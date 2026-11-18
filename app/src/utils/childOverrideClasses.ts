/**
 * THE class-applier for per-placement child overrides (`selector → breakpoint
 * → full token set`). Shared by componentPlaceholders.expandPlaceholders and
 * masters.baseMarkup's parent-layering — do NOT write a second one. Lives in
 * its own module so masters.ts can import it without a cycle
 * (componentPlaceholders imports from masters).
 *
 * Replace semantics per selector/bp (resolveOverrideClasses): a base set
 * replaces every unprefixed token; a non-base set replaces that breakpoint's
 * prefixed tokens, each new token emitted as `bp:token`. Selectors resolve as
 * `querySelectorAll(tag)[N]` (resolveOverrideSource convention).
 */
const SELECTOR_RE = /^([a-z][a-z0-9]*)-(\d+)$/i;

export function applyChildOverrideClasses(
  html: string,
  overrides: Record<string, Record<string, string[]>> | undefined,
): string {
  if (!overrides || Object.keys(overrides).length === 0) return html;
  const dom = new DOMParser().parseFromString(`<div id="__sq-root">${html}</div>`, 'text/html');
  const root = dom.getElementById('__sq-root');
  if (!root) return html;
  for (const [selector, byBp] of Object.entries(overrides)) {
    const m = selector.match(SELECTOR_RE);
    if (!m) continue;
    const target = root.querySelectorAll(m[1].toLowerCase())[parseInt(m[2], 10)];
    if (!target) continue;
    let tokens = (target.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    // base first: it replaces the WHOLE class attr, then non-base slots append.
    const entries = Object.entries(byBp).sort(([a], [b]) =>
      (a === 'base' || a === 'xs' ? 0 : 1) - (b === 'base' || b === 'xs' ? 0 : 1),
    );
    for (const [bp, set] of entries) {
      if (!Array.isArray(set)) continue;
      if (bp === 'base' || bp === 'xs') {
        // The base set is the FULL intended class list (it may itself carry
        // bp-prefixed tokens). Replace EVERYTHING — keeping existing prefixed
        // tokens let a stale xl:bg-white from an old bake conflict with the
        // override's xl:bg-orange-500 and win by stylesheet order.
        tokens = [...set];
      } else {
        tokens = [...tokens.filter((t) => !t.startsWith(bp + ':')), ...set.map((t) => `${bp}:${t}`)];
      }
    }
    target.setAttribute('class', tokens.join(' '));
  }
  return root.innerHTML;
}
