/**
 * task-149 STEP 5 — the DOM-level leak, which correct doc keys alone do NOT fix.
 *
 * `handleUpdateClasses` optimistically repaints every element that shares the
 * payload's `sourceLocation`, so component instances update together without
 * waiting for a rescan. Under placement identity that broadcast is exactly the
 * leak the feature exists to kill: styling one `<Card/>` visibly restyles the
 * other `<Card/>` on the same page, no matter how well the doc keys are scoped.
 *
 * The broadcast is narrowed to the payload key's placement — and ONLY when the
 * payload key names one, so WC/server (whose keys never carry `~p…`) keep the
 * old whole-source-key broadcast byte for byte.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const CARD_A = 'p4317f4b4863ead18';
const CARD_B = 'pfcdbacdb0850b321';
const SRC = 'src/components/Card.astro:4:1';
const LOC = { file: 'src/components/Card.astro', line: 4, column: 1 };

function twoPlacements(): void {
  document.body.innerHTML =
    `<section class="card" data-sq-source="${SRC}" data-sq-placement="${CARD_A}"` +
    ` data-key="${SRC}~${CARD_A}">a</section>` +
    `<section class="card" data-sq-source="${SRC}" data-sq-placement="${CARD_B}"` +
    ` data-key="${SRC}~${CARD_B}">b</section>`;
}

const sections = () =>
  Array.from(document.querySelectorAll('section')).map((s) => s.getAttribute('class'));

describe('UPDATE_CLASSES broadcast is placement-scoped', () => {
  let bridge: HarnessBridge;
  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    (bridge as unknown as { resolveAssetRefs: (c: string) => string }).resolveAssetRefs = (c) => c;
    bridge.scanThen = vi.fn();
  });

  it('an edit on placement A does NOT repaint placement B', () => {
    twoPlacements();

    bridge.handleUpdateClasses({
      key: `${SRC}~${CARD_A}`,
      classes: 'card bg-red-500',
      sourceLocation: LOC,
    });

    expect(sections()).toEqual(['card bg-red-500', 'card']);
  });

  it('an edit on placement B does NOT repaint placement A', () => {
    twoPlacements();

    bridge.handleUpdateClasses({
      key: `${SRC}~${CARD_B}`,
      classes: 'card bg-blue-500',
      sourceLocation: LOC,
    });

    expect(sections()).toEqual(['card', 'card bg-blue-500']);
  });

  it('a placement-scoped key with a #N repeat suffix still scopes correctly', () => {
    // A .map() loop: one placement, several renders.
    document.body.innerHTML =
      `<li class="row" data-sq-source="${SRC}" data-sq-placement="${CARD_A}" data-key="${SRC}~${CARD_A}">a</li>` +
      `<li class="row" data-sq-source="${SRC}" data-sq-placement="${CARD_A}" data-key="${SRC}~${CARD_A}#1">b</li>` +
      `<li class="row" data-sq-source="${SRC}" data-sq-placement="${CARD_B}" data-key="${SRC}~${CARD_B}">c</li>`;

    bridge.handleUpdateClasses({
      key: `${SRC}~${CARD_A}#1`,
      classes: 'row font-bold',
      sourceLocation: LOC,
    });

    // Both renders of placement A follow the edit (that is the existing
    // instance-broadcast contract); placement B is untouched.
    expect(Array.from(document.querySelectorAll('li')).map((l) => l.getAttribute('class'))).toEqual([
      'row font-bold',
      'row font-bold',
      'row',
    ]);
  });

  it('a key with NO placement keeps the old whole-source-key broadcast', () => {
    // WC / server mode: keys are bare, and the broadcast is what makes every
    // instance of a component follow a master edit.
    document.body.innerHTML =
      `<section class="card" data-sq-source="${SRC}" data-key="${SRC}">a</section>` +
      `<section class="card" data-sq-source="${SRC}" data-key="${SRC}#1">b</section>`;

    bridge.handleUpdateClasses({ key: SRC, classes: 'card p-4', sourceLocation: LOC });

    expect(sections()).toEqual(['card p-4', 'card p-4']);
  });
});
