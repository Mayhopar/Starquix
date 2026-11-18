/** Layout toolbar ops as real Tiptap transactions: saved bytes + ⌘Z. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { parsePostBody, serializePostDoc } from '@/postmodel/postModel';
import { mdxCompiles } from '@/postmodel/compileGate';
import { postDocToTiptap, tiptapToPostDoc, postEditorExtensions, type PMNode } from '../tiptap/schema';
import * as cmd from '../stackCommands';

const read = (n: string) => readFileSync(join(__dirname, '../../../postmodel/__tests__/corpus', n), 'utf8');

function open(src: string) {
  const original = parsePostBody(src);
  const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
  const out = () => serializePostDoc(tiptapToPostDoc(editor.getJSON() as PMNode, original));
  /** caret into the text `needle` */
  const caret = (needle: string) => {
    let at = -1;
    editor.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text!.includes(needle)) at = p + 1; return at < 0; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    return cmd.stackInfoAt(editor.state)!;
  };
  return { editor, out, caret };
}

describe('stack commands', () => {
  it('swap → saved body has the divs swapped; ⌘Z restores the original bytes', async () => {
    const src = read('stack-row.txt');
    const { editor, out, caret } = open(src);
    expect(cmd.swapSlots(editor, caret('Second'))).toBe(true);
    const text = out();
    expect(text.indexOf('<Media')).toBeLessThan(text.indexOf('Second'));
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    editor.commands.undo();
    expect(out()).toBe(src);
    editor.destroy();
  });

  it('info: nested row inside a column', () => {
    const { editor, caret } = open(read('stack-nested.txt'));
    expect(caret('Left')).toMatchObject({ direction: 'row', nested: true });
    expect(caret('Intro')).toMatchObject({ direction: 'column', nested: false });
    editor.destroy();
  });

  it('width refuses nested (P3); ratio rewrites the open tag', () => {
    const src = read('stack-nested.txt');
    const { editor, out, caret } = open(src);
    expect(cmd.setStackAttrs(editor, caret('Left'), { width: 'edge' })).toBe(false);
    cmd.setStackAttrs(editor, caret('Left'), { ratio: '1:1' });
    expect(out()).toBe(src.replace('<Stack direction="row" ratio="2:1">', '<Stack direction="row">'));
    editor.destroy();
  });

  it('row → column, and a nested row → joins its parent (D3)', async () => {
    const row = open(read('stack-row.txt'));
    cmd.toColumn(row.editor, row.caret('Second'));
    expect(row.out()).toContain('<Stack>\n\nText *beside* the image.\n\nSecond paragraph.\n\n<Media items={[null]} />\n\n</Stack>');
    expect(await mdxCompiles(row.out())).toEqual({ ok: true });
    row.editor.destroy();
    const nested = open(read('stack-nested.txt'));
    cmd.toColumn(nested.editor, nested.caret('Left'));
    const text = nested.out();
    expect(text.match(/<Stack/g)).toHaveLength(1);
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    nested.editor.destroy();
  });

  it('column → row: all into slot 1; refused when it holds a row', async () => {
    const col = open(read('stack-column-colored.txt'));
    expect(cmd.toRow(col.editor, col.caret('A colored'))).toBe(true);
    const text = col.out();
    expect(text).toContain('<Stack direction="row" width="wide" class="bg-[var(--brand)] text-[#111111]" text="auto">\n<div>\n\n## A colored passage');
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    col.editor.destroy();
    const nested = open(read('stack-nested.txt'));
    expect(cmd.toRow(nested.editor, nested.caret('Intro'))).toBe(false);
    nested.editor.destroy();
  });

  it('move / duplicate / delete stay valid MDX', async () => {
    const src = read('stack-column-colored.txt');
    const a = open(src);
    cmd.moveStack(a.editor, a.caret('A colored'), 1);
    expect(a.out()).toMatch(/Trailing text\.\n\n<Stack/);
    expect(cmd.moveStack(a.editor, cmd.stackInfoAt(a.editor.state)!, -1)).toBe(true);
    expect(cmd.moveStack(a.editor, cmd.stackInfoAt(a.editor.state)!, -1)).toBe(false); // never above imports
    cmd.duplicateStack(a.editor, cmd.stackInfoAt(a.editor.state)!);
    expect(a.out().match(/<Stack /g)).toHaveLength(2);
    expect(await mdxCompiles(a.out())).toEqual({ ok: true });
    cmd.deleteStack(a.editor, cmd.stackInfoAt(a.editor.state)!);
    expect(a.out().match(/<Stack /g)).toHaveLength(1);
    a.editor.destroy();
  });

  it('wrapTopLevel adds the Stack import in the same transaction; unwrap restores', async () => {
    const src = "import Media from '../../components/sq/Media.astro';\n\nIntro.\n\n<Media items={[\"/a.jpg\"]} />\n";
    const { editor, out } = open(src);
    let pos = -1;
    editor.state.doc.forEach((n, off) => { if (n.type.name === 'astroComponent') pos = off; });
    cmd.wrapTopLevel(editor, pos, { width: 'edge' }, "import Stack from '../../components/sq/Stack.astro';");
    const text = out();
    expect(text).toBe("import Media from '../../components/sq/Media.astro';\nimport Stack from '../../components/sq/Stack.astro';\n\nIntro.\n\n<Stack width=\"edge\">\n\n<Media items={[\"/a.jpg\"]} />\n\n</Stack>\n");
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    editor.commands.undo();
    expect(out()).toBe(src);
    editor.destroy();
  });
});

describe('wrapSelection (Color on selected blocks, D7)', () => {
  const IMP = "import Stack from '../../components/sq/Stack.astro';";
  const select = (editor: Editor, a: string, b: string) => {
    const find = (needle: string, end: boolean) => {
      let at = -1;
      editor.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text!.includes(needle)) at = p + (end ? n.text!.length : 0); return at < 0; });
      return at;
    };
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, find(a, false), find(b, true))));
  };

  it('three paragraphs → one colored column, import added, ESM never inside', async () => {
    const src = 'A.\n\nB.\n\nC.\n\nD.\n';
    const { editor, out } = open(src);
    select(editor, 'A.', 'C.');
    expect(cmd.wrapSelection(editor, { cls: 'bg-[#eeeeee] text-[#111111]', text: 'auto' }, IMP)).not.toBeNull();
    const text = out();
    expect(text).toBe(`${IMP}\n\n<Stack class="bg-[#eeeeee] text-[#111111]" text="auto">\n\nA.\n\nB.\n\nC.\n\n</Stack>\n\nD.\n`);
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    editor.commands.undo();
    expect(out()).toBe(src);
    editor.destroy();
  });

  it('last block of a passage + blocks after → the passage grows (no second stack)', async () => {
    const src = `${IMP}\n\n<Stack class="bg-[#111111] text-white" text="auto">\n\nIn.\n\n</Stack>\n\nOut1.\n\nOut2.\n`;
    const { editor, out } = open(src);
    select(editor, 'In.', 'Out2.');
    cmd.wrapSelection(editor, { cls: 'bg-[#eeeeee]' }, IMP);
    const text = out();
    expect(text.match(/<Stack/g)).toHaveLength(1);
    expect(text).toContain('<Stack class="bg-[#111111] text-white" text="auto">\n\nIn.\n\nOut1.\n\nOut2.\n\n</Stack>');
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    editor.destroy();
  });

  it('touching two passages merges into the first one\'s colors', async () => {
    const src = `${IMP}\n\n<Stack class="bg-[#111111]">\n\nOne.\n\n</Stack>\n\nMid.\n\n<Stack class="bg-[#222222]">\n\nTwo.\n\n</Stack>\n`;
    const { editor, out } = open(src);
    select(editor, 'One.', 'Two.');
    cmd.wrapSelection(editor, {}, IMP);
    const text = out();
    expect(text).toContain('<Stack class="bg-[#111111]">\n\nOne.\n\nMid.\n\nTwo.\n\n</Stack>');
    expect(text).not.toContain('#222222');
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    editor.destroy();
  });

  it('a selection of imports only wraps nothing', () => {
    const { editor } = open(`${IMP}\n\nA.\n`);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 0, 1)));
    expect(cmd.wrapSelection(editor, {}, IMP)).toBeNull();
    editor.destroy();
  });
});

describe('replacing ops keep the layout selected (toolbar stays open — found live)', () => {
  it('swap / toColumn / toRow leave the selection on the new layout', () => {
    const { editor, caret } = open(read('stack-row.txt'));
    cmd.swapSlots(editor, caret('Second'));
    expect(cmd.stackInfoAt(editor.state)?.direction).toBe('row');
    cmd.toColumn(editor, cmd.stackInfoAt(editor.state)!);
    expect(cmd.stackInfoAt(editor.state)?.direction).toBe('column');
    cmd.toRow(editor, cmd.stackInfoAt(editor.state)!);
    expect(cmd.stackInfoAt(editor.state)?.direction).toBe('row');
    cmd.moveStack(editor, cmd.stackInfoAt(editor.state)!, 1);
    expect(cmd.stackInfoAt(editor.state)?.direction).toBe('row');
    cmd.moveStack(editor, cmd.stackInfoAt(editor.state)!, -1);
    expect(cmd.stackInfoAt(editor.state)?.direction).toBe('row');
    editor.destroy();
  });
});
