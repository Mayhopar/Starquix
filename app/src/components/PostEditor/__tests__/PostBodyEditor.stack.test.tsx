import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); captured.editor = editor; return editor;
  } };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));
beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 80, 20);
  Range.prototype.getClientRects = () => [new DOMRect(10, 20, 80, 20)] as unknown as DOMRectList;
});
import { PostBodyEditor } from '../PostBodyEditor';
import { PostWriteQueue } from '@/postmodel/writeQueue';

const SRC = readFileSync(join(__dirname, '../../../postmodel/__tests__/corpus/stack-row.txt'), 'utf8');

it('caret in a layout shows its toolbar; Swap saves swapped divs; ⌘Z restores the original bytes; Esc selects the layout', async () => {
  const writes: string[] = [];
  const queue = new PostWriteQueue({ collection: 'works', slug: 'a', writePost: async (_c, _s, _fm, value) => { writes.push(value); } });
  const view = render(<PostBodyEditor body={SRC} format="mdx" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" filePath="src/content/works/a.mdx" />);
  const ed = captured.editor!;
  let at = -1;
  ed.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text!.includes('Second')) at = p + 1; return at < 0; });
  act(() => { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at))); });
  expect(screen.getByRole('toolbar', { name: 'Layout' })).toBeInTheDocument();
  act(() => { fireEvent.click(screen.getByLabelText('Swap sides')); });
  await act(async () => { await queue.flushNow(); });
  const swapped = writes.at(-1)!;
  expect(swapped.indexOf('<Media')).toBeLessThan(swapped.indexOf('Second paragraph.'));
  act(() => { ed.commands.undo(); });

  // Esc inside the layout node-selects it
  act(() => { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at))); });
  fireEvent.keyDown(ed.view.dom, { key: 'Escape' });
  expect(ed.state.selection.constructor.name).toBe('NodeSelection');
  // unmount flushes the debounced undo write
  view.unmount(); await queue.flushNow();
  expect(writes.at(-1)).toBe(SRC);
});

it('formatting toolbar Color groups the selected blocks into one colored section (import + Stack file ensured)', async () => {
  const ensure = await import('../ensureComponent');
  const spy = vi.spyOn(ensure, 'ensureSqComponent').mockResolvedValue('src/components/sq/Stack.astro');
  const writes: string[] = [];
  const queue = new PostWriteQueue({ collection: 'works', slug: 'a', writePost: async (_c, _s, _fm, value) => { writes.push(value); } });
  const view = render(<PostBodyEditor body={'A.\n\nB.\n\nC.\n'} format="mdx" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" filePath="src/content/works/a.mdx" />);
  const ed = captured.editor!;
  act(() => { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, 7))); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Put on a colored section')); });
  await act(async () => { await queue.flushNow(); });
  expect(spy.mock.calls[0]?.[1]).toBe('Stack');
  expect(writes.at(-1)).toBe("import Stack from '../../components/sq/Stack.astro';\n\n<Stack class=\"bg-[#f4f1ea] text-[#111111]\" text=\"auto\">\n\nA.\n\nB.\n\n</Stack>\n\nC.\n");
  view.unmount(); await queue.flushNow();
});

it('hovering the image inside a layout keeps the layout toolbar (audit 2026-09-30: hover swapped it out and closed its popovers)', async () => {
  const queue = new PostWriteQueue({ collection: 'works', slug: 'a', writePost: async () => {} });
  const view = render(<PostBodyEditor body={SRC} format="mdx" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" filePath="src/content/works/a.mdx" />);
  const ed = captured.editor!;
  let at = -1; let media = -1;
  ed.state.doc.descendants((n, p) => {
    if (at < 0 && n.isText && n.text!.includes('Second')) at = p + 1;
    if (media < 0 && n.type.name === 'astroComponent') media = p;
    return true;
  });
  act(() => { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at))); });
  expect(screen.getByRole('toolbar', { name: 'Layout' })).toBeInTheDocument();
  const storage = (ed.storage as unknown as { astroComponent: { onHover?: (h: { pos: number } | null) => void } }).astroComponent;
  await act(async () => storage.onHover?.({ pos: media }));
  expect(screen.getByRole('toolbar', { name: 'Layout' })).toBeInTheDocument();
  view.unmount(); await queue.flushNow();
});
