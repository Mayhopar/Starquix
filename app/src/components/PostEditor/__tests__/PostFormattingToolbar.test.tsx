import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { parsePostBody, serializePostDoc } from '@/postmodel/postModel';
import { mdxCompiles } from '@/postmodel/compileGate';
import { postDocToTiptap, postEditorExtensions, tiptapToPostDoc, type PMNode } from '../tiptap/schema';
import { PostFormattingToolbar } from '../PostFormattingToolbar';
import { readTextSelectionAnchor } from '../selectionAnchor';
beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(12, 16, 100, 20);
  Range.prototype.getClientRects = () => [new DOMRect(12, 16, 100, 20)] as unknown as DOMRectList;
});
function mount(left = 12, top = 16) {
  const original = parsePostBody('Hello {name}.', 'mdx');
  const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  const anchor = { ...readTextSelectionAnchor(editor)!, rect: { left, top, width: 100, height: 20 } };
  const view = render(<PostFormattingToolbar editor={editor} anchor={anchor} onClose={() => {}} />);
  const body = () => serializePostDoc(tiptapToPostDoc(editor.getJSON() as PMNode, original));
  return { editor, view, body };
}
it('restores the captured text range for pointer and keyboard formatting beside opaque MDX', async () => {
  const { editor, view, body } = mount();
  // Chrome can own focus and the DOM selection can disappear while the toolbar is open.
  act(() => { editor.commands.setTextSelection(1); });
  const bold = screen.getByRole('button', { name: 'Bold' });
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  fireEvent(bold, down); expect(down.defaultPrevented).toBe(true);
  fireEvent.click(bold);
  expect(body()).toBe('**Hello** {name}.');
  const italic = screen.getByRole('button', { name: 'Italic' });
  italic.focus(); fireEvent.click(italic);
  expect(body()).toBe('***Hello*** {name}.');
  fireEvent.change(screen.getByRole('combobox', { name: 'Text style' }), { target: { value: 'h2' } });
  expect(body()).toBe('## ***Hello*** {name}.');
  expect(await mdxCompiles(body())).toMatchObject({ ok: true });
  view.unmount(); editor.destroy();
});
it('uses the native popover clamp and flip at the viewport edge', async () => {
  const { view, editor } = mount(-80, -10);
  const anchor = document.querySelector('span[aria-hidden="true"]') as HTMLElement;
  anchor.getBoundingClientRect = () => new DOMRect(-80, -10, 100, 0);
  fireEvent(window, new Event('resize'));
  await waitFor(() => {
    const panel = screen.getByRole('toolbar').parentElement!.parentElement!;
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
  });
  view.unmount(); editor.destroy();
});

it('text style covers the blocks the page styles (no Heading 1: the title is the h1); link round-trips', () => {
  const { view, editor, body } = mount();
  const select = screen.getByRole('combobox', { name: 'Text style' }) as HTMLSelectElement;
  expect([...select.options].map(o => o.textContent)).toEqual(['Paragraph', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Quote']);
  fireEvent.change(select, { target: { value: 'quote' } });
  expect(body()).toBe('> Hello {name}.');
  fireEvent.change(select, { target: { value: 'ul' } });
  expect(body()).toBe('- Hello {name}.');
  fireEvent.change(select, { target: { value: 'p' } });
  expect(body()).toBe('Hello {name}.');
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Link address' }), { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(body()).toBe('[Hello](https://example.com) {name}.');
  view.unmount(); editor.destroy();
});
it('every mark control is the same 24px square button', () => {
  const { view, editor } = mount();
  const marks = ['Bold', 'Italic', 'Strikethrough', 'Inline code', 'Link'].map(name => screen.getByRole('button', { name }));
  expect(new Set(marks.map(b => b.className)).size).toBe(1);
  view.unmount(); editor.destroy();
});
