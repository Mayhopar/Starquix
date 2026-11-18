/**
 * Editorial-layout edits as ProseMirror transactions (task-242): one undo
 * history with the typing, ⌘Z reverts any of them. Serialization is the usual
 * Tiptap→PostDoc match, so a changed stack regenerates only its own tags.
 *
 * Structure rules mirror postmodel/stackOps (D3): a row may sit inside a
 * column; nothing nests deeper; nested stacks have no width (P3).
 */
import type { Editor } from '@tiptap/core';
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, type Node as PMDocNode } from '@tiptap/pm/model';

export interface StackInfo {
  pos: number;
  node: PMDocNode;
  direction: 'row' | 'column';
  /** a row inside a column (no width, P3) */
  nested: boolean;
}

export const isStack = (n: PMDocNode | null | undefined): boolean => n?.type.name === 'stackRow' || n?.type.name === 'stackColumn';
/** The imports block — bookkeeping, hidden in the writing view, never moved or grabbed. */
export const isEsmNode = (n: PMDocNode) => n.type.name === 'passthrough' && n.attrs.nodeType === 'mdxjsEsm';

/** The innermost stack holding the selection (or node-selected). */
export function stackInfoAt(state: EditorState): StackInfo | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && isStack(sel.node)) {
    const $pos = state.doc.resolve(sel.from);
    return { pos: sel.from, node: sel.node, direction: sel.node.type.name === 'stackRow' ? 'row' : 'column', nested: $pos.depth > 0 };
  }
  const $from = sel.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isStack(node)) {
      return { pos: $from.before(d), node, direction: node.type.name === 'stackRow' ? 'row' : 'column', nested: d > 1 };
    }
  }
  return null;
}

/** Add the Stack import (as a top-level ESM passthrough) unless a `Stack` binding exists. */
export function ensureStackImportTr(tr: Transaction, importLine: string): Transaction {
  let lastEsmEnd = -1;
  let bound = false;
  tr.doc.forEach((node, offset) => {
    if (!isEsmNode(node)) return;
    lastEsmEnd = offset + node.nodeSize;
    if (/\bimport\s+Stack\b/.test(String(node.attrs.source))) bound = true;
  });
  if (bound) return tr;
  const esm = tr.doc.type.schema.nodes.passthrough.create({ source: importLine, nodeType: 'mdxjsEsm' });
  return tr.insert(Math.max(0, lastEsmEnd), esm);
}

const para = (state: EditorState) => state.schema.nodes.paragraph.create();

/** After replacing a layout, keep IT selected — the caret's old spot is gone
 *  and the selection would otherwise fall out (closing the toolbar). */
const keepSelected = (tr: Transaction, pos: number) => tr.setSelection(NodeSelection.create(tr.doc, pos));

function apply(editor: Editor, build: (tr: Transaction, state: EditorState) => Transaction | null): boolean {
  const tr = build(editor.state.tr, editor.state);
  if (!tr || !tr.docChanged) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function setStackAttrs(editor: Editor, info: StackInfo, attrs: Record<string, unknown>): boolean {
  if ('width' in attrs && info.nested) return false; // P3
  return apply(editor, tr => {
    for (const [k, v] of Object.entries(attrs)) tr.setNodeAttribute(info.pos, k, v);
    return tr;
  });
}

export function swapSlots(editor: Editor, info: StackInfo): boolean {
  if (info.direction !== 'row') return false;
  const { node, pos } = info;
  return apply(editor, tr => keepSelected(tr.replaceWith(pos, pos + node.nodeSize, node.type.create(node.attrs, [node.child(1), node.child(0)])), pos));
}

/** Side by side → stacked. A nested row cannot become a column (D3): its content joins the parent. */
export function toColumn(editor: Editor, info: StackInfo): boolean {
  if (info.direction !== 'row') return false;
  const { node, pos } = info;
  const kids: PMDocNode[] = [];
  node.forEach(slot => slot.forEach(child => { if (!(child.type.name === 'paragraph' && child.content.size === 0)) kids.push(child); }));
  return apply(editor, (tr, state) => {
    if (info.nested) return tr.replaceWith(pos, pos + node.nodeSize, kids.length ? kids : [para(state)]);
    const { ratio: _ratio, ...attrs } = node.attrs;
    const column = state.schema.nodes.stackColumn.create(attrs, kids.length ? kids : [para(state)]);
    return keepSelected(tr.replaceWith(pos, pos + node.nodeSize, column), pos);
  });
}

/** Stacked → side by side: everything into slot 1, slot 2 empty. Refused when it holds a row (D3). */
export function toRow(editor: Editor, info: StackInfo): boolean {
  if (info.direction !== 'column') return false;
  const { node, pos } = info;
  let hasRow = false;
  node.forEach(c => { if (c.type.name === 'stackRow') hasRow = true; });
  if (hasRow) return false;
  return apply(editor, (tr, state) => {
    const slot = state.schema.nodes.stackSlot;
    const row = state.schema.nodes.stackRow.create({ ...node.attrs, ratio: '1:1' }, [slot.create(null, node.content), slot.create(null, [para(state)])]);
    return keepSelected(tr.replaceWith(pos, pos + node.nodeSize, row), pos);
  });
}

/** Swap with the previous/next sibling (never above the imports). */
export function moveStack(editor: Editor, info: Pick<StackInfo, 'pos' | 'node'>, dir: -1 | 1): boolean {
  const $pos = editor.state.doc.resolve(info.pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const j = index + dir;
  if (j < 0 || j >= parent.childCount) return false;
  const other = parent.child(j);
  if (isEsmNode(other)) return false;
  return apply(editor, tr => {
    if (dir === 1) {
      const end = info.pos + info.node.nodeSize;
      return keepSelected(tr.delete(end, end + other.nodeSize).insert(info.pos, other), info.pos + other.nodeSize);
    }
    const start = info.pos - other.nodeSize;
    return keepSelected(tr.delete(start, info.pos).insert(start + info.node.nodeSize, other), start);
  });
}

export function duplicateStack(editor: Editor, info: Pick<StackInfo, 'pos' | 'node'>): boolean {
  return apply(editor, tr => tr.insert(info.pos + info.node.nodeSize, info.node.copy(info.node.content)));
}

/** Delete — content goes with it. An emptied column keeps an empty paragraph (its schema needs one). */
export function deleteStack(editor: Editor, info: Pick<StackInfo, 'pos' | 'node'>): boolean {
  const $pos = editor.state.doc.resolve(info.pos);
  const onlyChild = $pos.parent.childCount === 1 && $pos.depth > 0;
  return apply(editor, (tr, state) => (onlyChild
    ? tr.replaceWith(info.pos, info.pos + info.node.nodeSize, para(state))
    : tr.delete(info.pos, info.pos + info.node.nodeSize)));
}

/** Esc inside a layout selects the whole layout. */
export function selectStack(editor: Editor, info: Pick<StackInfo, 'pos'>): boolean {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, info.pos)));
  return true;
}

/**
 * Wrap a top-level node (a Media on width change — P7) in a column with
 * `attrs`, adding the Stack import in the same transaction.
 */
export function wrapTopLevel(editor: Editor, pos: number, attrs: Record<string, unknown>, importLine: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || editor.state.doc.resolve(pos).depth !== 0) return false;
  return apply(editor, (tr, state) => {
    tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.stackColumn.create(attrs, [node]));
    return ensureStackImportTr(tr, importLine);
  });
}

/** Replace a stack by its content (P7 back to reading width). */
export function unwrapStack(editor: Editor, info: StackInfo): boolean {
  const kids: PMDocNode[] = [];
  const collect = (n: PMDocNode) => n.forEach(c => (c.type.name === 'stackSlot' ? collect(c) : kids.push(c)));
  collect(info.node);
  return apply(editor, (tr, state) => tr.replaceWith(info.pos, info.pos + info.node.nodeSize, kids.length ? kids : [para(state)]));
}

/**
 * The formatting toolbar's Color: wrap the top-level blocks the selection
 * touches into ONE colored column (design D7). Imports are trimmed off both
 * ends; a range overlapping an existing column GROWS the first one (its colors
 * win) and absorbs any other column's content. Returns the column's position,
 * or null when nothing sensible can be wrapped (only imports, or an import in
 * the middle — ESM must stay top-level).
 */
export function wrapSelection(editor: Editor, attrs: Record<string, unknown>, importLine: string): number | null {
  const { doc } = editor.state;
  const { from, to } = editor.state.selection;
  let i = doc.resolve(from).index(0);
  const $to = doc.resolve(to);
  let j = $to.index(0);
  // `to` sitting BETWEEN top-level blocks ends the range at the block before it
  if ($to.depth === 0 && j > i) j--;
  if (j >= doc.childCount) j = doc.childCount - 1;
  while (i <= j && isEsmNode(doc.child(i))) i++;
  while (j >= i && isEsmNode(doc.child(j))) j--;
  if (i > j) return null;
  const range: PMDocNode[] = [];
  for (let k = i; k <= j; k++) range.push(doc.child(k));
  if (range.some(isEsmNode)) return null;
  let start = 0;
  for (let k = 0; k < i; k++) start += doc.child(k).nodeSize;
  const end = start + range.reduce((n, c) => n + c.nodeSize, 0);
  const host = range.find(n => n.type.name === 'stackColumn');
  const kids = range.flatMap(n => {
    if (n.type.name !== 'stackColumn') return [n];
    const inner: PMDocNode[] = [];
    n.forEach(c => inner.push(c));
    return inner;
  });
  const column = editor.state.schema.nodes.stackColumn.create(host ? host.attrs : attrs, kids);
  const tr = editor.state.tr.replaceWith(start, end, column);
  ensureStackImportTr(tr, importLine);
  const at = tr.mapping.map(start, 1);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  editor.view.dispatch(tr.scrollIntoView());
  return at;
}

/**
 * May `info` be dropped at document position `at` (a gap between blocks of
 * any container — the doc, a layout column, a side of a row)? Never into
 * itself, never above the imports block, and only where the schema allows it
 * (a layout cannot go into a row's side — D3).
 */
export function canDropAt(state: EditorState, info: Pick<StackInfo, 'pos' | 'node'>, at: number): boolean {
  if (at > info.pos && at < info.pos + info.node.nodeSize) return false;
  const $at = state.doc.resolve(at);
  const index = $at.index();
  for (let k = index; k < $at.parent.childCount; k++) if (isEsmNode($at.parent.child(k))) return false;
  return $at.parent.canReplace(index, index, Fragment.from(info.node));
}

/**
 * Drag-to-move any block (BlockHandle) to document position `at` — another
 * place in the same container or a different one (the other side of a row, a
 * column, the page). A container it empties keeps an empty paragraph (a slot
 * or column must hold one block).
 */
export function moveBlockToPos(editor: Editor, info: Pick<StackInfo, 'pos' | 'node'>, at: number): boolean {
  const { state } = editor;
  if (!canDropAt(state, info, at)) return false;
  const end = info.pos + info.node.nodeSize;
  if (at === info.pos || at === end) return false; // its own gap
  const $pos = state.doc.resolve(info.pos);
  const onlyChild = $pos.parent.childCount === 1 && $pos.depth > 0;
  return apply(editor, (tr, st) => {
    if (onlyChild) tr.replaceWith(info.pos, end, para(st));
    else tr.delete(info.pos, end);
    const landed = tr.mapping.map(at);
    return keepSelected(tr.insert(landed, info.node), landed);
  });
}

/** Move a block to sibling gap `target` (0..childCount) of its own parent. */
export function moveBlockTo(editor: Editor, info: Pick<StackInfo, 'pos' | 'node'>, target: number): boolean {
  const $pos = editor.state.doc.resolve(info.pos);
  const parent = $pos.parent;
  let first = 0; // never above the imports block: clamp just below it
  while (first < parent.childCount && isEsmNode(parent.child(first))) first++;
  let at = $pos.start();
  for (let k = 0; k < Math.max(first, Math.min(target, parent.childCount)); k++) at += parent.child(k).nodeSize;
  return moveBlockToPos(editor, info, at);
}
