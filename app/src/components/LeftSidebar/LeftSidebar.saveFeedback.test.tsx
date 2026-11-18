import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { assertNoIncompleteSourceWrites, queueSourceWrites } from '@/utils/pendingSourceWrites';
import { db } from '@/db';
import { flushDurableSourceWrites, PartialSourceMaterialization } from '@/services/durableEdits/sourceMaterialization';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { setLocalTransport } from '@/utils/sqLocalBase';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { LOCAL_COMPONENT_VIEW_FAILED } from '@/services/localComponentView';

const h = vi.hoisted(() => ({
  doc: null as unknown as Y.Doc,
  activeTopTab: 'assets' as 'pages' | 'assets' | 'content',
  setActiveTopTab: vi.fn(),
  select: null as null | ((component: ScannedComponent) => Promise<void>),
  active: null as string | null | undefined,
  push: vi.fn(),
  appends: vi.fn(async () => 1),
  refreshMaster: vi.fn(async () => {}),
  localPath: null as string | null,
  materialize: vi.fn(),
  toasts: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => vi.fn(),
  useYjsValue: (selector: (doc: Y.Doc) => unknown) => selector(h.doc),
}));
vi.mock('@/components/PagesPanel/PagesPanel', () => ({ PagesPanel: () => <div>File panel</div> }));
vi.mock('@/components/LayersPanel/ElementsTree', () => ({ ElementsTree: () => <div>Layers tree</div> }));
vi.mock('@/components/SeoPanel/SeoPanel', () => ({ SeoPanel: () => <div>SEO panel</div> }));
vi.mock('@/components/AssetsPanel/AssetsPanel', () => ({ AssetsPanel: (props: { onSelectComponent: typeof h.select; activeComponentPath?: string | null }) => { h.select = props.onSelectComponent; h.active = props.activeComponentPath; return <div>Assets panel</div>; } }));
vi.mock('@/components/CollectionsPanel/CollectionsPanel', () => ({ CollectionsPanel: () => <div>Content panel</div> }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ activeCollectionId: null, setActiveCollectionId: vi.fn() }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ editingPost: null, closePost: vi.fn() }) }));
vi.mock('@/context/SidebarTabContext', () => ({ useSidebarTab: () => ({ activeTopTab: h.activeTopTab, setActiveTopTab: h.setActiveTopTab }) }));
vi.mock('@/context/SelectionContext', () => ({ useSelectionContext: () => ({ clearSelection: vi.fn() }) }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ builtIn: [], userProject: [], refresh: vi.fn() }) }));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [] }),
  layoutToScannedComponent: (layout: unknown) => layout,
}));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.localPath }));
vi.mock('@/services/pendingLayoutAppends', () => ({ flushLayoutAppends: (...args: []) => h.appends(...args), useDrainLayoutAppendsOnUnmount: () => {} }));
vi.mock('@/store/selectors', async (original) => ({
  ...await original<typeof import('@/store/selectors')>(),
  selectEditorRootElementId: () => 'editor', selectRootElementIds: () => [],
}));
vi.mock('@/utils/pushOverridesToSource', () => ({
  pushOverridesToSource: (...args: unknown[]) => h.push(...args),
  collectWriteBackPayloads: () => ({ astroSource: 'A.astro', payloads: [{ astroSource: 'A.astro', overrides: { classOverrides: { h1: 'new' } } }], skipped: [], drawnMarkups: [] }),
}));
vi.mock('@/utils/ensureBlogPostMaster', () => ({ refreshMasterFromSource: () => h.refreshMaster() }));
vi.mock('@/utils/bakeEditorMaster', () => ({ bakeEditorMaster: () => {}, syncDrawnIntoMasterOverlay: () => {} }));
vi.mock('@/utils/canvasHtml', () => ({ resolveComponentEditorOpen: async () => ({ html: '<h1>Hi</h1>', placements: [] }) }));
vi.mock('./seedComponentEditor', () => ({ seedComponentEditorPage: () => 'editor' }));
vi.mock('react-hot-toast', () => ({ default: h.toasts }));

vi.mock('@/components/Editor/localComponentInsert', () => ({ materializeLibraryComponent: (...args: unknown[]) => h.materialize(...args) }));

import { LeftSidebar } from './LeftSidebar';

function buildDoc(projectId: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  doc.getMap('meta').set('currentPageId', 'page-1');
  return doc;
}

const component = (name: string) => ({ name, path: name + '.astro', source: 'built-in', html: '', category: '', props: [], slots: [], dependencies: [] }) as ScannedComponent;
describe('LeftSidebar source save feedback', () => {
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
    h.doc = buildDoc('browser_legacy'); h.activeTopTab = 'assets'; h.localPath = null;
    vi.clearAllMocks(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLocalTransport({ projectPath: 'wc://browser_legacy', fetch: async () => new Response('<main>Title</main>') });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('a component that cannot be prepared: one generic toast, the internal reason only in the console (HN report 2026-11-09)', async () => {
    h.localPath = '/Users/test/site';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.materialize.mockResolvedValueOnce({ ok: false, reason: 'depends on a layout outside the component library' });
    render(<LeftSidebar />);
    await act(async () => { await h.select!(component('A')); });
    expect(h.toasts.error).toHaveBeenCalledTimes(1);
    expect(h.toasts.error).toHaveBeenCalledWith("Couldn't open A. Try again.");
    expect(errors.mock.calls.flat().join(' ')).toContain('outside the component library');
  });
  it('a thrown preparation failure: the same generic toast, never the error text', async () => {
    h.localPath = '/Users/test/site';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.materialize.mockRejectedValueOnce(new Error('PRIVATE_MATERIALIZE'));
    render(<LeftSidebar />);
    await act(async () => { await h.select!(component('A')); });
    expect(h.toasts.error).toHaveBeenCalledWith("Couldn't open A. Try again.");
  });
  it('a view that never opened puts the Assets row back on what the canvas shows', async () => {
    h.localPath = '/Users/test/site';
    const project = (name: string) => ({ ...component(name), path: `src/components/${name}.astro`, source: 'user-project' }) as ScannedComponent;
    render(<LeftSidebar />);
    await act(async () => { await h.select!(project('Open')); });
    await act(async () => { await h.select!(project('Broken')); });
    expect(h.active).toBe('src/components/Broken.astro');
    act(() => { window.dispatchEvent(new CustomEvent(LOCAL_COMPONENT_VIEW_FAILED, { detail: { file: 'src/components/Broken.astro', previous: 'src/components/Open.astro' } })); });
    expect(h.active).toBe('src/components/Open.astro');
    // A late failure for a row the user already left changes nothing.
    act(() => { window.dispatchEvent(new CustomEvent(LOCAL_COMPONENT_VIEW_FAILED, { detail: { file: 'src/components/Gone.astro', previous: null } })); });
    expect(h.active).toBe('src/components/Open.astro');
  });
  it('does not apply or announce late component preparation on another document', async () => {
    h.localPath = '/Users/test/site';
    let fail!: (error: Error) => void;
    h.materialize.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const view = render(<LeftSidebar />);
    let pending!: Promise<void>;
    await act(async () => { pending = h.select!(component('A')); await Promise.resolve(); });
    h.doc = buildDoc('browser_other'); view.rerender(<LeftSidebar />);
    await act(async () => { fail(new Error('PRIVATE_MATERIALIZE')); await expect(pending).resolves.toBeUndefined(); });
    expect(h.toasts.error).not.toHaveBeenCalled();
  });
  it('retains a partial source receipt internally while allowing later master navigation without feedback', async () => {
    const skipped = [{ source: 'A.astro', category: 'classes' as const, selector: 'h1', reason: 'inside-component' as const }];
    await queueSourceWrites([], skipped, { doc: h.doc });
    await flushDurableSourceWrites('browser_legacy').catch(() => {});
    render(<LeftSidebar />);
    await act(async () => { await h.select!(component('A')); });
    await act(async () => { await h.select!(component('B')); });
    expect(h.refreshMaster).not.toHaveBeenCalled();
    const failure = await assertNoIncompleteSourceWrites('browser_legacy').catch(error => error);
    expect(failure).toBeInstanceOf(PartialSourceMaterialization);
    expect(failure).toMatchObject({ skipped });
    expect(await listUnmaterialized('browser_legacy')).toHaveLength(2);
    expect(h.toasts).not.toHaveBeenCalled();
    expect(h.toasts.error).not.toHaveBeenCalled();
    await act(async () => { await h.select!(component('C')); });
    expect(await listUnmaterialized('browser_legacy')).toHaveLength(3);
  });
  it('switches masters without waiting for background source acknowledgement or presenting a save message', async () => {
    let release!: () => void;
    const source = new Promise<void>(resolve => { release = resolve; });
    h.push.mockImplementation(() => source);
    h.appends.mockImplementationOnce(() => source.then(() => 1));
    render(<LeftSidebar />);
    await act(async () => { await h.select!(component('A')); });
    let switched = false;
    const switching = h.select!(component('B')).then(() => { switched = true; });
    try {
      // Wait FOR the switch (a cold first select takes ~100 ms: dynamic imports) — still before release(): a switch
      // that waited on the source acknowledgement would never get here. A fixed 25 ms sleep flaked alone and under load.
      await act(async () => { await vi.waitFor(() => expect(switched).toBe(true), { timeout: 5_000 }); });
      expect(h.toasts.error).not.toHaveBeenCalled();
      expect(h.toasts).not.toHaveBeenCalled();
      expect((await db.durableEdits.toArray())[0].commands[0].kind).toBe('source-batch');
    } finally { release(); await switching; }
  });
  it('a late failure from an old document does not announce an error in the new project', async () => {
    let reject!: (error: Error) => void;
    h.appends.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(<LeftSidebar />);
    await act(async () => { await h.select!(component('A')); });
    let changing!: Promise<void>;
    await act(async () => { changing = h.select!(component('B')); await changing; });
    h.doc = buildDoc('browser_other'); view.rerender(<LeftSidebar />);
    await act(async () => { reject(new Error('private parser message')); await changing; });
    expect(h.toasts.error).not.toHaveBeenCalled();
  });
});
