/**
 * Editor → source write-back: push overrides back to .astro files (targeted
 * AST write-back — NEVER codegen), plus the element-source read/write pair.
 * The two /__sq/element-source registrations are ORDER-SENSITIVE (GET first,
 * then POST) and move as a unit. Moved verbatim from vite-plugin/index.ts.
 * Guarded by server/__tests__/writeBack.characterization.test.ts.
 */
import { readFile, writeFile } from 'fs/promises';
import { getElementSource, updateElementSource } from '../ast-updater';
import { applyWriteBackOverrides } from '../write-back-apply';
import type { SqServerContext } from './context';

export function registerWriteBackEndpoints(ctx: SqServerContext): void {
  const { server, readJsonBody, formatError, resolveComponentPath, resolveFilePath, queueFileWrite, suppressHmrFor } = ctx;

  // --- Element Source Tab endpoints ---

  // GET endpoint to read element source
  server.middlewares.use('/__sq/element-source', async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const file = url.searchParams.get('file');
      const line = parseInt(url.searchParams.get('line') || '', 10);
      const column = parseInt(url.searchParams.get('column') || '', 10);

      if (!file || isNaN(line) || isNaN(column)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing required params: file, line, column' }));
        return;
      }

      const filePath = resolveFilePath(file);
      const content = await readFile(filePath, 'utf-8');

      const result = getElementSource(content, { file: filePath, line, column });

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error('[sq-source] Error reading element source:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  // POST endpoint to write element source
  server.middlewares.use('/__sq/element-source', async (req, res, next) => {
    if (req.method !== 'POST') {
      return next();
    }

    try {
      const { file, startLine, endLine, newSource } = (await readJsonBody(req)) as {
        file: string; startLine: number; endLine: number; newSource: string;
      };

      if (!file || !startLine || !endLine || newSource === undefined) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing required fields: file, startLine, endLine, newSource' }));
        return;
      }

      const filePath = resolveFilePath(file);

      await queueFileWrite(filePath, async () => {
        const content = await readFile(filePath, 'utf-8');
        const updatedContent = updateElementSource(content, startLine, endLine, newSource);
        suppressHmrFor(filePath);
        await writeFile(filePath, updatedContent, 'utf-8');
      });

      console.log('[sq-source] Wrote element source to:', filePath);

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error('[sq-source] Error writing element source:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  // Write-back endpoint: push overrides from editor back to .astro source files
  server.middlewares.use('/__sq/write-back-component', async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        astroSource: string;
        overrides: {
          classOverrides?: Record<string, string>;
          textOverrides?: Record<string, string>;
          imageOverrides?: Record<string, Record<string, string>>;
          linkOverrides?: Record<string, Record<string, string>>;
          attributeOverrides?: Record<string, Record<string, string>>;
          orderOverrides?: string[];
          orderPermutation?: number[];
          orderRendered?: string[];
          deletedSelectors?: string[];
          drawnReconcile?: Array<{ markup: string; parentSelector?: string }>;
        };
      };

      const { astroSource, overrides } = body;
      if (!astroSource) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing astroSource' }));
        return;
      }

      // Resolve the full file path
      const filePath = resolveComponentPath(astroSource);
      const content0 = await readFile(filePath, 'utf-8');
      const result = await applyWriteBackOverrides(content0, filePath, overrides);

      if (!result.ok) {
        console.warn('[SQ-LAYOUT] write-back: refused — delete would empty file body', {
          astroSource, refusedSelectors: result.refusedSelectors,
        });
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'refused: delete would empty file body',
          refusedSelectors: result.refusedSelectors,
        }));
        return;
      }

      // Only touch disk / suppress HMR when something actually changed.
      // An all-skipped request used to rewrite the identical file and
      // return a bare 200 — the "OK on silently-skipped writes" trap.
      if (result.changed) {
        await queueFileWrite(filePath, async () => {
          suppressHmrFor(filePath);
          await writeFile(filePath, result.content, 'utf-8');
        });
        // A changed layout must reach every open editor NOW: useLayoutLibrary
        // refetches on this event and pages rebase their chrome on the fresh
        // body (selectPageComponents). Without it, a master reorder/edit only
        // showed up after a full editor reload (proven live 2026-08-27).
        if (astroSource.startsWith('layouts/')) {
          ctx.notifyWs('sq:layouts-changed');
        }
      }

      // Return new content + report so the client can mirror the write
      // AND surface skipped selectors.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        content: result.content,
        report: result.report,
        changed: result.changed,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });
}
