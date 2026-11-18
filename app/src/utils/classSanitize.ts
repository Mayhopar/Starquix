/**
 * blob: URLs are session-scoped resolution products — NEVER valid persisted
 * state. Guard every path that writes DOM-derived classes into Yjs.
 * Ledger: docs/plans/2026-07-02-bg-image-blob-poisoning-fix-ledger.md
 */
export function containsBlobUrl(classes: string): boolean {
  return classes.includes('blob:');
}

export function stripBlobUrlTokens(classes: string): string {
  return classes
    .split(/\s+/)
    .filter((t) => !t.includes('blob:'))
    .join(' ');
}
