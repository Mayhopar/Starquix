/**
 * Vite Plugin: Source Tracing
 *
 * Injects `data-sq-source="file:line:column"` attributes onto all elements
 * during compilation. This enables click-to-edit functionality by mapping
 * DOM elements back to their source locations.
 */

import type { Plugin, ViteDevServer } from 'vite';
import { parse } from '@astrojs/compiler';
import * as path from 'path';
import { readFile, writeFile, stat } from 'fs/promises';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { SnapshotPatcher } from './snapshot-patcher';
import { SNAPSHOT_IGNORE_RE } from './snapshot-shared';
import { maxSourceMtimeMs, isSnapshotStale, isBridgePartsFile } from './snapshot-staleness';
import { createSqServerContext } from './server/context';
import { registerSqEndpoints } from './server/registerEndpoints';
// task-132: tagger is shared with the local-mode spawned instance — single
// implementation lives in preview-template (parity law, no forked lookalike).
import { transformCompiledOutput } from '../../../preview-template/src/plugins/sq-tagging.js';

function warnBridgePartsEdit(): void {
  console.warn(
    '\n[sq-source] ⚠️  app/src/bridge/parts/*.ts edited — the dev iframe runs the GENERATED\n' +
    '            preview-template/public/scripts/bridge.js, which is now stale.\n' +
    '            Run: node scripts/build-snapshot.js  (regenerates bridge.js + snapshot;\n' +
    '            never hand-edit bridge.js). Then reload the editor to apply.\n' +
    '            Freshness guard: app/src/bridge/__tests__/snapshot-parity.test.ts\n'
  );
}


export interface SqSourcePluginOptions {
  enabled?: boolean;
  extensions?: string[];
  exclude?: string[];
  pathMode?: 'relative' | 'absolute';
  root?: string;
}

/**
 * Create the Vite plugin for source tracing
 */
export function sqSourcePlugin(options: SqSourcePluginOptions = {}): Plugin {
  const {
    enabled,
    extensions = ['.astro'],
    exclude = ['node_modules'],
    pathMode = 'relative',
  } = options;

  let projectRoot: string;
  let isDev: boolean;
  let isEnabled: boolean;

  const suppressHmrFiles = new Map<string, NodeJS.Timeout>();

  function suppressHmrFor(filePath: string): void {
    const existingTimeout = suppressHmrFiles.get(filePath);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeout = setTimeout(() => { suppressHmrFiles.delete(filePath); }, 5000);
    suppressHmrFiles.set(filePath, timeout);
  }

  function resolveFilePath(file: string, root?: string): string {
    if (path.isAbsolute(file)) return file;
    return path.resolve(root || projectRoot, file);
  }

  // File write queue to prevent race conditions (LWW problem)
  // Each file has its own queue of pending write operations
  const fileWriteQueues = new Map<string, Promise<void>>();

  /**
   * Queue a write operation for a file to prevent concurrent writes.
   * Writes to the same file are serialized; writes to different files run in parallel.
   */
  async function queueFileWrite<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const currentQueue = fileWriteQueues.get(filePath) ?? Promise.resolve();

    // Chain our operation after any pending operations for this file
    const newQueue = currentQueue
      .catch(() => {}) // Don't let previous errors block the queue
      .then(operation);

    // Store a void version of the promise for queue tracking
    // Keep a reference to compare against later (don't create new promise chains)
    const voidQueue = newQueue.then(() => {}).catch(() => {});
    fileWriteQueues.set(filePath, voidQueue);

    // Clean up after completion. Chain off voidQueue (never rejects) — a
    // .finally() on newQueue would create a derived promise that re-rejects
    // with nobody attached, surfacing failed writes as process-level
    // unhandledRejection after the caller already handled the error.
    void voidQueue.then(() => {
      // Remove from queue map if this is still the latest operation
      if (fileWriteQueues.get(filePath) === voidQueue) {
        fileWriteQueues.delete(filePath);
      }
    });

    return newQueue;
  }

  /**
   * Read a file, apply a transform, suppress HMR, and write it back — all inside queueFileWrite.
   */
  async function executeFileWrite(filePath: string, transform: (content: string) => Promise<string>): Promise<void> {
    await queueFileWrite(filePath, async () => {
      const content = await readFile(filePath, 'utf-8');
      const updated = await transform(content);
      suppressHmrFor(filePath);
      await writeFile(filePath, updated, 'utf-8');
    });
  }

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  return {
    name: 'vite-plugin-sq-source',
    enforce: 'pre',

    configResolved(config) {
      projectRoot = options.root || config.root;
      isDev = config.command === 'serve';
      isEnabled = enabled ?? isDev;
    },

    resolveId(id) {
      if (id === 'virtual:built-in-components') {
        return '\0virtual:built-in-components';
      }
    },

    async load(id) {
      if (id === '\0virtual:built-in-components') {
        const previewTemplateRoot = path.join(projectRoot, '..', 'preview-template');
        const componentsDir = path.join(previewTemplateRoot, 'src', 'components', 'library');
        const { discoverComponents: discover } = await import('./component-discovery.js');
        const components = await discover(componentsDir);

        const results = await Promise.all(
          components.map(async (comp) => {
            const rawContent = await readFile(comp.absolutePath, 'utf-8');
            const html = rawContent.replace(/^---[\s\S]*?---\s*/, '').trim();

            return {
              name: comp.name,
              path: `library/${comp.path}`,
              source: 'built-in',
              html,
              category: comp.category,
              props: comp.props,
              slots: comp.slots,
              dependencies: comp.dependencies,
              pageTemplate: comp.pageTemplate,
              defaultChildren: comp.defaultChildren,
              contentBound: comp.contentBound,
              theme: comp.theme,
              section: comp.section,
            };
          }),
        );

        return `export default ${JSON.stringify(results)};`;
      }
    },

    configureServer(server) {

      const resolveComponentPath = (astroSource: string): string => {
        if (path.isAbsolute(astroSource)) return astroSource;
        // Explicit built-in library path (starts with "library/")
        if (astroSource.startsWith('library/') || astroSource.startsWith('library\\')) {
          return path.join(projectRoot, '..', 'preview-template', 'src', 'components', astroSource);
        }
        // Layouts directory (layouts/<Name>.astro)
        if (astroSource.startsWith('layouts/') || astroSource.startsWith('layouts\\')) {
          return path.join(projectRoot, '..', 'preview-template', 'src', astroSource);
        }
        // Built-in library (handles paths without library/ prefix)
        return path.join(projectRoot, '..', 'preview-template', 'src', 'components', 'library', astroSource);
      };

      // Explicit context for extracted endpoint modules (server/registerEndpoints.ts).
      // The transport helpers live in createSqServerContext; they are
      // destructured here so the not-yet-extracted inline endpoints below
      // keep their exact call sites (single copy, no parallel helpers).
      const sqCtx = createSqServerContext(server, {
        projectRoot,
        executeFileWrite,
        queueFileWrite,
        suppressHmrFor,
        formatError,
        resolveComponentPath,
        resolveFilePath,
      });
      const { readJsonBody, sendWsResult, sendHttpResult } = sqCtx;

      registerSqEndpoints(sqCtx);



      // Watch component directories for changes and notify clients
      const watchedDirs = new Set<string>();

      function watchComponentsDir(dir: string) {
        if (watchedDirs.has(dir)) return;
        watchedDirs.add(dir);
        server.watcher.add(dir);
      }

      // Watch built-in library
      const previewTemplateRoot = path.join(projectRoot, '..', 'preview-template');
      const builtInLibDir = path.join(previewTemplateRoot, 'src', 'components', 'library');
      watchComponentsDir(builtInLibDir);

      // Without this, the editor reads a stale astro-snapshot.json (component
      // inserts, sq/ upgrades) and write-back edits to the template are missed.
      server.watcher.add(previewTemplateRoot);

      const snapshotPath = path.join(projectRoot, 'public', 'astro-snapshot.json');
      const buildSnapshotScript = path.join(projectRoot, '..', 'scripts', 'build-snapshot.js');

      // Latest snapshot version known to the server; served at /__sq/snapshot-version
      // so the editor can re-check drift on tab focus without fetching 4.5 MB.
      let lastKnownSnapshotVersion: string | null = null;
      async function readSnapshotVersionFromDisk(): Promise<string | null> {
        try {
          const raw = await readFile(snapshotPath, 'utf-8');
          return (JSON.parse(raw) as { version?: string }).version ?? null;
        } catch {
          return null;
        }
      }

      // Startup reconciliation (design doc G1): edits made while the dev server was
      // down never reached the snapshot. Detect via mtimes; heal via the canonical
      // build script (~0.16s; its hash guard makes false positives write-free).
      void (async () => {
        try {
          const [sourceMtime, snapStat] = await Promise.all([
            maxSourceMtimeMs(previewTemplateRoot),
            stat(snapshotPath).catch(() => null),
          ]);
          if (isSnapshotStale(sourceMtime, snapStat?.mtimeMs ?? null)) {
            console.warn('[snapshot] astro-snapshot.json is STALE (preview-template/ changed while the dev server was down) — rebuilding...');
            execFileSync(process.execPath, [buildSnapshotScript], { stdio: 'inherit' });
            console.warn('[snapshot] rebuild done — reload the editor tab if it was already open.');
          } else {
            console.log('[snapshot] astro-snapshot.json is fresh.');
          }
        } catch (err) {
          console.error('[snapshot] startup reconciliation failed — run `node scripts/build-snapshot.js` manually:', err);
        }
        lastKnownSnapshotVersion = await readSnapshotVersionFromDisk();
      })();

      server.middlewares.use('/__sq/snapshot-version', async (_req, res) => {
        if (lastKnownSnapshotVersion === null) {
          lastKnownSnapshotVersion = await readSnapshotVersionFromDisk();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ version: lastKnownSnapshotVersion }));
      });

      const snapshotPatcher = new SnapshotPatcher({
        snapshotPath,
        previewTemplateRoot,
        onFlush: (version) => {
          lastKnownSnapshotVersion = version;
          server.ws.send({ type: 'custom', event: 'sq:snapshot-updated', data: { version } });
        },
      });

      server.watcher.on('all', (event, changedPath) => {
        // G3 reminder (design doc): bridge parts are config-graph deps, so
        // editing them restarts the whole dev server and handleHotUpdate
        // never sees them — warn from the watcher, which fires first.
        if (event === 'change' && isBridgePartsFile(changedPath)) {
          warnBridgePartsEdit();
        }
        if (changedPath.endsWith('.astro')) {
          for (const dir of watchedDirs) {
            if (changedPath.startsWith(dir)) {
              server.ws.send({ type: 'custom', event: 'sq:components-changed', data: {} });
              break;
            }
          }
        }
        if (SNAPSHOT_IGNORE_RE.test(changedPath)) return;
        if (event === 'unlink' || event === 'unlinkDir') {
          snapshotPatcher.removeFile(changedPath);
        } else if (event === 'add' || event === 'change') {
          void snapshotPatcher.patchFile(changedPath);
        }
      });

    },

    handleHotUpdate({ file }) {
      if (isBridgePartsFile(file)) {
        warnBridgePartsEdit();
      }
      if (suppressHmrFiles.has(file)) {
        console.log('[sq-source] Suppressed HMR reload for:', file);
        return [];
      }
      return;
    },

    async transform(code, id) {
      if (!isEnabled) {
        return null;
      }

      const cleanId = id.split('?')[0];
      const ext = path.extname(cleanId);
      if (!extensions.includes(ext)) return null;

      if (exclude.some((pattern) => id.includes(pattern))) return null;

      if (!code.includes('$$render`') && !code.includes('$$render `') && !code.includes('__template(')) {
        return null;
      }

      console.log('[sq-source] Transforming Astro file:', id);

      try {
        // Read original source file - may fail if file was deleted
        let originalCode: string;
        try {
          originalCode = await readFile(cleanId, 'utf-8');
        } catch (readError) {
          // File might have been deleted or moved - not a fatal error
          console.warn(`[sq-source] Could not read source file ${cleanId}, skipping transform`);
          return null;
        }

        const result = await transformCompiledOutput(
          code,
          originalCode,
          cleanId,
          projectRoot,
          pathMode,
          parse
        );
        if (result) {
          console.log('[sq-source] Successfully injected data-sq-source into:', id);
        }
        return result;
      } catch (error) {
        console.error(`[sq-source] Error transforming ${id}:`, error);
        return null;
      }
    },
  };
}

export type { Plugin };
export default sqSourcePlugin;
