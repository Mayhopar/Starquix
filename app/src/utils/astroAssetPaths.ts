/**
 * Path predicates and mappers for layouts/components in the editor.
 *
 * Layout files have an astroSource of the form `layouts/<Name>.astro`;
 * library components use `library/<Name>.astro` (or any path that ends up
 * under `src/components/`). In a project, layouts live at `src/<source>`
 * and components at `src/components/<source>`.
 *
 * The host vite-plugin's `resolveComponentPath` (app/src/vite-plugin/index.ts)
 * encodes the same rule for the host filesystem. The two must agree.
 */

export const LAYOUT_PATH_PREFIX = 'layouts/';

/** `Marketing` → `layouts/Marketing.astro` — the canonical layout astroSource. */
export function layoutAstroSource(layoutName: string): string {
  return `${LAYOUT_PATH_PREFIX}${layoutName}.astro`;
}

export function isLayoutPath(astroSource: string | null | undefined): boolean {
  if (!astroSource) return false;
  return astroSource.startsWith(LAYOUT_PATH_PREFIX) || astroSource.startsWith('layouts\\');
}

export function resolveComponentSourcePath(astroSource: string): string {
  return isLayoutPath(astroSource)
    ? `src/${astroSource}`
    : `src/components/${astroSource}`;
}

/**
 * Where an edited master's bytes go on host disk. Routing is by PATH, never by
 * basename: a layout is a full Astro document that belongs in src/layouts/, and
 * posting it to /__sq/save-component wrote src/components/library/<Name>.astro
 * — a phantom COMPONENT holding the layout's markup, which surfaced in the
 * Assets components tree while the real layout kept none of the edit. A
 * component in a library subdirectory carries that subdir as its `category`,
 * or it is flattened into a duplicate at the library root.
 */
export function masterSaveRequest(
  astroSource: string,
  astroContent: string,
): { url: string; body: Record<string, string> } | null {
  const nameMatch = astroSource.match(/([^/\\]+)\.astro$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (isLayoutPath(astroSource)) {
    return { url: '/__sq/save-layout', body: { name, astroContent } };
  }
  const category = astroSource
    .replace(/\\/g, '/')
    .replace(/^library\//, '')
    .split('/')
    .slice(0, -1)
    .join('/');
  return {
    url: '/__sq/save-component',
    body: { name, astroContent, targetDir: 'built-in', ...(category ? { category } : {}) },
  };
}

/**
 * Build the `import` specifier from `fromAstroSource` to `toAstroSource`,
 * mirroring how the snapshot is laid out under `src/`. Layouts sit one level
 * above components (`src/layouts/...` vs `src/components/...`) so a layout
 * importing a component goes through `../components/`. Components in the same
 * directory get a sibling-relative path; the buggy old form `./library/X.astro`
 * resolved to `library/library/X.astro` from inside `library/`.
 */
/**
 * Extract the lowercased component name from an astro source path:
 * `library/CTA.astro` → `cta`. Returns null when the path has no
 * recognizable basename. Used to translate rendered child selectors
 * (e.g. `<section data-sq-component-src="library/CTA.astro">` → `cta`)
 * back to the source-component tag name for AST resolution.
 */
export function componentNameFromAstroSource(src: string): string | null {
  return basenameFromAstroSource(src)?.toLowerCase() ?? null;
}

/**
 * Case-PRESERVING basename of an astro source path: `library/Marketing.astro` →
 * `Marketing`. Returns null when there's no basename. Use this when the name must
 * match a library entry case-sensitively (e.g. resolving the editor root to a
 * layout by name); use componentNameFromAstroSource when a lowercased tag is wanted.
 */
export function basenameFromAstroSource(src: string): string | null {
  const slash = Math.max(src.lastIndexOf('/'), src.lastIndexOf('\\'));
  const file = slash === -1 ? src : src.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const base = dot === -1 ? file : file.slice(0, dot);
  return base || null;
}

export function resolveRelImport(fromAstroSource: string, toAstroSource: string): string {
  if (isLayoutPath(fromAstroSource)) {
    return `../components/${toAstroSource}`;
  }
  const slashIdx = fromAstroSource.lastIndexOf('/');
  const fromDir = slashIdx >= 0 ? fromAstroSource.slice(0, slashIdx + 1) : '';
  if (fromDir && toAstroSource.startsWith(fromDir)) {
    return `./${toAstroSource.slice(fromDir.length)}`;
  }
  return `./${toAstroSource}`;
}
