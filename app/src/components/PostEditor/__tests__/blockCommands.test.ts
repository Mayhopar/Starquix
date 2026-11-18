/** Notion-style blocks (owner 2026-09-30): select, turn into, move, drag-reorder — saved bytes asserted. */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { parsePostBody, serializePostDoc } from '@/postmodel/postModel';
import { postDocToTiptap, postEditorExtensions, tiptapToPostDoc, type PMNode } from '../tiptap/schema';
import { blockAt, blockAtSelection, moveBlockTo, turnInto, selectBlock, duplicateBlock, deleteBlock } from '../blockCommands';

function mount(src: string) {
  const original = parsePostBody(src, 'mdx');
  const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
  const body = () => serializePostDoc(tiptapToPostDoc(editor.getJSON() as PMNode, original));
  /** the top-level block whose text starts with `text` */
  const block = (text: string) => {
    let found = -1;
    editor.state.doc.forEach((n, off) => { if (found < 0 && n.textContent.startsWith(text)) found = off; });
    return { pos: found, node: editor.state.doc.nodeAt(found)! };
  };
  return { editor, body, block };
}

describe('blockCommands', () => {
  it('blockAt: a paragraph from any position inside it; the imports block is never grabbable', () => {
    const { editor, block } = mount("import Media from '../../components/sq/Media.astro';\n\nOne.\n\nTwo.\n");
    const one = block('One');
    expect(blockAt(editor.state.doc, one.pos + 2)?.pos).toBe(one.pos);
    expect(blockAt(editor.state.doc, 0, 0)).toBeNull();
    editor.destroy();
  });

  it('drag-move down and up among siblings; bytes follow', () => {
    const { editor, body, block } = mount('One.\n\nTwo.\n\nThree.\n');
    expect(moveBlockTo(editor, block('One'), 3)).toBe(true);
    expect(body()).toBe('Two.\n\nThree.\n\nOne.\n');
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(moveBlockTo(editor, block('One'), 0)).toBe(true);
    expect(body()).toBe('One.\n\nTwo.\n\nThree.\n');
    // dropping into its own gap is a no-op
    expect(moveBlockTo(editor, block('Two'), 1)).toBe(false);
    expect(moveBlockTo(editor, block('Two'), 2)).toBe(false);
    editor.destroy();
  });

  it('never lands above the imports block', () => {
    const src = "import Media from '../../components/sq/Media.astro';\n\nOne.\n\nTwo.\n";
    const { editor, body, block } = mount(src);
    expect(moveBlockTo(editor, block('Two'), 0)).toBe(true);
    expect(body()).toBe("import Media from '../../components/sq/Media.astro';\n\nTwo.\n\nOne.\n");
    editor.destroy();
  });

  it('turn into heading / list / quote and back', () => {
    const { editor, body, block } = mount('One.\n\nTwo.\n');
    turnInto(editor, block('Two'), 'h2');
    expect(body()).toBe('One.\n\n## Two.\n');
    turnInto(editor, block('Two'), 'quote');
    expect(body()).toBe('One.\n\n> Two.\n');
    turnInto(editor, block('Two'), 'p');
    expect(body()).toBe('One.\n\nTwo.\n');
    editor.destroy();
  });

  it('duplicate + delete a selected block; blockAtSelection is the node itself', () => {
    const { editor, body, block } = mount('One.\n\nTwo.\n');
    selectBlock(editor, block('One'));
    expect(blockAtSelection(editor)?.pos).toBe(block('One').pos);
    duplicateBlock(editor, block('One'));
    expect(body()).toBe('One.\n\nOne.\n\nTwo.\n');
    deleteBlock(editor, block('Two'));
    expect(body()).toBe('One.\n\nOne.\n');
    editor.destroy();
  });
});

// Owner 2026-10-01: "dragging inside these horizontal stacks doesn't work well horizontally".
describe('moveBlockToPos — across containers', () => {
  const ROW = "import Stack from '../../components/sq/Stack.astro';\n\n<Stack direction=\"row\">\n<div>\n\nLeft one.\n\nLeft two.\n\n</div>\n<div>\n\nRight one.\n\n</div>\n</Stack>\n\nAfter.\n";
  const find = (editor: Editor, text: string) => {
    let hit = -1;
    editor.state.doc.descendants((n, p) => { if (hit < 0 && n.type.name === 'paragraph' && n.textContent === text) hit = p; return hit < 0; });
    return { pos: hit, node: editor.state.doc.nodeAt(hit)! };
  };
  it('a paragraph moves from the left side of a row to the right side', async () => {
    const { moveBlockToPos } = await import('../blockCommands');
    const { editor, body } = mount(ROW);
    const right = find(editor, 'Right one.');
    expect(moveBlockToPos(editor, find(editor, 'Left two.'), right.pos + right.node.nodeSize)).toBe(true);
    expect(body()).toContain('Right one.\n\nLeft two.');
    expect(body()).not.toMatch(/Left one\.\n\nLeft two\./);
    editor.destroy();
  });
  it('a side emptied by the move keeps an empty paragraph (a side must hold a block)', async () => {
    const { moveBlockToPos } = await import('../blockCommands');
    const { editor } = mount(ROW);
    const after = find(editor, 'After.');
    expect(moveBlockToPos(editor, find(editor, 'Right one.'), after.pos)).toBe(true);
    const row = editor.state.doc.child(1);
    expect(row.type.name).toBe('stackRow');
    expect(row.child(1).childCount).toBe(1);
    expect(row.child(1).firstChild?.type.name).toBe('paragraph');
    editor.destroy();
  });
  it('refuses a layout into a row side, a block into itself, and a spot above the imports', async () => {
    const { canDropAt } = await import('../blockCommands');
    const { editor } = mount(ROW);
    const row = { pos: editor.state.doc.child(0).nodeSize, node: editor.state.doc.child(1) };
    const left = find(editor, 'Left one.');
    expect(canDropAt(editor.state, row, left.pos)).toBe(false); // into its own side
    const after = find(editor, 'After.');
    expect(canDropAt(editor.state, after, 0)).toBe(false); // above the imports
    expect(canDropAt(editor.state, after, left.pos)).toBe(true); // a paragraph into a side: fine
    editor.destroy();
  });
});
