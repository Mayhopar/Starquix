import { describe, it, expect } from 'vitest';
import { findInsertionTarget } from './smartInsertion';
import type { ScannedElement } from '@/context/SelectionContext';

function makeScanned(overrides: Partial<ScannedElement> & { key: string; rect: ScannedElement['rect'] }): ScannedElement {
  return {
    tagName: 'div',
    classes: '',
    parentKey: null,
    hasSourceTracking: false,
    ...overrides,
  };
}

describe('findInsertionTarget', () => {
  it('returns page root when no containers contain the drawn rect', () => {
    const elements: ScannedElement[] = [
      makeScanned({ key: 'div-1', rect: { top: 0, left: 0, width: 100, height: 100 } }),
    ];
    const result = findInsertionTarget(
      { top: 200, left: 200, width: 50, height: 50 },
      elements
    );
    expect(result.parentKey).toBeNull();
  });

  it('returns deepest containing container', () => {
    const elements: ScannedElement[] = [
      makeScanned({ key: 'outer', tagName: 'section', rect: { top: 0, left: 0, width: 800, height: 600 } }),
      makeScanned({ key: 'inner', tagName: 'div', rect: { top: 100, left: 100, width: 400, height: 300 }, parentKey: 'outer' }),
    ];
    const result = findInsertionTarget(
      { top: 150, left: 150, width: 100, height: 50 },
      elements
    );
    expect(result.parentKey).toBe('inner');
  });

  it('calculates position relative to parent', () => {
    const elements: ScannedElement[] = [
      makeScanned({ key: 'container', tagName: 'div', rect: { top: 100, left: 50, width: 500, height: 400 } }),
    ];
    const result = findInsertionTarget(
      { top: 200, left: 150, width: 100, height: 50 },
      elements
    );
    expect(result.parentKey).toBe('container');
    expect(result.relativeX).toBe(100); // 150 - 50
    expect(result.relativeY).toBe(100); // 200 - 100
  });

  // task-069 A2: the draw-time instance lock. Component/theme instances (el-…)
  // are locked — they can never parent a drawn element. The non-instance
  // ancestor here is a page-source section (file:line:col key) so
  // isComponentInstanceContainerKey returns false for it.
  it('skips instance containers when lockInstances=true → lands on nearest non-instance ancestor', () => {
    const sourceSection = makeScanned({ key: 'src/pages/index.astro:5:1', tagName: 'section', rect: { top: 0, left: 0, width: 500, height: 500 } });
    const instance = makeScanned({ key: 'el-hero', tagName: 'section', rect: { top: 50, left: 50, width: 300, height: 300 }, parentKey: 'src/pages/index.astro:5:1' });
    const result = findInsertionTarget({ top: 100, left: 100, width: 50, height: 50 }, [sourceSection, instance], true);
    expect(result.parentKey).toBe('src/pages/index.astro:5:1'); // NOT 'el-hero'
  });

  it('returns null parent when the only container is an instance and lockInstances=true', () => {
    const instance = makeScanned({ key: 'el-hero', tagName: 'section', rect: { top: 0, left: 0, width: 300, height: 300 } });
    const result = findInsertionTarget({ top: 10, left: 10, width: 50, height: 50 }, [instance], true);
    expect(result.parentKey).toBeNull();
  });

  it('default (lockInstances omitted) keeps current behavior — instance can be the parent', () => {
    const instance = makeScanned({ key: 'el-hero', tagName: 'section', rect: { top: 0, left: 0, width: 300, height: 300 } });
    const result = findInsertionTarget({ top: 10, left: 10, width: 50, height: 50 }, [instance]);
    expect(result.parentKey).toBe('el-hero');
  });

  // ledger F2: a DRAWN container is NOT a locked instance — the lock must still let it parent.
  it('lockInstances=true STILL allows a drawn-container parent', () => {
    const drawnBox = makeScanned({ key: 'drawn-box1', tagName: 'div', rect: { top: 0, left: 0, width: 300, height: 300 } });
    const result = findInsertionTarget({ top: 10, left: 10, width: 50, height: 50 }, [drawnBox], true);
    expect(result.parentKey).toBe('drawn-box1');
  });
});

const el = (over: Partial<ScannedElement>): ScannedElement =>
  ({
    key: '', parentKey: null, tagName: 'div', classes: '',
    rect: { top: 0, left: 0, width: 0, height: 0 },
    ...over,
  } as ScannedElement);

describe('findInsertionTarget — component editor', () => {
  // The infra wrapper #sq-components (isWrapperKey) and a full-bleed component
  // section both contain the draw. The section is WIDER/taller than the wrapper
  // (area inversion) — the wrapper must still NOT win.
  const WRAPPER = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
  const scanned: ScannedElement[] = [
    el({ key: WRAPPER, parentKey: null,    rect: { top: 0,  left: 100, width: 600, height: 800 } }),
    el({ key: 'el-abc:section-0', parentKey: WRAPPER, rect: { top: 0, left: 0, width: 800, height: 900 } }),
  ];

  it('nests a draw inside the section under the section, never the infra wrapper', () => {
    const draw = { top: 100, left: 200, width: 100, height: 100 };
    const result = findInsertionTarget(draw, scanned, /* lockInstances */ false);
    expect(result.parentKey).toBe('el-abc:section-0');
  });

  it('returns null (top-level) for a blank-canvas draw contained only by the wrapper', () => {
    // Draw inside the wrapper but in a region the section does NOT cover
    // (below the short section) — only the wrapper contains it.
    const wrapperOnly = [
      el({ key: WRAPPER, parentKey: null, rect: { top: 0, left: 0, width: 600, height: 2000 } }),
      el({ key: 'el-abc:section-0', parentKey: WRAPPER, rect: { top: 0, left: 0, width: 600, height: 300 } }),
    ];
    const draw = { top: 400, left: 50, width: 100, height: 100 }; // below the section
    const result = findInsertionTarget(draw, wrapperOnly, false);
    expect(result.parentKey).toBeNull();
  });

  it('picks the DOM-deepest container even when its area exceeds its parent (full-bleed child)', () => {
    const nested = [
      el({ key: 'el-abc:section-0', parentKey: null,             rect: { top: 0, left: 100, width: 400, height: 400 } }),
      el({ key: 'el-abc:div-1',     parentKey: 'el-abc:section-0', rect: { top: 0, left: 0,   width: 800, height: 800 } }),
    ];
    const draw = { top: 50, left: 150, width: 50, height: 50 };
    expect(findInsertionTarget(draw, nested, false).parentKey).toBe('el-abc:div-1');
  });

  // task-078 S1: filtering the wrapper changes a real-page top-level draw from
  // parentKey=wrapper to parentKey=null. The instance lock stays orthogonal.
  it('real page: blank-canvas draw over only the wrapper returns null (lock on)', () => {
    const WRAPPER_RP = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
    const scanned = [ el({ key: WRAPPER_RP, parentKey: null, rect: { top: 0, left: 0, width: 600, height: 900 } }) ];
    const draw = { top: 100, left: 100, width: 50, height: 50 };
    expect(findInsertionTarget(draw, scanned, /* lockInstances */ true).parentKey).toBeNull();
  });
});

describe('literal <slot> placeholders never parent a draw (2026-08-26)', () => {
  // Runtime-proven: in the layout master the scanned literal <slot> spans the
  // whole band, so it won the deepest-container pick and the drawn chrome
  // nested INSIDE the slot — unreachable by normal click (the selection walk
  // stops at the slot) and mis-shelved under the slot in Layers. A <slot> is
  // a compile-time placeholder, not a container; a draw over it is a sibling.
  it('a draw over a scanned literal slot resolves to the slot PARENT (or root)', () => {
    const elements: ScannedElement[] = [
      makeScanned({ key: 'el-x:slot-0', tagName: 'slot', rect: { top: 0, left: 0, width: 1024, height: 120 } }),
    ];
    const result = findInsertionTarget(
      { top: 16, left: 16, width: 120, height: 80 },
      elements
    );
    expect(result.parentKey).toBeNull();
  });

  it('a WRAPPED slot container (div[data-sq-slot]) still parents page draws', () => {
    const elements: ScannedElement[] = [
      makeScanned({ key: 'layoutchrome-p:slot-0', tagName: 'div', rect: { top: 0, left: 0, width: 1024, height: 500 } }),
    ];
    const result = findInsertionTarget(
      { top: 16, left: 16, width: 120, height: 80 },
      elements
    );
    expect(result.parentKey).toBe('layoutchrome-p:slot-0');
  });
});
