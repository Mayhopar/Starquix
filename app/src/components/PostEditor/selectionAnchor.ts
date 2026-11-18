import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
export interface SelectionAnchor {
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
  from: number;
  to: number;
}
/** Read a DOM range for the model selection, even when chrome holds focus. */
export function readTextSelectionAnchor(editor: Editor): SelectionAnchor | null {
  const { selection } = editor.state;
  if (selection.empty || selection instanceof NodeSelection) return null;
  const start = editor.view.domAtPos(selection.from);
  const end = editor.view.domAtPos(selection.to);
  const range = editor.view.dom.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const rect = range.getBoundingClientRect();
  return { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, from: selection.from, to: selection.to };
}
