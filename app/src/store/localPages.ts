/**
 * task-145: local-mode page creation. Files are truth — the REAL
 * src/pages/<slug>.astro is written FIRST via the host endpoint; only on
 * success does the doc get a page, keyed by localPageId(route) with
 * name = route (the seeding convention Editor's iframe mapping relies on).
 * A failed write adds NOTHING — no doc-only ghost page.
 */
import type * as Y from 'yjs';
import { applyCommand } from './commands';
import { localPageId, localPostTargetFor, discoverPagesFromPaths, type LocalPageRef } from '@/utils/localMode';
import { contentOps } from '@/core/collections/content-ops';
import type { PushStructuralUndo } from './structuralUndo';
import type { MutationSnapshot } from './documentMutation';
import { acceptFileChanges, finishAcceptedFiles, preparePageFilePlan, projectIdForFolder, type PageFilePlan } from '@/services/durableEdits/fileAcceptance';

export async function createLocalDocPage(doc: Y.Doc, projectPath: string, name: string): Promise<string> {
  projectIdForFolder(projectPath, doc);
  let body!: PageFilePlan;
  const accepted = await acceptFileChanges(projectPath, async () => {
    body = await preparePageFilePlan(projectPath, { action: 'create', name }); return body.files;
  }, doc, staged => {
    if (!applyCommand(staged, {
    type: 'ADD_PAGE',
    page: { id: localPageId(body.route), name: body.route, rootElementIds: [], children: [] },
    })) throw new Error('Page creation refused');
  });
  void finishAcceptedFiles(accepted);
  // task-133 Task 9 review: the session pages list (/__sq/local/pages) is
  // fetched ONCE at instance boot — announce the new page so useLocalInstance
  // appends its {route, file} mapping. Without this, resolveLocalPageFile
  // returns null for the new page and every follow-up structural write
  // refuses ("no source file yet" retry dead-end). Lives HERE (not at the
  // callers) so the UI Add-Page and the AI add_page both get it.
  if (typeof window !== 'undefined' && body.file) {
    window.dispatchEvent(new CustomEvent('sq:local-page-created', {
      detail: { route: body.route, file: body.file, editable: true },
    }));
  }
  return localPageId(body.route);
}

// ── task-148: page delete/restore ───────────────────────────────────────────
// Deleting a local page removes a REAL file, so it is file-FIRST (a doc-only
// delete left the file on disk and the page re-seeded from /__sq/local/pages
// on the next open — live-caught: six orphan new-page*.astro files). It is
// also UNDOABLE: the delete endpoint hands back the file's bytes, which ride a
// structural undo entry, and ⌘Z writes them back verbatim. The four functions
// below are the halves the undo replay (store/structuralUndo.ts) composes —
// keep the fetch and the doc mirror separable, never fused.

/** File half of the delete. Endpoint takes the doc page ID, never a path —
 *  the file is resolved server-side from the same discovery the pages list
 *  uses. Throws the server's reason on refusal. */
export async function deleteLocalPageFile(
  projectPath: string,
  pageId: string,
): Promise<{ route: string; file: string; content?: string }> {
  let body!: PageFilePlan;
  const accepted = await acceptFileChanges(projectPath, async () => {
    body = await preparePageFilePlan(projectPath, { action: 'delete', pageId }); return body.files;
  });
  void finishAcceptedFiles(accepted);
  return { route: body.route, file: body.file ?? '', content: body.content };
}

/** File half of the restore (⌘Z). The target is resolved server-side from the
 *  route; the endpoint refuses to overwrite a file that came back by other
 *  means. */
export async function restoreLocalPageFile(
  projectPath: string,
  route: string,
  content: string,
  file?: string,
): Promise<{ route: string; file: string }> {
  let body!: PageFilePlan;
  const accepted = await acceptFileChanges(projectPath, async () => {
    body = await preparePageFilePlan(projectPath, { action: 'restore', route, file, content }); return body.files;
  });
  void finishAcceptedFiles(accepted);
  return { route: body.route, file: body.file ?? file ?? '' };
}

/** Doc half of the delete: drop the page row + announce it so useLocalInstance
 *  drops the route→file mapping from the session pages list (fetched once at
 *  instance boot — a stale mapping would keep pointing structural writes at a
 *  file that no longer exists). */
export function applyLocalPageDeleteToDoc(doc: Y.Doc, pageId: string, route: string, file: string): void {
  applyCommand(doc, { type: 'DELETE_PAGE', pageId });
  if (typeof window !== 'undefined' && file) {
    window.dispatchEvent(new CustomEvent('sq:local-page-deleted', { detail: { route, file } }));
  }
}

/** Doc half of the restore: re-add the page row with the id and name SEEDING
 *  would produce (localPageId(route) / name = route), so the iframe route
 *  mapping and any later reopen agree, and announce it like a fresh create. */
export function applyLocalPageRestoreToDoc(doc: Y.Doc, route: string, file: string): string {
  const id = localPageId(route);
  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { id, name: route, rootElementIds: [], children: [] },
  });
  if (typeof window !== 'undefined' && file) {
    window.dispatchEvent(new CustomEvent('sq:local-page-created', {
      detail: { route, file, editable: true },
    }));
  }
  return id;
}

/** A local page's children are DERIVED rows — dynamic-route instances that
 *  seeding nests under the page linking them (seedLocalDynamicPages); they
 *  render from their own route file, not this one. Deleting the linking page
 *  lifts them to the top level where it stood instead of refusing the delete
 *  (DELETE_PAGE never cascades a root page — owner 2026-09-24, page-4). */
export function promoteLocalChildPages(doc: Y.Doc, pageId: string): void {
  const page = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  const children = (page?.get('children') as Y.Array<string> | undefined)?.toArray() ?? [];
  const at = Math.max(0, doc.getArray<string>('rootPages').toArray().indexOf(pageId));
  children.forEach((childId, i) => {
    applyCommand(doc, { type: 'MOVE_PAGE', pageId: childId, newParentId: null, index: at + 1 + i });
  });
}

/**
 * The Delete Page gesture. File first, doc second, then ONE structural undo
 * entry on the shared UndoContext stack (never takeSnapshot — a doc snapshot
 * cannot unwrite a file, and double-pushing would make ⌘Z lie). A reply
 * without bytes (older host build) still deletes the doc row — the file is
 * already gone — but offers no undo entry, because there is nothing to
 * write back.
 */
export async function deleteLocalDocPage(
  doc: Y.Doc,
  projectPath: string,
  pageId: string,
  pushUndo?: PushStructuralUndo,
  /** Claims the editor's undo snapshot for a POST page (its post file + row come back with one ⌘Z). */
  claimUndo?: () => MutationSnapshot | undefined,
): Promise<void> {
  projectIdForFolder(projectPath, doc);
  // "Every MDX in a collection is a page" — a dynamic-instance post page has
  // no page file of its own (it renders via /<coll>/[slug].astro), so deleting
  // it deletes its POST — at once, and ONE ⌘Z brings the post file and the row
  // back, like the Content-tab post delete (owner 2026-11-10: delete anything
  // AND undo). (Refusing with "no page file matches" was the owner's
  // 2026-08-10 report.)
  const pageRow = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  const pageName = (pageRow?.get('name') as string) ?? '';
  if (pageName.split('/').filter(Boolean).length >= 2) {
    const target = localPostTargetFor(pageName, await contentOps.fetchCollections());
    if (target) {
      const accepted = await acceptFileChanges(projectPath, async () => (await preparePageFilePlan(projectPath, { action: 'delete-post', ...target })).files, doc, staged => {
        if (!applyCommand(staged, { type: 'DELETE_PAGE', pageId })) throw new Error('Post page deletion refused');
      }, claimUndo?.());
      void finishAcceptedFiles(accepted);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('sq:content-changed'));
      return;
    }
  }
  let plan!: PageFilePlan;
  const accepted = await acceptFileChanges(projectPath, async () => {
    plan = await preparePageFilePlan(projectPath, { action: 'delete', pageId }); return plan.files;
  }, doc, staged => {
    promoteLocalChildPages(staged, pageId);
    if (!applyCommand(staged, { type: 'DELETE_PAGE', pageId })) throw new Error('Page deletion refused');
  });
  const { route, file, content } = plan;
  if (content !== undefined) pushUndo?.({
    structuralOp: {
      forward: [{ kind: 'page-delete', folder: projectPath, pageId, route, file }],
      inverse: [{ kind: 'page-restore', folder: projectPath, pageId, route, file, content }],
    },
  });
  void finishAcceptedFiles(accepted);
  announceLocalPage('deleted', route, file);
}

export function announceLocalPage(kind: 'created' | 'deleted', route: string, file: string): void {
  if (typeof window !== 'undefined' && file) window.dispatchEvent(new CustomEvent(`sq:local-page-${kind}`, {
    detail: { route, file, ...(kind === 'created' ? { editable: true } : {}) },
  }));
}

/**
 * task-270 — files are truth: a page FILE that appeared or vanished by another
 * road than Add / Delete Page (the AI's write_file, an agent in the terminal,
 * git) becomes or stops being a page, with the id and name seeding gives it at
 * open. `gone` = the pages whose file left. Static routes only: a dynamic
 * route's rows come from discovery. Returns the ids of the pages it added.
 */
export function followLocalPageFiles(doc: Y.Doc, created: string[], gone: LocalPageRef[] = []): string[] {
  const pages = doc.getMap('pages');
  const added = discoverPagesFromPaths(created)
    .filter(page => !page.dynamic && !pages.has(localPageId(page.route)))
    .map(page => applyLocalPageRestoreToDoc(doc, page.route, page.file));
  for (const { route, file } of gone) {
    const id = localPageId(route);
    if (!pages.has(id)) continue;
    promoteLocalChildPages(doc, id);
    applyLocalPageDeleteToDoc(doc, id, route, file);
  }
  return added;
}

/** Every disk change in the open project (`sq:files-changed`: our own writes
 *  echoed, and any outside writer's) reaches the doc's pages. `pages` = the
 *  session's route→file list: a removed folder names no file, the list knows
 *  which pages lived under it. Returns the unsubscribe. */
export function watchLocalPageFiles(doc: Y.Doc, projectId: string, pages: LocalPageRef[]): () => void {
  const onFiles = (e: Event): void => {
    const { projectId: id, files, gone } = (e as CustomEvent<{ projectId: string; files: string[]; gone: string[] }>).detail;
    if (id === projectId) followLocalPageFiles(doc, files, pages.filter(page => gone.some(path => page.file === path || page.file.startsWith(`${path}/`))));
  };
  window.addEventListener('sq:files-changed', onFiles);
  return () => window.removeEventListener('sq:files-changed', onFiles);
}
