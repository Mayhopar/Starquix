/**
 * A post is published unless its frontmatter explicitly sets `draft: true`.
 * Non-boolean falsy values ("false", 0, missing) are treated as published, so
 * authoring quirks (YAML string vs boolean) don't accidentally hide posts.
 */
export function isPublishedPost(post: { frontmatter?: Record<string, unknown> }): boolean {
  return post.frontmatter?.draft !== true;
}
