import { describe, expect, it, vi } from 'vitest';
import { recoverStaleCanvas, sourceActionFailure } from '../sourceActionFeedback';

describe('sourceActionFailure (2026-09-16: the toast carries the real cause)', () => {
  it('appends an Error message or a string reason', () => {
    expect(sourceActionFailure('delete-element', new Error('Structural edits cannot change another surface file')))
      .toBe("Couldn't delete the element: Structural edits cannot change another surface file");
    expect(sourceActionFailure('draw', 'plugin refused')).toBe("Couldn't add the shape: plugin refused");
  });
  it('never emits the retired "not confirmed. Check saving" copy', () => {
    for (const action of ['create-page', 'delete-page', 'rename-page', 'delete-element', 'move-element', 'draw', 'insert', 'prepare-insert'] as const) {
      expect(sourceActionFailure(action)).not.toMatch(/not confirmed|Check saving/);
      expect(sourceActionFailure(action, new Error(''))).toBe(sourceActionFailure(action));
    }
  });
});

describe('recoverStaleCanvas (owner 2026-09-24: recover, don\'t toast)', () => {
  it('a deleted-on-disk element still on the canvas reloads the preview instead of failing loudly', () => {
    const reload = vi.fn();
    window.addEventListener('sq:reload-preview', reload);
    // Verbatim cause from the owner's Arc console (new-page.astro, rev 10 already removed it).
    expect(recoverStaleCanvas(new Error('Source element has been deleted'))).toBe(true);
    expect(recoverStaleCanvas(new Error('Source target version does not match the projected source baseline'))).toBe(true);
    expect(recoverStaleCanvas(new Error('Structural edits cannot change another surface file'))).toBe(false);
    window.removeEventListener('sq:reload-preview', reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
