/**
 * task-206 D5: the ONE write path for canvas Media edits. Locates the
 * invocation in the post body by the rehype wrapper's body-line stamp,
 * applies a pure mutate on its raw source, and saves through
 * contentOps.updatePost — runtime-agnostic (local file / WC FS / ls tier).
 *
 * Frontmatter law: the fetched post's frontmatter object passes through
 * UNTOUCHED as the successful read baseline. updatePost sends an explicit
 * empty YAML patch and guards the body against changes since that read.
 */
import { contentOps } from '@/core/collections/content-ops';
import { parsePostBody, serializePostDoc, walkBlockLines, type PostDoc, type PostBlock } from '@/postmodel/postModel';
import { awaitPostWritesSettled } from '@/postmodel/writeQueue';

/**
 * The COMPONENT block covering body `line`, descending into layouts (a Media
 * inside a Stack slot is stamped with its own line).
 */
export function componentAtLine(doc: PostDoc, line: number): Extract<PostBlock, { kind: 'component' }> | null {
  let hit: Extract<PostBlock, { kind: 'component' }> | null = null;
  walkBlockLines(doc, (block, start, end) => {
    if (block.kind === 'component' && line >= start && line <= end) { hit = block; return true; }
  });
  return hit;
}

/** Fetch the post and resolve the component block at the stamped line.
 *  fetchCollections reads EVERY post body, so callers should hold onto the
 *  result rather than locating twice. */
async function locateInvocation(opts: { collection: string; slug: string; bodyLine: number }) {
  // task-207 T1: the post editor's PostWriteQueue drains asynchronously on
  // unmount (tab switch back to the canvas), so a flush can still be in flight
  // when the canvas edit arrives. Serialize behind it: read AFTER every
  // in-flight flush lands, so this edit rebases on the flushed body instead of
  // racing it — neither write can clobber the other.
  await awaitPostWritesSettled(opts.collection, opts.slug);
  const collections = await contentOps.fetchCollections();
  const post = collections
    .find((c) => c.name === opts.collection)
    ?.posts.find((p) => p.slug === opts.slug);
  if (!post) return null;
  const doc = parsePostBody(post.body, 'mdx');
  const block = componentAtLine(doc, opts.bodyLine);
  if (!block) return null;
  return { post, doc, block };
}

/** Current raw invocation source at the stamped line, or null. MediaBlock
 *  reads it to show the knobs' current values. */
export async function readMediaInvocation(opts: {
  collection: string;
  slug: string;
  bodyLine: number;
}): Promise<string | null> {
  const located = await locateInvocation(opts);
  return located ? located.block.source : null;
}

/** Returns the invocation's NEW source on success (so callers can refresh
 *  their view without a second full fetch), null on refusal/miss. */
export async function saveMediaEdit(opts: {
  collection: string;
  slug: string;
  bodyLine: number;
  mutate: (invocationSource: string) => string | null;
}): Promise<string | null> {
  const located = await locateInvocation(opts);
  if (!located) return null;
  const { post, doc, block } = located;

  const next = opts.mutate(block.source);
  if (next === null) return null;

  block.source = next;
  block.dirty = true; // serialize the edited source, not the verbatim raw
  const newBody = serializePostDoc(doc);
  await contentOps.updatePost(opts.collection, opts.slug, post.frontmatter, newBody, { baseline: { frontmatter: post.frontmatter, body: post.body } });
  return next;
}
