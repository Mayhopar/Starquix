import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { copyTheme } from '@/utils/libraryThemes';

// Auto-generated preview PNGs for library components, keyed by component name.
// Regenerate with `npm run previews:generate` after changing preview-template
// components. See docs/plans/2026-07-08-cmdk-auto-previews-design.md
const PREVIEWS = import.meta.glob('../../assets/images/editor-components/generated/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const BY_NAME: Record<string, string> = {};
for (const [path, url] of Object.entries(PREVIEWS)) {
  BY_NAME[path.split('/').pop()!.replace('.png', '')] = url;
}

export function getPreviewImage(componentName: string): string | undefined {
  return BY_NAME[componentName];
}

/**
 * THE join between a picker card and its preview image. The generated PNGs are renders of STARQUIX'S OWN library,
 * keyed by section name (Classic's as `classic--<Name>`). A built-in gets its own render; a project file gets one
 * only when it is a library section's copy — its `@name` names the section (HeroClassic.astro → Hero, untagged =
 * Classic); edits made since are not re-rendered. A user's own file (no `@name`) never borrows another file's render:
 * undefined means the grey name placeholder (follow-up: task-148, project previews).
 */
export function resolvePreviewImage(
  component: Pick<ScannedComponent, 'name' | 'source' | 'previewImage' | 'theme' | 'section'>,
): string | undefined {
  const builtIn = component.source === 'built-in';
  const section = builtIn ? component.name : component.section;
  if (!section) return component.previewImage;
  const theme = builtIn ? component.theme : copyTheme(component);
  // A shared part's copy (untagged → "classic") has only the plain render.
  return getPreviewImage(theme === 'classic' ? `classic--${section}` : section) ?? getPreviewImage(section) ?? component.previewImage;
}
