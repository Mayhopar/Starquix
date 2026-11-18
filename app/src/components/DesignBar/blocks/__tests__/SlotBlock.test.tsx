/**
 * SlotBlock — name editor for a selected <slot>, across BOTH representations:
 *  - a Yjs slot element (type:'slot') → SET_SLOT_NAME
 *  - a layout source <slot> in the editor (instance-child key, no Yjs element)
 *    → UPDATE_INSTANCE_CHILD_ATTRIBUTE, reading override-or-original name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const h = vi.hoisted(() => ({ doc: null as unknown, dispatch: vi.fn() }));

vi.mock('@/store/hooks', () => ({
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));

import { SlotBlock } from '../SlotBlock';

beforeEach(() => { h.dispatch.mockClear(); });

describe('SlotBlock — Yjs slot element', () => {
  it('reads the name from element attributes and commits via SET_SLOT_NAME', () => {
    const doc = new Y.Doc();
    const el = new Y.Map<unknown>();
    el.set('type', 'slot');
    el.set('attributes', { name: 'header' });
    doc.getMap('elements').set('el-1', el);
    h.doc = doc;

    render(<SlotBlock elementKey="el-1" />);
    const input = screen.getByDisplayValue('header');
    fireEvent.change(input, { target: { value: 'main' } });
    fireEvent.blur(input);

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'SET_SLOT_NAME', elementId: 'el-1', name: 'main' });
  });
});

describe('SlotBlock — editor source slot (instance-child key)', () => {
  it('reads the original name from the root staticMarkup and commits via UPDATE_INSTANCE_CHILD_ATTRIBUTE', () => {
    const doc = new Y.Doc();
    const root = new Y.Map<unknown>();
    root.set('staticMarkup', '<div><slot name="header"></slot><slot></slot></div>');
    doc.getMap('elements').set('el-root', root);
    h.doc = doc;

    render(<SlotBlock elementKey="el-root:slot-0" />);
    // Original name from markup shows up
    const input = screen.getByDisplayValue('header');
    fireEvent.change(input, { target: { value: 'hero' } });
    fireEvent.blur(input);

    expect(h.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE',
      instanceId: 'el-root', selector: 'slot-0', attribute: 'name', value: 'hero',
    });
  });

  it('a pending attributeOverride wins over the markup name', () => {
    const doc = new Y.Doc();
    const root = new Y.Map<unknown>();
    root.set('staticMarkup', '<div><slot name="header"></slot></div>');
    const overrides = new Y.Map<Y.Map<string>>();
    const slot0 = new Y.Map<string>();
    slot0.set('name', 'pending');
    overrides.set('slot-0', slot0);
    root.set('attributeOverrides', overrides);
    doc.getMap('elements').set('el-root', root);
    h.doc = doc;

    render(<SlotBlock elementKey="el-root:slot-0" />);
    expect(screen.getByDisplayValue('pending')).toBeInTheDocument();
  });

  it('clearing the name commits an empty value (= remove → default slot)', () => {
    const doc = new Y.Doc();
    const root = new Y.Map<unknown>();
    root.set('staticMarkup', '<div><slot name="header"></slot></div>');
    doc.getMap('elements').set('el-root', root);
    h.doc = doc;

    render(<SlotBlock elementKey="el-root:slot-0" />);
    const input = screen.getByDisplayValue('header');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(h.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE',
      instanceId: 'el-root', selector: 'slot-0', attribute: 'name', value: '',
    });
  });
});

describe('SlotBlock — filled layout slot on a real page (read-only)', () => {
  it('shows the scanned fallbackName and does NOT dispatch on edit when editable=false', () => {
    const doc = new Y.Doc();
    // The filled slot is a <div data-sq-slot> in staticMarkup — no parseable
    // <slot>, so the name comes from the scanned fallbackName.
    const root = new Y.Map<unknown>();
    root.set('staticMarkup', '<div><div data-sq-slot></div></div>');
    doc.getMap('elements').set('layoutchrome-p1', root);
    h.doc = doc;

    render(<SlotBlock elementKey="layoutchrome-p1:div-0" editable={false} fallbackName="hero" />);
    const input = screen.getByDisplayValue('hero') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByText(/Defined by the layout/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'changed' } });
    fireEvent.blur(input);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
