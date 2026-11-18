/**
 * CLEAR_SOURCE_TEXT drops a text override. A refused file write (a dynamic
 * expression the plugin will not overwrite) must not leave the canvas value
 * behind as a doc overlay — on a page view the scan re-apply would paint the
 * component view's stub over what the file really renders (2026-09-10).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

const KEY = 'src/components/FeaturedWork.astro:60:17';

describe('CLEAR_SOURCE_TEXT', () => {
  it('removes the sourceText entry written by UPDATE_SOURCE_TEXT', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Stub ZZQ', originalText: 'Stub' });
    expect(doc.getMap('sourceText').has(KEY)).toBe(true);
    expect(applyCommand(doc, { type: 'CLEAR_SOURCE_TEXT', sourceKey: KEY })).not.toBe(false);
    expect(doc.getMap('sourceText').has(KEY)).toBe(false);
  });

  it('is a no-op (returns false) when there is nothing to clear', () => {
    const doc = new Y.Doc();
    expect(applyCommand(doc, { type: 'CLEAR_SOURCE_TEXT', sourceKey: KEY })).toBe(false);
  });
});
