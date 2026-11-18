/**
 * CLEAR_SOURCE_IMAGE_ATTRIBUTES drops the session's src/alt override for a
 * source key. Owner 2026-09-19: an <img> uploaded via the attribute tier, then
 * converted to a container and back to an <img> with a NEW src — the rescan
 * re-applied the stale override and painted the old image over the file's.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

const KEY = 'src/pages/index.astro:5:3';

describe('CLEAR_SOURCE_IMAGE_ATTRIBUTES', () => {
  it('drops the override for the key; a missing entry is a no-op, never a refusal', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: KEY, attribute: 'src', value: '/uploads/old.png' });
    expect(doc.getMap('sourceImageAttributes').has(KEY)).toBe(true);
    expect(applyCommand(doc, { type: 'CLEAR_SOURCE_IMAGE_ATTRIBUTES', sourceKey: KEY })).not.toBe(false);
    expect(doc.getMap('sourceImageAttributes').has(KEY)).toBe(false);
    expect(applyCommand(doc, { type: 'CLEAR_SOURCE_IMAGE_ATTRIBUTES', sourceKey: KEY })).not.toBe(false);
  });
  it("'' is an honest src / alt override on a source key (no image, decorative) — never a delete", () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: KEY, attribute: 'src', value: '/uploads/old.png' });
    applyCommand(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: KEY, attribute: 'src', value: '' });
    applyCommand(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: KEY, attribute: 'alt', value: '' });
    expect((doc.getMap('sourceImageAttributes').get(KEY) as Y.Map<string>).toJSON()).toEqual({ src: '', alt: '' });
    applyCommand(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: KEY, attribute: 'loading', value: '' });
    expect((doc.getMap('sourceImageAttributes').get(KEY) as Y.Map<string>).has('loading')).toBe(false);
  });
});
