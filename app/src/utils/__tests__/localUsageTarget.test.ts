/**
 * task-148 item 7 — the usage re-target predicate.
 *
 * Ledger (all enumerated states + why there is no picker):
 * ../../../../docs/archive/plans/2026-08-10-task-148-usage-selection-ledger.md
 *
 * Every case here is a case that is REFUSED today, so a `null` return means
 * "behaves exactly as before" and a location means "the gesture now has the
 * target the user meant". The cross-file default-deny is never weakened: this
 * only ever produces a target IN the current surface file.
 */
import { describe, it, expect } from 'vitest';
import { resolveLocalUsageTarget, type UsageTargetNode } from '../localUsageTarget';

const PAGE = 'src/pages/index.astro';
const CARD = 'src/components/Card.astro';
const LAYOUT = 'src/layouts/Base.astro';

/** The fixture's real shape: `<body>` (page) > `<article>` (Card root) > `<h3>`. */
function tree(overrides: Record<string, Partial<UsageTargetNode>> = {}) {
  const base: Record<string, UsageTargetNode> = {
    [`${PAGE}:10:3`]: {
      parentKey: null,
      sourceLocation: { file: PAGE, line: 10, column: 3 },
      // A page file's own elements emit data-sq-usage="" → parses to undefined.
      usageLocation: undefined,
    },
    [`${CARD}:4:1~s4db83f82b016cfb0`]: {
      parentKey: `${PAGE}:10:3`,
      sourceLocation: { file: CARD, line: 4, column: 1 },
      usageLocation: { file: PAGE, line: 21, column: 5 },
    },
    [`${CARD}:5:3~s4db83f82b016cfb0`]: {
      parentKey: `${CARD}:4:1~s4db83f82b016cfb0`,
      sourceLocation: { file: CARD, line: 5, column: 3 },
      usageLocation: { file: PAGE, line: 21, column: 5 },
    },
  };
  for (const [k, v] of Object.entries(overrides)) base[k] = { ...base[k], ...v } as UsageTargetNode;
  return new Map(Object.entries(base));
}

const CARD_ROOT = `${CARD}:4:1~s4db83f82b016cfb0`;
const CARD_INNER = `${CARD}:5:3~s4db83f82b016cfb0`;

describe('resolveLocalUsageTarget', () => {
  it('retargets a component ROOT to its <Card /> tag in the page file', () => {
    // The whole point: the element is in Card.astro (refused today), the tag
    // that placed it is in the page (writable).
    expect(resolveLocalUsageTarget(CARD_ROOT, tree(), PAGE)).toEqual({
      file: PAGE,
      line: 21,
      column: 5,
    });
  });

  it('does NOT retarget an inner element of the component (C-N2)', () => {
    // `<h3>` cannot be "removed from this page only" — it stays refused, which
    // is the behavior that protects Header.astro/Back.astro.
    expect(resolveLocalUsageTarget(CARD_INNER, tree(), PAGE)).toBeNull();
  });

  it('does NOT retarget slot content authored in the page (C-R4)', () => {
    // `<p>Card body</p>` renders INSIDE the card but is the page's own markup:
    // its own file is already writable, so it must keep deleting itself rather
    // than removing the whole card.
    const slotKey = `${PAGE}:22:7~s4db83f82b016cfb0`;
    const map = tree();
    map.set(slotKey, {
      parentKey: CARD_ROOT,
      sourceLocation: { file: PAGE, line: 22, column: 7 },
      usageLocation: { file: PAGE, line: 21, column: 5 },
    });
    expect(resolveLocalUsageTarget(slotKey, map, PAGE)).toBeNull();
  });

  it('does NOT retarget when the usage lives in a LAYOUT (C-N1)', () => {
    // A `<Card />` placed by the layout is cross-file for a page view: removing
    // that tag would take the card off every page using the layout.
    const map = tree({ [CARD_ROOT]: { usageLocation: { file: LAYOUT, line: 9, column: 5 } } });
    expect(resolveLocalUsageTarget(CARD_ROOT, map, PAGE)).toBeNull();
  });

  it('does NOT retarget an untaggable invocation with no usage at all (C-T2)', () => {
    // The REAL "unselectable usage" state — not the {...Astro.props} spread the
    // task text blamed (see the ledger §0; refuted on live served bytes).
    const map = tree({ [CARD_ROOT]: { usageLocation: undefined } });
    expect(resolveLocalUsageTarget(CARD_ROOT, map, PAGE)).toBeNull();
  });

  it('does NOT retarget in the component view — the master stays the target (C-N3)', () => {
    // Surface file IS Card.astro: `<article>` is same-file and already writable.
    expect(resolveLocalUsageTarget(CARD_ROOT, tree(), CARD)).toBeNull();
  });

  it('DOES retarget a nested component root inside the component view (C-N4)', () => {
    // Same rule, no page/component special case: viewing Card.astro, the
    // `<Inner />` tag it contains is Card.astro's own markup.
    const innerRoot = 'src/components/Inner.astro:2:1~sffffffffffffffff';
    const map = tree();
    map.set(innerRoot, {
      parentKey: CARD_ROOT,
      sourceLocation: { file: 'src/components/Inner.astro', line: 2, column: 1 },
      usageLocation: { file: CARD, line: 6, column: 3 },
    });
    expect(resolveLocalUsageTarget(innerRoot, map, CARD)).toEqual({
      file: CARD,
      line: 6,
      column: 3,
    });
  });

  it('returns null with no scan tree, no key, or no surface — inert by default', () => {
    expect(resolveLocalUsageTarget(CARD_ROOT, undefined, PAGE)).toBeNull();
    expect(resolveLocalUsageTarget(null, tree(), PAGE)).toBeNull();
    expect(resolveLocalUsageTarget(CARD_ROOT, tree(), null)).toBeNull();
    expect(resolveLocalUsageTarget('nope:1:1', tree(), PAGE)).toBeNull();
  });

  it('two sibling <Card />s retarget to their OWN tags, never a shared one (C-C3)', () => {
    // task-182's bug is structurally absent: each invocation carries its own
    // compile-time coordinates, so there is no ordinal to slide.
    const secondRoot = `${CARD}:4:1~s1111111111111111`;
    const map = tree();
    map.set(secondRoot, {
      parentKey: `${PAGE}:10:3`,
      sourceLocation: { file: CARD, line: 4, column: 1 },
      usageLocation: { file: PAGE, line: 25, column: 5 },
    });
    expect(resolveLocalUsageTarget(CARD_ROOT, map, PAGE)).toEqual({ file: PAGE, line: 21, column: 5 });
    expect(resolveLocalUsageTarget(secondRoot, map, PAGE)).toEqual({ file: PAGE, line: 25, column: 5 });
  });
});
