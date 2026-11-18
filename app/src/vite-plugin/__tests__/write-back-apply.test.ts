import { describe, it, expect } from 'vitest';
import { applyWriteBackOverrides } from '../write-back-apply';

const SRC = `---
const x = 1;
---
<section class="p-4">
  <h1 class="text-xl">Title</h1>
  <p>Body</p>
  <img src="/a.png" alt="a" />
  <a href="/old">Link</a>
</section>
`;
const FILE = '/fake/Comp.astro';

describe('applyWriteBackOverrides — report contract', () => {
  it('counts applied classes and mutates content for a resolvable selector', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { classOverrides: { 'h1-0': 'font-bold' } });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.applied.classes).toBe(1);
    expect(r.report.skipped.classes).toEqual([]);
    expect(r.content).toContain('font-bold');
    expect(r.changed).toBe(true);
  });

  it('lists an unresolvable class selector in skipped and leaves content untouched', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { classOverrides: { 'h1-5': 'font-bold' } });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.applied.classes).toBe(0);
    expect(r.report.skipped.classes).toEqual(['h1-5']);
    expect(r.content).toBe(SRC);
    expect(r.changed).toBe(false);
  });

  // TODAY'S ZERO-SIGNAL PATHS — these silently skip with no warn at all
  it('records skipped image selectors (today: silent skip)', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { imageOverrides: { 'img-9': { src: '/b.png' } } });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.skipped.images).toEqual(['img-9']);
    expect(r.changed).toBe(false);
  });

  it('records skipped link selectors (today: silent skip)', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { linkOverrides: { 'a-9': { href: '/new' } } });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.skipped.links).toEqual(['a-9']);
  });

  it('records unresolvable deletedSelectors (today: filtered silently)', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { deletedSelectors: ['p-0', 'p-9'] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.applied.deletes).toBe(1);
    expect(r.report.skipped.deletes).toEqual(['p-9']);
    expect(r.content).not.toContain('<p>Body</p>');
  });

  it('keeps lenient reorder (task-024): resolvable subset reorders, rest listed in skipped.reorder', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { orderOverrides: ['p-0', 'h1-0', 'cta-0'] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.applied.reordered).toBe(2);
    expect(r.report.skipped.reorder).toEqual(['cta-0']);
    expect(r.content.indexOf('<p>')).toBeLessThan(r.content.indexOf('<h1'));
  });

  it('preserves the delete-would-empty-body refusal', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { deletedSelectors: ['section-0'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusedSelectors).toEqual(['section-0']);
  });

  it('applies text + attribute overrides and counts them', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, {
      textOverrides: { 'h1-0': 'New Title' },
      attributeOverrides: { 'img-0': { loading: 'lazy' } },
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.applied.text).toBe(1);
    expect(r.report.applied.attributes).toBe(1);
    expect(r.content).toContain('New Title');
  });

  it('counts drawnReconcile inserts and appends them inside the outermost wrapper', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, { drawnReconcile: [{ markup: '<div data-drawn="true"></div>' }] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.report.applied.drawn).toBe(1);
    expect(r.content).toContain('data-drawn');
  });

  it('changed:false when every category skips — caller must not write/mirror', async () => {
    const r = await applyWriteBackOverrides(SRC, FILE, {
      classOverrides: { 'h1-9': 'x' },
      textOverrides: { 'p-9': 'y' },
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.changed).toBe(false);
    expect(r.content).toBe(SRC);
  });
});
