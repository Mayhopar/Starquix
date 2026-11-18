/**
 * Component-file endpoints for a LOCAL project, plus the built-in library's
 * missing rename. Both call the same componentFiles.ts helpers — the runtime
 * picks the root directory and nothing else.
 *
 *   /__sq/rename-component        -> preview-template/src/components   (was MISSING;
 *                                    AssetsPanel already fetched it, so WC rename
 *                                    was a silent no-op that reverted on rescan)
 *   /__sq/local/component-create  -> <project>/src/components
 *   /__sq/local/component-rename  -> <project>/src/components
 *   /__sq/local/component-promote -> moves into/out of <project>/src/components/sq
 *   /__sq/local/component-delete  -> <project>/src/components
 *
 * The local routes take the project folder in the POST body (`path`) and
 * refuse an unknown folder, exactly like /__sq/local/folders.
 */
import * as path from 'path';
import type { ServerResponse } from 'http';
import type { SqServerContext } from './context';
import { ComponentFileError, renameComponentFile } from './componentFiles';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, error: unknown): void {
  const status = error instanceof ComponentFileError ? error.status : 500;
  json(res, status, { error: error instanceof Error ? error.message : String(error) });
}

export function registerComponentFileEndpoints(ctx: SqServerContext): void {
  const { server, projectRoot, readJsonBody, notifyWs } = ctx;

  const builtInRoot = path.join(projectRoot, '..', 'preview-template', 'src', 'components');

  // The built-in library's rename. AssetsPanel has POSTed here since the panel
  // was written, but no handler existed — the fetch fell through to Vite's SPA
  // catch-all, so the rename "worked" until the next scan put the old name back.
  server.middlewares.use('/__sq/rename-component', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const { componentPath, newName } = (await readJsonBody(req)) as { componentPath: string; newName: string };
      const nextPath = await renameComponentFile(builtInRoot, componentPath, newName);
      notifyWs('sq:components-changed');
      json(res, 200, { success: true, path: nextPath });
    } catch (error) {
      fail(res, error);
    }
  });

  // /__sq/local/component-* and /__sq/local/layout-* moved to the shared
  // route table (sq-project-fs-routes.js) registered by localProject.ts.
}
