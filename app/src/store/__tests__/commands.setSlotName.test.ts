/**
 * Regression: SET_SLOT_NAME handler (task-006, DesignBar SlotBlock).
 *
 * Before this handler existed, a slot's `name` attribute could only be edited
 * by hand-editing the .astro source — there was no command to set it from the
 * editor. These tests pin the Yjs mutation (doc→.astro codegen was retired
 * with the browser runtime, 2026-10-07).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

function makeSlot(doc: Y.Doc, id: string): Y.Map<unknown> {
  const elements = doc.getMap('elements');
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('type', 'slot');
  elements.set(id, el);
  return el;
}

describe('SET_SLOT_NAME', () => {
  it('sets attributes.name on a slot element', () => {
    const doc = new Y.Doc();
    const el = makeSlot(doc, 'slot-1');

    applyCommand(doc, { type: 'SET_SLOT_NAME', elementId: 'slot-1', name: 'header' });

    expect(el.get('attributes')).toEqual({ name: 'header' });
  });

  it('trims whitespace around the name', () => {
    const doc = new Y.Doc();
    const el = makeSlot(doc, 'slot-1');

    applyCommand(doc, { type: 'SET_SLOT_NAME', elementId: 'slot-1', name: '  footer  ' });

    expect(el.get('attributes')).toEqual({ name: 'footer' });
  });

  it('clears the name (reverts to default slot) and drops empty attributes', () => {
    const doc = new Y.Doc();
    const el = makeSlot(doc, 'slot-1');
    el.set('attributes', { name: 'header' });

    applyCommand(doc, { type: 'SET_SLOT_NAME', elementId: 'slot-1', name: '' });

    expect(el.get('attributes')).toBeUndefined();
  });

  it('preserves other attributes when changing the name', () => {
    const doc = new Y.Doc();
    const el = makeSlot(doc, 'slot-1');
    el.set('attributes', { 'data-x': '1' });

    applyCommand(doc, { type: 'SET_SLOT_NAME', elementId: 'slot-1', name: 'aside' });

    expect(el.get('attributes')).toEqual({ 'data-x': '1', name: 'aside' });
  });

  it('is a no-op for a non-slot element', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');
    const el = new Y.Map<unknown>();
    el.set('id', 'el-1');
    el.set('type', 'frame');
    elements.set('el-1', el);

    applyCommand(doc, { type: 'SET_SLOT_NAME', elementId: 'el-1', name: 'header' });

    expect(el.get('attributes')).toBeUndefined();
  });
});

/**
 * The previous suite hand-builds `type: 'slot'` elements — a shape the running
 * editor never produces. The slot draw tool dispatches ADD_DRAWN_ELEMENT, which
 * stores the slot identity in `slotType: 'slot'` while `type` stays 'frame'.
 * These tests pin the REAL creation flow: the command must recognise a drawn slot.
 */
describe('SET_SLOT_NAME — drawn slot (real creation flow)', () => {
  function makeDrawnSlot(doc: Y.Doc, id: string): Y.Map<unknown> {
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: id,
        tag: 'div', // slot tool produces a div; root-level converts to <section>
        classes: '',
        textContent: '',
        parentKey: null,
        insertIndex: 0,
        pageId: 'page-1',
        slotType: 'slot',
      },
    });
    return doc.getMap('elements').get(id) as Y.Map<unknown>;
  }

  it('a drawn slot carries slotType="slot" but type="frame" (not "slot")', () => {
    const doc = new Y.Doc();
    const el = makeDrawnSlot(doc, 'drawn-slot-1');
    expect(el.get('slotType')).toBe('slot');
    expect(el.get('type')).toBe('frame');
  });

  it('sets attributes.name on a drawn slot', () => {
    const doc = new Y.Doc();
    const el = makeDrawnSlot(doc, 'drawn-slot-1');

    applyCommand(doc, { type: 'SET_SLOT_NAME', elementId: 'drawn-slot-1', name: 'header' });

    expect((el.get('attributes') as Record<string, string>)?.name).toBe('header');
  });
});
