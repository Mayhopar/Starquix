/**
 * task-120 (5.3) — useInstanceOverrideSync bumps the instance counter only
 * for override-relevant Yjs mutations. Adding an element WITHOUT override
 * keys must not bump; classOverrides writes must.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useInstanceOverrideSync } from '@/context/hooks/useInstanceOverrideSync';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('elements');
  return doc;
}

describe('useInstanceOverrideSync bump gate (task-120)', () => {
  let doc: Y.Doc;
  let bump: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = makeDoc();
    bump = vi.fn();
    renderHook(() => useInstanceOverrideSync(doc, bump));
  });

  it('adding an element without override keys does NOT bump', () => {
    doc.transact(() => {
      const el = new Y.Map();
      el.set('id', 'el-1');
      el.set('pageId', 'p1');
      el.set('staticMarkup', '<div data-key="el-1">x</div>');
      doc.getMap('elements').set('el-1', el);
    });
    expect(bump).not.toHaveBeenCalled();
  });

  it('writing classOverrides bumps', () => {
    doc.transact(() => {
      const el = new Y.Map();
      el.set('id', 'el-1');
      el.set('staticMarkup', '<div data-key="el-1:div-0">x</div>');
      doc.getMap('elements').set('el-1', el);
    });
    bump.mockClear();
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      const co = new Y.Map();
      el.set('classOverrides', co);
    });
    expect(bump).toHaveBeenCalled();
  });

  it('a non-override field write does NOT bump', () => {
    doc.transact(() => {
      const el = new Y.Map();
      el.set('id', 'el-1');
      el.set('staticMarkup', '<div data-key="el-1">x</div>');
      doc.getMap('elements').set('el-1', el);
    });
    bump.mockClear();
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      el.set('x', 42);
    });
    expect(bump).not.toHaveBeenCalled();
  });

  it('deleting an element bumps (prev-state cleanup)', () => {
    doc.transact(() => {
      const el = new Y.Map();
      el.set('id', 'el-1');
      doc.getMap('elements').set('el-1', el);
    });
    bump.mockClear();
    doc.transact(() => {
      doc.getMap('elements').delete('el-1');
    });
    expect(bump).toHaveBeenCalled();
  });

  it('adding an element WITH overrides bumps (undo/redo restore seeds prev refs)', () => {
    doc.transact(() => {
      const el = new Y.Map();
      el.set('id', 'el-1');
      el.set('staticMarkup', '<div data-key="el-1:div-0" class="a">x</div>');
      el.set('classOverrides', new Y.Map());
      doc.getMap('elements').set('el-1', el);
    });
    expect(bump).toHaveBeenCalled();
  });
});
