/**
 * Insert at the `/` paragraph wherever it sits — top level or inside a layout
 * slot. The paragraph is swapped for a sentinel passthrough in the editor
 * JSON, the normal Tiptap→PostDoc matching runs (so the sentinel lands at its
 * exact nested place with the right gap), and the sentinel is then replaced by
 * the new block(s). No index arithmetic that empty paragraphs could skew.
 */
import type { PostBlock, PostDoc } from '@/postmodel/postModel';
import type { PMNode } from './tiptap/schema';

const SENTINEL = '\u0000sq-slash\u0000';

/** `path` = child index at each depth from the doc down to the paragraph. */
export function markSlash(json: PMNode, path: number[]): PMNode {
  if (path.length === 0) return { type: 'passthrough', attrs: { source: SENTINEL, nodeType: 'sq-slash' } };
  const content = (json.content ?? []).slice();
  content[path[0]] = markSlash(content[path[0]], path.slice(1));
  return { ...json, content };
}

/** Replace the sentinel block with `blocks` (the first takes its gap). null = not found. */
export function replaceSentinel(doc: PostDoc, blocks: PostBlock[]): PostDoc | null {
  let found = false;
  const walk = (list: PostBlock[]): PostBlock[] => list.flatMap(b => {
    if (b.kind === 'passthrough' && b.source === SENTINEL) {
      found = true;
      return blocks.map((n, i) => (i === 0 ? { ...n, gapBefore: b.gapBefore } : n));
    }
    return b.kind === 'stack' ? [{ ...b, slots: b.slots.map(walk) }] : [b];
  });
  const next = { ...doc, blocks: walk(doc.blocks) };
  return found ? next : null;
}
