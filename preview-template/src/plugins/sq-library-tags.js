/**
 * Library-section tags in a component's frontmatter JSDoc — ONE grammar for the scan (sq-project-fs.js) and the
 * editor's insert path (app/src/utils/libraryThemes.ts re-exports it): `@theme <id>` (docs/plans/
 * 2026-11-08-theme-selector-design.md) and `@name <Section>` (the library section a project copy came from; it is
 * copied with the file, so `HeroClassic.astro` still says `@name Hero`). Only the frontmatter is read, so CSS such as
 * a Tailwind v4 `@theme { … }` block elsewhere never counts. Browser-safe (no node imports).
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const THEME_RE = /(?:^|\*)[ \t]*@theme[ \t]+([a-z0-9-]+)/m;
const NAME_RE = /(?:^|\*)[ \t]*@name[ \t]+([A-Za-z0-9_-]+)/m;

export function libraryTags(content) {
  const frontmatter = content.match(FRONTMATTER_RE)?.[1] ?? '';
  return { theme: frontmatter.match(THEME_RE)?.[1] ?? null, section: frontmatter.match(NAME_RE)?.[1] ?? null };
}
