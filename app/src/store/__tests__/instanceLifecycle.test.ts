// Characterization tests for the instance-lifecycle logic extracted from
// DesignBar (handleResetInstanceToOriginal / handleMakeComponent).
// Durable contract (fdd2d12f / c8535b79): both gestures run inside the
// durable acceptance lane — they need a projectId + IndexedDB, mutate the
// STAGED doc via applyCommand (the injected dispatch is no longer the
// writer), and a drawn → component conversion writes the library file
// through acceptFileChanges instead of POST /__sq/save-component.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import { emptyClassData } from '../types';

vi.mock('../commands', async importOriginal => {
  const actual = await importOriginal<typeof import('../commands')>();
  return { ...actual, applyCommand: vi.fn(actual.applyCommand) };
});

import { resetInstanceToOriginal, makeComponentFromDrawn, type ResetInstanceArgs } from '../instanceLifecycle';
import { applyCommand } from '../commands';
import { selectPageDrawnElements } from '../selectors';

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_lifecycle_${crypto.randomUUID()}`;
  runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main />' });
});
afterEach(() => { runtime.close(); vi.unstubAllGlobals(); vi.mocked(applyCommand).mockClear(); });

function seedInstanceDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_THEME_INSTANCE', element: {
    id: 'el-1', pageId: 'page-1', parentId: null, index: 0, type: 'instance', instanceType: 'theme',
    themeId: 'Card', componentPath: 'Card.astro', staticMarkup: '<section><h1>Hi</h1></section>', classes: emptyClassData(),
  } });
  // A page-keyed child order under the instance (CLEAR_INSTANCE_CHILD_ORDERS target).
  const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
  const orders = new Y.Map<Y.Array<string>>();
  page.set('childOrders', orders);
  const arr = new Y.Array<string>(); arr.push(['b', 'a']); orders.set('el-1', arr);
  return doc;
}

function makeResetArgs(over: Partial<ResetInstanceArgs> = {}): ResetInstanceArgs {
  return {
    doc: seedInstanceDoc(),
    dispatch: vi.fn(() => true),
    takeSnapshot: vi.fn(),
    instanceId: 'el-1',
    currentPageId: 'page-1',
    isBlogSlot: false,
    builtIn: [],
    ...over,
  };
}

// ↻ Reset now drops the placement's overrides so it snaps to the LIVE master
// overlay — no UPDATE_STATIC_MARKUP / masterVersion / source round-trip.
describe('resetInstanceToOriginal', () => {
  it('snapshots, then clears overrides + child orders + drawn elements', async () => {
    const args = makeResetArgs();
    vi.mocked(applyCommand).mockClear();
    const r = await resetInstanceToOriginal(args);

    expect(r.ok).toBe(true);
    const dispatch = vi.mocked(applyCommand);
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'CLEAR_INSTANCE_OVERRIDES', elementId: 'el-1',
    }));
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'CLEAR_INSTANCE_CHILD_ORDERS', pageId: 'page-1', instanceId: 'el-1',
    }));
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'CLEAR_INSTANCE_DRAWN_ELEMENTS', pageId: 'page-1', instanceId: 'el-1',
    }));
    // The accepted doc carries the clear.
    const orders = (args.doc.getMap('pages').get('page-1') as Y.Map<unknown>).get('childOrders') as Y.Map<unknown>;
    expect(orders.has('el-1')).toBe(false);
    // It never re-pulls source markup
    expect(dispatch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'UPDATE_STATIC_MARKUP' }));
    // Snapshot must precede the first mutation
    const snapOrder = vi.mocked(args.takeSnapshot).mock.invocationCallOrder[0];
    const firstDispatchOrder = dispatch.mock.invocationCallOrder[0];
    expect(snapOrder).toBeLessThan(firstDispatchOrder);
  });

  it('clears overrides even with no currentPageId (skips the page-keyed clears)', async () => {
    const args = makeResetArgs({ currentPageId: null });
    vi.mocked(applyCommand).mockClear();
    const r = await resetInstanceToOriginal(args);
    expect(r.ok).toBe(true);
    const dispatch = vi.mocked(applyCommand);
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'CLEAR_INSTANCE_OVERRIDES', elementId: 'el-1',
    }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'CLEAR_INSTANCE_CHILD_ORDERS' }));
  });
});

describe('makeComponentFromDrawn', () => {
  function seedDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.getMap('meta').set('projectId', projectId);
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: { key: 'drawn-root', tag: 'section', classes: 'p-4', textContent: '', parentKey: null, insertIndex: 0, pageId: 'page-1' },
    });
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: { key: 'drawn-child', tag: 'h2', classes: '', textContent: 'Hi', parentKey: 'drawn-root', insertIndex: 0, pageId: 'page-1' },
    });
    return doc;
  }

  it('removes the drawn subtree and adds a theme instance in ONE transaction', async () => {
    const doc = seedDoc();
    const takeSnapshot = vi.fn();
    let updates = 0;
    doc.on('update', () => { updates++; });

    const r = await makeComponentFromDrawn({
      doc, currentPageId: 'page-1', key: 'drawn-root', existingNames: ['Header'], takeSnapshot,
    });

    expect(r.ok).toBe(true);
    expect(r.componentName).toBeTruthy();
    expect(r.instanceId).toBeTruthy();
    expect(takeSnapshot).toHaveBeenCalled();
    // Whole drawn subtree gone
    const drawnLeft = selectPageDrawnElements(doc, 'page-1');
    expect(drawnLeft.find(e => e.key === 'drawn-root' || e.key === 'drawn-child')).toBeUndefined();
    // Instance exists with the serialized drawn markup
    const inst = doc.getMap('elements').get(r.instanceId!) as Y.Map<unknown>;
    expect(inst).toBeDefined();
    // ADD_THEME_INSTANCE stamps data-key attributes into the markup
    const markup = inst.get('staticMarkup') as string;
    expect(markup).toContain('class="p-4"');
    expect(markup).toContain('>Hi</h2>');
    expect(markup).toContain(`data-key="${r.instanceId}:section-0"`);
    expect(inst.get('componentPath')).toBe(`${r.componentName}.astro`);
    // Single Yjs transaction → single update event (no visual flash)
    expect(updates).toBe(1);
    // The library file lands on disk after materialization.
    await flushDurableSourceWritesThrough(projectId, 1);
    const source = runtime.read(`src/components/library/${r.componentName}.astro`);
    expect(source).toContain('class="p-4"');
    expect(source).toContain('>Hi</h2>');
  });

  it('fails gracefully when the component file cannot be created (conflicting file on disk)', async () => {
    const doc = seedDoc();
    // generateComponentName('section', []) → the first free Section name.
    mkdirSync(join(runtime.root, 'src/components/library'), { recursive: true });
    const probe = await import('../serializeDrawnTree');
    const name = probe.generateComponentName('section', []);
    writeFileSync(join(runtime.root, `src/components/library/${name}.astro`), '<main>Existing</main>');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await makeComponentFromDrawn({
      doc, currentPageId: 'page-1', key: 'drawn-root', existingNames: [], takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(r.reason).not.toMatch(/different project|not ready/);
    // Drawn elements untouched
    expect(selectPageDrawnElements(doc, 'page-1')).toHaveLength(2);
    expect(runtime.read(`src/components/library/${name}.astro`)).toBe('<main>Existing</main>');
  });
});
