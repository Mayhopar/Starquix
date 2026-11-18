import { describe, it, expect } from 'vitest';
// NOTE: parseFrontmatter/serializeFrontmatter are currently private.
// Part of this task is exporting them. If we prefer to keep them private,
// test through a thin re-export in a test-only entry — but exporting is simpler.
import { parseFrontmatter, serializeFrontmatter } from '../content-ops';

describe('parseFrontmatter', () => {
  it('parses flow-sequence arrays', () => {
    const raw = '---\ntags: [astro, ui, beta]\n---\nhello';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.tags).toEqual(['astro', 'ui', 'beta']);
    expect(body).toBe('hello');
  });

  it('parses empty flow-sequence arrays', () => {
    const raw = '---\ntags: []\n---\n';
    expect(parseFrontmatter(raw).frontmatter.tags).toEqual([]);
  });

  it('strips quotes from array items', () => {
    const raw = '---\ntags: ["a", "b c"]\n---\n';
    expect(parseFrontmatter(raw).frontmatter.tags).toEqual(['a', 'b c']);
  });

  it('keeps existing scalar behaviour', () => {
    const raw = '---\ntitle: "Hello"\ndraft: true\n---\nbody';
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe('Hello');
    expect(frontmatter.draft).toBe(true);
  });
});

describe('serializeFrontmatter', () => {
  it('emits arrays as flow sequences with quoted strings', () => {
    const out = serializeFrontmatter({ tags: ['a', 'b c'] }, 'body');
    expect(out).toContain('tags: ["a", "b c"]');
    expect(out.endsWith('\n---\nbody')).toBe(true);
  });

  it('emits empty arrays as []', () => {
    const out = serializeFrontmatter({ tags: [] }, '');
    expect(out).toContain('tags: []');
  });

  it('round-trips', () => {
    const input = { title: 'T', tags: ['x', 'y'], draft: false };
    const { frontmatter } = parseFrontmatter(serializeFrontmatter(input, ''));
    expect(frontmatter).toEqual(input);
  });
});

// Post-editor-v2 Task 11: Enter in the subtitle used to write a literal
// newline into a double-quoted YAML scalar, breaking the frontmatter (the
// continuation line has no colon and the quote never closes).
import { serializeFrontmatter as sfm, parseFrontmatter as pfm } from '../content-ops';

describe('frontmatter round-trip with hostile strings', () => {
  it('a multi-line description survives serialize→parse', () => {
    const out = sfm({ title: 'T', description: 'line one\nline two' }, 'Body.');
    const back = pfm(out);
    expect(back.frontmatter.description).toBe('line one\nline two');
    expect(back.body).toBe('Body.');
  });

  it('embedded double quotes survive', () => {
    const out = sfm({ title: 'He said "hi"' }, 'Body.');
    expect(pfm(out).frontmatter.title).toBe('He said "hi"');
  });
});

// Imported-adoption Task 2.2: real YAML for DISPLAY. Arbitrary imported
// frontmatter (nested maps, block scalars, block lists) must parse correctly;
// non-scalar values surface as an explicit raw marker — read-only, never
// mangled into "[object Object]" — and survive re-serialization verbatim
// (semantically) instead of being destroyed.
import { isRawFrontmatterValue } from '../content-ops';

describe('parseFrontmatter — real YAML (imported content)', () => {
  it('block scalar | parses to a multi-line string', () => {
    const raw = '---\ndescription: |\n  line one\n  line two\n---\nbody';
    const { frontmatter, body } = pfm(raw);
    expect(frontmatter.description).toBe('line one\nline two\n');
    expect(body).toBe('body');
  });

  it('block-sequence lists parse to arrays', () => {
    const raw = '---\ntags:\n  - astro\n  - ui\n---\n';
    expect(pfm(raw).frontmatter.tags).toEqual(['astro', 'ui']);
  });

  it('nested maps surface as a raw marker, not a mangled scalar', () => {
    const raw = '---\nauthor:\n  name: Jo\n  url: https://jo.dev\n---\n';
    const v = pfm(raw).frontmatter.author;
    expect(isRawFrontmatterValue(v)).toBe(true);
    expect((v as { raw: string }).raw).toContain('name: Jo');
  });

  it('arrays containing non-scalars surface as a raw marker', () => {
    const raw = '---\nimages:\n  - src: /a.png\n    alt: A\n---\n';
    expect(isRawFrontmatterValue(pfm(raw).frontmatter.images)).toBe(true);
  });

  it('date-like values stay STRINGS (never Date objects — gap 18 inference relies on it)', () => {
    const raw = '---\ndate: 2026-08-10\n---\n';
    expect(typeof pfm(raw).frontmatter.date).toBe('string');
  });

  it('malformed YAML falls back to the legacy line parser (WC-tier posts keep working)', () => {
    const raw = '---\ntitle: "Hello"\nbad: [unclosed\n---\nbody';
    const { frontmatter, body } = pfm(raw);
    expect(frontmatter.title).toBe('Hello');
    expect(body).toBe('body');
  });

  it('a raw marker round-trips through serializeFrontmatter without mangling', () => {
    const raw = '---\nauthor:\n  name: Jo\n---\n';
    const { frontmatter } = pfm(raw);
    const out = sfm(frontmatter, 'B');
    const back = pfm(out);
    expect(isRawFrontmatterValue(back.frontmatter.author)).toBe(true);
    expect((back.frontmatter.author as { raw: string }).raw).toContain('name: Jo');
    expect(out).not.toContain('[object Object]');
  });
});
