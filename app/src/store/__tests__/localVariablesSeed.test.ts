import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { db } from '@/db';
import { putProjectFiles } from '@/db/projectFiles';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { generateCollectionsCSS } from '@/core/variables/cssGenerator';
import { createDefaultCollection } from '@/core/variables/types';
import { selectVariableCollections } from '@/store/variableSelectors';
import { seedLocalVariables } from '../localVariablesSeed';

beforeEach(async () => { await db.delete(); await db.open(); localStorage.clear(); });

describe('seedLocalVariables (files-truth: the CSS file re-seeds the panel)', () => {
  it('round-trips generateCollectionsCSS → file → parseCSS → ONE collection with the same variables/modes', async () => {
    const col = createDefaultCollection();
    const light = col.modes.find((m) => m.isDefault)!.id;
    const dark = col.modes.find((m) => !m.isDefault)!.id;
    col.variables.push({ id: 'v1', name: 'brand', type: 'color', values: { [light]: { type: 'color', hex: '#111111', opacity: 1 }, [dark]: { type: 'color', hex: '#eeeeee', opacity: 1 } } });
    const css = generateCollectionsCSS([col]);
    markFilesTruth('browser_v');
    await putProjectFiles('browser_v', [{ path: 'src/styles/sq-variables.css', content: new TextEncoder().encode(css) }]);
    const doc = new Y.Doc();
    const seeded = await seedLocalVariables(doc, 'browser_v');
    expect(seeded?.variables.map((v) => v.name)).toEqual(['brand']);
    const inDoc = selectVariableCollections(doc);
    expect(inDoc).toHaveLength(1);
    expect(inDoc[0].variables[0].name).toBe('brand');
    expect(inDoc[0].variables[0].type).toBe('color');
    expect(Object.values(inDoc[0].variables[0].values).map((v) => (v as { hex: string }).hex).sort()).toEqual(['#111111', '#eeeeee']);
    // idempotent: a second seed (HMR re-load) adds nothing
    expect(await seedLocalVariables(doc, 'browser_v')).toBeNull();
    expect(selectVariableCollections(doc)).toHaveLength(1);
    unmarkFilesTruth('browser_v');
  });

  it('no file / no variables → nothing seeded', async () => {
    markFilesTruth('browser_e');
    const doc = new Y.Doc();
    expect(await seedLocalVariables(doc, 'browser_e')).toBeNull();
    expect(selectVariableCollections(doc)).toEqual([]);
    unmarkFilesTruth('browser_e');
  });
});
