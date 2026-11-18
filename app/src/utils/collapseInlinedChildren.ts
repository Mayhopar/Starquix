/**
 * MIGRATION primitive (task-098): old masters markup with inlined child HTML
 * (marker = data-sq-component-src, injected by injectSourceMarkers) → collapse
 * each marker-rooted subtree to an `<sq-child>` placeholder. Pure DOM — lives
 * outside componentPlaceholders.ts so masters.ts can import it without a cycle
 * (componentPlaceholders imports masters selectors).
 */

/**
 * MIGRATION: pagination is settings-driven chrome (BlogSettingsBlock owns the
 * add/remove of the pagination child) — it must NEVER live in a master's
 * markup. Old-era bakes captured the rendered pagination INLINE, so it painted
 * unconditionally regardless of the pagination setting. Reset the
 * data-blog-source="pagination" wrapper's contents back to the empty
 * `<slot name="pagination">`. Returns the input string unchanged (byte-for-
 * byte) when the wrapper is already clean or absent.
 */
export function resetPaginationSlot(markup: string): { markup: string; changed: boolean } {
  if (!markup.includes('data-blog-source="pagination"')) return { markup, changed: false };
  const dom = new DOMParser().parseFromString(`<div id="__sq-root">${markup}</div>`, 'text/html');
  const root = dom.getElementById('__sq-root');
  const wrapper = root?.querySelector('[data-blog-source="pagination"]');
  if (!root || !wrapper) return { markup, changed: false };
  const onlySlot =
    wrapper.childElementCount === 1 &&
    wrapper.children[0].tagName.toLowerCase() === 'slot' &&
    wrapper.children[0].getAttribute('name') === 'pagination' &&
    (wrapper.textContent ?? '').trim() === '';
  if (onlySlot) return { markup, changed: false };
  wrapper.innerHTML = '<slot name="pagination"></slot>';
  return { markup: root.innerHTML, changed: true };
}

/** Strip attrs that differ by construction before deep-comparing subtrees. */
function comparableHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('data-sq-') || attr.name === 'data-key' || attr.name === 'class') {
        node.removeAttribute(attr.name);
      }
    }
  }
  return clone.innerHTML;
}

/**
 * Consecutive same-src siblings (a multi-root child body) collapse into ONE
 * placeholder. If the inlined root's class attr differs from the child base
 * root's class attr, that difference is returned as a childOverrides patch;
 * deeper divergence is dropped with a console.warn naming the subtree's tag.
 */
export function collapseInlinedChildren(
  markup: string,
  childBases: Map<string, string>,
): { markup: string; patches: Record<string, Record<string, Record<string, string[]>>> } {
  if (!markup.includes('data-sq-component-src')) return { markup, patches: {} };
  const dom = new DOMParser().parseFromString(`<div id="__sq-root">${markup}</div>`, 'text/html');
  const root = dom.getElementById('__sq-root');
  if (!root) return { markup, patches: {} };

  // Top-most marked elements only — nested components' own markers collapse
  // with their parent subtree.
  const marked = Array.from(root.querySelectorAll('[data-sq-component-src]')).filter(
    (el) => !el.parentElement?.closest('[data-sq-component-src]'),
  );

  const patches: Record<string, Record<string, Record<string, string[]>>> = {};
  const counters = new Map<string, number>();
  const consumed = new Set<Element>();

  for (const el of marked) {
    if (consumed.has(el)) continue;
    const src = el.getAttribute('data-sq-component-src')!;

    // Group consecutive siblings sharing the same src (multi-root child body).
    const group: Element[] = [el];
    let sib = el.nextElementSibling;
    while (sib && sib.getAttribute('data-sq-component-src') === src) {
      group.push(sib);
      consumed.add(sib);
      sib = sib.nextElementSibling;
    }

    const baseName = (src.split('/').pop() ?? src).replace(/\.astro$/i, '').toLowerCase();
    const slotEl = el.closest('slot[name]');
    const slotName = slotEl?.getAttribute('name')?.trim() || undefined;
    let placementKey: string;
    if (slotName) {
      placementKey = slotName;
    } else {
      const n = counters.get(baseName) ?? 0;
      counters.set(baseName, n + 1);
      placementKey = `${baseName}-${n}`;
    }

    // Root-class diff vs the child base → childOverrides patch.
    const baseHtml = childBases.get(src);
    if (baseHtml) {
      const baseDom = new DOMParser().parseFromString(`<div id="__sq-root">${baseHtml}</div>`, 'text/html');
      const baseRoot = baseDom.getElementById('__sq-root')?.firstElementChild;
      if (baseRoot) {
        const inlinedClass = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
        const baseClass = (baseRoot.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
        if (inlinedClass.join(' ') !== baseClass.join(' ')) {
          patches[placementKey] = { [`${el.tagName.toLowerCase()}-0`]: { base: inlinedClass } };
        }
        if (comparableHtml(el) !== comparableHtml(baseRoot)) {
          console.warn(
            `[componentPlaceholders] collapse dropped deeper divergence inside <${el.tagName.toLowerCase()}> (${src})`,
          );
        }
      }
    }

    const placeholder = dom.createElement('sq-child');
    placeholder.setAttribute('data-sq-astro-source', src);
    placeholder.setAttribute('data-sq-placement', placementKey);
    if (slotName) placeholder.setAttribute('data-sq-slot-fallback', slotName);
    el.replaceWith(placeholder);
    for (const g of group.slice(1)) g.remove();
  }

  return { markup: root.innerHTML, patches };
}
