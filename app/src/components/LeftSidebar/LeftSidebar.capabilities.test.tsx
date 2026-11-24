import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { setLocalComponentViewFile } from '@/services/localComponentView';

const lib = (name: string, source: string) => ({ name, path: `src/components/${name}.astro`, source, html: '<div />' });

const h = vi.hoisted(() => ({
  doc: null as unknown as Y.Doc,
  activeTopTab: 'pages' as 'pages' | 'assets' | 'content',
  setActiveTopTab: vi.fn(),
  builtIn: [] as unknown[],
  userProject: [] as unknown[],
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => vi.fn(),
  useYjsValue: (selector: (doc: Y.Doc) => unknown) => selector(h.doc),
}));
vi.mock('@/components/PagesPanel/PagesPanel', () => ({ PagesPanel: () => <div>File panel</div> }));
vi.mock('@/components/LayersPanel/ElementsTree', () => ({ ElementsTree: () => <div>Layers tree</div> }));
vi.mock('@/components/SeoPanel/SeoPanel', () => ({ SeoPanel: () => <div>SEO panel</div> }));
vi.mock('@/components/AssetsPanel/AssetsPanel', () => ({
  AssetsPanel: ({ onSelectComponent }: { onSelectComponent: (c: unknown) => void }) => (
    <div>{(h.userProject as Array<{ name: string }>).map(c => <span key={c.name} onClick={() => onSelectComponent(c)}>row {c.name}</span>)}</div>
  ),
}));
vi.mock('@/components/CollectionsPanel/CollectionsPanel', () => ({ CollectionsPanel: () => <div>Content panel</div> }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ activeCollectionId: null, setActiveCollectionId: vi.fn() }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ editingPost: null, closePost: vi.fn() }) }));
vi.mock('@/context/SidebarTabContext', () => ({ useSidebarTab: () => ({ activeTopTab: h.activeTopTab, setActiveTopTab: h.setActiveTopTab }) }));
vi.mock('@/context/SelectionContext', () => ({ useSelectionContext: () => ({ clearSelection: vi.fn() }) }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ builtIn: h.builtIn, userProject: h.userProject, refresh: vi.fn() }) }));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [] }),
  layoutToScannedComponent: (layout: unknown) => layout,
}));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/services/pendingLayoutAppends', () => ({ flushLayoutAppends: vi.fn(async () => 0), useDrainLayoutAppendsOnUnmount: () => {} }));
vi.mock('@/utils/pendingSourceWrites', () => ({ flushPendingSourceWrites: vi.fn(async () => {}) }));

import { LeftSidebar } from './LeftSidebar';

function buildDoc(projectId: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  doc.getMap('meta').set('currentPageId', 'page-1');
  return doc;
}

describe('LeftSidebar project capabilities', () => {
  beforeEach(() => {
    unmarkFilesTruth('browser_release');
    h.doc = buildDoc('browser_release');
    h.activeTopTab = 'pages';
    h.setActiveTopTab.mockClear();
  });

  afterEach(() => unmarkFilesTruth('browser_release'));

  it('keeps Content and SEO affordances for a legacy document project', () => {
    render(<LeftSidebar />);
    expect(screen.getByRole('tab', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'SEO' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByText('SEO panel')).toBeInTheDocument();
  });

  // task-248: SEO lives in the project files now — the tab is there on every desktop project.
  it('keeps the SEO tab on a files-truth project', () => {
    markFilesTruth('browser_release');
    render(<LeftSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByText('SEO panel')).toBeInTheDocument();
  });

  // Finding #31: a pages height saved in a taller window pushed Layers and its divider off-screen, even after a
  // restart. jsdom has no layout, so this pins the rule; the flex result was measured in Chromium.
  it('Layers keeps its minimum height and the pages section gives way, whatever height was saved', () => {
    localStorage.setItem('starquix:left-sidebar-pages-height', '652');
    render(<LeftSidebar />);
    const pages = screen.getByText('File panel').parentElement!.parentElement!;
    expect(pages.style.height).toBe('652px'); // the saved height is kept for a window tall enough
    expect(pages.className).not.toMatch(/\bflex-shrink-0\b/); // …and shrinks in a shorter one
    expect(screen.getByText('Layers tree').parentElement!.parentElement!.style.minHeight).toBe('100px');
    localStorage.removeItem('starquix:left-sidebar-pages-height');
  });
});

// Owner 2026-11-17: the Assets tab is the component editor — it never shows the
// site, and entering it opens nothing ("I dropped a hero, switched to Assets and
// saw the hero again").
describe('LeftSidebar — the Assets tab is the component editor', () => {
  let views: Array<string | null>;
  const onView = (e: Event) => views.push((e as CustomEvent).detail.file);

  beforeEach(() => {
    h.doc = buildDoc('browser_components_tab');
    h.activeTopTab = 'pages';
    h.setActiveTopTab.mockClear();
    h.builtIn = [lib('LibHero', 'system')];
    h.userProject = [lib('Card', 'user-project'), lib('Hero', 'user-project')];
    views = [];
    window.addEventListener('sq:local-component-view', onView);
  });
  afterEach(() => {
    window.removeEventListener('sq:local-component-view', onView);
    setLocalComponentViewFile(null);
  });

  it('entering it opens nothing, even with project components', () => {
    render(<LeftSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));
    expect(h.setActiveTopTab).toHaveBeenCalledWith('assets');
    expect(views).toEqual([]);
  });

  it('a page switch from outside (an agent) lands on the File tab', () => {
    h.activeTopTab = 'assets';
    const view = render(<LeftSidebar />);
    h.doc.getMap('meta').set('currentPageId', 'page-2');
    view.rerender(<LeftSidebar />);
    expect(h.setActiveTopTab).toHaveBeenCalledWith('pages');
  });

  it('"go to the page" leaves a view the sidebar did not open (an agent\'s open_component)', () => {
    h.activeTopTab = 'assets';
    setLocalComponentViewFile('src/components/Hero.astro');
    render(<LeftSidebar />);
    window.dispatchEvent(new CustomEvent('sq:go-to-page'));
    expect(h.setActiveTopTab).toHaveBeenCalledWith('pages');
    expect(views).toEqual([null]);
  });
});
