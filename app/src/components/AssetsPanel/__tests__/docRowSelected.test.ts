/**
 * The open editor-doc row's SELECTION highlight gate. Regression: "Go to source"
 * on a layout opens it in the editor with the layout ROOT selected — the doc row
 * must stay highlighted (selecting the root IS selecting the doc), so the left
 * side reflects what the DesignBar is showing. The highlight only moves off when
 * a deeper CHILD is selected.
 */
import { describe, it, expect } from 'vitest';
import { docRowSelected } from '../AssetsPanel';

const ROOT = 'el-root';

describe('docRowSelected', () => {
  it('highlights an active doc row when nothing is selected', () => {
    expect(docRowSelected(true, null, ROOT)).toBe(true);
  });

  it('highlights an active doc row when its OWN ROOT is selected', () => {
    expect(docRowSelected(true, ROOT, ROOT)).toBe(true);
  });

  it('highlights an active doc row when the infrastructure wrapper is selected (Go to source on a layout)', () => {
    // The editor auto-selects #sq-components / [pageId].astro on load.
    expect(docRowSelected(true, 'src/pages/preview/[projectId]/[pageId].astro:17:29', ROOT)).toBe(true);
  });

  it('drops the highlight when a deeper CHILD element is selected', () => {
    expect(docRowSelected(true, `${ROOT}:slot-0`, ROOT)).toBe(false);
  });

  it('is never highlighted when the row is not active', () => {
    expect(docRowSelected(false, null, ROOT)).toBe(false);
    expect(docRowSelected(false, ROOT, ROOT)).toBe(false);
  });

  it('falls back to "nothing selected" when there is no editor root', () => {
    expect(docRowSelected(true, null, null)).toBe(true);
    expect(docRowSelected(true, 'something', null)).toBe(false);
  });
});
