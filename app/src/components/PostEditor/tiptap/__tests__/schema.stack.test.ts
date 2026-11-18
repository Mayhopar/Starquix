/**
 * Editorial layouts through a REAL Tiptap editor: the schema accepts every
 * stack shape, untouched stacks come back byte-identical, and edits inside a
 * slot touch only that slot.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { parsePostBody, serializePostDoc, type PostDoc } from '@/postmodel/postModel';
import { mdxCompiles } from '@/postmodel/compileGate';
import { postDocToTiptap, tiptapToPostDoc, postEditorExtensions, componentBodyLines, type PMNode } from '../schema';

const DIR = join(__dirname, '..', '..', '..', '..', 'postmodel', '__tests__', 'corpus');
const read = (n: string) => readFileSync(join(DIR, n), 'utf8');

function open(src: string): { editor: Editor; original: PostDoc; out: () => string } {
  const original = parsePostBody(src);
  const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
  return { editor, original, out: () => serializePostDoc(tiptapToPostDoc(editor.getJSON() as PMNode, original)) };
}

/** doc position of the first text node containing `needle` */
function posOf(editor: Editor, needle: string): number {
  let at = -1;
  editor.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text!.includes(needle)) at = pos + n.text!.indexOf(needle);
    return at < 0;
  });
  if (at < 0) throw new Error(`no ${needle}`);
  return at;
}

describe('stack nodes in a real editor', () => {
  for (const name of readdirSync(DIR)) {
    it(`editor round-trip keeps ${name} byte-identical`, () => {
      const src = read(name);
      const { editor, out } = open(src);
      try { expect(out()).toBe(src); } finally { editor.destroy(); }
    });
  }

  it('the schema holds stack nodes (not flattened to passthrough)', () => {
    const { editor } = open(read('stack-nested.txt'));
    try {
      const types: string[] = [];
      editor.state.doc.descendants(n => { types.push(n.type.name); });
      expect(types).toEqual(expect.arrayContaining(['stackColumn', 'stackRow', 'stackSlot', 'astroComponent']));
    } finally { editor.destroy(); }
  });

  it('typing in a slot changes only that paragraph', async () => {
    const src = read('stack-row.txt');
    const { editor, out } = open(src);
    try {
      editor.chain().insertContentAt(posOf(editor, 'Second'), 'Very ').run();
      const text = out();
      expect(text).toBe(src.replace('Second paragraph.', 'Very Second paragraph.'));
      expect(await mdxCompiles(text)).toEqual({ ok: true });
    } finally { editor.destroy(); }
  });

  it('swapping the slots via a transaction swaps source order and stays valid', async () => {
    const { editor, out } = open(read('stack-row.txt'));
    try {
      let rowPos = -1;
      editor.state.doc.descendants((n, pos) => { if (n.type.name === 'stackRow') rowPos = pos; return rowPos < 0; });
      const row = editor.state.doc.nodeAt(rowPos)!;
      const swapped = row.type.create(row.attrs, [row.child(1), row.child(0)]);
      editor.view.dispatch(editor.state.tr.replaceWith(rowPos, rowPos + row.nodeSize, swapped));
      const text = out();
      expect(text.indexOf('<Media')).toBeLessThan(text.indexOf('Text *beside*'));
      expect(text).toContain('Text *beside* the image.\n\nSecond paragraph.'); // children bytes kept
      expect(await mdxCompiles(text)).toEqual({ ok: true });
    } finally { editor.destroy(); }
  });

  it('typing into an empty slot regenerates the frame (valid MDX)', async () => {
    const src = "import Stack from '../../components/sq/Stack.astro';\n\n<Stack direction=\"row\">\n<div>\n</div>\n<div>\n\nB\n\n</div>\n</Stack>\n";
    const { editor, out } = open(src);
    try {
      let slotPara = -1;
      editor.state.doc.descendants((n, pos) => { if (slotPara < 0 && n.type.name === 'stackSlot') slotPara = pos + 2; return slotPara < 0; });
      editor.chain().insertContentAt(slotPara, 'Typed').run();
      const text = out();
      expect(text).toContain('<div>\n\nTyped\n\n</div>\n<div>\n\nB\n\n</div>');
      expect(await mdxCompiles(text)).toEqual({ ok: true });
    } finally { editor.destroy(); }
  });

  it('ratio change via node attrs rewrites only the open tag', () => {
    const src = read('stack-row.txt');
    const { editor, out } = open(src);
    try {
      let rowPos = -1;
      editor.state.doc.descendants((n, pos) => { if (n.type.name === 'stackRow') rowPos = pos; return rowPos < 0; });
      editor.view.dispatch(editor.state.tr.setNodeAttribute(rowPos, 'ratio', '2:1'));
      expect(out()).toBe(src.replace('ratio="1:2"', 'ratio="2:1"'));
    } finally { editor.destroy(); }
  });

  it('componentBodyLines pairs a Media nested in a row inside a column with its own line', () => {
    const src = read('stack-nested.txt');
    const line = src.split('\n').findIndex(l => l.startsWith('<Media')) + 1;
    expect(componentBodyLines(parsePostBody(src))).toEqual([line]);
  });
});
