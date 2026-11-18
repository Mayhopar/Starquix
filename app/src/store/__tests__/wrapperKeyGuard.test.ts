// Wrapper-key write guard (2026-07-23). A model styled #sq-components (its
// key is exposed by the scan) → sourceClasses override on the WRAPPER →
// every section reflowed inside a padded max-w box ("all sections float"),
// and selection refuses infra keys so the UI could not undo it.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { repairMetaAfterRestore } from '../persistence/migrateLegacyToYDoc';
import { SOURCE_OVERRIDE_MAP_NAMES } from '../sourceOverrideEntries';

const WRAPPER_KEY = 'src/pages/preview/[projectId]/[pageId].astro:18:29';

describe('wrapper-key write guard', () => {
  it('UPDATE_SOURCE_CLASSES refuses the wrapper key', () => {
    const doc = createEditorDoc();
    const applied = applyCommand(doc, {
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: WRAPPER_KEY,
      classes: 'py-20 max-w-6xl mx-auto',
    });
    expect(applied).toBe(false);
    expect(doc.getMap('sourceClasses').has(WRAPPER_KEY)).toBe(false);
  });

  it('UPDATE_SOURCE_TEXT refuses the wrapper key', () => {
    const doc = createEditorDoc();
    const applied = applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: WRAPPER_KEY,
      textContent: 'x',
    });
    expect(applied).toBe(false);
    expect(doc.getMap('sourceText').has(WRAPPER_KEY)).toBe(false);
  });

  it('repairMetaAfterRestore purges wrapper-key overrides from poisoned docs', () => {
    const doc = createEditorDoc();
    // Simulate a doc poisoned before the guard existed.
    for (const mapName of SOURCE_OVERRIDE_MAP_NAMES) {
      doc.getMap(mapName).set(WRAPPER_KEY, 'poison');
      doc.getMap(mapName).set('src/pages/index.astro:5:1', 'legit');
    }
    repairMetaAfterRestore(doc, 'p1');
    for (const mapName of SOURCE_OVERRIDE_MAP_NAMES) {
      expect(doc.getMap(mapName).has(WRAPPER_KEY)).toBe(false);
      expect(doc.getMap(mapName).has('src/pages/index.astro:5:1')).toBe(true);
    }
  });

  // The scan-seed path (handleElementsScanned → REORDER_PAGE_ELEMENTS) used to
  // pass the wrapper itself (isRootLevelElement counts parentKey === null), so
  // live docs hold rootElementIds like [WRAPPER_KEY, 'el-…'] — junk ids in the
  // render-order array that AI placement anchors and order diffs trip over.
  it('REORDER_PAGE_ELEMENTS drops wrapper keys but keeps real ids', () => {
    const doc = createEditorDoc();
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'P', rootElementIds: [], children: [] },
    });
    const applied = applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'page-1',
      elementIds: [WRAPPER_KEY, 'el-1', 'el-2'],
    });
    expect(applied).toBe(true);
    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['el-1', 'el-2']);
  });

  it('REORDER_PAGE_ELEMENTS with only wrapper keys is refused', () => {
    const doc = createEditorDoc();
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'P', rootElementIds: ['el-1'], children: [] },
    });
    const applied = applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'page-1',
      elementIds: [WRAPPER_KEY],
    });
    expect(applied).toBe(false);
    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['el-1']);
  });

  it('repairMetaAfterRestore purges wrapper keys from every page rootElementIds', () => {
    const doc = createEditorDoc();
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'P', rootElementIds: [WRAPPER_KEY, 'el-1'], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Q', rootElementIds: ['el-2', WRAPPER_KEY], children: [] },
    });
    repairMetaAfterRestore(doc, 'p1');
    const pages = doc.getMap('pages');
    const ids = (p: string) =>
      ((pages.get(p) as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>).toArray();
    expect(ids('page-1')).toEqual(['el-1']);
    expect(ids('page-2')).toEqual(['el-2']);
  });
});
