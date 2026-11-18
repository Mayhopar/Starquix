import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { readLocalFile } from './localElementSource';
import { resolveComponentSourcePath } from './astroAssetPaths';
import { extractComponentPlaceholders, type ChildPlacement } from './componentPlaceholders';

/** Astro frontmatter delimited by `---` lines at the top of a file. */
export function stripFrontmatter(src: string): string {
  return src.replace(/^---[\s\S]*?---\s*/, '').trim();
}

/**
 * Replace component tags (e.g. `<Header />`, `<CTA class="…" />`) with their
 * pre-rendered HTML from the picker library. Without this the browser
 * silently drops unknown elements when the staticMarkup is innerHTML'd
 * into the iframe. Single-pass: build an alternation regex over component
 * names actually present in the html and replace via callback.
 */
export function expandComponentTags(html: string, library: ScannedComponent[]): string {
  const byName = new Map<string, ScannedComponent>();
  for (const c of library) {
    if (c.html) byName.set(c.name, c);
  }
  const present = new Set<string>();
  for (const match of html.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (byName.has(name)) present.add(name);
  }
  if (present.size === 0) return html;
  const re = new RegExp(`<(${Array.from(present).join('|')})\\b[^>]*\\/?>`, 'g');
  return html.replace(re, (_, name: string) => {
    const comp = byName.get(name)!;
    return injectSourceMarkers(comp.html, comp.path);
  });
}

/**
 * Add `data-sq-component-src="<src>"` to every top-level opening tag in `body`.
 * Top-level = depth-0 in tag-nesting terms; descendants inherit attribution
 * by DOM ancestry at write-back time, so one marker per outermost element is
 * sufficient. Idempotent.
 */
export function injectSourceMarkers(body: string, src: string): string {
  const attr = ` data-sq-component-src="${src}"`;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let result = '';
  let depth = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body)) !== null) {
    const [full, slash, , attrs] = m;
    const isClosing = slash === '/';
    const isSelfClosing = /\/\s*$/.test(attrs);
    result += body.slice(lastIndex, m.index);
    if (!isClosing && depth === 0) {
      const alreadyMarked = /\bdata-sq-component-src=/.test(attrs);
      result += alreadyMarked
        ? full
        : full.replace(/^<([a-zA-Z][a-zA-Z0-9]*)\b/, `<$1${attr}`);
    } else {
      result += full;
    }
    lastIndex = m.index + full.length;
    if (isClosing) depth = Math.max(0, depth - 1);
    else if (!isSelfClosing) depth += 1;
  }
  result += body.slice(lastIndex);
  return result;
}

/**
 * `<slot />` in HTML doesn't actually self-close — the browser parses it as
 * an opening `<slot>` tag and adopts every following sibling as a child.
 * Force the explicit closing tag so the slot's bounding box is its own.
 */
export function normalizeSelfClosingSlots(html: string): string {
  return html.replace(/<slot\b([^>]*)\/>/gi, '<slot$1></slot>');
}

/**
 * Layouts contain a full document (`<!doctype><html><head>…</head><body>…</body>`).
 * The canvas inlines markup via insertAdjacentHTML into a div, so head-only
 * elements (meta/title/link/base) and scripts would survive as visible
 * siblings rather than being relocated to the document head. Strip everything
 * outside <body> and the head/script tags themselves so only renderable body
 * content reaches the canvas.
 */
export function stripDocumentBoilerplate(html: string): string {
  let result = html;
  const bodyMatch = result.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) result = bodyMatch[1];
  // If no <body>, drop just <!doctype>, <html>, and <head>…</head>.
  result = result
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  // Drop top-level head-only tags that may have been authored in <body>.
  result = result
    .replace(/<meta\b[^>]*\/?>/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<link\b[^>]*\/?>/gi, '')
    .replace(/<base\b[^>]*\/?>/gi, '');
  // Drop <script> blocks — the canvas re-injects bridge scripts itself and
  // user-authored script tags are an XSS/eval hazard inside the editor.
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return result.trim();
}

/**
 * Default class applied to a Layout-instance wrapper when the page-template
 * source declares a bare `<Layout>` (no class attribute yet). `bg-white`
 * gives the wrapper a visible surface; `min-h-screen` is omitted on purpose —
 * the preview shell already sets `min-h-screen` on its body, and stacking two
 * `min-h-screen` containers turns the canvas into a 2× viewport-tall page.
 */
const DEFAULT_LAYOUT_BODY_CLASS = 'bg-white';

/**
 * Page templates (e.g. BlogPost) wrap their body in `<Layout>…</Layout>` so the
 * Astro build pulls in global head/body chrome. In the editor preview the
 * preview shell at `preview-template/src/pages/preview/[projectId]/[pageId].astro`
 * already provides shell chrome (global.css, body container), but the LAYOUT
 * itself is an editable design surface — the user clicks it, drags components
 * in/out of it, and class edits must persist.
 *
 * Rewrite a top-level `<Layout …>…</Layout>` pair as a literal `<layout>` tag
 * (lowercase, the same name HTML reports for the case-insensitive `<Layout>`).
 * No `data-sq-component-src` marker: edits walk up to the page-template root
 * and route to the page template's own source (BlogPost.astro), where the
 * server-side AST walker (`mapKeysToPositions`) matches `layout-0` against the
 * `<Layout>` component node by lowercased name. Result: class edits land on the
 * `<Layout class="…">` opener in BlogPost.astro and persist across reloads.
 *
 * Carry any existing `class="…"` attribute from the source through to the
 * wrapper so previously-persisted edits are visible on re-open. Falls back to
 * `DEFAULT_LAYOUT_BODY_CLASS` when the source has none. Other Astro props on
 * `<Layout>` are dropped — they're build-time inputs, not DOM attributes.
 *
 * `<layout>` is HTMLUnknownElement by default (inline); preview-template's
 * `global.css` overrides it to `display: block` so the wrapper behaves like a
 * page surface — required, not optional.
 *
 * Idempotent: no-op when the source doesn't open with `<Layout`.
 */
export function inlineTopLevelLayout(html: string): string {
  const trimmed = html.trim();
  if (!/^<Layout\b/i.test(trimmed)) return html;
  const m = trimmed.match(/^<Layout\b([^>]*)>([\s\S]*)<\/Layout>\s*$/i);
  if (!m) return html;
  const wrapperAttrs = m[1];
  const children = m[2];
  // Pull class from the source <Layout class="..."> if present; otherwise use default.
  const classMatch = wrapperAttrs.match(/\bclass=["']([^"']*)["']/i);
  const cls = classMatch ? classMatch[1] : DEFAULT_LAYOUT_BODY_CLASS;
  return `<layout class="${cls}">${children}</layout>`;
}

/**
 * Frontmatter-strip → boilerplate-strip → inline top-level Layout → expand
 * component tags → normalize self-closing slots. The pipeline used to turn a
 * raw .astro source into HTML the live preview iframe can render via innerHTML.
 */
export function resolveCanvasHtml(astroSource: string, library: ScannedComponent[]): string {
  return normalizeSelfClosingSlots(expandComponentTags(preprocessAstroSource(astroSource), library));
}

/** Shared front half of both canvas pipelines: frontmatter → boilerplate → Layout inline. */
function preprocessAstroSource(astroSource: string): string {
  return inlineTopLevelLayout(stripDocumentBoilerplate(stripFrontmatter(astroSource)));
}

/**
 * Same pipeline as resolveCanvasHtml, but nested component tags become
 * `<sq-child>` placeholders (componentPlaceholders wire format) instead of
 * being inlined — the placement list lets the editor materialize each nested
 * component as a real child instance element (task-098). Only the component
 * editor open path uses this; every other caller keeps resolveCanvasHtml.
 */
export function resolveCanvasHtmlWithPlacements(
  astroSource: string,
  library: ScannedComponent[],
): { html: string; placements: ChildPlacement[] } {
  const { html, placements } = extractComponentPlaceholders(preprocessAstroSource(astroSource), library);
  return { html: normalizeSelfClosingSlots(html), placements };
}

/**
 * Master-editor open path: prefer the live WC source, fall back to the
 * picker-scanned source when WC isn't available (server mode never boots WC;
 * the scanned html is the same file body). BOTH inputs run the full pipeline —
 * seeding raw source is the bug this guards against: unexpanded `<Foo />` /
 * `<slot />` are parsed by the browser as UNCLOSED open tags (siblings get
 * swallowed into a nesting chain, components render empty, write-back
 * selectors go dead).
 */
export async function resolveComponentEditorOpen(
  component: ScannedComponent,
  library: ScannedComponent[],
): Promise<{ html: string; placements: ChildPlacement[] }> {
  let source = component.html;
  try {
    source = await readLocalFile(resolveComponentSourcePath(component.path));
  } catch {
    // Instance not answering yet (boot race) — the scanned source stands in.
  }
  const resolved = resolveCanvasHtmlWithPlacements(source, library);
  return resolved;
}

/**
 * Read an asset's source from the project instance and run the full
 * canvas-HTML pipeline. Returns `undefined` if the read fails (instance not
 * ready) so callers can fall back to picker-cached html.
 */
export async function tryResolveCanvasHtmlFromSource(
  astroSource: string,
  library: ScannedComponent[],
): Promise<string | undefined> {
  try {
    const raw = await readLocalFile(resolveComponentSourcePath(astroSource));
    return resolveCanvasHtml(raw, library);
  } catch {
    return undefined;
  }
}
