import { componentNameFromAstroSource } from './astroAssetPaths';

const SELECTOR_RE = /^([a-z][a-z0-9]*)-(\d+)$/i;

export type DeleteTargetResult =
  | { kind: 'page-template'; sourceSelector: string }
  | { kind: 'reject'; reason: 'inside-component'; componentSrc: string }
  | { kind: 'reject'; reason: 'not-found' };

/**
 * Decide where (and as what selector) a delete against `selector` should be
 * applied. Routes deletes ONLY into the page-template source — single-instance
 * deletes must never mutate a sub-component .astro file.
 */
export function resolveDeleteTarget(
  resolvedHtml: string,
  selector: string,
  _pageTemplateSource: string,
): DeleteTargetResult {
  const m = selector.match(SELECTOR_RE);
  if (!m) return { kind: 'reject', reason: 'not-found' };
  const tag = m[1].toLowerCase();
  const idx = parseInt(m[2], 10);

  const doc = new DOMParser().parseFromString(
    `<div id="__sq-root">${resolvedHtml}</div>`,
    'text/html',
  );
  const root = doc.getElementById('__sq-root');
  if (!root) return { kind: 'reject', reason: 'not-found' };

  // task-098 placements: the editor markup carries `<sq-child
  // data-sq-placement="footer-0">` instead of the inlined component tag, so
  // the tag walk below can never match a deleted placement child. The
  // placementKey of a non-slot placement IS the page-template source selector
  // (`<name>-<occurrence>`; key-to-position matches component nodes by
  // lowercased name), so route it straight to the page template.
  if (root.querySelector(`sq-child[data-sq-placement="${selector}"]`)) {
    return { kind: 'page-template', sourceSelector: selector };
  }

  const candidates = Array.from(root.querySelectorAll(tag));
  const target = candidates[idx];
  if (!target) return { kind: 'reject', reason: 'not-found' };

  // Walk up to find the nearest data-sq-component-src ancestor (or self).
  let el: Element | null = target;
  let subSrc: string | null = null;
  let subRoot: Element | null = null;
  while (el && el !== root) {
    const attr = el.getAttribute('data-sq-component-src');
    if (attr) { subSrc = attr; subRoot = el; break; }
    el = el.parentElement;
  }

  // Case 2: page-template-native — no sub-component ancestor.
  if (!subSrc || !subRoot) {
    return { kind: 'page-template', sourceSelector: selector };
  }

  // Case 3: mid-tree inside a component — reject.
  if (subRoot !== target) {
    return { kind: 'reject', reason: 'inside-component', componentSrc: subSrc };
  }

  // Case 1: target IS a subRoot. Translate to <componentName>-<perComponentIdx>
  // where perComponentIdx is this subRoot's position among all subRoots that
  // share its componentSrc. This matches translateChildKeysToSourceSelectors.
  const componentName = componentNameFromAstroSource(subSrc);
  if (!componentName) return { kind: 'reject', reason: 'not-found' };

  const sameSrcSubRoots = Array.from(
    root.querySelectorAll(`[data-sq-component-src="${CSS.escape(subSrc)}"]`),
  );
  const perComponentIdx = sameSrcSubRoots.indexOf(subRoot);
  if (perComponentIdx === -1) return { kind: 'reject', reason: 'not-found' };

  return {
    kind: 'page-template',
    sourceSelector: `${componentName}-${perComponentIdx}`,
  };
}
