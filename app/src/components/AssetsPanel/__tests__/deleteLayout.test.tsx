/**
 * Delete a layout (task-209): every page that imported it gets the layout's
 * whole document inlined, so nothing on screen changes except that the layout
 * is gone. Files are truth, and the parent never sends
 * doc-derived markup to the iframe, so the panel posts the file rewrite and
 * leaves the doc alone. Undo is ONE atomic restore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const LAYOUT_BODY = '<body><header class="hd">H</header><slot class="p-4" /></body>';

const h = vi.hoisted(() => ({
  localPath: null as string | null,
  calls: [] as string[],
  dispatch: vi.fn(),
  takeSnapshot: vi.fn(),
  deleteLayout: vi.fn(async () => '---\n---\n<slot />\n'),
  createLayout: vi.fn(async () => 'layouts/Foo.astro'),
  inlineDeleteLayout: vi.fn(async () => ({ ok: true as const, files: [] })),
  restoreFiles: vi.fn(async () => true),
  doc: null as Y.Doc | null,
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.localPath }));
vi.mock('@/hooks/useComponentFileOps', () => ({
  useComponentFileOps: () => ({
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), promote: vi.fn(),
    createLayout: h.createLayout,
    deleteLayout: (...a: unknown[]) => { h.calls.push('deleteLayout'); return h.deleteLayout(...(a as [])); },
    inlineDeleteLayout: (...a: unknown[]) => { h.calls.push('inlineDeleteLayout'); return h.inlineDeleteLayout(...(a as [])); },
    restoreFiles: (...a: unknown[]) => { h.calls.push('restoreFiles'); return h.restoreFiles(...(a as [])); },
  }),
}));
// One component is REQUIRED scaffolding, not decoration: the panel early-returns
// "No components available" at zero tree items, so the Layouts section (and its
// + button) never renders — a pre-existing gap, not this task's.
const COMPONENTS = [{
  name: 'Card', path: 'library/Card.astro', source: 'built-in', html: '',
  category: 'Uncategorized', props: [], slots: [], dependencies: [], pageTemplate: null,
}];
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: COMPONENTS, userProject: [], isLoading: false, error: null, refresh: () => {} }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({
    layouts: [{ name: 'Foo', path: 'Foo.astro', absolutePath: '/x/Foo.astro', props: [], slots: [''], frontmatter: '', body: LAYOUT_BODY }],
    isLoading: false, error: null, refresh: () => {},
  }),
  layoutToScannedComponent: (l: { name: string }) => ({ ...l, path: `layouts/${l.name}.astro` }),
}));
vi.mock('@/store/hooks', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/store/hooks');
  return {
    ...actual,
    useYjsValue: () => [],
    useDispatch: () => (c: unknown) => { h.calls.push('dispatch'); h.dispatch(c); },
    useEditorDoc: () => h.doc,
  };
});
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: (...a: unknown[]) => { h.calls.push('takeSnapshot'); h.takeSnapshot(...a); } }),
}));
vi.mock('@/context/VariablesContext', () => ({
  useVariables: () => ({ activeCollectionId: null, setActiveCollectionId: vi.fn() }),
}));
vi.mock('@/context/SelectionContext', () => ({
  // Assets → Dynamic → Blog (collections + openBoundPage) reads the scan + select.
  useScannedElements: () => ({ scannedByKey: new Map() }),
  useSelectionContext: () => ({ selectedKey: null }),
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
  useSelectedElement: () => ({}),
}));
vi.mock('@/components/LayersPanel/ElementsTree', () => ({ ElementsTree: () => null }));
vi.mock('@/hooks/useFolderManifest', () => ({
  useFolderManifest: () => ({ manifest: { version: 1, roots: [], folders: {} }, loaded: true, save: vi.fn(), reload: vi.fn() }),
}));
vi.mock('@/components/ui/SortableTree', () => ({
  SortableTreeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTreeNodeDnd: () => ({ setNodeRef: () => {}, attributes: {}, listeners: {}, isDragging: false, dropZone: null }),
  useTreePointerY: () => null,
  getDropZone: () => null,
  TreeDropIndicator: () => null,
  ROW_HEIGHT: 28,
}));
vi.mock('@/components/Editor/useLayersDrag', () => ({
  useLayersDrag: () => ({ onDragStart() {}, onDragMove() {}, onDragEnd() {}, onDragCancel() {} }),
}));
vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});

import { AssetsPanel } from '../AssetsPanel';
import { createElementYMap } from '@/store/commands';
import { emptyClassData } from '@/store/types';

/** p1 and p2 use 'Foo'; p3 uses nothing. */
function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  for (const [id, layout] of [['p1', 'Foo'], ['p2', 'Foo'], ['p3', null]] as const) {
    const page = new Y.Map();
    const roots = new Y.Array<string>();
    roots.push([`${id}-root`]);
    page.set('id', id);
    page.set('name', id);
    if (layout) page.set('layoutName', layout);
    page.set('rootElementIds', roots);
    doc.getMap('pages').set(id, page);
    doc.getMap('elements').set(`${id}-root`, createElementYMap({
      id: `${id}-root`, pageId: id, parentId: null, index: 0, type: 'frame',
      classes: emptyClassData(), staticMarkup: `<div>${id}</div>`,
    }));
  }
  return doc;
}

function deleteFooLayout(): void {
  render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
  fireEvent.contextMenu(screen.getByText('Foo'));
  fireEvent.click(screen.getByText('Delete'));
}

beforeEach(() => {
  h.localPath = null;
  h.calls.length = 0;
  h.doc = buildDoc();
  h.dispatch.mockClear();
  h.takeSnapshot.mockClear();
  h.deleteLayout.mockClear();
  h.createLayout.mockClear();
  h.inlineDeleteLayout.mockClear();
  h.inlineDeleteLayout.mockReset();
  h.restoreFiles.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
});

describe('delete a layout', () => {
  beforeEach(() => {
    h.localPath = 'wc://browser_abc';
    h.inlineDeleteLayout.mockResolvedValue([
      { file: 'src/pages/index.astro', content: 'PREV PAGE' },
      { file: 'src/layouts/Foo.astro', content: 'PREV LAYOUT' },
    ] as never);
  });

  it('goes through the inline endpoint and never touches the doc', async () => {
    deleteFooLayout();
    await vi.waitFor(() => expect(h.inlineDeleteLayout).toHaveBeenCalledWith('Foo'));
    expect(h.deleteLayout).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.calls).toEqual(['inlineDeleteLayout', 'takeSnapshot']);
  });

  it('restores every file through ONE atomic call on undo', async () => {
    deleteFooLayout();
    await vi.waitFor(() => expect(h.takeSnapshot).toHaveBeenCalled());
    const effect = h.takeSnapshot.mock.calls[0][0] as { reverse: () => void };
    effect.reverse(); // waits its write turn (never skipped)
    await vi.waitFor(() => expect(h.restoreFiles).toHaveBeenCalledTimes(1));
    expect(h.restoreFiles).toHaveBeenCalledWith([
      { file: 'src/pages/index.astro', content: 'PREV PAGE' },
      { file: 'src/layouts/Foo.astro', content: 'PREV LAYOUT' },
    ]);
  });

  it('takes no undo entry when the endpoint refuses (C7/C14)', async () => {
    h.inlineDeleteLayout.mockResolvedValueOnce(null as never);
    deleteFooLayout();
    await vi.waitFor(() => expect(h.inlineDeleteLayout).toHaveBeenCalled());
    expect(h.takeSnapshot).not.toHaveBeenCalled();
  });
});

// ⌘\ hides the sidebars and dispatches `resize`: a menu pinned at the cursor would float over the canvas.
describe('Assets row menu', () => {
  it('closes when the layout resizes', () => {
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('Foo'));
    expect(screen.getByText('Delete')).toBeTruthy();
    fireEvent(window, new Event('resize'));
    expect(screen.queryByText('Delete')).toBeNull();
  });
});
