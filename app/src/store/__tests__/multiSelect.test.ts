import { describe, it, expect } from 'vitest';
import { canJoinMultiSelection, computeVisibleRange, decideToggle, pruneDescendants, relinkSameLine } from '../multiSelect';
import type { ScannedElement } from '@/context/SelectionContext';

describe('canJoinMultiSelection (any-layer, task-076)', () => {
  it('sibling of the anchor joins', () => {
    expect(canJoinMultiSelection('el-bbb', 'el-aaa')).toBe(true);
  });
  it('instance children of the same instance join', () => {
    expect(canJoinMultiSelection('el-ccc:div-1', 'el-ccc:div-0')).toBe(true);
  });
  it('cross-parent candidate joins (any layer)', () => {
    expect(canJoinMultiSelection('el-ddd:p-0', 'el-ccc:div-0')).toBe(true);
  });
  it('a different component root joins a component-root anchor', () => {
    expect(canJoinMultiSelection('el-bbb:section-0', 'el-aaa:section-0')).toBe(true);
  });
  it('parent and child can be co-selected', () => {
    expect(canJoinMultiSelection('el-aaa:div-2', 'el-aaa:section-0')).toBe(true);
  });
  it('the anchor itself never joins', () => {
    expect(canJoinMultiSelection('el-aaa', 'el-aaa')).toBe(false);
  });
  it('the infra wrapper never joins', () => {
    expect(canJoinMultiSelection(
      'src/pages/preview/[projectId]/[pageId].astro:17:29', 'el-aaa')).toBe(false);
  });
  it('layout chrome never joins (root or child, either side)', () => {
    expect(canJoinMultiSelection('layoutchrome-page-1', 'el-aaa')).toBe(false);
    expect(canJoinMultiSelection('layoutchrome-page-1:slot-0', 'layoutchrome-page-1:header-0')).toBe(false);
    expect(canJoinMultiSelection('el-aaa', 'layoutchrome-page-1')).toBe(false);
  });
});

describe('computeVisibleRange', () => {
  const rows = ['A', 'A1', 'A2', 'B', 'C'];

  it('inclusive slice anchor→click', () => {
    expect(computeVisibleRange('A1', 'B', rows)).toEqual(['A1', 'A2', 'B']);
  });

  it('reversed order works', () => {
    expect(computeVisibleRange('B', 'A1', rows)).toEqual(['A1', 'A2', 'B']);
  });

  it('missing key → null (caller falls back to plain select)', () => {
    expect(computeVisibleRange('A1', 'ZZZ', rows)).toBeNull();
    expect(computeVisibleRange('ZZZ', 'A1', rows)).toBeNull();
  });

  it('returns a single-element range when anchor === clicked', () => {
    expect(computeVisibleRange('A2', 'A2', rows)).toEqual(['A2']);
  });
});

describe('pruneDescendants', () => {
  const parents: Record<string, string | null> = {
    'el-p:section-0': null,
    'el-p:div-1': 'el-p:section-0',
    'el-p:span-2': 'el-p:div-1',
    'el-q': null,
  };
  const lookup = (k: string) => (k in parents ? parents[k] : undefined);
  const e = (key: string) => ({ key, elementId: key.split(':')[0] });

  it('drops a direct child of another member', () =>
    expect(pruneDescendants([e('el-p:section-0'), e('el-p:div-1')], lookup))
      .toEqual([e('el-p:section-0')]));
  it('drops a grandchild (full ancestor walk, not direct parent)', () =>
    expect(pruneDescendants([e('el-p:section-0'), e('el-p:span-2')], lookup))
      .toEqual([e('el-p:section-0')]));
  it('keeps unrelated members and preserves order', () =>
    expect(pruneDescendants([e('el-q'), e('el-p:div-1')], lookup))
      .toEqual([e('el-q'), e('el-p:div-1')]));
  it('unscanned member (undefined parent) is kept — no info, no prune', () =>
    expect(pruneDescendants([e('el-p:section-0'), e('el-x')], lookup))
      .toEqual([e('el-p:section-0'), e('el-x')]));
});

describe('decideToggle (ledger §1, A12, A14)', () => {
  const base = { primaryKey: 'el-a' as string | null, extraKeys: [] as string[], isLocked: () => false };

  it('nothing selected → select', () => {
    expect(decideToggle({ ...base, primaryKey: null, clickedKey: 'el-b' })).toBe('select');
  });
  it('a joinable element joins', () => {
    expect(decideToggle({ ...base, clickedKey: 'el-b' })).toBe('join');
  });
  it('an extra leaves', () => {
    expect(decideToggle({ ...base, extraKeys: ['el-b'], clickedKey: 'el-b' })).toBe('leave');
  });
  it('the primary while extras exist → drop-primary', () => {
    expect(decideToggle({ ...base, extraKeys: ['el-b'], clickedKey: 'el-a' })).toBe('drop-primary');
  });
  it('the sole selection → deselect', () => {
    expect(decideToggle({ ...base, clickedKey: 'el-a' })).toBe('deselect');
  });
  it('Layout parts and the infra wrapper never join → none', () => {
    expect(decideToggle({ ...base, clickedKey: 'layoutchrome-page-1:header-0' })).toBe('none');
    expect(decideToggle({ ...base, clickedKey: 'src/pages/preview/[projectId]/[pageId].astro:17:29' })).toBe('none');
  });
  it('a locked element never joins → none', () => {
    expect(decideToggle({ ...base, clickedKey: 'el-b', isLocked: k => k === 'el-b' })).toBe('none');
  });
  it('a primary that cannot anchor (Layout / locked) → select the clicked alone', () => {
    expect(decideToggle({ ...base, primaryKey: 'layoutchrome-page-1', clickedKey: 'el-b' })).toBe('select');
    expect(decideToggle({ ...base, clickedKey: 'el-b', isLocked: k => k === 'el-a' })).toBe('select');
  });
});

describe('relinkSameLine (ledger E7)', () => {
  const F = 'src/pages/index.astro';
  const s = (key: string, tagName = 'span') => ({ key, tagName, classes: '', rect: { top: 0, left: 0, width: 1, height: 1 },
    parentKey: null, hasSourceTracking: true }) as ScannedElement;

  it('follows a same-line shift by position among same-tag siblings on that line', () => {
    const prev = [s(`${F}:7:3`, 'p'), s(`${F}:7:6`), s(`${F}:7:36`)];
    const next = [s(`${F}:7:3`, 'p'), s(`${F}:7:6`), s(`${F}:7:48`)];
    expect(relinkSameLine([`${F}:7:6`, `${F}:7:36`], prev, next)).toEqual(new Map([[`${F}:7:36`, `${F}:7:48`]]));
  });
  it('leaves a member alone when the same-tag count on its line changed', () => {
    expect(relinkSameLine([`${F}:7:36`], [s(`${F}:7:6`), s(`${F}:7:36`)], [s(`${F}:7:6`)]).size).toBe(0);
  });
  it('never maps onto a key a live member already holds', () => {
    const prev = [s(`${F}:7:6`), s(`${F}:7:36`)];
    const next = [s(`${F}:7:36`), s(`${F}:7:50`)];
    // ':7:6' vanished; its ordinal-0 target ':7:36' is itself a live member → no rename
    expect(relinkSameLine([`${F}:7:6`, `${F}:7:36`], prev, next).has(`${F}:7:6`)).toBe(false);
  });
  it('ignores non-source keys', () => {
    expect(relinkSameLine(['el-a'], [s('el-a')], []).size).toBe(0);
  });
});
