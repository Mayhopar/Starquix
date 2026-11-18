/**
 * Custom code (owner 2026-11-04): `/` → "Custom code" writes raw HTML/JSX
 * elements into the post. A raw element is a model passthrough (verbatim
 * bytes); the writing view draws it as an editable box. Edits commit only when
 * the source compiles — a half-typed tag must never reach the write gate (a
 * refused write rolls the whole draft back to the last accepted body).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { parsePostBody, serializePostDoc } from '@/postmodel/postModel';
import { postDocToTiptap, tiptapToPostDoc, postEditorExtensions, type PMNode } from '../schema';

const SRC = 'Intro\n\n<div class="box">\n  <p>hi</p>\n\n  <p>there</p>\n</div>\n\nOutro\n';

describe('custom code: PostDoc ↔ Tiptap', () => {
  it('editing the source writes exactly the new source; neighbours keep their bytes', () => {
    const original = parsePostBody(SRC);
    const json = postDocToTiptap(original);
    json.content![1] = { ...json.content![1], attrs: { ...json.content![1].attrs, source: '<section>\n  <b>x</b>\n</section>' } };
    expect(serializePostDoc(tiptapToPostDoc(json, original))).toBe('Intro\n\n<section>\n  <b>x</b>\n</section>\n\nOutro\n');
  });

  it('a block just inserted by `/` (no source yet) is not serialized', () => {
    const original = parsePostBody('Intro\n');
    const json = postDocToTiptap(original);
    json.content!.push({ type: 'passthrough', attrs: { source: '', nodeType: 'mdxJsxFlowElement' } });
    expect(serializePostDoc(tiptapToPostDoc(json, original))).toBe('Intro\n');
  });

  it('a new block with source lands after a blank line', () => {
    const original = parsePostBody('Intro\n');
    const json = postDocToTiptap(original);
    json.content!.push({ type: 'passthrough', attrs: { source: '<hr class="fancy" />', nodeType: 'mdxJsxFlowElement' } });
    expect(serializePostDoc(tiptapToPostDoc(json, original))).toBe('Intro\n\n<hr class="fancy" />\n');
  });
});

describe('custom code: the box in the writing view', () => {
  let editor: Editor | null = null;
  afterEach(() => { editor?.destroy(); editor = null; });

  const mount = (src: string, format: 'mdx' | 'md' = 'mdx') => {
    const el = document.createElement('div');
    document.body.append(el);
    editor = new Editor({ element: el, extensions: postEditorExtensions, content: postDocToTiptap(parsePostBody(src, format)) as never });
    (editor.storage as unknown as { passthrough: { format: string } }).passthrough.format = format;
    return el;
  };
  const sources = () => (editor!.getJSON().content as PMNode[]).filter(n => n.type === 'passthrough').map(n => n.attrs!.source);
  const type = (area: HTMLTextAreaElement, value: string) => { area.value = value; area.dispatchEvent(new Event('input', { bubbles: true })); };

  it('a raw element is an editable box holding its source; code fences/tables/imports are not', () => {
    const el = mount(`import X from './x.astro'\n\n${SRC}\n\`\`\`js\nlet a\n\`\`\`\n`);
    const areas = el.querySelectorAll<HTMLTextAreaElement>('.sq-custom-code textarea');
    expect(areas).toHaveLength(1);
    expect(areas[0].value).toBe('<div class="box">\n  <p>hi</p>\n\n  <p>there</p>\n</div>');
  });

  it('a valid edit commits to the block (blur = at once)', async () => {
    const el = mount(SRC);
    const area = el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!;
    type(area, '<section class="x">hello</section>');
    area.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 50));
    expect(sources()).toEqual(['<section class="x">hello</section>']);
  });

  it('an invalid edit is NOT committed and says why; fixing it commits', async () => {
    const el = mount(SRC);
    const area = el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!;
    type(area, '<div class="x"');
    area.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 50));
    expect(sources()).toEqual(['<div class="box">\n  <p>hi</p>\n\n  <p>there</p>\n</div>']);
    expect(el.querySelector('.sq-custom-code-error')!.textContent).not.toBe('');
    expect((el.querySelector('.sq-custom-code-error') as HTMLElement).hidden).toBe(false);

    type(area, '<div class="x"></div>');
    area.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 50));
    expect(sources()).toEqual(['<div class="x"></div>']);
    expect((el.querySelector('.sq-custom-code-error') as HTMLElement).hidden).toBe(true);
  });

  it('typing commits after a pause, not per keystroke', async () => {
    const el = mount(SRC);
    const area = el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!;
    type(area, '<p>one</p>');
    expect(sources()[0]).toContain('class="box"');
    await new Promise(r => setTimeout(r, 450));
    expect(sources()).toEqual(['<p>one</p>']);
  });

  const key = (area: HTMLTextAreaElement, k: string) => area.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('ArrowDown on the last line of the LAST block opens a paragraph after it — never selects the box (typing would replace it)', () => {
    const el = mount('Intro\n\n<div>\n  <p>x</p>\n</div>\n');
    const area = el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!;
    area.setSelectionRange(area.value.length, area.value.length);
    key(area, 'ArrowDown');
    const { selection, doc } = editor!.state;
    expect(selection.$from.parent.type.name).toBe('paragraph');
    expect(selection.$from.parent.content.size).toBe(0);
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).type.name).toBe('passthrough');
  });

  it('ArrowUp on the first line of the FIRST block stays in the box', () => {
    const el = mount('<div>\n  <p>x</p>\n</div>\n');
    const area = el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!;
    area.setSelectionRange(0, 0);
    const before = editor!.state.selection.from;
    key(area, 'ArrowUp');
    expect(editor!.state.selection.from).toBe(before);
    expect(editor!.state.doc.childCount).toBe(1);
  });

  it('Escape selects the block (Delete then removes it)', () => {
    const el = mount(SRC);
    key(el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!, 'Escape');
    expect((editor!.state.selection as unknown as { node?: { type: { name: string } } }).node?.type.name).toBe('passthrough');
  });

  it('undo (an outside change to the block) refreshes the box', () => {
    const el = mount(SRC);
    const pos = editor!.state.doc.child(0).nodeSize;
    editor!.view.dispatch(editor!.state.tr.setNodeMarkup(pos, undefined, { source: '<i>undone</i>', nodeType: 'mdxJsxFlowElement', display: null }));
    expect(el.querySelector<HTMLTextAreaElement>('.sq-custom-code textarea')!.value).toBe('<i>undone</i>');
  });
});
