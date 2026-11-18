/**
 * "The MDX file takes the name of the title" — a NEW post is created as
 * untitled-<timestamp>.mdx; the first time its title is saved, the file is
 * renamed to slugify(title).mdx.
 *
 * Laws (fixed by design):
 * - Only files still named /^untitled-\d+/ are ever renamed, and only .mdx —
 *   a user's own file is never touched, and a post renamed once no longer
 *   matches, so URLs stay stable.
 * - The slug comes from THE shared slugify (utils/slugify). Collisions with
 *   any existing post slug in the collection (case-insensitive, excluding the
 *   post itself) get -2, -3, …
 * - Rename preserves acknowledged source bytes; stale source and target collisions refuse.
 * - No undo (git is history) — same contract as post delete.
 */
import { slugify } from '@/utils/slugify';
import { contentOps } from './content-ops';

const UNTITLED_FILE = /^untitled-\d+/;

export interface ResolveRenamedSlugArgs {
  /** frontmatter.title as saved — unknown because frontmatter is untyped */
  title: unknown;
  /** the post's REAL file name (postFileName), e.g. untitled-123.mdx */
  fileName: string;
  oldSlug: string;
  /** every post slug currently in the collection (may include oldSlug) */
  existingSlugs: readonly string[];
}

/**
 * THE rename decision. Returns the new slug, or null when no rename may
 * happen: non-untitled or non-.mdx file, empty/non-string title, or a title
 * that slugifies back to the current slug (no-op).
 */
export function resolveRenamedSlug(args: ResolveRenamedSlugArgs): string | null {
  const { title, fileName, oldSlug, existingSlugs } = args;
  if (!UNTITLED_FILE.test(fileName) || !/\.mdx$/i.test(fileName)) return null;
  if (typeof title !== 'string' || title.trim() === '') return null;

  const base = slugify(title);
  const taken = new Set(
    existingSlugs.map(s => s.toLowerCase()).filter(s => s !== oldSlug.toLowerCase()),
  );
  let candidate = base;
  // -99 cap mirrors the server's page-create guard — a runaway suffix means
  // something else is wrong; refusing beats minting my-post-4711.
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    if (n > 99) return null;
    candidate = `${base}-${n}`;
  }
  if (candidate.toLowerCase() === oldSlug.toLowerCase()) return null;
  return candidate;
}

/**
 * Current slugs of a collection, or NULL when discovery can't be trusted —
 * fetch failure, collection missing, or the renaming post itself absent from
 * the result. FAIL-CLOSED: an empty collision set from a transient discovery
 * hiccup would let createPost silently overwrite an existing post (verifier
 * finding, 2026-08-10). Null aborts the rename; it retries on the next save.
 */
export async function fetchCollectionSlugs(
  collection: string,
  oldSlug: string,
): Promise<string[] | null> {
  try {
    const cols = await contentOps.fetchCollections();
    const slugs = cols.find(c => c.name === collection)?.posts.map(p => p.slug);
    if (!slugs) return null;
    if (!slugs.some(s => s.toLowerCase() === oldSlug.toLowerCase())) return null;
    return slugs;
  } catch {
    return null;
  }
}

export interface RenamePostArgs {
  collection: string;
  oldSlug: string;
  newSlug: string;
  frontmatter: Record<string, unknown>;
  /** the CURRENT body — from the open editor's model, not a stale prop */
  body: string;
}

/** The rename itself retains the saved file source, including opaque YAML. */
export async function renamePostToTitle(args: RenamePostArgs): Promise<void> {
  await contentOps.renamePost(args.collection, args.oldSlug, args.newSlug, args.frontmatter, args.body);
}
