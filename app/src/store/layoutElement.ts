import * as Y from 'yjs';
import { createElementYMap } from './commands';
import { emptyClassData, type ElementData } from './types';
import { stripDocumentBoilerplate, resolveCanvasHtml } from '../utils/canvasHtml';
import { layoutAstroSource } from '../utils/astroAssetPaths';
import type { ScannedComponent } from '../hooks/useComponentLibrary';

/**
 * The derived, editor-only "layout chrome" element (Model B).
 *
 * A page keeps `page.layoutName` + `page.layoutProps` as the persisted
 * association and the codegen source of truth. This element is DERIVED from the
 * applied layout's discovered body and exists solely so a layout-on-a-page can
 * reuse the component-instance lifecycle in the editor (dirty `*`, Push, Reset,
 * pull-when-stale ↻). It carries the chrome `staticMarkup`, a `masterVersion`,
 * and the standard override maps — exactly like a component instance.
 *
 * It is NEVER inserted into `rootElementIds` and is never seen by codegen.
 */

/** Deterministic id for a page's layout-chrome element (one per page). */
export function pageLayoutElementId(pageId: string): string {
  return `layoutchrome-${pageId}`;
}

/**
 * The layout's chrome = its discovered body reduced to inner-body markup. This is
 * what we store as the element's staticMarkup AND what the DesignBar feeds as the
 * instance `sourceHtml`; createElementYMap then stamps masterVersion =
 * computeMasterVersion(staticMarkup) over this same string, so a real master edit
 * moves the version (↻) and a no-op does not.
 */
export function layoutChromeMarkup(body: string): string {
  return stripDocumentBoilerplate(body);
}

/**
 * Render-ready layout chrome: strip the document boilerplate, then EXPAND the
 * components the layout composes (`<Header/>`, `<Div2/>`, …) into their HTML via
 * resolveCanvasHtml — the same representation a component instance's staticMarkup
 * uses. Both the live page render (Canvas `layoutBodies`) and the derived
 * layout-chrome element snapshot go through THIS, so they're byte-identical:
 * the layout renders complete from page load (not just after you select it), and
 * materializing the element on selection causes no flicker.
 */
export function resolvedLayoutChrome(body: string, library: ScannedComponent[]): string {
  return resolveCanvasHtml(layoutChromeMarkup(body), library);
}

/**
 * Ensure the page's layout-chrome element exists and matches the applied layout.
 *
 * - No element yet → create it from the current discovered body.
 * - Element exists for a DIFFERENT layout → replace it (fresh chrome, overrides
 *   dropped: a different layout is a different master).
 * - Element exists for the SAME layout → LEAVE IT UNTOUCHED. The stored
 *   staticMarkup is NOT what pages render — selectPageComponents rebases the
 *   chrome on the discovered (file) body every render and applies this element's
 *   overrides on top, so a master edit reaches every page with no pull step and
 *   without re-snapshotting over the user's overrides. The stored copy is the
 *   fallback for a layout discovery can't see, plus the masterVersion baseline.
 */
export function ensureLayoutElement(
  doc: Y.Doc,
  pageId: string,
  layoutName: string,
  body: string,
): void {
  const id = pageLayoutElementId(pageId);
  const elements = doc.getMap('elements');
  const existing = elements.get(id) as Y.Map<unknown> | undefined;
  if (existing && existing.get('componentType') === layoutName) return;

  const element: ElementData = {
    id,
    pageId,
    parentId: null,
    index: 0,
    type: 'instance',
    instanceType: 'local',
    componentType: layoutName,
    astroSource: layoutAstroSource(layoutName),
    bindingType: 'layout-chrome',
    classes: emptyClassData(),
    staticMarkup: layoutChromeMarkup(body),
  };

  doc.transact(() => {
    const yEl = createElementYMap(element);
    elements.set(id, yEl);
  }, 'layout-element');
}

/** Remove a page's layout-chrome element (on detach / layout delete). */
export function removeLayoutElement(doc: Y.Doc, pageId: string): void {
  const id = pageLayoutElementId(pageId);
  const elements = doc.getMap('elements');
  if (!elements.has(id)) return;
  doc.transact(() => {
    elements.delete(id);
  }, 'layout-element');
}

/**
 * Stamp `data-sq-chrome` on every chrome tag (those whose data-key starts with
 * the layout element's prefix) so the iframe scan includes layout chrome as
 * instance-children. Paired with layoutChromeMarkup/resolvedLayoutChrome — all
 * layout-chrome representation lives here.
 */
export function markChromeTags(html: string, layoutElementId: string): string {
  const prefix = `${layoutElementId}:`;
  return html.replace(
    // Trailing `/` of a self-closing tag is captured separately — appending
    // the marker after it emitted `<slot … / data-sq-chrome>`, which parses
    // as an OPEN slot swallowing its siblings (found 2026-08-26).
    /<([a-z][a-z0-9]*)\b([^>]*\bdata-key="([^"]+)"[^>]*?)(\s*\/)?>/gi,
    (full, tag: string, attrs: string, key: string, slash: string | undefined) => {
      if (!key.startsWith(prefix)) return full;
      if (/\bdata-sq-chrome\b/.test(attrs)) return full;
      return `<${tag}${attrs} data-sq-chrome${slash ?? ''}>`;
    },
  );
}
