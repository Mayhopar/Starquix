/**
 * Findings #35 #36 #39: the page row's right-click menu is the kit Menu (Escape closes it, it clamps to the window) and
 * offers no "Set as home" (a project's home is its index.astro, so that item could only fail); the row works from the
 * keyboard — Tab lands on the row, never on its read-only name, and Enter opens the page.
 * Real dnd wiring (SortableTreeProvider), so the row carries dnd-kit's role="button" + tabIndex.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { PageData } from '@/store/types';

const h = vi.hoisted(() => ({ pages: [] as PageData[], setActivePage: vi.fn() }));
vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({
    activePageId: 'p1', expandedIds: new Set<string>(), pages: h.pages, setActivePage: h.setActivePage,
    toggleExpanded: vi.fn(), expandPages: vi.fn(), renamePage: vi.fn(), deletePage: vi.fn(),
  }),
}));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ clearPreviewPost: vi.fn(), previewPost: null, openPost: vi.fn() }) }));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [] }) }));
vi.mock('@/store/hooks', () => ({ useYjsValue: () => [], useEditorDoc: () => ({}) }));
vi.mock('@/store/selectors', () => ({ selectPageBlogCollectionIds: () => [], selectIsPageRowVisible: () => true }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
vi.mock('@/hooks/useGoToPost', () => ({ useGoToPost: () => vi.fn() }));
vi.mock('@/ai/AIContext', () => ({ useAI: () => ({ activeKeys: [], recentlyTouchedKeys: [] }) }));
vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map((k) => [k, () => null]));
});

import { PageTreeNode } from '../PageTreeNode';
import { SortableTreeProvider } from '@/components/ui';

const page = (p: Partial<PageData> & { id: string; name: string }): PageData => ({ rootElementIds: [], children: [], ...p });

function renderTree() {
  const pages = [page({ id: 'p1', name: 'index', isHome: true }), page({ id: 'p2', name: 'About' })];
  h.pages = pages;
  render(
    <SortableTreeProvider items={pages} rootIds={['p1', 'p2']} dragType="pages-panel" onMove={() => {}}>
      <SortableContext items={['p1', 'p2']} strategy={verticalListSortingStrategy}>
        {pages.map((p, i) => <PageTreeNode key={p.id} page={p} depth={0} index={i} siblingIds={['p1', 'p2']} parentId={null} />)}
      </SortableContext>
    </SortableTreeProvider>,
  );
  return screen.getAllByTestId('page-item');
}

beforeEach(() => h.setActivePage.mockClear());

describe('PageTreeNode — menu and keyboard', () => {
  it('right-click opens the kit menu with Delete only, and Escape closes it', () => {
    const rows = renderTree();
    fireEvent.contextMenu(rows[1]);
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Set as home' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('the read-only name is out of the Tab order (focus stays on the row), and Enter opens the focused page', async () => {
    const user = userEvent.setup();
    const rows = renderTree();
    expect(rows[1].querySelector('input')!.tabIndex).toBe(-1);
    rows[1].closest<HTMLElement>('[role="button"]')!.focus(); // dnd-kit's row button, the one Tab stop per page
    await user.keyboard('{Enter}');
    expect(h.setActivePage).toHaveBeenCalledTimes(1);
    expect(h.setActivePage).toHaveBeenCalledWith('p2');
  });

  it('the row carries its full route as a title, for a name cut off by the panel width', () => {
    const rows = renderTree();
    expect(rows[1].getAttribute('title')).toBe(rows[1].querySelector('input')!.value);
  });
});
