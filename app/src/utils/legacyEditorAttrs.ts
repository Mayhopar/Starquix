/**
 * Doc-era editor machinery that the pre-unification export baked into real
 * `.astro` files: `data-key` (doc element ids), a literal `data-sq-source`
 * (`element-…:1:1` — the tagger adds the real file:line:col at serve time),
 * `data-with-props` and `contenteditable='false'`. In files-truth the bridge
 * reads `data-key` BEFORE `data-sq-source`, so a baked key turns a source
 * element into a doc key and every structural edit on it is refused.
 * None of them belongs in a user's source or on a published site.
 */
import { db } from '@/db';
import { putProjectFiles } from '@/db/projectFiles';

const LEGACY_ATTRS = /\s+(?:data-key|data-sq-source|data-with-props)=(?:"[^"]*"|'[^']*')|\s+contenteditable=(?:"false"|'false')/g;

/** A doc-era element id — never hand-authored, so an imported project that
 *  happens to use `data-key` or `contenteditable` is left alone. */
const DOC_ERA_ID = /\s(?:data-key|data-sq-source)=["']element-/;

export function hasLegacyEditorAttrs(source: string): boolean {
  return DOC_ERA_ID.test(source);
}

export function stripLegacyEditorAttrs(source: string): string {
  return source.replace(LEGACY_ATTRS, '');
}

/** Only markup the doc export generated: Astro sources under src/. */
export const isLegacyAttrTarget = (path: string): boolean => /^src\/.*\.astro$/.test(path);

/**
 * Projects converted before the export stripped editor attributes carry
 * doc-era `data-key`s in their pages (every structural edit on them was
 * refused). Heal them once, before boot, so the instance mounts clean files.
 * Skipped while journal rows await materialization: their before-bytes must
 * still match what is on disk.
 */
export async function healLegacyEditorAttrs(projectId: string): Promise<number> {
  const pending = await db.durableEdits.where('projectId').equals(projectId).filter((r) => !r.materializedAt).count();
  if (pending) return 0;
  const rows = await db.projectFiles.where('projectId').equals(projectId).toArray();
  const dec = new TextDecoder(), enc = new TextEncoder();
  const healed = rows.flatMap((r) => {
    if (!r.isText || !isLegacyAttrTarget(r.path)) return [];
    const text = dec.decode(r.content);
    return hasLegacyEditorAttrs(text) ? [{ path: r.path, content: enc.encode(stripLegacyEditorAttrs(text)) }] : [];
  });
  if (healed.length) await putProjectFiles(projectId, healed);
  return healed.length;
}
