import { readLocalFile } from './localElementSource';
import { resolveComponentSourcePath } from './astroAssetPaths';

/**
 * Read a component's FULL .astro source (frontmatter included) from the
 * project instance. Throws when it cannot be read (caller decides how to surface it).
 */
export async function readComponentSource(componentPath: string): Promise<string> {
  return readLocalFile(resolveComponentSourcePath(componentPath));
}
