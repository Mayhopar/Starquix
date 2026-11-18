import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SelectionProvider } from '@/context/SelectionContext';
import { useSelection } from '@/test/mergedSelectionHook';
import type { ReactNode } from 'react';
import type { ScannedElement } from './SelectionContext';
import { getSelectionEpoch } from '@/utils/localPendingSelection';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SelectionProvider>{children}</SelectionProvider>
);

const makeElement = (key: string, parentKey: string | null): ScannedElement => ({
  key,
  parentKey,
  tagName: 'div',
  classes: '',
  rect: { top: 0, left: 0, width: 100, height: 100 },
  hasSourceTracking: true
});

describe('SelectionContext expandedNodes', () => {
  it('toggleExpand adds and removes keys from expandedNodes', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    expect(result.current.expandedNodes.has('node-1')).toBe(false);

    act(() => {
      result.current.toggleExpand('node-1');
    });
    expect(result.current.expandedNodes.has('node-1')).toBe(true);

    act(() => {
      result.current.toggleExpand('node-1');
    });
    expect(result.current.expandedNodes.has('node-1')).toBe(false);
  });

  it('expandNodes adds multiple keys to expandedNodes', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    act(() => {
      result.current.expandNodes(['node-1', 'node-2', 'node-3']);
    });

    expect(result.current.expandedNodes.has('node-1')).toBe(true);
    expect(result.current.expandedNodes.has('node-2')).toBe(true);
    expect(result.current.expandedNodes.has('node-3')).toBe(true);
  });

  it('collapseAll clears all expandedNodes', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    act(() => {
      result.current.expandNodes(['node-1', 'node-2']);
    });
    expect(result.current.expandedNodes.size).toBe(2);

    act(() => {
      result.current.collapseAll();
    });
    expect(result.current.expandedNodes.size).toBe(0);
  });
});

describe('SelectionContext auto-expand on select', () => {
  it('auto-expands ancestor nodes when selecting a nested element', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    // Set up scanned elements with parent-child hierarchy
    // grandparent -> parent -> child
    act(() => {
      result.current.setScannedElements([
        makeElement('grandparent', null),
        makeElement('parent', 'grandparent'),
        makeElement('child', 'parent'),
      ]);
    });

    // Select the deeply nested child
    act(() => {
      result.current.select('child', { tagName: 'div' });
    });

    // Both ancestors should be auto-expanded
    expect(result.current.expandedNodes.has('grandparent')).toBe(true);
    expect(result.current.expandedNodes.has('parent')).toBe(true);
    expect(result.current.selectedKey).toBe('child');
  });
});

describe('SelectionContext auto-expand root nodes', () => {
  it('auto-expands root nodes when scannedElements are first set', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    // Initially no expanded nodes
    expect(result.current.expandedNodes.size).toBe(0);

    // Set scanned elements with root nodes
    act(() => {
      result.current.setScannedElements([
        makeElement('root1', null),
        makeElement('root2', null),
        makeElement('child1', 'root1'),
      ]);
    });

    // Root nodes should be auto-expanded
    expect(result.current.expandedNodes.has('root1')).toBe(true);
    expect(result.current.expandedNodes.has('root2')).toBe(true);
    // Children should not be auto-expanded
    expect(result.current.expandedNodes.has('child1')).toBe(false);
  });
});

// e2e A2 2026-11-10: a post-insert pending selection applies only if the user
// has not re-selected since the gesture — every change of the selected key counts.
describe('SelectionContext selection epoch', () => {
  it('select / clear bump it when the key changes; re-selecting the same key does not', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    const e0 = getSelectionEpoch();
    act(() => { result.current.select('a'); });
    expect(getSelectionEpoch()).toBe(e0 + 1);
    act(() => { result.current.select('a'); });
    expect(getSelectionEpoch()).toBe(e0 + 1);
    act(() => { result.current.clearSelection(); });
    expect(getSelectionEpoch()).toBe(e0 + 2);
    act(() => { result.current.clearSelection(); });
    expect(getSelectionEpoch()).toBe(e0 + 2);
  });
});

describe('SelectionContext enterContext', () => {
  it('enterContext expands the context node', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    // Set up scanned elements
    act(() => {
      result.current.setScannedElements([
        makeElement('container', null),
        makeElement('child', 'container'),
      ]);
    });

    // Clear expanded nodes first
    act(() => {
      result.current.collapseAll();
    });
    expect(result.current.expandedNodes.has('container')).toBe(false);

    // Enter context
    act(() => {
      result.current.enterContext('container');
    });

    // Container should be expanded
    expect(result.current.expandedNodes.has('container')).toBe(true);
    expect(result.current.contextKey).toBe('container');
  });

  // Phase 2 of docs/archive/plans/2026-06-10-selection-key-architecture-memo.md:
  // context (drill-down location) and selection are orthogonal. Entering a
  // context NEVER implies selection — every caller that wants both already
  // calls select() explicitly with the full payload.
  it('enterContext never changes the selection (context ≠ selection)', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.select('el-existing'); });
    act(() => { result.current.enterContext('container'); });
    expect(result.current.contextKey).toBe('container');
    expect(result.current.selectedKey).toBe('el-existing');
  });

  it('enterContext on the infra wrapper leaves selection empty', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    // Regression: the editor auto-enters the #sq-components wrapper on load; it
    // must NOT become the selection (else the layout editor mislabels it).
    act(() => { result.current.enterContext('src/pages/preview/[projectId]/[pageId].astro:17:29'); });
    expect(result.current.contextKey).toBe('src/pages/preview/[projectId]/[pageId].astro:17:29');
    expect(result.current.selectedKey).toBeNull();
  });
});

describe('SelectionContext exitContext selection', () => {
  it('exitContext selects the container being exited (drill-up keeps orientation)', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.enterContext('container'); });
    act(() => { result.current.select('container:div-0'); });
    act(() => { result.current.exitContext(); });
    expect(result.current.contextKey).toBeNull();
    expect(result.current.selectedKey).toBe('container');
  });

  it('exitContext from the infra wrapper context does NOT select the wrapper', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    const wrapperKey = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
    // The auto-entered wrapper is the outermost context on load. Escape from it
    // must not leak the wrapper into the selection (same disease as the
    // layout-editor "styleable Layout" bug, via a different door).
    act(() => { result.current.enterContext(wrapperKey); });
    act(() => { result.current.exitContext(); });
    expect(result.current.contextKey).toBeNull();
    expect(result.current.selectedKey).toBeNull();
  });
});

// Phase 3 of docs/archive/plans/2026-06-10-selection-key-architecture-memo.md: the
// selection records WHICH doc (Yjs page) it belongs to. ViewportFrame sets the
// scope on page change; select() stamps it. Kills the "is this selection inside
// MY subtree?" reconstruction heuristics (memo F2).
describe('SelectionContext selectedDocId (selection doc scope)', () => {
  it('select() stamps selectedDocId from the current doc scope', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.setSelectionDocScope('page-1'); });
    act(() => { result.current.select('el-a'); });
    expect(result.current.selectedDocId).toBe('page-1');
  });

  it('selection keeps the doc id it was stamped with when the scope later changes', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.setSelectionDocScope('page-1'); });
    act(() => { result.current.select('el-a'); });
    act(() => { result.current.setSelectionDocScope('page-2'); });
    expect(result.current.selectedDocId).toBe('page-1');
  });

  it('clearSelection() and select(null) clear selectedDocId', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.setSelectionDocScope('page-1'); });
    act(() => { result.current.select('el-a'); });
    act(() => { result.current.clearSelection(); });
    expect(result.current.selectedDocId).toBeNull();
    act(() => { result.current.select('el-a'); });
    act(() => { result.current.select(null); });
    expect(result.current.selectedDocId).toBeNull();
  });

  it('exitContext stamps the current scope on the container it selects', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.setSelectionDocScope('page-1'); });
    act(() => { result.current.enterContext('container'); });
    act(() => { result.current.exitContext(); });
    expect(result.current.selectedKey).toBe('container');
    expect(result.current.selectedDocId).toBe('page-1');
  });
});

describe('SelectionContext select() user-selectability boundary', () => {
  it('select() on the infra wrapper key is a no-op — infra is never the selection, by construction', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.select('el-real'); });
    act(() => { result.current.select('src/pages/preview/[projectId]/[pageId].astro:17:29'); });
    expect(result.current.selectedKey).toBe('el-real');
  });
});

describe('synchronous refs (task-075/task-044)', () => {
  it('select() updates selectedKeyRef, selectedElementIdRef and state in the same call', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.select('el-abc:div-0');
      // Read refs inside the same act() — before any rerender.
      expect(result.current.selectedKeyRef.current).toBe('el-abc:div-0');
      expect(result.current.selectedElementIdRef.current).toBe('el-abc');
    });
    expect(result.current.selectedKey).toBe('el-abc:div-0');
    expect(result.current.selectedElementId).toBe('el-abc');
  });

  it('selectedElementIdRef is null for dynamic keys', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.select('dynamic:span-1');
      expect(result.current.selectedElementIdRef.current).toBeNull();
    });
    expect(result.current.selectedElementId).toBeNull();
    expect(result.current.selectedKey).toBe('dynamic:span-1');
  });

  it('exitContext() updates selectedKeyRef in the same call (task-044)', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.enterContext('el-parent'); });
    act(() => { result.current.enterContext('el-child'); });
    act(() => {
      result.current.exitContext();
      expect(result.current.selectedKeyRef.current).toBe('el-child');
      expect(result.current.selectedElementIdRef.current).toBe('el-child');
      expect(result.current.contextKeyRef.current).toBe('el-parent');
    });
    expect(result.current.selectedKey).toBe('el-child');
    expect(result.current.contextKey).toBe('el-parent');
  });

  it('exitContext() from the infra wrapper leaves selectedKeyRef null', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    const wrapperKey = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
    act(() => { result.current.enterContext(wrapperKey); });
    act(() => {
      result.current.exitContext();
      expect(result.current.selectedKeyRef.current).toBeNull();
      expect(result.current.selectedElementIdRef.current).toBeNull();
    });
    expect(result.current.selectedKey).toBeNull();
  });

  it('clearSelection() nulls all selection refs', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => { result.current.select('el-abc:div-0'); });
    act(() => {
      result.current.clearSelection();
      expect(result.current.selectedKeyRef.current).toBeNull();
      expect(result.current.selectedElementIdRef.current).toBeNull();
    });
    expect(result.current.selectedKey).toBeNull();
    expect(result.current.selectedElementId).toBeNull();
  });

  it('contextKeyRef tracks enterContext/exitContext/resetContext synchronously', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.enterContext('el-a');
      expect(result.current.contextKeyRef.current).toBe('el-a');
    });
    act(() => {
      result.current.enterContext('el-b');
      expect(result.current.contextKeyRef.current).toBe('el-b');
    });
    act(() => {
      result.current.exitContext();
      expect(result.current.contextKeyRef.current).toBe('el-a');
    });
    act(() => {
      result.current.resetContext();
      expect(result.current.contextKeyRef.current).toBeNull();
    });
    expect(result.current.contextKey).toBeNull();
  });
});

describe('SelectionContext parentDisplay', () => {
  it('stores parentDisplay when selecting an element', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    // Select element with parentDisplay option
    act(() => {
      result.current.select('child-element', {
        tagName: 'div',
        parentDisplay: 'grid'
      });
    });

    // parentDisplay should be stored
    expect(result.current.selectedParentDisplay).toBe('grid');
  });

  it('preserves parentDisplay from scannedElements when selecting by key', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    // Set up scanned elements with parentDisplay
    const elementsWithParentDisplay: ScannedElement[] = [
      { ...makeElement('grid-container', null), parentDisplay: 'block' },
      { ...makeElement('grid-child', 'grid-container'), parentDisplay: 'grid' },
    ];

    act(() => {
      result.current.setScannedElements(elementsWithParentDisplay);
    });

    // Select the grid child - should get parentDisplay from scanned element
    act(() => {
      result.current.select('grid-child', { tagName: 'div' });
    });

    // parentDisplay should come from the scanned element
    expect(result.current.selectedParentDisplay).toBe('grid');
  });

  it('clears parentDisplay when selection is cleared', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    // Select with parentDisplay
    act(() => {
      result.current.select('element', { parentDisplay: 'grid' });
    });
    expect(result.current.selectedParentDisplay).toBe('grid');

    // Clear selection
    act(() => {
      result.current.clearSelection();
    });

    // parentDisplay should be null
    expect(result.current.selectedParentDisplay).toBe(null);
  });
});

it('keeps imported post navigation current across Layers selection, href-only scans and selection reset', () => {
  const { result } = renderHook(() => useSelection(), { wrapper });
  const card = { ...makeElement('card', null), postLinkPaths: ['/works/first'] };
  act(() => { result.current.setScannedElements([card]); result.current.select('card', { postLinkPaths: card.postLinkPaths }); });
  expect(result.current.selectedPostLinkPaths).toEqual(['/works/first']);
  act(() => { result.current.setScannedElements([{ ...card, postLinkPaths: ['/works/second'] }]); });
  expect(result.current.scannedElements[0].postLinkPaths).toEqual(['/works/second']);
  expect(result.current.selectedPostLinkPaths).toEqual(['/works/second']);
  act(() => { result.current.select('other', { tagName: 'div' }); });
  expect(result.current.selectedPostLinkPaths).toBeNull();
  act(() => { result.current.select('card', { postLinkPaths: ['/works/second'] }); result.current.clearSelection(); });
  expect(result.current.selectedPostLinkPaths).toBeNull();
});
it('does not replace an actual clicked clone identity with the first template on rescan', () => {
  const { result } = renderHook(() => useSelection(), { wrapper });
  const card = { ...makeElement('template', null), postSlug: 'first', postLinkPaths: ['/works/first'] };
  act(() => { result.current.setScannedElements([card]); result.current.select('template', { postSlug: 'second', postLinkPaths: ['/works/second'] }); });
  act(() => { result.current.setScannedElements([{ ...card, classes: 'updated' }]); });
  expect(result.current.selectedPostLinkPaths).toEqual(['/works/second']);
  act(() => { result.current.setScannedElements([]); });
  expect(result.current.selectedPostLinkPaths).toBeNull();
});
it('refreshes a fresh imported click even when its paths already differ from the previous scan', () => {
  const { result } = renderHook(() => useSelection(), { wrapper });
  const card = { ...makeElement('card', null), postLinkPaths: ['/works/first'] };
  act(() => { result.current.setScannedElements([card]); result.current.select('card', { postLinkPaths: ['/works/second'] }); });
  act(() => { result.current.setScannedElements([{ ...card, postLinkPaths: ['/works/third'] }]); });
  expect(result.current.selectedPostLinkPaths).toEqual(['/works/third']);
});
it('exiting a card context clears its post navigation from the unrelated selected parent', () => {
  const { result } = renderHook(() => useSelection(), { wrapper });
  act(() => {
    result.current.setScannedElements([makeElement('section', null), { ...makeElement('card', 'section'), postLinkPaths: ['/works/first'] }]);
    result.current.enterContext('section'); result.current.select('card', { postLinkPaths: ['/works/first'] });
    result.current.exitContext();
  });
  expect(result.current.selectedKey).toBe('section');
  expect(result.current.selectedPostLinkPaths).toBeNull();
});
