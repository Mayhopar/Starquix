/**
 * Component-library endpoints: scan/read/save/categorize/delete. Moved
 * verbatim from vite-plugin/index.ts configureServer. (The component-dir
 * watcher stays in index.ts — it is entangled with the snapshot-patcher
 * watcher pipeline.)
 */
import * as path from 'path';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import type { SqServerContext } from './context';
import { ComponentFileError, deleteComponentFile } from './componentFiles';

function extractComponentHtml(fullHtml: string): string {
  // Remove doctype, html, head, body wrappers — extract the component content
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    let content = bodyMatch[1];
    // Remove bridge script and HMR scripts
    content = content.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
    return content;
  }
  return fullHtml;
}

export function registerComponentsEndpoints(ctx: SqServerContext): void {
  const { server, projectRoot, readJsonBody, formatError, resolveComponentPath } = ctx;

  // Component scanning endpoint
  server.middlewares.use('/__sq/scan-components', async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const source = url.searchParams.get('source') || 'built-in';

    try {
      // task-136: scan the opened local project's own src/components (files-truth).
      // Previews are the raw frontmatter-stripped template — user projects have
      // no __component-preview SSR route (ledger L7).
      if (source === 'local') {
        const dir = url.searchParams.get('path') || '';
        if (!dir || !existsSync(dir)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unknown project folder' }));
          return;
        }
        const { scanComponents } = await import('../../../../preview-template/src/plugins/sq-project-fs.js');
        const scanned = await scanComponents(dir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(scanned));
        return;
      }

      if (source !== 'built-in') {
        // Legacy non-built-in sources (removed local-folder mode) — return []
        // so stale clients don't log 4xx.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }

      // Scan built-in library from preview-template
      const previewTemplateRoot = path.join(projectRoot, '..', 'preview-template');
      const componentsDir = path.join(previewTemplateRoot, 'src', 'components', 'library');

      const { discoverComponents } = await import('../component-discovery.js');
      const components = await discoverComponents(componentsDir);

      // For each component, try to fetch pre-rendered HTML from the preview endpoint.
      // Fallback: read the raw .astro file and strip frontmatter to get the HTML template.
      const previewUrl: string | null = null; // Phase 6: no :4321 renderer — previews are the frontmatter-stripped template
      const results = await Promise.all(
        components.map(async (comp) => {
          let html = '';

          // Try 1: Fetch pre-rendered HTML from the preview endpoint (SSR)
          try {
            if (previewUrl) {
              const compPath = `library/${comp.name}`;
              const resp = await fetch(`${previewUrl}/__component-preview/${compPath}`);
              if (resp.ok) {
                html = await resp.text();
                html = extractComponentHtml(html);
              }
            }
          } catch (err) {
            console.warn(`[scan-components] Preview fetch failed for ${comp.path}:`, err);
          }

          // Fallback: read the raw .astro file and extract the HTML template
          if (!html) {
            try {
              const rawContent = await readFile(comp.absolutePath, 'utf-8');
              // Strip frontmatter (--- ... ---) to get the template HTML
              const stripped = rawContent.replace(/^---[\s\S]*?---\s*/, '');
              html = stripped.trim();
            } catch (err) {
              console.warn(`[scan-components] Fallback read failed for ${comp.path}:`, err);
            }
          }

          return {
            name: comp.name,
            path: `library/${comp.path}`,
            source,
            html,
            category: comp.category,
            props: comp.props,
            slots: comp.slots,
            dependencies: comp.dependencies,
            frontmatter: comp.frontmatter,
            pageTemplate: comp.pageTemplate,
            defaultChildren: comp.defaultChildren,
            contentBound: comp.contentBound,
            theme: comp.theme,
            section: comp.section,
          };
        })
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  // Get current HTML for a single component (for comparing instance state vs source)
  server.middlewares.use('/__sq/component-html', async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const componentPath = url.searchParams.get('path');
    if (!componentPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path' }));
      return;
    }

    try {
      const filePath = resolveComponentPath(componentPath);
      const content = await readFile(filePath, 'utf-8');
      // ?raw=1 returns the FULL file (frontmatter included) — the server-mode
      // master-editor append path needs it to inject imports without
      // clobbering @category/@page-template markers (WC is not booted there).
      if (url.searchParams.get('raw')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(content);
        return;
      }
      // Strip frontmatter to get raw HTML template
      const html = content.replace(/^---[\s\S]*?---\s*/, '').trim();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Component not found' }));
    }
  });

  // Save-as-component endpoint: save HTML as a new .astro component file
  server.middlewares.use('/__sq/save-component', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        name: string;
        category?: string;
        astroContent: string;
      };

      const { name, category, astroContent } = body;
      if (!name || !astroContent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing name or astroContent' }));
        return;
      }

      const componentsDir = path.join(projectRoot, '..', 'preview-template', 'src', 'components', 'library');

      const categoryDir = category ? path.join(componentsDir, category.toLowerCase()) : componentsDir;
      await mkdir(categoryDir, { recursive: true });

      const filePath = path.join(categoryDir, `${name}.astro`);
      await writeFile(filePath, astroContent, 'utf-8');

      // Trigger re-scan notification
      server.ws.send({ type: 'custom', event: 'sq:components-changed', data: {} });

      const relativePath = path.relative(componentsDir, filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, path: relativePath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  // Delete a component file from disk
  server.middlewares.use('/__sq/delete-component', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        componentPath: string;
      };

      const { componentPath } = body;
      if (!componentPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing componentPath' }));
        return;
      }

      // Shared with the local-project routes — one guard, one implementation
      // (see server/componentFiles.ts).
      const componentsDir = path.join(projectRoot, '..', 'preview-template', 'src', 'components');
      let content: string;
      try {
        content = await deleteComponentFile(componentsDir, componentPath);
      } catch (e) {
        const status = e instanceof ComponentFileError ? e.status : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        return;
      }

      // Trigger re-scan notification
      server.ws.send({ type: 'custom', event: 'sq:components-changed', data: {} });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, content }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });
}
