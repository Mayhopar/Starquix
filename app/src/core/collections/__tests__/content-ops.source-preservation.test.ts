// preparePostUpdate is the shared source-preservation step of every post
// write (`acceptPreparedPostWrite` in services/durableEdits/featureAcceptance):
// it patches only the changed spans of the CURRENT source and refuses a write
// that would overwrite something changed outside the editor since its baseline.
import { describe, expect, it } from 'vitest';
import { parseFrontmatter, preparePostUpdate } from '../content-ops';
import { applyPreparedPostPatch } from '@/postmodel/frontmatterPatch';

const raw = '---\r\ntitle: Before # keep\r\ntags: ["a, b", "c"]\r\ndescription: |\r\n  first\r\n  second\r\nauthor:\r\n  name: Jo\r\ndate: 2026-09-09\r\n---\r\nOld body.\r\n';

/** The bytes a write against `current` would produce. */
function write(current: string, frontmatter: Record<string, unknown>, body: string, baseline?: ReturnType<typeof parseFrontmatter>): string {
  const { patch, nextBody } = preparePostUpdate(current, frontmatter, body, baseline ? { baseline } : undefined);
  return applyPreparedPostPatch(current, patch, nextBody);
}

describe('preparePostUpdate → source preservation', () => {
  it('body autosave leaves complex CRLF YAML byte-identical', () => {
    const { patch } = preparePostUpdate(raw, parseFrontmatter(raw).frontmatter, 'New body.\r\n');
    expect(patch).toMatchObject({ expectedSource: raw, edits: [] });
    expect(write(raw, parseFrontmatter(raw).frontmatter, 'New body.\r\n')).toBe(raw.replace('Old body.', 'New body.'));
  });
  it('one scalar changes without rewriting comments, dates, flow lists or opaque neighbors', () => {
    const post = parseFrontmatter(raw);
    const saved = write(raw, { ...post.frontmatter, title: 'After' }, post.body);
    expect(saved).toBe(raw.replace('Before', '"After"'));
    expect(parseFrontmatter(saved).frontmatter).toEqual({ ...post.frontmatter, title: 'After' });
  });
  it('refuses a changed multiline property', () => {
    const post = parseFrontmatter(raw);
    expect(() => preparePostUpdate(raw, { ...post.frontmatter, description: 'Lost' }, post.body)).toThrow();
  });
  it('preserves external disjoint properties while checking the editor baseline', () => {
    const post = parseFrontmatter(raw);
    const current = raw.replace('2026-09-09', '2026-09-10');
    expect(write(current, { ...post.frontmatter, title: 'After' }, post.body, post)).toBe(current.replace('Before', '"After"'));
  });
  it('keeps an outside rewrite of the same text over the stale editor copy (newest wins, D3)', () => {
    const post = parseFrontmatter(raw);
    const current = raw.replace('Old body.', 'External body.');
    expect(write(current, post.frontmatter, 'Mine.', post)).toBe(current);
  });
  it('keeps an outside property change over a stale one (newest wins, D5)', () => {
    const post = parseFrontmatter(raw);
    const current = raw.replace('Before', 'External');
    expect(write(current, { ...post.frontmatter, title: 'Mine' }, post.body, post)).toBe(current);
  });
  it('stays strict while an earlier write is unresolved (D6)', () => {
    const post = parseFrontmatter(raw);
    const current = raw.replace('Old body.', 'External body.');
    const unresolvedAttempts = [{ frontmatter: post.frontmatter, body: 'Lost?', canReconcileCandidate: false }];
    expect(() => preparePostUpdate(current, post.frontmatter, 'Mine.', { baseline: post, unresolvedAttempts })).toThrow(/changed/);
  });
  it('an unchanged editor body cannot overwrite an external body during a property save', () => {
    const post = parseFrontmatter(raw);
    const current = raw.replace('Old body.', 'External body.');
    expect(write(current, { ...post.frontmatter, title: 'After' }, post.body, post)).toBe(current.replace('Before', '"After"'));
  });
  it('lands an editor body edit next to an outside body edit on other lines (an agent in the terminal)', () => {
    const prose = '---\ntitle: T\n---\nOne.\n\nTwo.\n\nThree.\n';
    const post = parseFrontmatter(prose);
    const current = prose.replace('Three.', 'Three, by the agent.');
    expect(write(current, post.frontmatter, post.body.replace('One.', 'One, by me.'), post))
      .toBe(current.replace('One.', 'One, by me.'));
  });
});
