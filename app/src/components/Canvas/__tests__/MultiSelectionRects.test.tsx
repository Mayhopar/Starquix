/**
 * Plain outline rects for EVERY member while ≥2 are selected (ledger B1 — the
 * primary's SelectionOverlay handles are suppressed then; a lone primary keeps
 * them and this renders nothing). Outline-only divs positioned from scanned
 * rects with the same math as the neighboring overlays (rect + containerOffset,
 * NO scale multiplication — the canvas parent applies the CSS scale transform).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect } from 'react';
import * as Y from 'yjs';

// The outline colour is read from the doc (selectionVariantForKey) — a bare doc per test.
const h = vi.hoisted(() => ({ doc: null as unknown as import('yjs').Doc }));
vi.mock('@/store/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/store/hooks')>(),
  useEditorDoc: () => h.doc,
  useYjsValue: <T,>(selector: (d: import('yjs').Doc) => T) => selector(h.doc),
}));
beforeEach(() => { h.doc = new Y.Doc(); });
import {
  SelectionProvider,
  useScannedElements,
  useSelectionContext,
} from '@/context/SelectionContext';
import type { MultiSelectionEntry, ScannedElement } from '@/context/SelectionContext';
import { MultiSelectionRects } from '../MultiSelectionRects';

function scanned(key: string, rect: { top: number; left: number; width: number; height: number }): ScannedElement {
  return {
    key,
    tagName: 'section',
    classes: '',
    rect,
    parentKey: null,
    hasSourceTracking: true,
  };
}

/** Seeds scanned elements + primary + extras into the REAL provider. */
function Driver({ elements, extras }: { elements: ScannedElement[]; extras: MultiSelectionEntry[] }) {
  const { setScannedElements } = useScannedElements();
  const { select, addAdditionalSelection } = useSelectionContext();
  useEffect(() => {
    setScannedElements(elements);
    select('el-primary');
    for (const e of extras) addAdditionalSelection(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderRects(elements: ScannedElement[], extras: MultiSelectionEntry[]) {
  return render(
    <SelectionProvider>
      <Driver elements={elements} extras={extras} />
      <MultiSelectionRects containerOffset={{ x: 10, y: 20 }} />
    </SelectionProvider>,
  );
}

const rects = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="multi-select-rect"]')) as HTMLElement[];

describe('MultiSelectionRects', () => {
  it('renders nothing when there are no extras', () => {
    const { container } = renderRects(
      [scanned('el-primary', { top: 0, left: 0, width: 50, height: 50 })],
      [],
    );
    expect(rects(container)).toHaveLength(0);
  });

  it('renders one outline div per member, primary first, positioned from the scanned rect + offset', () => {
    const { container } = renderRects(
      [
        scanned('el-primary', { top: 0, left: 0, width: 50, height: 50 }),
        scanned('el-b', { top: 100, left: 30, width: 200, height: 80 }),
        scanned('el-c', { top: 300, left: 60, width: 120, height: 40 }),
      ],
      [
        { key: 'el-b', elementId: 'el-b' },
        { key: 'el-c', elementId: 'el-c' },
      ],
    );
    // ledger B1: the primary (el-primary) is a plain outline too → 3, not 2.
    const els = rects(container);
    expect(els).toHaveLength(3);
    expect(els[0].style.top).toBe('20px'); // primary: 0 + offset.y 20
    expect(els[0].style.left).toBe('10px');
    expect(els[1].style.top).toBe('120px'); // 100 + offset.y 20
    expect(els[1].style.left).toBe('40px'); // 30 + offset.x 10
    expect(els[1].style.width).toBe('200px');
    expect(els[1].style.height).toBe('80px');
    expect(els[2].style.top).toBe('320px');
    expect(els[2].style.left).toBe('70px');
  });

  it('draws the primary as a plain outline too while extras exist (ledger B1)', () => {
    const { container } = renderRects(
      [scanned('el-primary', { top: 0, left: 0, width: 10, height: 10 }), scanned('el-b', { top: 20, left: 0, width: 10, height: 10 })],
      [{ key: 'el-b', elementId: 'el-b' }],
    );
    expect(container.querySelectorAll('[data-testid="multi-select-rect"]')).toHaveLength(2);
  });

  it('each outline wears its own single-selection colour (owner 2026-11-17: purple, not yellow)', () => {
    const frame = new Y.Map(); frame.set('type', 'frame'); h.doc.getMap('elements').set('el-frame', frame);
    const SRC = 'src/components/Hero.astro:5:3', SLOT = 'src/pages/index.astro:9:1';
    const r = (top: number) => ({ top, left: 0, width: 10, height: 10 });
    const { container } = renderRects(
      [scanned('el-primary', r(0)), scanned(SRC, r(20)), scanned('el-frame', r(40)), { ...scanned(SLOT, r(60)), tagName: 'slot' }],
      [{ key: SRC, elementId: null }, { key: 'el-frame', elementId: 'el-frame' }, { key: SLOT, elementId: null }],
    );
    const cls = rects(container).map(el => el.className);
    expect(cls[1]).toMatch(/border-stroke-component/); // a source element selects purple on its own → purple here
    expect(cls[2]).toMatch(/border-stroke-active/);    // a plain created frame selects yellow → yellow
    expect(cls[3]).toMatch(/border-overlay-component/); // <slot> → the slot colour
  });

  it('skips an extra whose key has no scanned element', () => {
    const { container } = renderRects(
      [
        scanned('el-primary', { top: 0, left: 0, width: 50, height: 50 }),
        scanned('el-b', { top: 100, left: 30, width: 200, height: 80 }),
      ],
      [
        { key: 'el-b', elementId: 'el-b' },
        { key: 'el-gone', elementId: null },
      ],
    );
    // primary + el-b (ledger B1 counts the primary); el-gone has no rect.
    expect(rects(container)).toHaveLength(2);
  });
});
