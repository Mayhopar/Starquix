import DiffMatchPatch from 'diff-match-patch';

// @types/diff-match-patch types patch_make as returning constructors; the runtime returns patch_obj instances.
type Patch = DiffMatchPatch.patch_obj;
type Patches = ReturnType<DiffMatchPatch['patch_make']>;
const INSERT = 1, DELETE = -1; // diff-match-patch operation codes
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function engine(): DiffMatchPatch {
  const dmp = new DiffMatchPatch();
  dmp.Diff_Timeout = 0.5; // a huge file gets a coarser diff, still a correct one
  dmp.Match_Threshold = 0.1; // context the other side rewrote is a conflict, never a fuzzy landing
  dmp.Match_Distance = 1_000_000; // an outside insert far above may shift a patch anywhere
  dmp.Patch_DeleteThreshold = 0.1; // deleting text the other side edited is a conflict
  return dmp;
}

/** A7: an insert whose surroundings the newer side typed into lands next to the
 *  half of its context that is still there, so both texts stay. */
function insertAtAnchor(patch: Patch, text: string): string | null {
  const at = patch.diffs.findIndex(([op]) => op === INSERT);
  if (at < 0 || patch.diffs.some(([op], i) => op === DELETE || (op === INSERT && i !== at))) return null;
  const joined = (part: Patch['diffs']) => part.map(([, s]) => s).join('');
  const before = joined(patch.diffs.slice(0, at)), after = joined(patch.diffs.slice(at + 1)), insert = patch.diffs[at][1];
  // The longest piece of the context next to the insert that still occurs exactly once (3+ characters).
  const unique = (s: string) => s.length >= 3 && text.indexOf(s) >= 0 && text.indexOf(s) === text.lastIndexOf(s);
  for (let k = before.length; k >= 3; k--) {
    const anchor = before.slice(before.length - k);
    if (!unique(anchor)) continue;
    const i = text.indexOf(anchor) + anchor.length;
    return text.startsWith(insert, i) ? text : text.slice(0, i) + insert + text.slice(i); // A10 at the anchor
  }
  for (let k = after.length; k >= 3; k--) {
    const anchor = after.slice(0, k);
    if (!unique(anchor)) continue;
    const i = text.indexOf(anchor);
    return text.slice(i - insert.length, i) === insert ? text : text.slice(0, i) + insert + text.slice(i);
  }
  return null;
}

/**
 * Agent multiplayer (owner 2026-11-08: newest change wins). Re-apply OLDER's
 * changes (base → older) onto NEWER, character by character, in any number of
 * places. Where both changed the same characters NEWER keeps its text; a change
 * NEWER already carries is never applied twice. Never refuses. Ledger A in
 * docs/plans/2026-11-08-agent-multiplayer-design.md.
 */
export function mergeText(base: string, older: string, newer: string): string {
  return mergeTextReport(base, older, newer).text;
}

/** mergeText plus whether every one of OLDER's changes is in the result
 *  (`clean`) — a multi-file edit stays atomic on it (ledger B5a). */
export function mergeTextReport(base: string, older: string, newer: string): { text: string; clean: boolean } {
  if (older === base || older === newer) return { text: newer, clean: true };
  if (newer === base) return { text: older, clean: true };
  const dmp = engine();
  let text = newer, clean = true;
  for (const patch of dmp.patch_make(base, older) as unknown as Patch[]) {
    const from = dmp.diff_text1(patch.diffs), to = dmp.diff_text2(patch.diffs);
    if (!text.includes(from) && text.includes(to)) continue; // A10: already there
    const [next, [landed]] = dmp.patch_apply([patch] as unknown as Patches, text);
    const anchored = landed ? next : insertAtAnchor(patch, text);
    if (anchored === null) clean = false; // A6: newer keeps its text
    else text = anchored;
  }
  return LONE_SURROGATE.test(text) && !LONE_SURROGATE.test(newer) ? { text: newer, clean: false } : { text, clean }; // A14
}
