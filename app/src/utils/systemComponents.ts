/**
 * task-206: THE definition of "system component" — the sq/ folder convention,
 * stated once. AssetsPanel locking, the DesignBar media resolver, the header's
 * ↗ target, and the ensure/upgrade endpoint all read from here; before this
 * module the prefix existed in four independently drifting shapes.
 */
export const SQ_SYSTEM_DIR = 'src/components/sq/';

/** The preview-template's own system Media path, in its two shapes:
 *  `src/components/Media.astro` (a full dispatch) and `Media.astro` (the
 *  `src/components`-relative component that the ↗ go-to-source synthesizes
 *  before the project path resolves — resolveGoToSourceComponent). Both must
 *  classify or the System locking chrome (badge, no rename/delete) fails to
 *  engage in the ↗-opened editor view. The project scan emits only
 *  `src/components/…` and the built-in catalog only `library/…`, so the bare
 *  shape cannot collide with a scanned file. */
const TEMPLATE_MEDIA_PATHS = ['src/components/Media.astro', 'Media.astro'];

export const isSystemComponentPath = (path: string | undefined | null): boolean =>
  !!path && (path.startsWith(SQ_SYSTEM_DIR) || TEMPLATE_MEDIA_PATHS.includes(path));

export const systemComponentPath = (name: string): string =>
  `${SQ_SYSTEM_DIR}${name}.astro`;

/** The one system component today (task-207 generalizes). */
export const MEDIA_SYSTEM_COMPONENT = { path: systemComponentPath('Media'), name: 'Media' };

/**
 * task-207 D5: OURS — mirrors the server's SQ_INSERTABLE_COMPONENTS. "Ours vs
 * theirs" is this list plus the sq/ path, not a new marker: a marker in the
 * file would be something a user could delete to grant themselves our lock
 * semantics, and a `sq/system/` subfolder would be path churn plus a migration.
 *
 * Ours are locked (System badge, no rename/delete/master-edit) and are the only
 * ones we ever copy or upgrade. Everything else under sq/ is a normal component
 * that merely also appears in the `/` menu.
 */
export const SQ_OURS: readonly string[] = ['Media', 'Stack'];

/** Mirrors the plugin's SQ_HIDDEN: ours, but driven by the editor (layouts),
 *  never listed as a component anywhere. */
export const SQ_HIDDEN: readonly string[] = ['Stack'];


/** Ours: under sq/ AND allowlisted. A promoted component is NOT ours (D5). */
export const isOurSystemComponent = (path: string | undefined | null): boolean =>
  isSystemComponentPath(path) &&
  SQ_OURS.includes((path!.split('/').pop() ?? '').replace(/\.astro$/, ''));

/** Mirrors the plugin's SQ_UPGRADE_MARKERS (parity-tested): an sq/ copy of
 *  OURS without its marker is stale and is replaced (with a .bak). */
export const SQ_UPGRADE_MARKERS: Readonly<Record<string, string>> = { Media: 'sq-media-v2', Stack: 'sq-stack-v5' };

/**
 * Files to write so stale sq/ copies of OURS match the shipped templates
 * (`snapshot` keys = `src/components/<Name>.astro`). A copy WITH the marker
 * is the user's (possibly edited) file and is never touched.
 */
export function staleSqUpgrades(
  projectFiles: Readonly<Record<string, string | Uint8Array>>,
  snapshot: Readonly<Record<string, string | Uint8Array>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, marker] of Object.entries(SQ_UPGRADE_MARKERS)) {
    const path = systemComponentPath(name);
    const current = projectFiles[path];
    const template = snapshot[`src/components/${name}.astro`];
    if (typeof current !== 'string' || typeof template !== 'string') continue;
    if (current.includes(marker) || !template.includes(marker)) continue;
    out[`${path}.bak`] = current;
    out[path] = template;
  }
  return out;
}
