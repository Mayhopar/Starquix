/**
 * The Layers/Assets tree must highlight exactly ONE row at a time. The open
 * editor-doc row drives the nested ElementsTree via `isActive` ("open in
 * editor"), but it should only wear the SELECTION highlight when nothing inside
 * its tree is selected — otherwise the doc row AND the selected element both
 * read as selected.
 *
 * Rendering the full AssetsPanel pulls a large provider tree; we stub the DnD
 * layer, contexts, and the nested ElementsTree, leaving the panel's own
 * selection-gating under test. A component in the 'Uncategorized' category
 * flattens to a root-level row (no category expansion needed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const DOC_NAME = 'Hero';
const DOC_PATH = 'library/Hero.astro';

// STABLE references — the panel's tree-rebuild effect depends on these arrays;
// returning fresh arrays per render would loop forever (recompute → re-render).
const h = vi.hoisted(() => {
  const builtIn = [{
    name: 'Hero', path: 'library/Hero.astro', source: 'built-in', html: '',
    category: 'Uncategorized', props: [], slots: [], dependencies: [], pageTemplate: null,
  }];
  const userComp = [{
    name: 'Card', path: 'src/components/Card.astro', source: 'user-project', html: '',
    category: 'Uncategorized', props: [], slots: [], dependencies: [], pageTemplate: null,
  }];
  const sqComp = [{
    name: 'Media', path: 'src/components/sq/Media.astro', source: 'user-project', html: '',
    category: 'Uncategorized', props: [], slots: [], dependencies: [], pageTemplate: null,
  }];
  return {
    folderIssue: null as any, folderLoaded: true, folderRetry: vi.fn(async () => {}),
    folderSave: vi.fn(async () => {}), folderReload: vi.fn(), takeSnapshot: vi.fn(),
    componentLoading: false, componentError: null as string | null,
    layoutLoading: false, layoutError: null as string | null,
    projectState: undefined as any, layoutReadState: undefined as any,
    selectedKey: null as string | null,
    localPath: null as string | null,
    userComp,
    sqComp,
    builtIn,
    defaultBuiltIn: builtIn,
    layouts: [{
      name: 'Marketing', path: 'Marketing.astro', absolutePath: '/x/Marketing.astro',
      props: [], slots: [''], frontmatter: '', body: '<slot />',
    }],
    empty: [] as unknown[],
    refresh: () => {},
    createLayout: vi.fn(async () => 'layouts/Layout1.astro'),
  };
});
const mockCreateLayout = h.createLayout;

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.localPath }));
vi.mock('@/hooks/useComponentFileOps', () => ({
  useComponentFileOps: () => ({
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(),
    createLayout: h.createLayout,
    deleteLayout: vi.fn(async () => true),
  }),
}));

vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({
    builtIn: h.builtIn, userProject: h.empty, isLoading: h.componentLoading, error: h.componentError, refresh: h.refresh, projectState: h.projectState,
  }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: h.layoutError ? h.empty : h.layouts, isLoading: h.layoutLoading, error: h.layoutError, refresh: h.refresh, readState: h.layoutReadState }),
  // Identity is enough here: the fixture already carries name/path, which is
  // all the panel reads from a ScannedComponent.
  layoutToScannedComponent: (l: unknown) => l,
}));
vi.mock('@/store/hooks', () => ({
  useYjsValue: () => [],
  useDispatch: () => vi.fn(),
  // handleDeleteLayout reads every page's layout at click time, so the panel
  // holds the doc directly. An empty doc is enough here — no page uses a layout.
  useEditorDoc: () => new Y.Doc(),
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: h.takeSnapshot, claimSnapshot: () => undefined }),
}));
vi.mock('@/context/VariablesContext', () => ({
  useVariables: () => ({ activeCollectionId: null, setActiveCollectionId: vi.fn() }),
}));
vi.mock('@/context/SelectionContext', () => ({
  // Assets → Dynamic → Blog (collections + openBoundPage) reads the scan + select.
  useScannedElements: () => ({ scannedByKey: new Map() }),
  useSelectionContext: () => ({ selectedKey: h.selectedKey, select: vi.fn() }),
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
  // task-144: MediaSection (always mounted now) reads the selection descriptor
  useSelectedElement: () => ({}),
}));
vi.mock('@/components/LayersPanel/ElementsTree', () => ({
  ElementsTree: () => null,
}));
// The folder manifest normally arrives over /__sq/folders; stub it so the
// panel renders synchronously and no fetch escapes into jsdom.
vi.mock('@/hooks/useFolderManifest', () => ({
  useFolderManifest: () => ({
    manifest: { version: 1, roots: [], folders: {} },
    loaded: h.folderLoaded, issue: h.folderIssue,
    save: h.folderSave, retry: h.folderRetry,
    reload: h.folderReload,
  }),
}));
// Stub the DnD layer — the panel provides it, but @dnd-kit is heavy in jsdom.
// (Mocked at the ui/ source module so both the panel's `@/components/ui`
// import and ui/Row's internal './SortableTree' import see the stub.)
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

import { AssetsPanel } from './AssetsPanel';

function docRow(): HTMLElement {
  // The row name renders as a readOnly <input>; its ui/Row wrapper (the
  // `group/row` div) carries the `bg-bg-selected` class when selected.
  return screen.getByDisplayValue(DOC_NAME).closest('[class*="group/row"]')!;
}

describe('AssetsPanel — single-row selection highlight', () => {
  beforeEach(() => {
    h.selectedKey = null;
    h.localPath = null;
    // jsdom implements neither — the active row scrolls itself into view.
    Element.prototype.scrollIntoView = vi.fn();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });

  it('open-doc row is NOT highlighted when an element inside it is selected', () => {
    h.selectedKey = 'Hero.astro:5:1';
    render(
      <AssetsPanel
        activeComponentPath={DOC_PATH}
        onSelectComponent={vi.fn()}
        onClearComponent={vi.fn()}
      />,
    );
    expect(docRow()).not.toHaveClass('bg-bg-selected');
  });

  it('open-doc row IS highlighted when nothing inside is selected', () => {
    h.selectedKey = null;
    render(
      <AssetsPanel
        activeComponentPath={DOC_PATH}
        onSelectComponent={vi.fn()}
        onClearComponent={vi.fn()}
      />,
    );
    expect(docRow()).toHaveClass('bg-bg-selected');
  });
});

// The folder manifest is a sidecar dotfile — it never touches a file the user
// authored — so folders are available in local projects. Adding a COMPONENT
// still writes their files through app-rooted endpoints and stays hidden
// (task-136 ledger M3).
// PARITY: the panel must look and behave the SAME in every runtime. Folder ops
// write a sidecar manifest; component-file ops go through useComponentFileOps,
// which is the only thing that knows which runtime it is. Before 2026-08-10 a
// local project hid the Add-component button, hid Delete, and refused rename —
// three visible differences for the same panel.
describe('AssetsPanel — runtime parity', () => {
  beforeEach(() => {
    h.selectedKey = null;
    h.localPath = null;
    h.builtIn = h.defaultBuiltIn;
    Element.prototype.scrollIntoView = vi.fn();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });

  function renderPanel() {
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
  }

  /** [label, localPath, componentFixture, rowName] */
  const RUNTIMES = [
    ['WC / built-in', null, 'defaultBuiltIn', 'Hero'],
    ['local project', '/tmp/their-site', 'userComp', 'Card'],
  ] as const;

  // task-206: sq/ components are SYSTEM files — badged, no rename, no delete.
  // Same chrome in both runtimes (the path prefix is the gate, not the mode).
  for (const [label, localPath] of [['WC', null], ['local project', '/tmp/their-site']] as const) {
    describe(`system sq/ component — ${label}`, () => {
      beforeEach(() => {
        h.localPath = localPath;
        h.builtIn = h.sqComp as typeof h.builtIn;
      });

      it('wears the System badge', () => {
        renderPanel();
        expect(screen.getByText('System')).toBeTruthy();
      });

      it('context menu has no Delete', () => {
        renderPanel();
        const row = screen.getByDisplayValue('Media').closest('[class*="group/row"]')!;
        fireEvent.click(row);
        fireEvent.contextMenu(row);
        expect(screen.getByText('New folder from selection')).toBeTruthy();
        expect(screen.queryByText('Delete')).toBeNull();
      });

      it('double-click does NOT arm rename', () => {
        renderPanel();
        const row = screen.getByDisplayValue('Media').closest('[class*="group/row"]')!;
        fireEvent.doubleClick(row);
        expect((screen.getByDisplayValue('Media') as HTMLInputElement).readOnly).toBe(true);
      });
    });
  }

  for (const [label, localPath, fixture, rowName] of RUNTIMES) {
    describe(label, () => {
      beforeEach(() => {
        h.localPath = localPath;
        h.builtIn = h[fixture] as typeof h.builtIn;
      });

      it('shows BOTH the Add folder and Add component buttons', () => {
        renderPanel();
        expect(screen.getByTitle('Add folder')).toBeTruthy();
        expect(screen.getByTitle('Add component')).toBeTruthy();
      });

      it('offers the same context menu on a component row, Delete included', () => {
        renderPanel();
        const row = screen.getByDisplayValue(rowName).closest('[class*="group/row"]')!;
        fireEvent.click(row);
        fireEvent.contextMenu(row);
        expect(screen.getByText('New folder from selection')).toBeTruthy();
        expect(screen.getByText('Delete')).toBeTruthy();
      });

      it('arms inline rename on double-click', () => {
        renderPanel();
        const row = screen.getByDisplayValue(rowName).closest('[class*="group/row"]')!;
        fireEvent.doubleClick(row);
        expect((screen.getByDisplayValue(rowName) as HTMLInputElement).readOnly).toBe(false);
      });

      // A layout is NOT a component. It must not appear in the draggable folder
      // tree, where it was silently a drag source, a drop target, and a row
      // whose rename/delete hit component-rooted endpoints and 404'd.
      it('does not render layouts inside the component tree', () => {
        renderPanel();
        // The tree renders every row name as a readOnly <input>; a layout must
        // not be one of them.
        expect(screen.queryByDisplayValue('Marketing')).toBeNull();
      });

      it('renders a Layouts section with its own add button', () => {
        renderPanel();
        expect(screen.getByText('Layouts')).toBeTruthy();
        expect(screen.getByTitle('Add layout')).toBeTruthy();
        expect(screen.getByText('Marketing')).toBeTruthy();
      });

      // task-209: right-click a layout row → Delete. Same gesture in both
      // runtimes; the row owns its own menu (a layout is not in the tree
      // selection RowMenu acts on).
      it('offers Delete on a layout row', () => {
        renderPanel();
        const row = screen.getByText('Marketing');
        fireEvent.contextMenu(row);
        expect(screen.getByText('Delete')).toBeTruthy();
      });
    });
  }
});

describe('AssetsPanel — create layout', () => {
  beforeEach(() => {
    h.selectedKey = null;
    h.localPath = null;
    h.builtIn = h.defaultBuiltIn;
    h.createLayout.mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });

  it('writes a full document with exactly one slot', async () => {
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add layout'));
    await vi.waitFor(() => expect(mockCreateLayout).toHaveBeenCalled());

    const [name, content] = mockCreateLayout.mock.calls[0];
    expect(name).toBe('Layout1');
    // A fragment would ship pages with no <html>/<head>; codegen emits this
    // layout as the page's ONLY wrapper.
    expect(content).toContain('<!doctype html>');
    expect(content).toContain('{title}');
    // "without a slot, a layout is just a component" (layouts.rules)
    expect(content.match(/<slot/g)).toHaveLength(1);
  });

  // A layout named after an existing component recreates the documented
  // same-name drift incident (project_layout_component_name_collision).
  it('skips a name already taken by a COMPONENT', async () => {
    h.builtIn = [{ ...h.defaultBuiltIn[0], name: 'Layout1' }] as typeof h.builtIn;
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add layout'));
    await vi.waitFor(() => expect(mockCreateLayout).toHaveBeenCalled());
    expect(mockCreateLayout.mock.calls[0][0]).toBe('Layout2');
  });
});


describe('AssetsPanel scoped discovery failure', () => {
  beforeEach(() => {
    h.builtIn = h.defaultBuiltIn; h.selectedKey = null; h.localPath = null;
    h.componentLoading = false; h.componentError = null; h.layoutLoading = false; h.layoutError = null;
    h.projectState = undefined; h.layoutReadState = undefined;
    Element.prototype.scrollIntoView = vi.fn();
  });
  it('keeps independent sections and built-ins visible during component loading', () => {
    h.componentLoading = true;
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} />);
    expect(screen.getByText('Variables')).toBeInTheDocument();
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByText('Layouts')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hero')).toBeInTheDocument();
    expect(screen.getByTitle('Add component')).toBeDisabled();
  });
  it('shows unavailable project data read-only beside usable built-ins without raw errors', () => {
    h.componentError = '/private/token-secret';
    h.projectState = { status: 'unavailable', data: h.userComp };
    const select = vi.fn();
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={select} />);
    expect(screen.getByText('Project components are unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('/private/token-secret')).not.toBeInTheDocument();
    fireEvent.click(screen.getByDisplayValue('Card'));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByDisplayValue('Hero'));
    expect(select).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Add folder')).toBeDisabled();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
  });
  it('keeps layout failure local and refuses stale layout selection', () => {
    h.layoutError = 'raw layout failure'; h.layoutReadState = { status: 'unavailable', data: h.layouts };
    const select = vi.fn();
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={select} />);
    expect(screen.getByText('Project layouts are unavailable.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hero')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Marketing'));
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add layout' })).toBeDisabled();
  });
});


describe('AssetsPanel folder outcome feedback', () => {
  beforeEach(() => {
    h.folderIssue = null; h.folderLoaded = true;
    h.componentLoading = false; h.componentError = null; h.layoutLoading = false; h.layoutError = null;
    h.projectState = undefined; h.layoutReadState = undefined; h.builtIn = h.defaultBuiltIn;
    h.folderRetry.mockClear(); h.folderReload.mockClear(); h.folderSave.mockReset();
  });
  it('keeps unknown folder work visible and offers no write retry', () => {
    h.folderIssue = { operation: 'folder-save', outcome: 'unknown', recover: 'get-help' };
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} />);
    expect(screen.getByText('Folder changes have not been confirmed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Add folder')).toBeDisabled();
    expect(screen.getByText('Variables')).toBeInTheDocument();
  });
  it('offers only the owner retry for acknowledged folder bytes that are not durable', () => {
    h.folderIssue = { operation: 'folder-save', outcome: 'written-not-durable', recover: 'retry-save' };
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(h.folderRetry).toHaveBeenCalledTimes(1);
  });
  it('distinguishes unavailable folders from loading and retries only the read', () => {
    h.folderLoaded = false; h.folderIssue = { operation: 'folder-save', outcome: 'not-applicable', recover: 'read-again' };
    render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} />);
    expect(screen.getByText('Component folders are unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Loading component folders…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.folderReload).toHaveBeenCalledTimes(1); expect(h.folderRetry).not.toHaveBeenCalled();
  });
});
