/**
 * Seamless canvas (plan docs/plans/2026-10-04-seamless-canvas-plan.md, Task
 * 1.6): typed text lives in <project>/.sq/drafts/ while the user types, so a
 * document replacement, crash or quit never loses it. A draft is a safety
 * net, not the save path (case 45): a failed write just waits for the next
 * debounce. It is cleared only once the text commit is ACCEPTED.
 */
import { localFetch } from '@/utils/sqLocalBase';
import { isLocalProjectId } from '@/utils/localMode';
import { resolveProjectedSourceLocation, isRetiredSourceIdentity } from '@/services/durableEdits/sourceIdentity';
import type { TextDraftPayload } from '@/bridge';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ViewportMessageContext } from './context';

export function handleTextDraft(ctx: ViewportMessageContext, payload: unknown): void {
  const d = payload as TextDraftPayload | null;
  if (!d || typeof d.key !== 'string' || typeof d.markup !== 'string' || typeof d.file !== 'string' || !d.file.startsWith('src/')) return;
  if (!isLocalProjectId(ctx.env.projectId ?? '')) return;
  void localFetch('/__sq/local/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })
    .catch(error => console.warn('[sq] draft write failed; the next keystroke retries', error));
}

/** Every window that has spoken as this viewport's frame (keyed by its ref). */
const frameWindows = new WeakMap<object, WeakSet<object>>();
export function rememberFrameWindow(frameRef: object, win: object): void {
  let seen = frameWindows.get(frameRef);
  if (!seen) frameWindows.set(frameRef, seen = new WeakSet());
  seen.add(win);
}
export function wasFrameWindow(frameRef: object, win: unknown): boolean {
  return !!win && typeof win === 'object' && !!frameWindows.get(frameRef)?.has(win);
}

export async function clearTextDraft(key: string): Promise<void> {
  await localFetch(`/__sq/local/draft?key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
}

type StoredDraft = TextDraftPayload & { updatedAt?: number };

const postDraft = (body: unknown, query = '') => localFetch(`/__sq/local/draft${query}`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Restore is owed once per NEW document (IFRAME_READY); an in-place refresh
 *  keeps the live edit, so it never restores. Keyed by the frame's ref. */
const restoreOwed = new WeakMap<object, boolean>();
export function armTextDraftRestore(ctx: ViewportMessageContext): void {
  restoreOwed.set(ctx.refs.iframe, true);
}

/**
 * Task 1.7 (cases 35/36, D7): re-enter edit mode with a draft typed before the
 * document was replaced. Identity must be PROVEN — keys are positional, and a
 * draft committed into the wrong element is corruption:
 *   1. same key AND same source version → restore;
 *   2. else project the draft's coordinate through the accepted identity maps
 *      → restore there and re-key the draft;
 *   3. else (retired identity / no such element) → orphan it: kept on disk in
 *      .sq/drafts/orphaned/, never applied.
 * One restore per document (newest first); the rest wait for the next one.
 */
export async function restoreTextDrafts(ctx: ViewportMessageContext, elements: ScannedElement[], route: string | null | undefined): Promise<void> {
  const projectId = ctx.env.projectId ?? '';
  if (!restoreOwed.get(ctx.refs.iframe) || !isLocalProjectId(projectId) || ctx.refs.isEditingText.current) return;
  restoreOwed.set(ctx.refs.iframe, false);
  let drafts: StoredDraft[];
  try { drafts = ((await (await localFetch('/__sq/local/draft')).json()) as { drafts?: StoredDraft[] }).drafts ?? []; }
  catch { return; }
  const mine = drafts.filter(d => d && typeof d.key === 'string' && d.page === (route ?? ''))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  for (const draft of mine) {
    const exact = elements.find(e => e.key === draft.key && (e.sourceLocation?.sourceVersion ?? '') === draft.sourceVersion);
    if (exact) { ctx.actions.sendEnterEditMode(draft.key, draft.markup); return; }
    const m = /^(.+?):(\d+):(\d+)(.*)$/.exec(draft.key);
    let target: ScannedElement | undefined;
    if (m) {
      try {
        const mapped = await resolveProjectedSourceLocation(projectId, { file: m[1], line: Number(m[2]), column: Number(m[3]), sourceVersion: draft.sourceVersion });
        const key = `${mapped.file}:${mapped.line}:${mapped.column}${m[4]}`;
        target = elements.find(e => e.key === key && (!mapped.sourceVersion || e.sourceLocation?.sourceVersion === mapped.sourceVersion));
      } catch (error) {
        if (!isRetiredSourceIdentity(error)) continue; // storage failure: keep the draft, decide next time
      }
    }
    if (!target) {
      console.warn('[sq] draft orphaned:', draft.key);
      await postDraft({ key: draft.key }, '?orphan=1').catch(() => {});
      continue;
    }
    const rekeyed: TextDraftPayload = { key: target.key, file: draft.file, sourceVersion: target.sourceLocation?.sourceVersion ?? '', markup: draft.markup, page: draft.page };
    await postDraft(rekeyed).catch(() => {});
    await clearTextDraft(draft.key);
    ctx.actions.sendEnterEditMode(target.key, draft.markup);
    return;
  }
}
