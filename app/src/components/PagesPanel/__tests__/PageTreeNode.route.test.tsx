/**
 * Blind review 2026-08-04 item 5 — the Pages panel shows the ROUTE, in every
 * runtime. Local listed `/`, `/about`; WC/server listed `index`, `Page 2`. See
 * store/pageRoute.ts for why routes won.
 *
 * The rename affordance is unchanged and must stay that way: double-click still
 * edits the page NAME (the doc field `RENAME_PAGE` writes), because the route is
 * derived from it. Swapping the two would make a blur write the displayed route
 * back over the name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PageData } from '@/store/types';

const h = vi.hoisted(() => ({
  pages: [] as PageData[],
  renamePage: vi.fn(),
}));

vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({
    activePageId: 'p1',
    expandedIds: new Set<string>(),
    pages: h.pages,
    setActivePage: vi.fn(),
    toggleExpanded: vi.fn(),
    expandPages: vi.fn(),
    renamePage: h.renamePage,
    deletePage: vi.fn(),
    setHomePage: vi.fn(),
  }),
}));
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ clearPreviewPost: vi.fn(), previewPost: null, openPost: vi.fn() }),
}));
vi.mock('@/hooks/useContentCollections', () => ({
  useContentCollections: () => ({ collections: [] }),
}));
vi.mock('@/store/hooks', () => ({
  useYjsValue: () => [],
  useEditorDoc: () => ({}),
}));
vi.mock('@/store/selectors', () => ({
  selectIsPostPage: () => false,
  selectPageBlogCollectionIds: () => [],
}));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
vi.mock('@/hooks/useGoToPost', () => ({ useGoToPost: () => vi.fn() }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({ activeKeys: [], recentlyTouchedKeys: [] }),
}));
vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});
vi.mock('@/components/ui', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    useTreeNodeDnd: () => ({
      setNodeRef: () => {}, attributes: {}, listeners: {},
      isDragging: false, dropZone: null,
    }),
  };
});

import { PageTreeNode } from '../PageTreeNode';

const page = (p: Partial<PageData> & { id: string; name: string }): PageData => ({
  rootElementIds: [], children: [], ...p,
});

function renderNode(p: PageData) {
  h.pages = [p];
  return render(
    <PageTreeNode page={p} depth={0} index={0} siblingIds={[p.id]} parentId={null} />,
  );
}

const shown = () => (screen.getByTestId('page-item').querySelector('input') as HTMLInputElement).value;

beforeEach(() => { h.renamePage.mockClear(); });

describe('Pages panel — the row shows the ROUTE', () => {
  it('WC / server: a named page shows its derived route, not `Page 2`', () => {
    renderNode(page({ id: 'p2', name: 'Page 2' }));
    expect(shown()).toBe('/page-2');
  });

  it('WC / server: the home page shows `/`, not `index`', () => {
    renderNode(page({ id: 'p1', name: 'index', isHome: true }));
    expect(shown()).toBe('/');
  });

  it('local: a files-truth page shows its real route unchanged', () => {
    renderNode(page({ id: 'about', name: '/about' }));
    expect(shown()).toBe('/about');
  });

  it('local: the index route is `/`, never `/untitled`', () => {
    renderNode(page({ id: 'index', name: '/' }));
    expect(shown()).toBe('/');
  });
});

describe('Pages panel — renaming still edits the NAME', () => {
  it('double-click swaps the row to the page name, so a blur cannot overwrite it', () => {
    renderNode(page({ id: 'p2', name: 'Page 2' }));
    fireEvent.doubleClick(screen.getByTestId('page-item'));
    expect(shown()).toBe('Page 2');
  });

  it('an unchanged double-click + blur renames nothing', () => {
    renderNode(page({ id: 'p2', name: 'Page 2' }));
    const input = screen.getByTestId('page-item').querySelector('input')!;
    fireEvent.doubleClick(screen.getByTestId('page-item'));
    fireEvent.blur(input);
    expect(h.renamePage).not.toHaveBeenCalled();
  });

  it('a real edit writes the new NAME, and the row goes back to showing the route', () => {
    renderNode(page({ id: 'p2', name: 'Page 2' }));
    const input = screen.getByTestId('page-item').querySelector('input')!;
    fireEvent.doubleClick(screen.getByTestId('page-item'));
    fireEvent.change(input, { target: { value: 'Contact' } });
    fireEvent.blur(input);
    expect(h.renamePage).toHaveBeenCalledWith('p2', 'Contact');
  });
});

// Task239 live acceptance exposed a no-op Enter being sent as a source rename.
describe('Pages panel rename gesture ownership', () => {
  it('Enter on the read-only home route never requests a source rename', () => {
    renderNode(page({ id: 'home', name: '/', isHome: true }));
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.renamePage).not.toHaveBeenCalled();
  });

  it('an unchanged explicit rename Enter never requests a source rename', () => {
    renderNode(page({ id: 'home', name: '/', isHome: true }));
    fireEvent.doubleClick(screen.getByTestId('page-item'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(h.renamePage).not.toHaveBeenCalled();
  });

  it('Enter commits once despite the synchronous input blur', () => {
    renderNode(page({ id: 'p2', name: 'Page 2' }));
    fireEvent.doubleClick(screen.getByTestId('page-item'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Contact' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.renamePage).toHaveBeenCalledExactlyOnceWith('p2', 'Contact');
  });

  it('Escape cancels the edit without committing it through blur', () => {
    renderNode(page({ id: 'p2', name: 'Page 2' }));
    fireEvent.doubleClick(screen.getByTestId('page-item'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Contact' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(h.renamePage).not.toHaveBeenCalled();
    expect(shown()).toBe('/page-2');
  });
});
