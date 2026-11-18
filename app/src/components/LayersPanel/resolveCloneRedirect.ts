/**
 * Editor-side mirror of the bridge's clone→first-card redirect
 * (`_resolveToFirstBlogCard` in `preview-template/public/scripts/bridge.js`).
 * Clones have stripped data-keys → the iframe scanner assigns `dynamic:`
 * keys with no Yjs element, so the Design Bar's instance icons stay hidden.
 * Edits to a "clone" don't make sense — they land on the first-card template
 * and propagate to every clone on the next render. Both redirects must stay
 * semantically aligned.
 */

interface ParentLookup {
  key: string;
  parentKey?: string | null;
  postSlug?: string;
}

export interface ResolveCloneArgs {
  clickedKey: string;
  scannedElements: readonly ParentLookup[];
}

/**
 * Returns the real first-card key when the clicked key is a clone, or
 * `null` when no redirect is needed.
 */
export function resolveCloneRedirect(args: ResolveCloneArgs): string | null {
  const { clickedKey, scannedElements } = args;
  if (!clickedKey.startsWith('dynamic:')) return null;
  const clicked = scannedElements.find((el) => el.key === clickedKey);
  if (!clicked || !clicked.postSlug) return null;
  const realSibling = scannedElements.find(
    (el) =>
      el.parentKey === clicked.parentKey &&
      !el.key.startsWith('dynamic:') &&
      !!el.postSlug,
  );
  return realSibling ? realSibling.key : null;
}
