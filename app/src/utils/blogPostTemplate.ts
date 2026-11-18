import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { resolveCanvasHtml, tryResolveCanvasHtmlFromSource } from './canvasHtml';

export { BLOG_POST_ASTRO_SOURCE, BLOG_POST_COMPONENT_NAME } from './blogPostConstants';
import { BLOG_POST_ASTRO_SOURCE, findBlogPostComponent } from './blogPostConstants';

/**
 * Returns null when BlogPost isn't in the library (cold scan, snapshot mismatch).
 * Callers MUST handle null — fallback is "no wrapper, article as root" so a
 * stale library doesn't trap the editor in a broken state.
 */
export async function resolveBlogPostCanvasHtml(
  library: ScannedComponent[],
): Promise<string | null> {
  const blogPost = findBlogPostComponent(library);
  if (!blogPost) {
    console.warn('[blog-post-resolve] BlogPost not in library', { librarySize: library.length });
    return null;
  }

  const live = await tryResolveCanvasHtmlFromSource(BLOG_POST_ASTRO_SOURCE, library);
  if (live) return live;

  if (!blogPost.html) return null;
  // The scan endpoint strips frontmatter but doesn't expand sub-component tags
  // (<Header />, <Footer />) — resolveCanvasHtml does that.
  return resolveCanvasHtml(blogPost.html, library);
}
