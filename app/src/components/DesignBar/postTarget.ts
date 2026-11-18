/** Resolve only canonical, unambiguous disk posts from bridge-filtered paths. */
export function importedPostTargetFor(
  paths: readonly string[] | null | undefined,
  collections: ReadonlyArray<{ name: string; posts: ReadonlyArray<{ slug: string; frontmatter?: Readonly<Record<string, unknown>> }> }>,
): { collection: string; slug: string } | null {
  const matches = new Map<string, { collection: string; slug: string }>();
  for (const path of new Set(paths ?? [])) {
    const route = path.match(/^\/([^/]+)\/([^/?#]+)\/?$/);
    if (!route) continue;
    let routeSlug: string;
    try { routeSlug = decodeURIComponent(route[2]); } catch { continue; }
    for (const [collectionIndex, collection] of collections.entries()) {
      if (collection.name !== route[1]) continue;
      // An unresolvable filename might collide with a supported one (A B and
      // A-B both become a-b in Astro). Skipping it cannot prove uniqueness.
      if (collection.posts.some(post => !Object.prototype.hasOwnProperty.call(post.frontmatter ?? {}, 'slug') && !/^[A-Za-z0-9_-]+$/.test(post.slug))) return null;
      for (const [postIndex, post] of collection.posts.entries()) {
        // Astro's explicit slug REPLACES its generated route. For filenames,
        // this bounded ASCII subset matches Astro's github-slugger exactly;
        // unsupported punctuation/Unicode/nesting is never guessed.
        const explicit = Object.prototype.hasOwnProperty.call(post.frontmatter ?? {}, 'slug');
        const slug = explicit ? post.frontmatter?.slug : /^[A-Za-z0-9_-]+$/.test(post.slug) ? post.slug.toLowerCase() : null;
        if (typeof slug !== 'string' || !slug || slug.includes('/') || slug !== routeSlug) continue;
        matches.set(`${collectionIndex}:${postIndex}`, { collection: collection.name, slug: post.slug });
      }
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

/**
 * Doc-bound post page (post-page binding + previewed post): which selections
 * may target the previewed post? The <article> post root always did. A Media /
 * sq-component UNIT selection lives inside that same rendered body, so its
 * invocation writes to the SAME post — the article-only gate left
 * MediaBlock/SystemComponentBlock with `postTarget === null`, i.e. permanently
 * read-only even when the rehype stamps supplied a write range.
 *
 * Pure so DesignBar's goToPostTarget memo and the tests share one rule.
 */
export function docPostPageTarget(opts: {
  collectionName: string | null;
  previewPostSlug: string | null;
  effectiveTagName: string;
  /** resolveMediaUnit / resolveComponentUnit matched the selection. */
  isUnitSelection: boolean;
}): { collection: string; slug: string } | null {
  const { collectionName, previewPostSlug, effectiveTagName, isUnitSelection } = opts;
  if (!collectionName || !previewPostSlug) return null;
  if (effectiveTagName !== 'article' && !isUnitSelection) return null;
  return { collection: collectionName, slug: previewPostSlug };
}
