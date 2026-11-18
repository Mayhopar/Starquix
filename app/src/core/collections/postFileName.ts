/**
 * The post's real file name.
 *
 * Its own module, NOT content-ops: that module is mocked wholesale in several
 * tests, and a display helper living there breaks every one of them.
 *
 * NEVER hardcode `${slug}.md` at a call site. New posts are created as .mdx,
 * and a header that claims .md for an .mdx file on disk
 * is exactly how the "it creates .md posts" bug kept getting re-reported after
 * it was fixed.
 */
export function postFileName(post: { slug: string; filePath?: string }): string {
  const base = post.filePath?.split('/').pop();
  return base && /\.mdx?$/i.test(base) ? base : `${post.slug}.mdx`;
}

/**
 * `src/content/<collection>/<slug>.md(x)` → the post it holds. The ONE parse the
 * content listing keys posts by (slug may contain '/'; loose files at the
 * content root are not posts).
 */
export function contentEntryOf(filePath: string | null | undefined): { collection: string; slug: string } | null {
  const m = filePath?.match(/^src\/content\/([^/]+)\/(.+)\.mdx?$/);
  return m ? { collection: m[1], slug: m[2] } : null;
}
