/**
 * task-118 — computeSelectorRemap: pure matcher that maps old positional
 * selectors (tag-N) to new ones across a structural markup change, anchored
 * by data-sq-id (primary) with fingerprint fallback (tag+text, tag+class).
 * Ledger: docs/plans/2026-07-17-task-118-structural-safe-overrides-design.md §8.
 */
import { describe, it, expect, vi } from 'vitest';
import { computeSelectorRemap, SQ_ID_ATTR, tokenizeForRemap } from '../selectorRemap';
import { addDataKeysToHtml } from '../constants';

describe('computeSelectorRemap', () => {
  it('identity when structure unchanged (#7)', () => {
    const m = '<section><div>a</div><div>b</div></section>';
    const r = computeSelectorRemap(m, m);
    expect(r.orphaned).toEqual([]);
    expect(r.orphanCandidates).toEqual([]);
    expect(r.identity).toBe(true);
  });

  it('id match survives sibling insert (#1)', () => {
    const oldM = '<section><div data-sq-id="a1">x</div></section>';
    const newM = '<section><div>new</div><div data-sq-id="a1">x</div></section>';
    const r = computeSelectorRemap(oldM, newM);
    expect(r.remap.get('div-0')).toBe('div-1');
    expect(r.orphaned).toEqual([]);
  });

  it('id match survives reorder (#4)', () => {
    const r = computeSelectorRemap(
      '<section><div data-sq-id="a1">x</div><div data-sq-id="b2">y</div></section>',
      '<section><div data-sq-id="b2">y</div><div data-sq-id="a1">x</div></section>'
    );
    expect(r.remap.get('div-0')).toBe('div-1');
    expect(r.remap.get('div-1')).toBe('div-0');
    expect(r.orphaned).toEqual([]);
  });

  it('id match survives retype div→section (#5)', () => {
    const r = computeSelectorRemap(
      '<div><div data-sq-id="a1">x</div></div>',
      '<div><section data-sq-id="a1">x</section></div>'
    );
    expect(r.remap.get('div-1')).toBe('section-0');
  });

  it('deleted id → orphan (#2)', () => {
    const r = computeSelectorRemap(
      '<section><div data-sq-id="a1">x</div></section>',
      '<section></section>'
    );
    expect(r.orphaned).toHaveLength(1);
    expect(r.orphaned[0]).toMatchObject({ selector: 'div-0', sqId: 'a1' });
    expect(r.orphanCandidates).toContain('div-0');
  });

  it('delete sibling before overridden el shifts index down (#3)', () => {
    const r = computeSelectorRemap(
      '<section><div>gone</div><div data-sq-id="a1">x</div></section>',
      '<section><div data-sq-id="a1">x</div></section>'
    );
    expect(r.remap.get('div-1')).toBe('div-0');
  });

  it('fingerprint fallback: unique tag+text with shifted index (#10/#11)', () => {
    const r = computeSelectorRemap(
      '<div><p>hello world</p></div>',
      '<div><p>pad</p><p>hello world</p></div>'
    );
    expect(r.remap.get('p-0')).toBe('p-1');
    expect(r.orphaned).toEqual([]);
  });

  it('id-less + text changed → tag+class fallback (#13)', () => {
    const r = computeSelectorRemap(
      '<div><p class="lead">old text</p></div>',
      '<div><span>pad</span><p class="lead">new text</p></div>'
    );
    expect(r.remap.get('p-0')).toBe('p-0');
  });

  it('ambiguous fingerprint → orphan candidate, never guess (#12)', () => {
    const r = computeSelectorRemap(
      '<ul><li>item</li></ul>',
      '<ul><li>item</li><li>item</li></ul>'
    );
    expect([...r.remap.entries()].filter(([o, n]) => o !== n)).toEqual([]);
    expect(r.orphanCandidates).toContain('li-0');
  });

  it('duplicate id in new markup: first wins, rest id-less (#9)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = computeSelectorRemap(
      '<div><span data-sq-id="a1">x</span></div>',
      '<div><span data-sq-id="a1">x</span><span data-sq-id="a1">x</span></div>'
    );
    expect(r.remap.get('span-0')).toBe('span-0');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('grafts surviving ids into new markup (#22)', () => {
    const r = computeSelectorRemap(
      '<section><p data-sq-id="a1">hello</p></section>',
      '<section><div>pad</div><p>hello</p></section>' // external edit shed the id
    );
    expect(r.remap.get('p-0')).toBe('p-0');
    expect(r.graftedMarkup).toContain(`${SQ_ID_ATTR}="a1"`);
    // graft lands on the matched <p>, not the new <div>
    expect(r.graftedMarkup).toMatch(/<p data-sq-id="a1">hello/);
  });

  it('graft does not duplicate an id already present', () => {
    const m = '<section><p data-sq-id="a1">hello</p></section>';
    const r = computeSelectorRemap(m, m);
    expect(r.graftedMarkup.match(/data-sq-id/g)).toHaveLength(1);
    expect(r.identity).toBe(true);
  });

  it('counting parity with addDataKeysToHtml incl. SKIP_TAGS (task-098 fixture)', () => {
    const m = '<section><script>x</script><svg><path/></svg><div>a</div></section>';
    const keyed = addDataKeysToHtml(m, (s) => s);
    // div must be div-0 in BOTH: script/path neither keyed nor counted.
    // Root <svg> IS keyed/counted since 2026-07-24 (svg layers) — per-tag
    // counters mean it never shifts div/section numbering.
    expect(keyed).toContain('data-key="div-0"');
    expect(keyed).toContain('data-key="svg-0"');
    const r = computeSelectorRemap(m, m);
    expect(r.remap.has('div-0') || r.identity).toBe(true);
    const tokens = tokenizeForRemap(m);
    expect(tokens.map((t) => t.selector)).toEqual(['section-0', 'svg-0', 'div-0']);
  });

  it('tokenizer selector parity with addDataKeysToHtml on a mixed fixture', () => {
    const m = '<header class="top"><h1>Title</h1><sq-child data-sq-component-src="X"></sq-child><div><img src="a.png" /></div></header>';
    const fromKeys: string[] = [];
    addDataKeysToHtml(m, (s) => { fromKeys.push(s); return s; });
    expect(tokenizeForRemap(m).map((t) => t.selector)).toEqual(fromKeys);
  });

  it('malformed id treated as absent (#28)', () => {
    const r = computeSelectorRemap(
      '<div><p data-sq-id="<bad>">x</p></div>',
      '<div><p data-sq-id="<bad>">x</p></div>'
    );
    expect(r.identity).toBe(true); // falls to fingerprint, still matches
  });

  it('unmatched entries carry fingerprints for orphan records', () => {
    const r = computeSelectorRemap(
      '<section><p class="lead">Welcome to the site</p></section>',
      '<section></section>'
    );
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0]).toMatchObject({
      selector: 'p-0',
      fingerprint: { tag: 'p', text: 'Welcome to the site', className: 'lead' },
    });
  });

  it('text fingerprint capped at 80 chars', () => {
    const long = 'x'.repeat(200);
    const tokens = tokenizeForRemap(`<p>${long}</p>`);
    expect(tokens[0].fingerprint.text).toHaveLength(80);
  });
});
