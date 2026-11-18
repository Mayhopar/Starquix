/**
 * Section-library themes (docs/plans/2026-11-08-theme-selector-design.md).
 *
 * A built-in library section declares `@theme <id>` and `@name <Section>` in its JSDoc. Both travel with the file into
 * a project, so a copy keeps its identity — (section, theme) — whatever its file name. Untagged library files (Blog*,
 * Database*, Media, Video, Embed) are shared by every theme. A project picks ONE theme in ⌘K: a built-in id or
 * `upload:<themeId>`. Pure rules only — storage lives in ThemesLibraryContext.
 */
export { libraryTags } from '../../../preview-template/src/plugins/sq-library-tags.js';

export const BUILT_IN_THEMES = [
  { id: 'starquix', name: 'Starquix' },
  { id: 'classic', name: 'Classic' },
] as const;

/** New and imported projects. */
export const DEFAULT_LIBRARY_THEME = 'starquix';
/** A project with no saved theme predates themes: its pages already hold Classic sections. */
export const LEGACY_LIBRARY_THEME = 'classic';

const UPLOAD_PREFIX = 'upload:';
export const uploadThemeId = (themeId: string) => `${UPLOAD_PREFIX}${themeId}`;
export const uploadedThemeOf = (activeTheme: string): string | null =>
  activeTheme.startsWith(UPLOAD_PREFIX) ? activeTheme.slice(UPLOAD_PREFIX.length) : null;
const isBuiltIn = (id: string) => BUILT_IN_THEMES.some((t) => t.id === id);

/** A file's stem: `src/components/HeroClassic.astro` → `HeroClassic`. */
export const fileBase = (path: string) => (path.split('/').pop() ?? path).replace(/\.astro$/, '');

type Tags = { theme?: string | null; section?: string | null };

/** A section copy's theme: its tag, or Classic when untagged (copies made before themes existed). */
export const copyTheme = (c: Tags) => c.theme ?? LEGACY_LIBRARY_THEME;

/**
 * The built-ins for the active theme: the shared ones plus that theme's sections. Applied in useComponentLibrary —
 * the one list every by-name consumer reads (Canvas, DesignBar, Assets, ⌘K…) — because Starquix and Classic share
 * every section name; a consumer that saw both would resolve `Hero` to either.
 */
export function builtInsForTheme<T extends Tags>(builtIn: T[], activeTheme: string): T[] {
  return builtIn.filter((c) => !c.theme || c.theme === activeTheme);
}

/**
 * The file stem a themed section is inserted as: the first of `<Section>`, `<Section><Theme>`, `<Section><Theme>2`, …
 * that is free, or is already this section's copy in this theme (then it is reused: the user's edits win).
 */
export function themedComponentFile(section: string, theme: string, existing: Map<string, Tags>): string {
  const suffix = theme.charAt(0).toUpperCase() + theme.slice(1);
  for (let i = 0; ; i++) {
    const stem = i === 0 ? section : `${section}${suffix}${i === 1 ? '' : i}`;
    const file = existing.get(`${stem}.astro`);
    if (!file || (file.section === section && copyTheme(file) === theme)) return stem;
  }
}

/** A project component is a library section's copy: same section + theme (shared parts: the same file name). */
export function isProjectCopyOf(project: Tags & { path: string }, builtIn: Tags & { path: string }): boolean {
  if (!builtIn.theme) return fileBase(project.path) === fileBase(builtIn.path);
  return !!project.section && project.section === (builtIn.section ?? fileBase(builtIn.path))
    && copyTheme(project) === builtIn.theme;
}

/**
 * ⌘K offers ONE theme: drop project copies of another theme's sections (a Starquix `Hero.astro` while Classic is
 * active, an untagged legacy copy while Starquix is active). Files without `@name` (the user's own, an imported site's
 * `Header.astro`) and shared parts always stay; the Assets panel still lists every project file.
 */
export function projectComponentsForTheme<T extends Tags>(
  userProject: T[], activeBuiltIns: Array<Tags & { path: string }>, activeTheme: string,
): T[] {
  const themed = new Set(activeBuiltIns.filter((b) => b.theme).map((b) => b.section ?? fileBase(b.path)));
  return userProject.filter((c) => !c.section || !themed.has(c.section) || copyTheme(c) === activeTheme);
}

/** A project's saved theme → the theme to use: no record = Classic (pre-theme project), a dead id = Starquix. */
export function resolveProjectTheme(saved: string | undefined, uploadedIds: Set<string>): string {
  if (saved === undefined) return LEGACY_LIBRARY_THEME;
  const upload = uploadedThemeOf(saved);
  return (upload !== null ? uploadedIds.has(upload) : isBuiltIn(saved)) ? saved : DEFAULT_LIBRARY_THEME;
}
