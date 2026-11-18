/**
 * task-102 follow-up — UPDATE_THEME_INSTANCE_CLASS_OVERRIDE classes:null
 * deletes the selector's class override (back to live inheritance). Writing
 * [] instead means "cleared all classes" (renders classless), and the full
 * flat-string store means a set equal to the original markup left a no-op
 * override behind → phantom asterisk after "Remove all lg: classes".
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

function seedInstance(doc: Y.Doc, id = 'el-1') {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  el.set('staticMarkup', '<section class="p-10"><h2>t</h2></section>');
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

describe('UPDATE_THEME_INSTANCE_CLASS_OVERRIDE classes:null', () => {
  it('deletes the selector entry, leaves other selectors intact', () => {
    const doc = new Y.Doc();
    const el = seedInstance(doc);
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'section-0', breakpoint: 'base', classes: ['p-10', 'lg:p-12'] });
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'h2-0', breakpoint: 'base', classes: ['font-bold'] });

    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'section-0', breakpoint: 'base', classes: null });

    const co = el.get('classOverrides') as Y.Map<unknown>;
    expect(co.has('section-0')).toBe(false);
    expect(co.has('h2-0')).toBe(true);
  });

  it('no-op when the entry does not exist (no scaffold created)', () => {
    const doc = new Y.Doc();
    const el = seedInstance(doc);
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'section-0', breakpoint: 'base', classes: null });
    const co = el.get('classOverrides') as Y.Map<unknown> | undefined;
    expect(co?.has('section-0') ?? false).toBe(false);
  });
});
