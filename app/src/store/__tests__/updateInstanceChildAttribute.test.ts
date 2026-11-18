/**
 * UPDATE_INSTANCE_CHILD_ATTRIBUTE — stores a source-child attribute override on
 * the editor root instance, keyed by selector. Backs layout-editor slot-name
 * editing: the <slot> is a SOURCE child (no Yjs element), so its name lives as
 * an attributeOverride that pushOverridesToSource writes back to the .astro.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';

function seedInstance(doc: Y.Doc, id: string): Y.Map<unknown> {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'P', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: {
    id, pageId: 'p1', parentId: null, index: 0,
    type: 'component', astroSource: 'library/Marketing.astro', staticMarkup: '<div><slot /></div>',
    classes: emptyClassData(),
  }});
  return doc.getMap('elements').get(id) as Y.Map<unknown>;
}

function readOverride(inst: Y.Map<unknown>, selector: string, attr: string): string | undefined {
  const all = inst.get('attributeOverrides') as Y.Map<Y.Map<string>> | undefined;
  return all?.get(selector)?.get(attr);
}

describe('UPDATE_INSTANCE_CHILD_ATTRIBUTE', () => {
  it('stores an attribute override on the instance, keyed by selector', () => {
    const doc = new Y.Doc();
    const inst = seedInstance(doc, 'el-1');
    applyCommand(doc, { type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE', instanceId: 'el-1', selector: 'slot-0', attribute: 'name', value: 'header' });
    expect(readOverride(inst, 'slot-0', 'name')).toBe('header');
  });

  it('keeps an empty value (= "remove the attribute" instruction for write-back)', () => {
    const doc = new Y.Doc();
    const inst = seedInstance(doc, 'el-1');
    applyCommand(doc, { type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE', instanceId: 'el-1', selector: 'slot-0', attribute: 'name', value: 'header' });
    applyCommand(doc, { type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE', instanceId: 'el-1', selector: 'slot-0', attribute: 'name', value: '' });
    expect(readOverride(inst, 'slot-0', 'name')).toBe('');
  });

  it('no-ops when the instance does not exist', () => {
    const doc = new Y.Doc();
    expect(() =>
      applyCommand(doc, { type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE', instanceId: 'missing', selector: 'slot-0', attribute: 'name', value: 'x' }),
    ).not.toThrow();
    expect(doc.getMap('elements').get('missing')).toBeUndefined();
  });
});
