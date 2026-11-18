import { describe, expect, it } from 'vitest';
import { prepareFrontmatterPatch, applyPreparedPostPatch } from '../frontmatterPatch';
const patch = (raw: string, changes: Record<string, unknown>) => applyPreparedPostPatch(raw, prepareFrontmatterPatch(raw, changes));
describe('bounded YAML source edits', () => {
  it.each([
    ['false', 'false', '"false"'], ['12', '0012', '"0012"'],
    ['true', false, 'false'], ['12', 13, '13'], ['null', 'null', '"null"'],
    ['["a, b", c]', ['x,y', false, 2], '["x,y",false,2]'],
    ['2026-09-09', '2026-09-10', '2026-09-10'],
    ['"2026-09-09"', '2026-09-10', '"2026-09-10"'],
    ["'old # value'", 'new # value', '"new # value"'],
  ])('preserves scalar and date types from %s', (value, next, expected) => {
    const raw = `---\r\nfield: ${value} # keep\r\n---\r\nBody`;
    expect(patch(raw, { field: next })).toBe(raw.replace(`field: ${value}`, `field: ${expected}`));
  });
  it.each(['|\n  line', '>\n  line', '\n  nested: x', '\n  - a', '&id value', '*id', '!!str value'])('refuses changed nonlocal syntax %s', value => {
    expect(() => patch(`---\nother: &id value\nfield: ${value}\n---\nBody`, { field: 'new' })).toThrow();
  });
  it('keeps unrelated block values and aliases intact', () => {
    const raw = '---\ntitle: Old # keep\nblock: |\n  text\nother: &id [a, b]\nalias: *id\n---\nBody';
    expect(patch(raw, { title: 'New' })).toBe(raw.replace('Old', '"New"'));
  });
  it('refuses an anchor target whose change would mutate another property', () => {
    expect(() => patch('---\ntitle: &id Old\nalias: *id\n---\n', { title: 'New' })).toThrow();
  });
  it.each(['title: A\ntitle: B', 'title: [broken', '? [a,b]\n: value'])('refuses ambiguous or malformed edited source', yaml => {
    expect(() => patch(`---\n${yaml}\n---\n`, { title: 'New' })).toThrow();
  });
  it('empty patches keep unsupported and malformed YAML bytes', () => {
    const raw = '---\r\nfield: !custom [broken\r\n---\r\nBody';
    expect(patch(raw, {})).toBe(raw);
  });
  it.each(['Body', '---\n---\nBody', '\uFEFF---\r\n---\r\nBody'])('adds a field to empty frontmatter', raw => {
    expect(patch(raw, { title: 'New' })).toContain('title: "New"');
    expect(patch(raw, { title: 'New' })).toMatch(/---\r?\nBody$/);
  });
});

it.each(["don't", "he said 'hello", 'a "quote'])('keeps inline comments after plain scalar quotes: %s', value => {
  const raw = `---\ntitle: ${value} # keep\n---\nBody`;
  expect(patch(raw, { title: 'New' })).toBe(raw.replace(`title: ${value}`, 'title: "New"'));
});
