// Leaf module: importable from store/selectors.ts without pulling
// blogPostTemplate.ts's canvasHtml → webContainerRuntime chain into store tests.
export const BLOG_POST_ASTRO_SOURCE = 'library/BlogPost.astro';
export const BLOG_POST_COMPONENT_NAME = 'BlogPost';

/** THE BlogPost identity rule (name + path suffix) — single definition so a
 *  path move can't drift between the canvas resolver and the master seeder. */
export function findBlogPostComponent<T extends { name: string; path: string }>(
  library: T[],
): T | undefined {
  return library.find(
    (c) => c.name === BLOG_POST_COMPONENT_NAME && c.path.endsWith('BlogPost.astro'),
  );
}
