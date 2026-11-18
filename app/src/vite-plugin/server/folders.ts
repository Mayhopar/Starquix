/**
 * Folder-manifest endpoints. The manifest is the source of truth for the
 * Assets panel's folder tree; it names components by scanned path and never
 * moves a file.
 *
 * Two roots, one shape:
 *   /__sq/folders        -> preview-template/src/components/library/.sq-folders.json
 *   /__sq/local/folders  -> <project>/.starquix/folders.json   (?path= / body.path)
 *
 * Whole-file replace, last-write-wins — a single-user local file needs no merge.
 * Design: docs/plans/2026-08-09-component-folders-redesign-design.md §2.
 */
import * as path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import type { ServerResponse } from 'http';
import type { SqServerContext } from './context';
import { readFolderManifest } from '../../../../preview-template/src/plugins/sq-project-fs.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function writeManifest(file: string, manifest: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

export function registerFoldersEndpoints(ctx: SqServerContext): void {
  const { server, projectRoot, readJsonBody, notifyWs } = ctx;

  const builtInFile = path.join(
    projectRoot, '..', 'preview-template', 'src', 'components', 'library', '.sq-folders.json',
  );

  server.middlewares.use('/__sq/folders', async (req, res, next) => {
    try {
      if (req.method === 'GET') return json(res, 200, await readFolderManifest(builtInFile));
      if (req.method === 'POST') {
        const { manifest } = (await readJsonBody(req)) as { manifest: unknown };
        await writeManifest(builtInFile, manifest);
        notifyWs('sq:components-changed');
        return json(res, 200, { success: true });
      }
      return next();
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  // /__sq/local/folders moved to the shared route table (sq-project-fs-routes.js).
}
