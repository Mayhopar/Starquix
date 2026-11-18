import * as Y from 'yjs';

/**
 * THE serializer for an element's live classOverrides Y-structure
 * (selector → bp → Y.Array<string>) to the plain persisted shape
 * (selector → bp → string[]), skipping empty bp arrays and empty selectors.
 * Shared by the editor flush mirror (bakeEditorMaster) and the blog binding
 * mirror (useBlogSlotMigration) — two copies drifted on guard-strictness
 * within a day of each other.
 *
 * NOTE: useProjectSync has a same-named PAGE serializer that deliberately
 * KEEPS empty arrays (toJSON round-trip) — different contract, do not merge.
 */
export function serializeElementClassOverrides(el: Y.Map<unknown>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  const yOverrides = el.get('classOverrides') as Y.Map<unknown> | undefined;
  yOverrides?.forEach((bySelector, selector) => {
    if (!(bySelector instanceof Y.Map)) return;
    const byBp: Record<string, string[]> = {};
    bySelector.forEach((tokens, bp) => {
      if (tokens instanceof Y.Array && tokens.length > 0) byBp[bp] = tokens.toArray() as string[];
    });
    if (Object.keys(byBp).length > 0) out[selector] = byBp;
  });
  return out;
}
