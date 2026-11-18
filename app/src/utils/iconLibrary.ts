// Lazy Lucide loading + icon→component materialization (task-106).
// Icons are just components: picking one writes library/icons/Icon<Name>.astro
// through the same /__sq/save-component endpoint AssetsPanel uses, then the
// normal component-insert path places an instance.
import { localFetch } from './sqLocalBase';

export async function loadLucideIcons(): Promise<Record<string, string>> {
  const mod = await import('lucide-static'); // ~1990 SVG strings, loaded only when the Icons tab opens
  const icons: Record<string, string> = {};
  for (const [name, svg] of Object.entries(mod)) {
    if (typeof svg === 'string') icons[name] = svg; // drops the `default` aggregate export
  }
  return icons;
}

export async function materializeIconComponent(
  lucideName: string,
  svg: string,
  existingComponentNames: Set<string>,
  /** Local (files-truth) project path: the icon file lands in THE PROJECT
   *  (`src/components/Icon<Name>.astro` via `/__sq/local/component-create`),
   *  never on the host's preview-template disk. */
  localProjectPath: string | null = null,
): Promise<{ componentName: string; created: boolean }> {
  const componentName = `Icon${lucideName}`;
  if (existingComponentNames.has(componentName)) return { componentName, created: false };
  const astroContent = `---\n---\n${svg}\n`;
  const res = localProjectPath
    ? await localFetch('/__sq/local/component-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: localProjectPath, name: componentName, astroContent }),
      })
    : await fetch('/__sq/save-component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: componentName, category: 'icons', astroContent }),
      });
  if (!res.ok) throw new Error(`save-component failed: ${res.status}`);
  return { componentName, created: true };
}
