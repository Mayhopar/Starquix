/**
 * Block-level editing (owner 2026-09-30: "select paragraphs and elements in
 * general, like in Notion"). A BLOCK = a node whose parent is the doc, a layout
 * slot or a layout column — a paragraph, heading, list, quote, image, code,
 * divider or a whole layout. Every edit is one ProseMirror transaction, so ⌘Z
 * undoes it and the usual Tiptap→PostDoc match saves it (a moved block is
 * re-stringified; untouched blocks keep their bytes).
 */
import type { ChainedCommands, Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMDocNode } from '@tiptap/pm/model';
import { isEsmNode as isEsm } from './stackCommands';

export { moveStack as moveBlock, duplicateStack as duplicateBlock, deleteStack as deleteBlock, selectStack as selectBlock, moveBlockTo, moveBlockToPos, canDropAt } from './stackCommands';

export interface BlockRef { pos: number; node: PMDocNode }

const CONTAINERS = new Set(['doc', 'stackSlot', 'stackColumn']);

/**
 * The innermost block at a document position (`inside` = the node the pointer
 * is inside, from posAtCoords, or -1). null over nothing grabbable.
 */
export function blockAt(doc: PMDocNode, pos: number, inside = -1): BlockRef | null {
  if (inside >= 0) {
    const node = doc.nodeAt(inside);
    if (node && CONTAINERS.has(doc.resolve(inside).parent.type.name)) return isEsm(node) ? null : { pos: inside, node };
  }
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let d = $p.depth; d >= 1; d--) {
    if (CONTAINERS.has($p.node(d - 1).type.name)) {
      const node = $p.node(d);
      return isEsm(node) ? null : { pos: $p.before(d), node };
    }
  }
  const after = $p.nodeAfter;
  return after && CONTAINERS.has($p.parent.type.name) && !isEsm(after) ? { pos, node: after } : null;
}

/** The block holding the current selection (a node-selected block is itself). */
export function blockAtSelection(editor: Editor): BlockRef | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && CONTAINERS.has(sel.$from.parent.type.name)) return { pos: sel.from, node: sel.node };
  return blockAt(editor.state.doc, sel.from);
}

/** Text styles = the blocks the page styles (articleTokens BODY). No H1: the title is the page's h1. */
export const TEXT_STYLES = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'ul', label: 'Bulleted list' },
  { value: 'ol', label: 'Numbered list' },
  { value: 'quote', label: 'Quote' },
] as const;
export type TextStyle = typeof TEXT_STYLES[number]['value'];

export function currentTextStyle(editor: Editor): TextStyle {
  if (editor.isActive('bulletList')) return 'ul';
  if (editor.isActive('orderedList')) return 'ol';
  if (editor.isActive('blockquote')) return 'quote';
  const level = editor.getAttributes('heading').level as number | undefined;
  return level === 2 || level === 3 ? `h${level}` : 'p';
}

/** Apply a text style on `chain` (its selection already placed); styles are exclusive, like the menus say. */
export function applyTextStyle(editor: Editor, chain: ChainedCommands, value: TextStyle): ChainedCommands {
  if (editor.isActive('bulletList')) chain.toggleBulletList();
  else if (editor.isActive('orderedList')) chain.toggleOrderedList();
  else if (editor.isActive('blockquote')) chain.lift('blockquote');
  if (value === 'p') chain.setParagraph();
  else if (value === 'h2' || value === 'h3') chain.setHeading({ level: value === 'h2' ? 2 : 3 });
  else if (value === 'ul') chain.setParagraph().toggleBulletList();
  else if (value === 'ol') chain.setParagraph().toggleOrderedList();
  else chain.setParagraph().setBlockquote();
  return chain;
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote']);
export const canTurnInto = (ref: BlockRef): boolean => TEXT_BLOCKS.has(ref.node.type.name);

/** "Turn into" from the block menu: caret into the block, then the same style change the toolbar makes. */
export function turnInto(editor: Editor, ref: BlockRef, value: TextStyle): boolean {
  if (!canTurnInto(ref)) return false;
  const inside = TextSelection.near(editor.state.doc.resolve(ref.pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(inside));
  return applyTextStyle(editor, editor.chain().focus(), value).run();
}
