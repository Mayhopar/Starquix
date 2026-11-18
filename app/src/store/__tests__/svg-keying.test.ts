/**
 * Regression (2026-07-24): AI-generated inline <svg> shapes were invisible in
 * Layers — 'svg' sat in SKIP_TAGS so it never got a data-key. Root <svg> is
 * now keyable (a shape is content, like <img>); svg INTERNALS stay skipped.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { addDataKeysToHtml, SKIP_TAGS } from '../constants';
import { applyCommand } from '../commands';
import { selectResolvedStaticMarkup } from '../selectors';

describe('svg keying', () => {
  it('root <svg> gets a data-key; internals do not', () => {
    const html =
      '<div class="card"><svg width="96" height="96" viewBox="0 0 96 96">' +
      '<circle cx="48" cy="48" r="32" fill="#0066cc"></circle>' +
      '<path d="M0 0"></path></svg><h3>Circle</h3></div>';
    const out = addDataKeysToHtml(html, (sel) => `el-1:${sel}`);

    expect(out).toMatch(/<svg[^>]*data-key="el-1:svg-0"/);
    expect(out).toMatch(/<h3[^>]*data-key="el-1:h3-0"/);
    expect(out).not.toMatch(/<circle[^>]*data-key/);
    expect(out).not.toMatch(/<path[^>]*data-key/);
  });

  it('keying svg does not shift sibling tag counters', () => {
    const html = '<div><svg></svg><div>a</div></div>';
    const out = addDataKeysToHtml(html, (sel) => sel);
    expect(out).toContain('<div data-key="div-0"');
    expect(out).toContain('<div data-key="div-1"');
    expect(out).toContain('<svg data-key="svg-0"');
  });

  it('SKIP_TAGS covers svg internals but not svg itself', () => {
    expect(SKIP_TAGS).not.toContain('svg');
    for (const t of ['path', 'circle', 'g', 'defs', 'polygon', 'ellipse']) {
      expect(SKIP_TAGS).toContain(t);
    }
  });
});

/**
 * Pre-fix docs stored staticMarkup with keyed div/h3/p but an UNKEYED <svg>
 * (svg was skip-listed at generation time). Overrides target selectors via
 * data-key IN the stored markup, so svg-0 edits silently reverted on every
 * re-render. applyAllOverrides now heals missing keys first.
 */
describe('svg override on pre-fix markup (key healing)', () => {
  const PRE_FIX_MARKUP =
    '<div data-key="el-1:div-0" class="p-6">' +
    '<div data-key="el-1:div-1" class="flex h-40">' +
    '<svg width="96" height="96" viewBox="0 0 96 96" fill="none">' +
    '<circle cx="48" cy="48" r="32" fill="#0066cc"></circle></svg></div>' +
    '<h3 data-key="el-1:h3-0" class="mt-5">Circle</h3></div>';

  function addElement(doc: Y.Doc, id: string, staticMarkup: string, isDrawn = false) {
    const el = new Y.Map<unknown>();
    el.set('id', id);
    el.set('staticMarkup', staticMarkup);
    if (isDrawn) el.set('isDrawn', true);
    doc.getMap('elements').set(id, el);
  }

  it('classOverrides on svg-0 survive re-resolution', () => {
    const doc = new Y.Doc();
    addElement(doc, 'el-1', PRE_FIX_MARKUP);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-1',
      selector: 'svg-0',
      breakpoint: 'base',
      classes: ['w-[200px]', 'fill-red-500'],
    });
    const out = selectResolvedStaticMarkup(doc, 'el-1')!;
    expect(out).toContain('data-key="el-1:svg-0"');
    expect(out).toMatch(/<svg[^>]*class="[^"]*w-\[200px\]/);
    // existing keys untouched
    expect(out).toContain('data-key="el-1:div-0"');
    expect(out).toContain('data-key="el-1:h3-0"');
  });

  it('drawn elements are never key-healed (inline shape svg stays unkeyed)', () => {
    const doc = new Y.Doc();
    const shapeMarkup = '<svg viewBox="0 0 100 100"><path d="M0 0 L100 100"></path></svg>';
    addElement(doc, 'drawn-1', shapeMarkup, true);
    const out = selectResolvedStaticMarkup(doc, 'drawn-1')!;
    expect(out).not.toContain('data-key');
  });
});
