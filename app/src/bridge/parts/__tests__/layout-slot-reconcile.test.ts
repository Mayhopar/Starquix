/**
 * C4/C5 layout-slot reconciliation (2026-08-26, proven defects):
 *
 * 1. Dup-slot-node class: after inserting content into a page-layout slot the
 *    live DOM held TWO nodes keyed `layoutchrome-…:slot-0` (a stale empty
 *    <slot> + the wrapped container), React spammed dup-key errors from the
 *    Layers scan, and — because `_lastComponentsSig` was committed BEFORE
 *    reconciliation — every later identical RENDER fast-pathed past the
 *    corruption until a full editor reload. `_renderComponents` now sweeps
 *    duplicate data-keys (this render's subtree is canonical) and commits the
 *    signature only after reconciling.
 *
 * 2. C5 teleport: a parentKey-less drawn root was APPENDED into the slot
 *    container, mounting a box drawn at the TOP of the page at the BOTTOM of
 *    the content. Drawn payloads now carry the draw-time `insertIndex` and the
 *    bridge mounts at it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const LID = 'layoutchrome-p1';
const EMPTY_SLOT_CHROME = `<slot class="bg-white" data-key="${LID}:slot-0" data-sq-chrome></slot>`;
const FILLED_CHROME = `<div class="bg-white" data-key="${LID}:slot-0" data-sq-chrome data-sq-slot><section data-key="el-a:section-0">A</section><section data-key="el-b:section-0">B</section></div>`;

describe('layout slot reconciliation', () => {
  let bridge: HarnessBridge;
  beforeEach(() => {
    resetHarnessDom();
    document.body.innerHTML = '<div id="sq-components"></div>';
    bridge = mountBridgeForTest();
  });

  it('rehome never appends a node into itself (self-append guard)', () => {
    document.getElementById('sq-components')!.innerHTML =
      `<div data-key="k1" data-sq-slot></div>`;
    const node = document.querySelector('[data-key="k1"]')!;
    // Would throw HierarchyRequestError without the guard.
    expect(() => (bridge as unknown as {
      _rehomeDrawnRoot: (el: Element, i?: number) => void;
    })._rehomeDrawnRoot(node, 0)).not.toThrow();
    expect(document.querySelector('[data-key="k1"]')).toBe(node);
  });
});
