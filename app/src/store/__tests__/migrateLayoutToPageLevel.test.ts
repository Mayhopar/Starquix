import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { migrateLayoutToPageLevel } from '../migrations/migrateLayoutToPageLevel';

describe('migrateLayoutToPageLevel', () => {
  it('converts a synthetic layout-instance root into page.layoutName + lifted children', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    // Old shape: a layout element as root, content as its child.
    const elements = doc.getMap('elements');
    const layout = new Y.Map(); layout.set('id', 'el-layout'); layout.set('pageId', 'p1'); layout.set('astroSource', 'layouts/Marketing.astro'); elements.set('el-layout', layout);
    const child = new Y.Map(); child.set('id', 'el-c'); child.set('pageId', 'p1'); child.set('parentId', 'el-layout'); child.set('slotName', 'main'); elements.set('el-c', child);
    const page = doc.getMap('pages').get('p1') as Y.Map<unknown>;
    (page.get('rootElementIds') as Y.Array<string>).push(['el-layout']);

    migrateLayoutToPageLevel(doc);

    expect(page.get('layoutName')).toBe('Marketing');
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['el-c']);
    expect((elements.get('el-c') as Y.Map<unknown>).get('parentId') ?? null).toBeNull();
    expect((elements.get('el-c') as Y.Map<unknown>).get('slotName')).toBe('main'); // preserved
    expect(elements.get('el-layout')).toBeUndefined(); // synthetic element deleted
  });

  it('is idempotent (second run is a no-op)', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    migrateLayoutToPageLevel(doc);
    const before = JSON.stringify(doc.getMap('pages').toJSON());
    migrateLayoutToPageLevel(doc);
    expect(JSON.stringify(doc.getMap('pages').toJSON())).toBe(before);
  });
});
