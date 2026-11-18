/**
 * task-120 (4.4): gate REQUEST_GRID_GEOMETRY on the selection actually being
 * grid-relevant. The probe walk in the bridge is expensive; most selections
 * (text, buttons, plain sections) never need grid geometry.
 */
export function isGridRelevantSelection(
  el: { classes?: string; parentDisplay?: string } | undefined,
): boolean {
  // Unknown element (not scanned yet) → post; the bridge's own early-return
  // stays the correctness backstop.
  if (!el) return true;
  if (el.parentDisplay === 'grid' || el.parentDisplay === 'inline-grid') return true;
  // Own container: a `grid`/`inline-grid` utility token (any breakpoint/state
  // prefix). `grid-cols-3` etc. don't match — but such elements carry the
  // bare `grid` token anyway.
  return /(?:^|[\s:])(?:inline-)?grid(?=$|\s)/.test(el.classes ?? '');
}
