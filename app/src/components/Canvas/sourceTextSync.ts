/**
 * The `sourceText` observer's diff — extracted from ViewportFrame so the
 * prev-value cache transition is a value this can be tested on, not a closure
 * variable (same reason `reloadPreview.ts` and `restoreOverrides.ts` were
 * extracted from the same component).
 *
 * WHY THIS EXISTS — the round-5 defect it fixes.
 *
 * The observer answers "did this key's text change?" by comparing against the
 * value it saw last. That cache used to be MUTATED IN PLACE: an entry was
 * written when a value changed, and deleted only inside the `isUndoing` branch.
 * A Reset ("Discard changes on this placement") is a `'sync'` transaction, not
 * an undo — so it removed the doc entry while the cache kept the discarded
 * value. The next ⌘Z re-inserted exactly that string, `textContent !== prevText`
 * was false, and the observer emitted NOTHING while the frame had meanwhile
 * reloaded and was showing the source text. Confirmed live, not inferred:
 *
 *   Reset:  isUndoing=false docKeys=[] prevKeys=["…~p4317f4b4863ead18"]
 *           PRUNE-BRANCH removedKeysPresentInPrev=["…"] willPrune=false
 *   ⌘Z:     isUndoing=true  textContent="\n1" prevText="\n1" WILL_SEND=false
 *
 * THE FIX is structural, not a special case: the cache is now REBUILT from the
 * doc on every run (`nextPrev`), never merged. That is exactly what the class
 * tier (`ClassStoreContext` → `prevStateRef.current = next`) and the image tier
 * (`useSourceImageSync` → `prevAttributesRef.current = current`) already do,
 * which is why neither of them ever had this bug — verified by reading both, and
 * live: the identical Reset→⌘Z sequence repaints classes correctly.
 *
 * `removed` stays gated on `isUndoing` — that is the repaint semantic ("put it
 * back the way the source renders it"), and it matches the class tier, which
 * likewise gates `requestClassRestore` on undo while rebuilding its cache
 * unconditionally. Pruning and restoring are two different questions; conflating
 * them is what caused the bug.
 */

export interface TextSyncPlan {
  /** Keys whose text differs from the last observed value — post UPDATE_TEXT / write the file. */
  changed: Array<{ key: string; textContent: string }>;
  /**
   * Keys the doc no longer holds — ask the bridge for the baseline it captured
   * before it applied the first override. Undo/redo only.
   */
  removed: string[];
  /**
   * The cache for the NEXT run. Always the doc's current contents verbatim —
   * never a merge with `prev`, so a key the doc dropped can never linger and
   * swallow the comparison when the same value is re-added later.
   */
  nextPrev: Record<string, string>;
}

export function diffSourceText(
  prev: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
  isUndoing: boolean,
): TextSyncPlan {
  const changed: Array<{ key: string; textContent: string }> = [];
  for (const key of Object.keys(next)) {
    if (next[key] !== prev[key]) changed.push({ key, textContent: next[key] });
  }

  const removed = isUndoing
    ? Object.keys(prev).filter((key) => !(key in next))
    : [];

  return { changed, removed, nextPrev: { ...next } };
}
