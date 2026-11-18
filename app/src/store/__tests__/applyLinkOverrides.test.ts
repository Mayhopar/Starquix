// Invariant LI-4 (docs/archive/plans/2026-06-10-weak-system-tests-design.md §4):
// pins the applyLinkOverrides selector grammar — only `a-N` selectors apply;
// everything else is explicitly rejected (knownIssue L-B, design §8 Q2).
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyLinkOverrides } from '../selectors';

function makeOverrides(entries: Record<string, Record<string, string>>) {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>('linkOverrides');
  doc.transact(() => {
    for (const [sel, attrs] of Object.entries(entries)) {
      const m = new Y.Map();
      for (const [k, v] of Object.entries(attrs)) m.set(k, v);
      map.set(sel, m);
    }
  });
  return map;
}

describe('applyLinkOverrides selector grammar', () => {
  const markup = '<div><a href="/old">one</a><a href="/old2">two</a></div>';

  it('applies href/target to the Nth <a> for selector a-N', () => {
    const out = applyLinkOverrides(markup, makeOverrides({ 'a-1': { href: '/new', target: '_blank' } }));
    expect(out).toContain('<a href="/old">one</a>');
    expect(out).toMatch(/<a[^>]*href="\/new"[^>]*>two<\/a>/);
    expect(out).toMatch(/<a[^>]*target="_blank"[^>]*>two<\/a>/);
  });

  it('REJECTS non a-N selectors (accepted behavior — knownIssue L-B, see design §8 Q2)', () => {
    const out = applyLinkOverrides(markup, makeOverrides({ 'span-0': { href: '/new' } }));
    expect(out).toBe(markup); // untouched
  });

  it('returns markup unchanged for empty overrides', () => {
    expect(applyLinkOverrides(markup, undefined)).toBe(markup);
  });

  it('out-of-range index a-5 leaves markup unchanged', () => {
    const out = applyLinkOverrides(markup, makeOverrides({ 'a-5': { href: '/new' } }));
    expect(out).toBe(markup);
  });
});
