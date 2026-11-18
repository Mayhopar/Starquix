const SELECTOR_RE = /^([a-z][a-z0-9]*)-(\d+)$/i;

export interface OverrideSourceResult {
  /** Source path the override should be written to. */
  source: string;
  /** Selector local to that source (`tag-N` form). Always a valid `mapKeyToPosition` input. */
  subSelector: string;
}

/**
 * Given the editor element's resolved HTML (which carries `data-sq-component-src`
 * markers on tags inlined from sub-components), figure out which source file
 * an override against `selector` should be written to, and what selector it
 * should use against that file.
 *
 * Falls back to the page-template's own source when the selector either
 * doesn't match anything in the HTML or matches a tag that has no
 * `data-sq-component-src` ancestor.
 */
export function resolveOverrideSource(
  resolvedHtml: string,
  selector: string,
  pageTemplateSource: string,
): OverrideSourceResult {
  const m = selector.match(SELECTOR_RE);
  if (!m) return { source: pageTemplateSource, subSelector: selector };
  const tag = m[1].toLowerCase();

  const doc = new DOMParser().parseFromString(`<div id="__sq-root">${resolvedHtml}</div>`, 'text/html');
  const root = doc.getElementById('__sq-root');
  if (!root) return { source: pageTemplateSource, subSelector: selector };

  const candidates = Array.from(root.querySelectorAll(tag));
  const targetIdx = parseInt(m[2], 10);
  const target = candidates[targetIdx];
  if (!target) return { source: pageTemplateSource, subSelector: selector };

  let el: Element | null = target;
  let subSrc: string | null = null;
  let subRoot: Element | null = null;
  while (el && el !== root) {
    const attr = el.getAttribute('data-sq-component-src');
    if (attr) { subSrc = attr; subRoot = el; break; }
    el = el.parentElement;
  }

  if (!subSrc || !subRoot) {
    return { source: pageTemplateSource, subSelector: selector };
  }

  // Recompute target's index relative to the sub-component boundary.
  // Include subRoot itself when its tag matches (e.g. selector points at the
  // outermost `<header>` of an inlined Header body).
  const within = Array.from(subRoot.querySelectorAll(tag));
  const ordered = subRoot.tagName.toLowerCase() === tag ? [subRoot, ...within] : within;
  const localIdx = ordered.indexOf(target);
  if (localIdx === -1) return { source: pageTemplateSource, subSelector: selector };
  return { source: subSrc, subSelector: `${tag}-${localIdx}` };
}
