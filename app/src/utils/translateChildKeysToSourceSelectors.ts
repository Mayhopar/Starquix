import type { ScannedElement } from '@/context/SelectionContext';
import { parseKey } from '@/store/types';
import { componentNameFromAstroSource } from './astroAssetPaths';

/**
 * Translate the `selector` portion of an instance-child key from its rendered
 * tag form to the form the write-back server's AST walker can resolve in the
 * parent .astro source.
 *
 * Two transforms happen here, both keyed off a single per-name running index:
 *
 * 1. Sub-component expansion: BlogPost.astro contains `<CTA />`. The rendered
 *    HTML expands CTA to `<section data-sq-component-src="library/CTA.astro">`,
 *    stamped `:section-0`. The parent .astro source has no `<section>` tag —
 *    it has `<CTA />`. Using `componentSrc` we translate to `cta-N`, which
 *    the AST walker (indexes both element + component nodes by name) finds.
 *
 * 2. Plain-tag rendered-index inflation: a child like `<div>extra</div>` may
 *    have rendered key `div-1` because a preceding sibling component's
 *    expansion contains its own `<div>` (counted as `div-0` in the rendered
 *    DOM). The parent .astro source only contains the literal `<div>` —
 *    indexed `div-0` server-side. Passing `div-1` through would null-resolve
 *    and the server would silently partial-skip the child.
 *
 *    The fix: re-index plain-tag children per-tag within this child set,
 *    ignoring the rendered-DOM index. The child set already excludes
 *    descendants nested inside sibling component expansions (their parentKey
 *    is the expanded sub-component, not this instance root), so per-set tag
 *    counting matches the parent-source AST count.
 */
export function translateChildKeysToSourceSelectors(
  childKeys: string[],
  scannedElements: Pick<ScannedElement, 'key' | 'componentSrc'>[],
): string[] {
  const byKey = new Map<string, Pick<ScannedElement, 'componentSrc'>>();
  for (const el of scannedElements) byKey.set(el.key, el);

  // Per-source-name running index across this child set. Both transforms
  // feed into the same counter: component-translated children use the
  // component name; plain-tag children use the tag name parsed from the
  // rendered selector. The final source order matches iteration order.
  const indexByName = new Map<string, number>();

  return childKeys.map((childKey) => {
    const parsed = parseKey(childKey);
    const renderedSelector = parsed?.type === 'instance-child' ? parsed.selector : childKey;

    const src = byKey.get(childKey)?.componentSrc;
    const componentName = src ? componentNameFromAstroSource(src) : null;

    // Pick the name to index by: component name for translated children,
    // tag name (parsed from selector like "div-1") for plain-tag children.
    let name = componentName;
    if (!name) {
      const tagMatch = renderedSelector.match(/^([a-z][a-z0-9]*)-\d+$/i);
      if (!tagMatch) return renderedSelector;
      name = tagMatch[1].toLowerCase();
    }

    const idx = indexByName.get(name) ?? 0;
    indexByName.set(name, idx + 1);
    return `${name}-${idx}`;
  });
}
