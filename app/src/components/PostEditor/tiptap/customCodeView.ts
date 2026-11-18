/**
 * Custom code: the writing view's editable box for a raw HTML/JSX element.
 *
 * The model keeps the element as a passthrough block (verbatim bytes); this
 * view only lets the writer change `source`. The box holds the DRAFT text; the
 * block holds the last source that COMPILES. A half-typed tag is therefore never
 * committed — a refused write would roll the whole post draft back, eating the
 * typing — and the box says why it is not saved yet.
 */
import type { Editor } from '@tiptap/core';
import type { Node as PMDocNode } from '@tiptap/pm/model';
import { Selection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { postCompiles } from '@/postmodel/compileGate';
import type { PostFormat } from '@/postmodel/postModel';

/** Raw elements: JSX (`mdxJsxFlowElement`, .mdx) and HTML (`html`, .md). */
export const isRawElement = (nodeType: unknown): boolean => nodeType === 'mdxJsxFlowElement' || nodeType === 'html';

const PAUSE_MS = 250;

export function customCodeView(
  initial: PMDocNode,
  editor: Editor,
  getPos: () => number | undefined,
  format: () => PostFormat,
): NodeView {
  let node = initial;
  const dom = document.createElement('div');
  dom.className = 'sq-custom-code';
  dom.dataset.sqPassthrough = String(node.attrs.nodeType);
  dom.dataset.sqBlock = 'custom-code'; // the page's SPACE rules space a block by this hook (articleTokens)
  dom.contentEditable = 'false';

  const area = document.createElement('textarea');
  area.className = 'sq-custom-code-input';
  area.setAttribute('aria-label', 'Custom code');
  area.spellcheck = false;
  area.placeholder = '<div class="…">…</div>';
  area.value = String(node.attrs.source);

  const error = document.createElement('p');
  error.className = 'sq-custom-code-error';
  error.setAttribute('role', 'status');
  error.hidden = true;
  dom.append(area, error);

  const fit = () => { area.rows = Math.max(2, area.value.split('\n').length); };
  const show = (message: string | null) => { error.textContent = message ?? ''; error.hidden = message === null; };
  fit();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  const commit = async () => {
    const mine = ++latest;
    const text = area.value.trim();
    if (text === node.attrs.source) { show(null); return; }
    // An emptied box commits as empty: the serializer writes nothing for it.
    const gate = text === '' ? ({ ok: true } as const) : await postCompiles(text, format());
    if (mine !== latest) return; // a newer keystroke owns the box now
    if (!gate.ok) { show(gate.error); return; }
    show(null);
    const pos = getPos();
    if (pos === undefined || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, source: text }));
  };

  area.addEventListener('input', () => {
    fit();
    clearTimeout(timer);
    timer = setTimeout(() => void commit(), PAUSE_MS);
  });
  area.addEventListener('blur', () => { clearTimeout(timer); void commit(); });

  // Leave the box: Esc selects the block (Delete then removes it); arrows at
  // the first/last line step to the neighbouring block. Never land a NodeSelection
  // on THIS block that way — the next keystroke would replace it — so below the
  // last block a new paragraph opens, and above the first one the caret stays.
  const leave = (direction: 1 | -1) => {
    const pos = getPos();
    if (pos === undefined) return;
    const { state, view } = editor;
    const after = pos + node.nodeSize;
    let tr = state.tr;
    let selection: Selection;
    if (direction > 0 && after >= state.doc.content.size) {
      tr = tr.insert(after, state.schema.nodes.paragraph.create());
      selection = TextSelection.create(tr.doc, after + 1);
    } else {
      selection = Selection.near(state.doc.resolve(direction > 0 ? after : pos), direction);
      if (selection instanceof NodeSelection && selection.from === pos) return;
    }
    view.dispatch(tr.setSelection(selection).scrollIntoView());
    view.focus();
  };
  area.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const pos = getPos();
      if (pos !== undefined) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      editor.view.focus();
      return;
    }
    const { selectionStart: start, selectionEnd: end, value } = area;
    if (start !== end) return;
    if (event.key === 'ArrowUp' && !value.slice(0, start).includes('\n')) { event.preventDefault(); leave(-1); }
    if (event.key === 'ArrowDown' && !value.slice(end).includes('\n')) { event.preventDefault(); leave(1); }
  });

  if (node.attrs.source === '') setTimeout(() => area.focus(), 0);

  return {
    dom,
    update(next) {
      if (next.type !== node.type || next.attrs.nodeType !== node.attrs.nodeType) return false;
      node = next;
      // An outside change (undo, rollback) wins; our own commit leaves the box alone.
      if (area.value.trim() !== node.attrs.source) { area.value = String(node.attrs.source); fit(); show(null); }
      return true;
    },
    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
    stopEvent: () => true,
    ignoreMutation: () => true,
    destroy() { clearTimeout(timer); latest++; },
  };
}
