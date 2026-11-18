/**
 * LinkBlock: the selected element's link.
 * - no link: a "Link" header with +, which makes one at once
 * - a link: − removes it, an editable field, an arrow that follows it, the
 *   "Open in a new tab" toggle; every edit goes to the file (localLinkEdit)
 * - a text session goes through the bridge, which holds the live selection
 * - a link this surface can't write: read-only, still followable
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useLayoutEffect, useRef } from 'react';

const mockPushUndo = vi.fn();
const mockSetActivePage = vi.fn();
const mockAdd = vi.fn();
const mockRemove = vi.fn();
const mockSetAttribute = vi.fn();
const mockCrossFile = vi.fn();

type TextSelectionShape = {
  hasTextSelection: boolean;
  selectedText: string;
  isInsideLink: boolean;
  existingHref?: string;
  existingTarget?: '_blank' | '_self';
  linkKey?: string;
};
const NO_TEXT: TextSelectionShape = { hasTextSelection: false, selectedText: '', isInsideLink: false };
let textSelection = NO_TEXT;
let rows: Record<string, object> = {};
let mockPages: Array<{ id: string; name: string }> = [];

vi.mock('@/context/SelectionContext', () => ({
  useTextSelection: () => textSelection,
  useScannedElements: () => ({ scannedByKey: new Map(Object.entries(rows)) }),
}));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ pushStructuralUndo: mockPushUndo }) }));
vi.mock('@/context/PagesContext', () => ({ usePages: () => ({ pages: mockPages, setActivePage: mockSetActivePage }) }));
vi.mock('@/components/Editor/localLinkEdit', () => ({
  addElementLink: (...args: unknown[]) => mockAdd(...args),
  removeElementLink: (...args: unknown[]) => mockRemove(...args),
  setElementLinkAttribute: (...args: unknown[]) => mockSetAttribute(...args),
}));
vi.mock('@/utils/localWriteScope', () => ({ isLocalCrossFileWrite: (file: string) => mockCrossFile(file) }));
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return { PlusIcon: Stub, MinusIcon: Stub, ArrowUpRightIcon: Stub, ChevronDownIcon: Stub };
});

import { LinkBlock } from './LinkBlock';

const FILE = 'src/pages/index.astro';
const H2 = { key: `${FILE}:5:3`, tagName: 'h2', sourceLocation: { file: FILE, line: 5, column: 3 }, parentDisplay: 'block' };
const A_LOC = { file: FILE, line: 9, column: 3 };
const A = { key: `${FILE}:9:3`, tagName: 'a', sourceLocation: A_LOC, linkKey: `${FILE}:9:3`, linkHref: '/about' };
const addRow = (row: { key: string }) => { rows[row.key] = row; };

function renderBlock(overrides: Partial<React.ComponentProps<typeof LinkBlock>> = {}) {
  const props: React.ComponentProps<typeof LinkBlock> = {
    elementKey: null, isEditingText: false, onLinkChange: vi.fn(), onUnlink: vi.fn(), onInteractingChange: () => {}, ...overrides,
  };
  return { ...render(<LinkBlock {...props} />), props };
}

const field = () => screen.getByPlaceholderText('URL or page') as HTMLInputElement;
const toggle = () => screen.getByRole('switch', { name: 'Open in a new tab' });
const type = (value: string) => {
  act(() => { fireEvent.focus(field()); });
  fireEvent.change(field(), { target: { value } });
};

// e2e L1 (2026-11-09, flaky on the packaged 0.3.1 build): after the selection
// moved to a linked element, the field's FIRST commit still held the previous
// element's value and only a later effect put the new href in — typing in that
// frame ended up as "//nested/about/". The field must belong to the element on
// the very commit that shows it.
describe('LinkBlock — the field belongs to the selected element from its first commit', () => {
  beforeEach(() => { vi.clearAllMocks(); rows = {}; textSelection = NO_TEXT; mockPages = []; mockCrossFile.mockReturnValue(false); });
  it('switching from an element with another link shows the new href on the switch commit itself', () => {
    const B = { key: `${FILE}:20:3`, tagName: 'a', sourceLocation: { file: FILE, line: 20, column: 3 }, linkKey: `${FILE}:20:3`, linkHref: '/' };
    addRow(A); addRow(B);
    const seen: Array<string | null> = [];
    function Probe({ elementKey }: { elementKey: string }) {
      const ref = useRef<HTMLDivElement>(null);
      // Runs once per Probe commit — i.e. on the commit that switches the element.
      useLayoutEffect(() => { seen.push(ref.current?.querySelector('input')?.value ?? null); });
      return <div ref={ref}><LinkBlock elementKey={elementKey} isEditingText={false} onLinkChange={vi.fn()} onUnlink={vi.fn()} onInteractingChange={() => {}} /></div>;
    }
    const view = render(<Probe elementKey={A.key} />);
    view.rerender(<Probe elementKey={B.key} />);
    expect(seen).toEqual(['/about', '/']);
  });
});

describe('LinkBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    textSelection = NO_TEXT;
    rows = {};
    mockPages = [];
    mockCrossFile.mockReturnValue(false);
    mockAdd.mockResolvedValue(true);
    mockRemove.mockResolvedValue(true);
    mockSetAttribute.mockResolvedValue(true);
  });

  describe('no link', () => {
    it('is a header with + and nothing else', () => {
      addRow(H2);
      renderBlock({ elementKey: H2.key });
      expect(screen.getByText('Link')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Add link' })).toBeTruthy();
      expect(screen.queryByPlaceholderText('URL or page')).toBeNull();
    });

    it('+ makes the selected element a link at once', () => {
      addRow(H2);
      renderBlock({ elementKey: H2.key });
      fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(mockAdd).toHaveBeenCalledWith(H2, mockPushUndo);
    });

    it('the header itself adds it too, once', () => {
      addRow(H2);
      renderBlock({ elementKey: H2.key });
      fireEvent.click(screen.getByText('Link'));
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });

    it('in a text session + links the selected text through the bridge, with the default target', () => {
      addRow(H2);
      textSelection = { ...NO_TEXT, hasTextSelection: true, selectedText: 'wrap me' };
      const onLinkChange = vi.fn();
      renderBlock({ elementKey: H2.key, isEditingText: true, onLinkChange });
      fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
      expect(onLinkChange).toHaveBeenCalledWith('/');
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  describe('a link', () => {
    it('shows −, the field holding the link, the arrow and the toggle, and never says "target"', () => {
      addRow(A);
      const { container } = renderBlock({ elementKey: A.key });
      expect(screen.getByRole('button', { name: 'Remove link' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Add link' })).toBeNull();
      expect(field().value).toBe('/about');
      expect(screen.getByTestId('link-follow')).toBeTruthy();
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(container.textContent).toContain('Open in a new tab');
      expect(container.textContent?.toLowerCase()).not.toContain('target');
    });

    it('an element inside a link shows that link, and edits write the <a>', () => {
      addRow(A);
      const child = { ...H2, key: `${FILE}:10:5`, linkKey: A.key, linkHref: '/about' };
      addRow(child);
      renderBlock({ elementKey: child.key });
      expect(field().value).toBe('/about');
      fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
      expect(mockRemove).toHaveBeenCalledWith(A_LOC, child, mockPushUndo);
    });

    it('− removes it at once, asking nothing', () => {
      addRow(A);
      const confirm = vi.spyOn(window, 'confirm');
      renderBlock({ elementKey: A.key });
      fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
      expect(mockRemove).toHaveBeenCalledWith(A_LOC, A, mockPushUndo);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('in a text session − goes through the bridge', () => {
      addRow(A);
      textSelection = { ...NO_TEXT, isInsideLink: true, existingHref: '/about', linkKey: A.key };
      const onUnlink = vi.fn();
      renderBlock({ elementKey: H2.key, isEditingText: true, onUnlink });
      fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
      expect(onUnlink).toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('Enter writes the new href to the file', () => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('/pricing');
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(mockSetAttribute).toHaveBeenCalledTimes(1);
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/pricing', A, mockPushUndo);
    });

    it('leaving the field writes it too, once', () => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('/pricing');
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.blur(field());
      expect(mockSetAttribute).toHaveBeenCalledTimes(1);
    });

    it('leaving the field closes the page list: a click on the canvas never reaches the Popover', async () => {
      mockPages = [{ id: 'p-1', name: 'About' }];
      addRow(A);
      renderBlock({ elementKey: A.key });
      act(() => { fireEvent.focus(field()); });
      expect(screen.getByRole('menuitem', { name: /About/ })).toBeTruthy();
      fireEvent.blur(field());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
      expect(screen.queryByRole('menuitem', { name: /About/ })).toBeNull();
    });

    it('the page list opens whole again after a typed link', () => {
      mockPages = [{ id: 'p-1', name: 'About' }, { id: 'p-2', name: 'Blog' }];
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('/blog');
      fireEvent.keyDown(field(), { key: 'Enter' });
      act(() => { fireEvent.focus(field()); });
      expect(screen.getByRole('menuitem', { name: /About/ })).toBeTruthy();
    });

    it('Escape puts the link back, nothing written', () => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('/typo');
      fireEvent.keyDown(field(), { key: 'Escape' });
      fireEvent.blur(field());
      expect(field().value).toBe('/about');
      expect(mockSetAttribute).not.toHaveBeenCalled();
    });

    it('an emptied field keeps the link: − is what removes it', () => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('');
      fireEvent.blur(field());
      expect(field().value).toBe('/about');
      expect(mockSetAttribute).not.toHaveBeenCalled();
    });

    it('refuses a script link', () => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('javascript:alert(1)');
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(mockSetAttribute).not.toHaveBeenCalled();
      expect(field().value).toBe('/about');
    });

    it('a refused write puts the link back', async () => {
      addRow(A);
      mockSetAttribute.mockResolvedValue(false);
      renderBlock({ elementKey: A.key });
      type('/pricing');
      await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }); });
      expect(field().value).toBe('/about');
    });

    it('the toggle on writes _blank; off leaves no target at all', () => {
      addRow(A);
      const { unmount } = renderBlock({ elementKey: A.key });
      fireEvent.click(toggle());
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'target', '_blank', A, mockPushUndo);
      unmount();
      mockSetAttribute.mockClear();
      const blank = { ...A, linkTarget: '_blank' };
      addRow(blank);
      renderBlock({ elementKey: A.key });
      expect(toggle().getAttribute('aria-checked')).toBe('true');
      fireEvent.click(toggle());
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'target', '', blank, mockPushUndo);
    });

    it('in a text session an edit reaches the file and the live DOM, which the session writes back when it ends', async () => {
      addRow(A);
      textSelection = { ...NO_TEXT, isInsideLink: true, existingHref: '/about', linkKey: A.key };
      const post = vi.spyOn(window, 'postMessage');
      renderBlock({ elementKey: H2.key, isEditingText: true });
      type('/pricing');
      await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }); });
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/pricing', undefined, mockPushUndo);
      expect(post).toHaveBeenCalledWith({ type: 'SYNC_LINK_ATTR_TO_IFRAME', payload: { key: A.key, attribute: 'href', value: '/pricing' } }, '*');
    });

    it('a link a session just made, not yet in the file, changes in the DOM only', async () => {
      textSelection = { ...NO_TEXT, isInsideLink: true, existingHref: '/', linkKey: 'dynamic:a:0' };
      const post = vi.spyOn(window, 'postMessage');
      renderBlock({ elementKey: H2.key, isEditingText: true });
      type('/pricing');
      await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }); });
      expect(mockSetAttribute).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith({ type: 'SYNC_LINK_ATTR_TO_IFRAME', payload: { key: 'dynamic:a:0', attribute: 'href', value: '/pricing' } }, '*');
    });

    it('the aria label writes on blur, only when it changed', () => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      const aria = screen.getByLabelText('Aria label');
      fireEvent.blur(aria);
      expect(mockSetAttribute).not.toHaveBeenCalled();
      fireEvent.change(aria, { target: { value: 'About us' } });
      fireEvent.blur(aria);
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'aria-label', 'About us', A, mockPushUndo);
    });
  });

  describe('picking a page', () => {
    const pick = (name: RegExp) => {
      addRow(A);
      renderBlock({ elementKey: A.key });
      type('');
      fireEvent.click(screen.getByRole('menuitem', { name }));
    };

    it('writes its route', () => {
      mockPages = [{ id: 'p-1', name: 'About Us' }];
      pick(/About Us/);
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/about-us', A, mockPushUndo);
    });

    // 2026-06-11: editor and export slugs drifted; both derive from utils/slugify.
    it('special characters mint the export route (Q&A → /q-a)', () => {
      mockPages = [{ id: 'p-1', name: 'Q&A' }];
      pick(/Q&A/);
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/q-a', A, mockPushUndo);
    });

    it('Home is / — the exported index route, not /home', () => {
      mockPages = [{ id: 'p-1', name: 'Home' }];
      pick(/Home/);
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/', A, mockPushUndo);
    });

    it('a files-truth page is its route (/works/inito, not /works-inito)', () => {
      mockPages = [{ id: 'page-works-inito', name: '/works/inito' }];
      pick(/inito/);
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/works/inito', A, mockPushUndo);
    });
  });

  describe('the arrow', () => {
    const arrow = () => screen.getByTestId('link-follow') as HTMLButtonElement;
    const clickArrow = () => act(async () => { fireEvent.click(arrow()); });

    it('opens a page of the site in the editor', async () => {
      mockPages = [{ id: 'p-about', name: 'About' }];
      addRow(A);
      renderBlock({ elementKey: A.key });
      await clickArrow();
      expect(mockSetActivePage).toHaveBeenCalledWith('p-about');
    });

    it('legacy stored hrefs still find their page (/qa ↔ Q&A)', async () => {
      mockPages = [{ id: 'p-qa', name: 'Q&A' }];
      addRow({ ...A, linkHref: '/qa' });
      renderBlock({ elementKey: A.key });
      await clickArrow();
      expect(mockSetActivePage).toHaveBeenCalledWith('p-qa');
    });

    it('opens a web address in the browser', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      addRow({ ...A, linkHref: 'https://example.com' });
      renderBlock({ elementKey: A.key });
      await clickArrow();
      expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
      expect(mockSetActivePage).not.toHaveBeenCalled();
    });

    // Caught live: the page switch moved the surface, and the law refused the write.
    it('a typed link is written first, then the arrow leaves the page', async () => {
      mockPages = [{ id: 'p-blog', name: 'Blog' }];
      addRow(A);
      let finishWrite: (written: boolean) => void = () => {};
      mockSetAttribute.mockReturnValue(new Promise((resolve) => { finishWrite = resolve; }));
      renderBlock({ elementKey: A.key });
      type('/blog');
      await clickArrow();
      expect(mockSetAttribute).toHaveBeenCalledWith(A_LOC, 'href', '/blog', A, mockPushUndo);
      expect(mockSetActivePage).not.toHaveBeenCalled();
      await act(async () => { finishWrite(true); });
      expect(mockSetActivePage).toHaveBeenCalledWith('p-blog');
    });

    it('a refused write stays on the page', async () => {
      mockPages = [{ id: 'p-blog', name: 'Blog' }];
      addRow(A);
      mockSetAttribute.mockResolvedValue(false);
      renderBlock({ elementKey: A.key });
      type('/blog');
      await clickArrow();
      expect(mockSetActivePage).not.toHaveBeenCalled();
    });

    it('has nowhere to go for a link that leads nowhere', () => {
      addRow({ ...A, linkHref: '/no-such-page' });
      renderBlock({ elementKey: A.key });
      expect(arrow().disabled).toBe(true);
    });
  });

  describe('a link this surface cannot write', () => {
    const shared = { ...A, key: 'src/components/Header.astro:27:7~sabc', linkKey: 'src/components/Header.astro:27:7~sabc',
      sourceLocation: { file: 'src/components/Header.astro', line: 27, column: 7 } };

    it("a shared component's link reads, follows, and offers no edit", async () => {
      mockCrossFile.mockReturnValue(true);
      mockPages = [{ id: 'p-about', name: 'About' }];
      addRow(shared);
      renderBlock({ elementKey: shared.key });
      expect(field().readOnly).toBe(true);
      expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull();
      expect(screen.queryByRole('switch')).toBeNull();
      await act(async () => { fireEvent.click(screen.getByTestId('link-follow')); });
      expect(mockSetActivePage).toHaveBeenCalledWith('p-about');
    });

    it("a bound card's wrapper (no key) reads and follows too", async () => {
      mockPages = [{ id: 'p-post', name: '/blog/first' }];
      const inCard = { ...H2, linkHref: '/blog/first' };
      addRow(inCard);
      renderBlock({ elementKey: H2.key });
      expect(field().value).toBe('/blog/first');
      expect(field().readOnly).toBe(true);
      expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull();
      await act(async () => { fireEvent.click(screen.getByTestId('link-follow')); });
      expect(mockSetActivePage).toHaveBeenCalledWith('p-post');
    });

    it("an element of a shared component still offers +: the write's refusal says how", () => {
      mockCrossFile.mockReturnValue(true);
      const inComponent = { ...H2, key: 'src/components/Hero.astro:5:3~sabc', sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 3 } };
      addRow(inComponent);
      renderBlock({ elementKey: inComponent.key });
      fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
      expect(mockAdd).toHaveBeenCalledWith(inComponent, mockPushUndo);
    });
  });
});
