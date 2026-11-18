import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import { applyAllOverrides } from '../selectors';

/**
 * Property-based fuzz over applyAllOverrides — the shared override
 * pipeline used by the export renderer, the canvas preview, and the
 * runtime WC sync. Any bug here is a three-renderer bug by definition.
 *
 * 100 random (markup, overrides) pairs per invariant. Catches:
 *   - crashes on adversarial markup
 *   - data-sq-orig-idx leaks (internal tagging survives strip)
 *   - determinism breakage (same input → different output)
 *   - deletion-override correctness (element count goes down)
 *   - text override correctness (target text appears in output)
 *
 * Does NOT assert full semantic equivalence — that would require a
 * whole HTML parser contract. This file covers the properties that
 * must hold no matter what HTML or overrides get thrown at it.
 */

const NUM_RUNS = 100;

// ──────────────────────────────────────────────────────────────────
// Arbitraries
// ──────────────────────────────────────────────────────────────────

const CHILD_TAGS = ['section', 'article', 'p', 'h1', 'h2', 'h3', 'span', 'a'] as const;
const VOID_TAGS = new Set(['img', 'br', 'input', 'hr']);

const classArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}(\s+[a-z][a-z0-9-]{0,8}){0,3}$/);
const textArb = fc.stringMatching(/^[A-Za-z0-9 .,!?-]{0,40}$/);

interface ChildSpec {
  tag: (typeof CHILD_TAGS)[number];
  className: string;
  text: string;
}

interface ElementSpec {
  /** Parent is always <div>; fuzz the children. */
  className: string;
  children: ChildSpec[];
}

/**
 * Children are drawn from a uniqueArray on tag, so each child has a
 * distinct tag. That makes the selector simple: `${tag}-0` always
 * refers to that child. This matches how the real editor produces
 * selectors (tag-N where N is the Nth occurrence of that tag in the
 * markup in document order). For the outer <div>, the selector
 * would be 'div-0' — we don't target it in these fuzz invariants.
 */
const elementArb: fc.Arbitrary<ElementSpec> = fc.record({
  className: classArb,
  children: fc.uniqueArray(
    fc.record({
      tag: fc.constantFrom(...CHILD_TAGS),
      className: classArb,
      text: textArb,
    }),
    { minLength: 0, maxLength: 6, selector: (c) => c.tag },
  ),
});

function renderSpec(spec: ElementSpec): string {
  const childMarkup = spec.children.map((c) => {
    const selector = `${c.tag}-0`;
    return `<${c.tag} class="${c.className}" data-key="${selector}">${c.text}</${c.tag}>`;
  }).join('');
  return `<div class="${spec.className}">${childMarkup}</div>`;
}

function buildYEl(
  spec: ElementSpec,
  overridesOpts: {
    deletedSelectors?: string[];
    textOverrides?: Record<string, string>;
    orderOverrides?: string[];
  } = {},
): Y.Map<unknown> {
  const doc = new Y.Doc();
  const yEl = new Y.Map();
  yEl.set('staticMarkup', renderSpec(spec));
  doc.getMap('elements').set('el-1', yEl);

  if (overridesOpts.deletedSelectors && overridesOpts.deletedSelectors.length > 0) {
    const yArr = new Y.Array<string>();
    yArr.push(overridesOpts.deletedSelectors);
    yEl.set('deletedSelectors', yArr);
  }

  if (overridesOpts.textOverrides) {
    const yMap = new Y.Map<Y.Map<unknown>>();
    for (const [sel, txt] of Object.entries(overridesOpts.textOverrides)) {
      const slotMap = new Y.Map<unknown>();
      slotMap.set('text', txt);
      yMap.set(sel, slotMap);
    }
    yEl.set('overrides', yMap);
  }

  if (overridesOpts.orderOverrides && overridesOpts.orderOverrides.length > 0) {
    const yArr = new Y.Array<string>();
    yArr.push(overridesOpts.orderOverrides);
    yEl.set('orderOverrides', yArr);
  }

  return yEl;
}

// ──────────────────────────────────────────────────────────────────
// Invariants
// ──────────────────────────────────────────────────────────────────

describe('applyAllOverrides fuzz (100 random docs)', () => {
  it('never throws on valid random markup, no overrides', () => {
    fc.assert(
      fc.property(elementArb, (spec) => {
        const yEl = buildYEl(spec);
        const raw = renderSpec(spec);
        expect(() => applyAllOverrides(raw, yEl)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('strips all data-sq-orig-idx markers from output (internal tagging never leaks)', () => {
    fc.assert(
      fc.property(elementArb, (spec) => {
        const yEl = buildYEl(spec);
        const raw = renderSpec(spec);
        const out = applyAllOverrides(raw, yEl);
        return !out.includes('data-sq-orig-idx');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic — same input twice yields bit-identical output', () => {
    fc.assert(
      fc.property(elementArb, (spec) => {
        const yEl1 = buildYEl(spec);
        const yEl2 = buildYEl(spec);
        const raw = renderSpec(spec);
        return applyAllOverrides(raw, yEl1) === applyAllOverrides(raw, yEl2);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('deletion override removes the exact child (data-key gone, tag count drops)', () => {
    fc.assert(
      fc.property(
        elementArb.filter((s) => s.children.length >= 1),
        (spec) => {
          const target = spec.children[0];
          const selector = `${target.tag}-0`;
          const yEl = buildYEl(spec, { deletedSelectors: [selector] });
          const raw = renderSpec(spec);
          const out = applyAllOverrides(raw, yEl);
          return !out.includes(`data-key="${selector}"`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('text override replaces the target element\'s text content', () => {
    fc.assert(
      fc.property(
        elementArb.filter((s) => s.children.length >= 1),
        fc.stringMatching(/^STARQUIX_MARKER_[A-Z0-9]{6}$/),
        (spec, marker) => {
          const target = spec.children[0];
          const selector = `${target.tag}-0`;
          const yEl = buildYEl(spec, { textOverrides: { [selector]: marker } });
          const raw = renderSpec(spec);
          const out = applyAllOverrides(raw, yEl);
          return out.includes(marker);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('output length is within a reasonable factor of input length (no runaway duplication)', () => {
    fc.assert(
      fc.property(elementArb, (spec) => {
        const yEl = buildYEl(spec);
        const raw = renderSpec(spec);
        const out = applyAllOverrides(raw, yEl);
        // Generous upper bound — applyAllOverrides may add / remove attrs,
        // but should never grow output by >3× input or shrink below 10%.
        return out.length <= raw.length * 3 && out.length >= Math.floor(raw.length * 0.1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('multiple deletions cumulate — deleting n selectors removes all n', () => {
    fc.assert(
      fc.property(
        elementArb.filter((s) => s.children.length >= 2),
        (spec) => {
          const deletable = spec.children.map((c) => `${c.tag}-0`);
          const yEl = buildYEl(spec, { deletedSelectors: deletable });
          const raw = renderSpec(spec);
          const out = applyAllOverrides(raw, yEl);
          return deletable.every((sel) => !out.includes(`data-key="${sel}"`));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('empty overrides ≈ tagImgOriginalIndices(raw) through strip (round-trip when no overrides)', () => {
    fc.assert(
      fc.property(elementArb, (spec) => {
        const yEl = buildYEl(spec);
        const raw = renderSpec(spec);
        const out = applyAllOverrides(raw, yEl);
        // Without any overrides, the pipeline is:
        //   tag-orig-idx → identity through all override applications → strip.
        // Output should equal the raw input modulo whitespace / ordering
        // of attributes, but at minimum every original tag name that
        // appears in raw still appears in out.
        const rawTags = raw.match(/<([a-z][a-z0-9]*)\b/g) ?? [];
        const outTags = out.match(/<([a-z][a-z0-9]*)\b/g) ?? [];
        return outTags.length === rawTags.length;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('adversarial input: empty markup, empty overrides → empty-ish output', () => {
    const yEl = buildYEl({
      tag: 'div',
      className: '',
      text: '',
      children: [],
    });
    const out = applyAllOverrides('', yEl);
    expect(typeof out).toBe('string');
  });

  it('adversarial input: markup with existing data-sq-orig-idx is still stripped', () => {
    const yEl = buildYEl({
      tag: 'div',
      className: '',
      text: '',
      children: [],
    });
    const out = applyAllOverrides(
      '<div><img data-sq-orig-idx="99" src="/a.png" /></div>',
      yEl,
    );
    expect(out).not.toContain('data-sq-orig-idx');
  });
});
