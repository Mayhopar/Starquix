/** The query marker a canvas document boundary adds to the page's own URL (a #fragment-only change
 *  would not load a new document). Set by the bridge's documentBoundary and by ViewportFrame's
 *  same-port restart; the new document's bridge drops it before anything reads the URL. */
export const SQ_BOUNDARY_PARAM = 'sq-b';
