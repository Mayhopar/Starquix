/**
 * Files-truth export (Phase 2 Task 2.5): the project IS its files — zip the
 * Dexie rows as-is. No generator, no theme bundling: what boots is what ships.
 */
import JSZip from 'jszip';
import { db } from '@/db';
import type * as Y from 'yjs';
import { inspectAcceptedProject } from '@/services/durableEdits/acceptance';
import { selectProjectId } from '@/store/selectors';
import { assertNoUnpushedInstanceOverlays } from './instanceOverlayGuard';

function readExportRows(projectId: string, doc: Y.Doc) {
  return inspectAcceptedProject(projectId, async () => {
    if (!doc || selectProjectId(doc) !== projectId) throw new Error('The project document is not available for export.');
    const rows = await db.projectFiles.where('projectId').equals(projectId).toArray();
    const text = new TextDecoder();
    assertNoUnpushedInstanceOverlays(doc, new Map(rows.filter(r => r.isText && r.path.endsWith('.astro')).map(r => [r.path, text.decode(r.content)])));
    return rows;
  });
}

/** Publish to Cloudflare builds the folder on disk in main: the same Export guard, no zip (docs/plans/2026-10-16-cloudflare-one-click-design.md, ledger 38). */
export async function assertPublishable(projectId: string, doc: Y.Doc): Promise<void> {
  await readExportRows(projectId, doc);
}

export async function buildFilesTruthZip(projectId: string, doc: Y.Doc): Promise<Blob> {
  const rows = await readExportRows(projectId, doc);
  if (rows.length === 0) throw new Error('Project has no files');
  const zip = new JSZip();
  for (const r of rows) {
    const safe = r.path.replace(/\\/g, '/').split('/').filter((p) => p && p !== '..' && p !== '.').join('/');
    if (!safe || safe.startsWith('node_modules/') || safe.startsWith('.sq/')) continue;
    zip.file(safe, r.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function downloadFilesTruthZip(projectId: string, projectName: string, doc: Y.Doc): Promise<void> {
  const blob = await buildFilesTruthZip(projectId, doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName.replace(/[/\\:*?"<>|]/g, '-').replace(/^\.+/, '') || 'project'}.zip`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The deploy input over the rows: every file as its exact bytes (decoding
 *  "text" rows dropped a BOM and turned non-UTF-8 bytes into U+FFFD). */
export async function projectFilesAsArtifacts(projectId: string, projectName: string, doc: Y.Doc): Promise<{
  projectName: string;
  files: Array<{ path: string; content: string }>;
  binaries: Array<{ path: string; data: Uint8Array }>;
}> {
  const rows = await readExportRows(projectId, doc);
  if (rows.length === 0) throw new Error('Project has no files');
  const binaries = rows.filter((r) => !r.path.startsWith('node_modules/') && !r.path.startsWith('.sq/'))
    .map((r) => ({ path: r.path, data: r.content }));
  return { projectName, files: [], binaries };
}
