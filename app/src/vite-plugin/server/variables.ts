/**
 * CSS-variables endpoints. Owns the cachedVariablesCSS state (module scope —
 * shared across plugin instances, matching the original index.ts top-level
 * `let`); getCachedVariablesCSS() is the read accessor for other modules.
 * Endpoint bodies moved verbatim from vite-plugin/index.ts configureServer.
 */
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import type { SqServerContext } from './context';

// Cached variables CSS — served via /__sq/get-variables-css for instant availability
let cachedVariablesCSS = '';

/** Read accessor for other modules. */
export function getCachedVariablesCSS(): string {
  return cachedVariablesCSS;
}

export function registerVariablesEndpoints(ctx: SqServerContext): void {
  const { server, projectRoot, readJsonBody, sendHttpResult } = ctx;

  // Load cached variables CSS from disk on startup
  const varsCSSPath = path.join(projectRoot, 'src/styles/variables.css');
  if (existsSync(varsCSSPath)) {
    try { cachedVariablesCSS = readFileSync(varsCSSPath, 'utf-8'); } catch { /* ignore */ }
  }

  // NOTE (task-174): POST /__sq/write-variables was DELETED. Its only caller was
  // `ViteVariablesWriter.sendViaHttp('/__sq/write-variables')`, removed in
  // 1d4d6c59 (2026-06-11); after that it sat here for two months writing
  // nothing, while accepting an arbitrary `{ projectRoot, filePath }` and
  // `path.join`-ing them with no write-path guard. Variables reach disk in
  // exactly ONE place: `export/generateAstro.ts`, which emits
  // `src/styles/variables.css` together with the `@import` into global.css that
  // makes it load. A variables file written without that import is inert —
  // nothing in preview-template or in an arbitrary user project imports one.

  // GET /__sq/get-variables-css — return cached CSS for bridge initialization
  server.middlewares.use('/__sq/get-variables-css', (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.setHeader('Content-Type', 'text/css');
    res.end(cachedVariablesCSS);
  });

  // POST /__sq/cache-variables-css — update in-memory cache only (no disk write)
  server.middlewares.use('/__sq/cache-variables-css', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const { css } = (await readJsonBody(req)) as { css: string };
      cachedVariablesCSS = css;
      sendHttpResult(res, true);
    } catch (error) {
      sendHttpResult(res, false, error);
    }
  });
}
// NOTE: /__sq/{write,read}-variables-json were deleted — a single shared
// variables.json leaked tokens across projects; the Yjs doc is the only store.
