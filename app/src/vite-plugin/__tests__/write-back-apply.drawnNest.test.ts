import { describe, it, expect } from 'vitest';
import { applyWriteBackOverrides } from '../write-back-apply';
import { stripDrawnElements } from '../../utils/stripDrawnElements';

const SRC = `---
---
<section data-x>
  <h1>Title</h1>
</section>
`;

describe('write-back drawnReconcile — nested under a source selector', () => {
  it('inserts markup before the parent selector closing tag (not the file end)', async () => {
    const r = await applyWriteBackOverrides(SRC, 'Comp.astro', {
      drawnReconcile: [{ markup: '<div data-sq-drawn="sq-1" class="box"></div>', parentSelector: 'section-0' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The box lands INSIDE <section>, after <h1>, before </section>.
    expect(r.content).toMatch(/<h1>Title<\/h1>\s*<div data-sq-drawn="sq-1" class="box"><\/div>\s*<\/section>/);
    expect(r.report.applied.drawn).toBe(1);
  });

  it('top-level insert (no parentSelector) appends before the file last closing tag', async () => {
    const r = await applyWriteBackOverrides(SRC, 'Comp.astro', {
      drawnReconcile: [{ markup: '<div data-sq-drawn="sq-1" class="root"></div>' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toMatch(/<div data-sq-drawn="sq-1" class="root"><\/div>\s*<\/section>\s*$/);
    expect(r.report.applied.drawn).toBe(1);
  });

  it('records an unresolved parentSelector as skipped, never silently dropped', async () => {
    const r = await applyWriteBackOverrides(SRC, 'Comp.astro', {
      drawnReconcile: [{ markup: '<div data-sq-drawn="sq-1"></div>', parentSelector: 'nav-9' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.skipped.drawn).toContain('nav-9');
    expect(r.report.applied.drawn).toBe(0);
  });
});

describe('write-back drawnReconcile — strip + re-insert (mirror semantics)', () => {
  // Source already carrying a previously-baked drawn box.
  const BAKED = `---
---
<section data-x>
  <h1>Title</h1>
  <div data-sq-drawn="sq-1" class="box"></div>
</section>
`;

  it('add: empty source + one entry → box appears, marked', async () => {
    const r = await applyWriteBackOverrides(SRC, 'Comp.astro', {
      drawnReconcile: [{ markup: '<div data-sq-drawn="sq-1" class="box"></div>' }],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.content).toContain('data-sq-drawn="sq-1"');
    expect(r.report.applied.drawn).toBe(1);
    expect(r.changed).toBe(true);
  });

  it('delete: present-but-empty reconcile strips the baked box from source', async () => {
    const r = await applyWriteBackOverrides(BAKED, 'Comp.astro', {
      drawnReconcile: [],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.content).not.toContain('data-sq-drawn');
    expect(r.content).not.toContain('class="box"');
    // Strip leaves no blank line behind.
    expect(r.content).toMatch(/<h1>Title<\/h1>\s*<\/section>/);
    expect(r.changed).toBe(true);
  });

  it('idempotent: re-baking the same set on already-baked source is a no-op', async () => {
    const r = await applyWriteBackOverrides(BAKED, 'Comp.astro', {
      drawnReconcile: [{ markup: '<div data-sq-drawn="sq-1" class="box"></div>' }],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.content).toBe(BAKED);
    expect(r.changed).toBe(false);
  });

  it('undefined reconcile leaves a baked box untouched', async () => {
    const r = await applyWriteBackOverrides(BAKED, 'Comp.astro', {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.content).toBe(BAKED);
    expect(r.report.applied.drawn).toBe(0);
  });
});

describe('stripDrawnElements', () => {
  it('removes a nested drawn subtree wholesale, including children', () => {
    const html = `<section>
  <div data-sq-drawn="sq-1" class="card">
    <h2 class="t">Hi</h2>
    <div class="inner"></div>
  </div>
</section>`;
    const out = stripDrawnElements(html);
    expect(out).not.toContain('data-sq-drawn');
    expect(out).not.toContain('card');
    expect(out).not.toContain('inner');
    expect(out).toBe(`<section>
</section>`);
  });

  it('removes a void (self-closing) drawn root', () => {
    const html = `<div>
  <img data-sq-drawn="sq-2" class="w-full" />
</div>`;
    expect(stripDrawnElements(html)).toBe(`<div>
</div>`);
  });

  it('handles same-tag nesting via depth counting', () => {
    const html = `<main>
  <div data-sq-drawn="sq-3">
    <div class="child"></div>
  </div>
  <div class="keep"></div>
</main>`;
    const out = stripDrawnElements(html);
    expect(out).toContain('class="keep"');
    expect(out).not.toContain('class="child"');
    expect(out).not.toContain('data-sq-drawn');
  });

  it('removes multiple drawn roots', () => {
    const html = `<section>
  <div data-sq-drawn="a"></div>
  <p>keep</p>
  <div data-sq-drawn="b"></div>
</section>`;
    const out = stripDrawnElements(html);
    expect(out).not.toContain('data-sq-drawn');
    expect(out).toContain('<p>keep</p>');
  });

  it('is a no-op when no drawn markers are present', () => {
    const html = `<section><h1>Title</h1></section>`;
    expect(stripDrawnElements(html)).toBe(html);
  });
});
