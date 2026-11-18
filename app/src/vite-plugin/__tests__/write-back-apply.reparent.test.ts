import { describe, it, expect } from 'vitest';
import { applyWriteBackOverrides } from '../write-back-apply';

const FILE = 'src/components/Test.astro';

// Selectors are `tagName-index` (0-based occurrence in document order) — see
// key-to-position.ts mapKeysToPositions.

describe('applyWriteBackOverrides — reparentOverrides', () => {
  it('moves the element in the returned content + reports applied.reparented + changed', async () => {
    const content = [
      '---',
      '---',
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
      '<section class="b">',
      '  <span>existing</span>',
      '</section>',
    ].join('\n');

    // move <p> (p-0) into <section class="b"> (section-0)
    const res = await applyWriteBackOverrides(content, FILE, {
      reparentOverrides: [{ selector: 'p-0', newParentSelector: 'section-0' }],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.applied.reparented).toBe(1);
    expect(res.report.skipped.reparent).toEqual([]);
    expect(res.changed).toBe(true);

    const out = res.content;
    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<p>hello</p>');
    const sectionBlock = out.slice(out.indexOf('<section class="b">'), out.indexOf('</section>'));
    expect(sectionBlock).toContain('<p>hello</p>');
  });

  it('unresolved element selector → skipped+reported, ok stays true, content unchanged for that entry', async () => {
    const content = [
      '---',
      '---',
      '<section class="b">',
      '  <span>x</span>',
      '</section>',
    ].join('\n');

    const res = await applyWriteBackOverrides(content, FILE, {
      // p-0 does not exist
      reparentOverrides: [{ selector: 'p-0', newParentSelector: 'section-0' }],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.applied.reparented).toBe(0);
    expect(res.report.skipped.reparent).toEqual(['p-0']);
    expect(res.changed).toBe(false);
    expect(res.content).toBe(content);
  });

  it('unresolved newParentSelector → skipped+reported, no move', async () => {
    const content = [
      '---',
      '---',
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
    ].join('\n');

    const res = await applyWriteBackOverrides(content, FILE, {
      // section-0 does not exist
      reparentOverrides: [{ selector: 'p-0', newParentSelector: 'section-0' }],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.applied.reparented).toBe(0);
    expect(res.report.skipped.reparent).toEqual(['p-0']);
    expect(res.changed).toBe(false);
    expect(res.content).toBe(content);
  });

  it('newParentSelector=null → element moved to top level (before file last closing tag)', async () => {
    // A trailing top-level <footer> exists, so the file's LAST closing tag is
    // </footer> — the root move appends the <p> there, leaving the <div>.
    const content = [
      '---',
      '---',
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
      '<footer>end</footer>',
    ].join('\n');

    const res = await applyWriteBackOverrides(content, FILE, {
      reparentOverrides: [{ selector: 'p-0', newParentSelector: null }],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.applied.reparented).toBe(1);
    expect(res.report.skipped.reparent).toEqual([]);
    expect(res.changed).toBe(true);

    const out = res.content;
    // <p> no longer inside the div
    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<p>hello</p>');
    // <p> now sits at top level, after </div> and before the last </footer>
    expect(out).toContain('<p>hello</p>');
    expect(out.indexOf('<p>hello</p>')).toBeGreaterThan(out.indexOf('</div>'));
    expect(out.indexOf('<p>hello</p>')).toBeLessThan(out.lastIndexOf('</footer>'));
  });

  it('reparent is applied AFTER orderOverrides: a class override + a reparent in one call both land', async () => {
    const content = [
      '---',
      '---',
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
      '<section class="b">',
      '  <span>existing</span>',
      '</section>',
    ].join('\n');

    const res = await applyWriteBackOverrides(content, FILE, {
      // class on the section (resolves before the move)
      classOverrides: { 'section-0': 'text-red-500' },
      reparentOverrides: [{ selector: 'p-0', newParentSelector: 'section-0' }],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.applied.classes).toBe(1);
    expect(res.report.applied.reparented).toBe(1);
    expect(res.changed).toBe(true);

    const out = res.content;
    // class landed on the section
    expect(out).toMatch(/<section[^>]*class="[^"]*text-red-500[^"]*"/);
    // and the <p> moved into the section
    const sectionBlock = out.slice(out.indexOf('<section'), out.indexOf('</section>'));
    expect(sectionBlock).toContain('<p>hello</p>');
    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<p>hello</p>');
  });

  it('empty/absent reparentOverrides → no-op, applied.reparented === 0', async () => {
    const content = [
      '---',
      '---',
      '<div class="a"><p>hello</p></div>',
    ].join('\n');

    const absent = await applyWriteBackOverrides(content, FILE, {});
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect(absent.report.applied.reparented).toBe(0);
    expect(absent.report.skipped.reparent).toEqual([]);

    const empty = await applyWriteBackOverrides(content, FILE, { reparentOverrides: [] });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.report.applied.reparented).toBe(0);
    expect(empty.changed).toBe(false);
  });
});
