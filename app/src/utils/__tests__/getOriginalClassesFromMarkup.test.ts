import { describe, it, expect } from 'vitest';
import {
  getOriginalClassesFromMarkup,
  findElementBySelectorInMarkup,
} from '../markupQuery';

/**
 * Regression coverage for getOriginalClassesFromMarkup (task-015).
 *
 * The previous implementation lived inline in ClassStoreContext and used a
 * pair of regexes to grab `class="..."` near a matching `data-key`. That
 * approach is documented as fragile in systems.json / classes.knownIssues:
 * escaped quotes, multi-line attributes, missing class attribute, and reverse
 * attribute ordering all caused silent misses or wrong matches.
 *
 * Tests below exercise both the previously-failing edge cases AND the existing
 * call-site contract (selector format `tag-index`, returns '' on miss, drops
 * SKIP_TAGS so numbering stays in sync with addDataKeysToHtml).
 */
describe('getOriginalClassesFromMarkup', () => {
  it('returns the class attribute for a stamped element', () => {
    const markup = `<div data-key="el-abc:div-0" class="bg-white p-4"><span data-key="el-abc:span-0" class="text-sm">x</span></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('bg-white p-4');
    expect(getOriginalClassesFromMarkup(markup, 'span-0')).toBe('text-sm');
  });

  it('finds elements without any data-key (legacy markup)', () => {
    const markup = `<section class="hero"><h1 class="title">Hi</h1></section>`;
    expect(getOriginalClassesFromMarkup(markup, 'section-0')).toBe('hero');
    expect(getOriginalClassesFromMarkup(markup, 'h1-0')).toBe('title');
  });

  it('returns empty string when the element has no class attribute', () => {
    const markup = `<div data-key="el-abc:div-0"><p data-key="el-abc:p-0" class="lead">x</p></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, 'p-0')).toBe('lead');
  });

  it('returns empty string when the selector cannot be resolved', () => {
    const markup = `<div class="a"></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'span-0')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, 'div-7')).toBe('');
  });

  it('returns empty string for malformed selectors', () => {
    const markup = `<div class="a"></div>`;
    expect(getOriginalClassesFromMarkup(markup, '')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, 'div')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, 'div-')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, '-0')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, 'div-abc')).toBe('');
  });

  it('handles multi-line class attributes the regex used to miss', () => {
    // Real-world Tailwind class lists frequently get formatted across multiple
    // lines by Prettier. The old regex used `[^"']*?` which still works in
    // single-line mode but stopped matching as soon as helper attrs intervened.
    const markup = [
      `<button data-key="el-abc:button-0" data-x="1"`,
      `        class="px-4`,
      `               py-2`,
      `               bg-blue-500"`,
      `        type="button">Go</button>`,
    ].join('\n');
    const classes = getOriginalClassesFromMarkup(markup, 'button-0');
    expect(classes.split(/\s+/).filter(Boolean)).toEqual([
      'px-4',
      'py-2',
      'bg-blue-500',
    ]);
  });

  it('handles single-quoted class attributes', () => {
    const markup = `<div data-key='el-abc:div-0' class='bg-red-500'></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('bg-red-500');
  });

  it('handles attributes that appear before data-key', () => {
    // Reverse attribute ordering: class first, then data-key. The original
    // regex needed a second alternation branch to catch this; the parser
    // is order-agnostic.
    const markup = `<div class="bg-green-200" data-key="el-abc:div-0"></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('bg-green-200');
  });

  it('handles HTML entity-encoded characters in class strings', () => {
    // Browsers decode entities when reading attribute values via getAttribute.
    // The previous regex returned the raw string with entities still encoded,
    // which downstream consumers then mishandled.
    const markup = `<div class="text-[&quot;quoted&quot;]"></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('text-["quoted"]');
  });

  it('returns the Nth element (document order) for repeated tags', () => {
    const markup = `
      <section><div class="a">1</div><div class="b">2</div></section>
      <div class="c">3</div>
    `;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('a');
    expect(getOriginalClassesFromMarkup(markup, 'div-1')).toBe('b');
    expect(getOriginalClassesFromMarkup(markup, 'div-2')).toBe('c');
  });

  it('reads class from a void/self-closing element', () => {
    const markup = `<picture><img src="x.png" class="w-full" /></picture>`;
    expect(getOriginalClassesFromMarkup(markup, 'img-0')).toBe('w-full');
  });

  it('skips SKIP_TAGS so selector numbering matches addDataKeysToHtml', () => {
    // SKIP_TAGS includes svg, path, etc. addDataKeysToHtml does not key those,
    // so a selector like `path-0` is never produced and must not resolve.
    const markup = `<svg><path d="M0 0" class="ignored" /></svg>`;
    expect(getOriginalClassesFromMarkup(markup, 'path-0')).toBe('');
    expect(getOriginalClassesFromMarkup(markup, 'svg-0')).toBe('');
  });

  it('treats an absent class attribute as empty string, not null', () => {
    // Callers (mergeClasses, SYNC_CLASSES_TO_IFRAME) assume a string. The
    // previous regex implementation returned '' on miss; we preserve that
    // contract instead of leaking null/undefined.
    const markup = `<div data-key="el-abc:div-0"></div>`;
    const result = getOriginalClassesFromMarkup(markup, 'div-0');
    expect(typeof result).toBe('string');
    expect(result).toBe('');
  });

  it('uses the first matching tag in document order even with nested tags', () => {
    // Nested same-tag elements: <div><div>...</div></div>. The regex would
    // greedily match the wrong attribute boundary in some orderings.
    const markup = `<div class="outer"><div class="inner"></div></div>`;
    expect(getOriginalClassesFromMarkup(markup, 'div-0')).toBe('outer');
    expect(getOriginalClassesFromMarkup(markup, 'div-1')).toBe('inner');
  });

  it('aligns with findElementBySelectorInMarkup for non-skipped tags', () => {
    // Sanity check that the two helpers agree on element identity when the
    // selector targets a tag that addDataKeysToHtml would also key.
    const markup = `<header><h1 class="t1">a</h1><h1 class="t2">b</h1></header>`;
    const el = findElementBySelectorInMarkup(markup, 'h1-1');
    expect(el?.getAttribute('class')).toBe('t2');
    expect(getOriginalClassesFromMarkup(markup, 'h1-1')).toBe('t2');
  });
});
