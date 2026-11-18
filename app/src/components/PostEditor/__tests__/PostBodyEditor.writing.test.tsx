import { TEXT_ITEMS } from '../SlashMenu';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
const captured = vi.hoisted(() => ({ editor: null as Editor | null, ensure: vi.fn() }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); captured.editor = editor; return editor;
  } };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [{ name: 'Credit', path: 'src/components/sq/Credit.astro' }] }) }));
vi.mock('../ensureComponent', () => ({ ensureSqComponent: (...args: unknown[]) => captured.ensure(...args), componentImportPathFor: () => '../../components/sq/Credit.astro' }));
beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 80, 20);
  Range.prototype.getClientRects = () => [new DOMRect(10, 20, 80, 20)] as unknown as DOMRectList;
});
import { PostBodyEditor } from '../PostBodyEditor';
import { PostWriteQueue, hasPendingPostWrites } from '@/postmodel/writeQueue';
function mount(body = '') {
  const writes: string[] = [];
  const queue = new PostWriteQueue({ collection: 'works', slug: 'a', writePost: async (_c, _s, _fm, value) => { writes.push(value); } });
  const view = render(<PostBodyEditor body={body} format="mdx" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" filePath="src/content/works/a.mdx" />);
  captured.editor!.view.coordsAtPos = () => ({ left: 10, right: 10, top: 20, bottom: 40 });
  return { ...view, writes, queue };
}
it('labels the body, shows an empty hint without adding model content or saving', () => {
  const { writes, unmount } = mount();
  const body = screen.getByRole('textbox', { name: 'Post body' });
  expect(body.querySelector('[data-placeholder]'), JSON.stringify(captured.editor!.getJSON())).toBeTruthy();
  expect(captured.editor!.state.doc.textContent).toBe('');
  fireEvent.focus(body); expect(writes).toEqual([]); unmount();
});
it('keeps typing and successful saves free from routine save announcements', async () => {
  const { queue, unmount } = mount('Old.');
  act(() => { captured.editor!.commands.setContent('<p>Fresh.</p>'); });
  expect(screen.queryByText(/Saving|Unsaved|Saved/)).toBeNull();
  unmount(); await queue.flushNow();
});
it('navigates slash items from the body and preserves the slash when insertion is refused', async () => {
  captured.ensure.mockResolvedValue(null);
  const { unmount, queue } = mount('/');
  act(() => { captured.editor!.commands.setTextSelection(2); });
  // the writing blocks, then the three layout entries, then Media, then Credit
  for (let i = 0; i < TEXT_ITEMS.length + 4; i++) fireEvent.keyDown(captured.editor!.view.dom, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: /Credit/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(captured.editor!.view.dom, { key: 'Enter' });
  await vi.waitFor(() => expect(captured.ensure).toHaveBeenCalledWith(null, 'Credit'));
  expect(captured.editor!.state.doc.textContent).toBe('/');
  unmount(); await queue.flushNow();
});
it('/ → Heading turns the slash paragraph into a heading in place (writing blocks work in any format)', async () => {
  const { unmount, queue } = mount('/');
  act(() => { captured.editor!.commands.setTextSelection(2); });
  fireEvent.click(screen.getByRole('option', { name: /^Heading/ }));
  expect(captured.editor!.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  expect(captured.editor!.state.doc.textContent).toBe('');
  unmount(); await queue.flushNow();
});
it('/ → Custom code turns the slash paragraph into an empty, focused code box (nothing is written until it has source)', async () => {
  const { unmount, queue } = mount('/');
  act(() => { captured.editor!.commands.setTextSelection(2); });
  fireEvent.click(screen.getByRole('option', { name: /^Custom code/ }));
  expect(captured.editor!.getJSON().content?.[0]).toMatchObject({ type: 'passthrough', attrs: { source: '', nodeType: 'mdxJsxFlowElement' } });
  await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Custom code' })).toHaveFocus());
  unmount(); await queue.flushNow();
});
it('Escape dismisses slash options without deleting the paragraph', () => {
  const { unmount } = mount('/');
  act(() => { captured.editor!.commands.setTextSelection(2); });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(captured.editor!.view.dom, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(captured.editor!.state.doc.textContent).toBe('/'); unmount();
});

it('shows finite parse failure copy without exposing the source diagnostic', () => {
  render(<PostBodyEditor body="<Broken prop={" format="mdx" queue={new PostWriteQueue({ collection: 'works', slug: 'bad' })} frontmatterRef={{ current: {} }} collection="works" slug="bad" />);
  expect(screen.getByText("This post body can't be edited")).toBeInTheDocument();
  expect(screen.queryByText(/Unexpected|Could not parse|micromark|line.*column/i)).toBeNull();
  expect(screen.getByText(/Open the file in your editor/)).toBeInTheDocument();
});

it('retains failed body ownership behind one finite notice and clears it only after retry succeeds', async () => {
  let fail = true;
  const queue = new PostWriteQueue({ collection: 'works', slug: 'failure', projectId: 'browser_writing_failure', writePost: async () => {
    if (fail) throw new Error("Unexpected '<' at /private/site/post.mdx");
  } });
  const { unmount } = render(<PostBodyEditor body="Old." format="mdx" queue={queue} projectId={queue.projectId} frontmatterRef={{ current: {} }} collection="works" slug="failure" />);
  act(() => { captured.editor!.commands.setContent('<p>Kept draft.</p>'); });
  fireEvent(window, new Event('pagehide'));
  await vi.waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
  expect(screen.getByRole('status')).not.toHaveTextContent(/Unexpected|private|post.mdx/);
  expect(hasPendingPostWrites('browser_writing_failure')).toBe(true);
  expect(captured.editor!.state.doc.textContent).toBe('Kept draft.');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(hasPendingPostWrites('browser_writing_failure')).toBe(false);
  unmount();
});
it('keeps the caret clear of the floating bottom toolbar while typing (the new line hid behind it)', async () => {
  const { unmount, queue } = mount('Old.');
  const margin = captured.editor!.view.someProp('scrollMargin') as { bottom: number } | number | undefined;
  const threshold = captured.editor!.view.someProp('scrollThreshold') as { bottom: number } | number | undefined;
  const bottom = (v: typeof margin) => (typeof v === 'number' ? v : v?.bottom ?? 0);
  expect(bottom(margin)).toBeGreaterThanOrEqual(100);
  expect(bottom(threshold)).toBeGreaterThanOrEqual(100);
  unmount(); await queue.flushNow();
});
