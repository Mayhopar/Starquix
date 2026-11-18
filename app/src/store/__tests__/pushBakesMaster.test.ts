// Task 9 — Push bakes a placement's overrides into the `masters` overlay and
// clears the instance override; ↻ (reset) drops a placement's overrides with no
// network round-trip. The master overlay is the live base, so neither path
// re-pulls source or stamps a masterVersion.
//
// Durable contract (7932857b / c8535b79): Push and ↻ are async and accepted
// through the durable lane (projectId + IndexedDB). Push's write-back intent is
// a `source-batch` command on the accepted edit (the deferred queue); the
// .astro is written when the materializer runs at a flush boundary.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { applyCommand } from '../commands';
import { pushInstanceToSource, resetInstanceToOriginal } from '../instanceLifecycle';
import { selectMasterMarkup, selectMasterChildOverrides, baseMarkup, readMasterMarkupRev } from '../masters';
import { COMPONENT_EDITOR_PAGE_ID } from '../constants';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { getDurableProjectState } from '@/services/durableEdits/store';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import type { EditorCommand } from '../types';
import type { SourceWritePayload } from '@/utils/pushOverridesToSource';

const SECTION = 'src/components/Section.astro';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_push_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [SECTION]: '<section><h1>Heading</h1></section>\n' });
});

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  return doc;
}

/** Every source-batch payload accepted so far, in acceptance order. */
async function queuedPayloads(): Promise<SourceWritePayload[]> {
  const rows = (await db.durableEdits.where('projectId').equals(projectId).toArray()).sort((a, b) => a.revision - b.revision);
  return rows.flatMap(row => row.commands).flatMap(command => command.kind === 'source-batch' ? command.payload.payloads : []);
}

function dispatcher(doc: Y.Doc) {
  return (c: EditorCommand) => applyCommand(doc, c);
}

function seedInstance(doc: Y.Doc, id: string, astroSource: string, staticMarkup: string) {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  el.set('astroSource', astroSource);
  el.set('staticMarkup', staticMarkup);
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

/** Seed a text override (selector → text) the same shape applyAllOverrides reads. */
function seedTextOverride(el: Y.Map<unknown>, selector: string, text: string) {
  let overrides = el.get('overrides') as Y.Map<Y.Map<unknown>> | undefined;
  if (!overrides) { overrides = new Y.Map(); el.set('overrides', overrides); }
  const o = new Y.Map<unknown>();
  o.set('text', text);
  overrides.set(selector, o);
}

afterEach(() => {
  runtime.close();
  setActiveSaveProjectId(null);
  vi.unstubAllGlobals();
});

describe('pushInstanceToSource — bake into masters + clear override', () => {
  it('bakes the placement override into masters and clears the instance override', async () => {
    const doc = newDoc();
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');
    seedTextOverride(a, 'h1-0', 'Pushed Heading');
    const takeSnapshot = vi.fn();

    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot,
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });

    expect(r.ok).toBe(true);
    expect(takeSnapshot).toHaveBeenCalled();
    // master overlay now carries the override...
    expect(selectMasterMarkup(doc, SECTION)).toContain('Pushed Heading');
    // ...and the instance's own override is gone (it inherits the master now)
    expect(a.get('overrides')).toBeUndefined();
  });

  it('a sibling placement with no override inherits the freshly baked master', async () => {
    const doc = newDoc();
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');
    const b = seedInstance(doc, 'el-b', SECTION, '<section><h1>Heading</h1></section>');
    seedTextOverride(a, 'h1-0', 'Pushed Heading');

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });

    expect(baseMarkup(doc, b)).toContain('Pushed Heading');
  });

  it('returns ok:false and writes no master when the instance has no overrides', async () => {
    const doc = newDoc();
    seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');

    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });

    expect(r.ok).toBe(false);
    expect(selectMasterMarkup(doc, SECTION)).toBeUndefined();
  });

  // Push materializes to the .astro too — DEFERRED: collection happens BEFORE
  // the staged clear of the overrides; the source write runs only when the
  // materializer flushes (idle deadline / navigation boundary), so the preview
  // reload is masked.
  it('queues the pushed overrides and writes them to the .astro on flush', async () => {
    const doc = newDoc();
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');
    seedTextOverride(a, 'h1-0', 'Pushed Heading');

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });
    // deferred: no write yet, but the payload is queued (collected pre-clear)
    expect(runtime.read(SECTION)).toBe('<section><h1>Heading</h1></section>\n');
    expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
    const payloads = await queuedPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(SECTION);
    expect(payloads[0].overrides.textOverrides).toEqual({ 'h1-0': 'Pushed Heading' });
    // overrides were still cleared from the doc after collection
    expect(a.get('overrides')).toBeUndefined();

    await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read(SECTION)).toContain('<h1>Pushed Heading</h1>');
  });

  it('does not leak the page\'s drawn elements into the master .astro', async () => {
    const doc = newDoc();
    doc.getMap('pages').set('page-1', new Y.Map());
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');
    seedTextOverride(a, 'h1-0', 'Pushed Heading');
    // A drawn box on the host page — must NOT appear in the push payload.
    const drawn = new Y.Map<unknown>();
    drawn.set('id', 'drawn-1');
    drawn.set('pageId', 'page-1');
    drawn.set('isDrawn', true);
    drawn.set('tag', 'div');
    doc.getMap<Y.Map<unknown>>('elements').set('drawn-1', drawn);

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });

    const payloads = await queuedPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].overrides.drawnReconcile).toBeUndefined();
  });

  it('root-level sourceClasses edits (edited:true) reach the write-back payload', async () => {
    const doc = newDoc();
    seedInstance(doc, 'el-a', SECTION, '<section class="bg-white"><h1>Heading</h1></section>');
    // Root fill/class edit rides the doc-level sourceClasses tier (task-070).
    const entry = new Y.Map<unknown>();
    entry.set('classes', 'bg-red-500');
    entry.set('edited', true);
    doc.getMap<Y.Map<unknown>>('sourceClasses').set('el-a', entry);
    // Inert registration on a child — must NOT write back.
    const inert = new Y.Map<unknown>();
    inert.set('classes', 'text-6xl');
    doc.getMap<Y.Map<unknown>>('sourceClasses').set('el-a:h1-0', inert);

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });

    const [payload] = await queuedPayloads();
    expect(payload.overrides.classOverrides).toEqual({ 'section-0': 'bg-red-500' });
  });

  // The pre-durable queue merged same-source payloads into one POST. Since
  // 7932857b every accepted Push is its own receipted source-batch command
  // ("never aggregate independently receipted files into one command" —
  // pendingSourceWrites.sourceCommands). What must hold: neither push loses
  // the other's edit, in the queue or on disk.
  it('repeated pushes of the same source each queue their own edit and both reach the .astro', async () => {
    runtime.close();
    runtime = projectFsRuntime(projectId, { [SECTION]: '<section><h1>A</h1><p>B</p></section>\n' });
    const doc = newDoc();
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>A</h1><p>B</p></section>');
    seedTextOverride(a, 'h1-0', 'First push');
    expect((await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    })).ok).toBe(true);
    seedTextOverride(a, 'p-0', 'Second push');
    expect((await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    })).ok).toBe(true);

    const payloads = await queuedPayloads();
    expect(payloads.map(p => p.overrides.textOverrides)).toEqual([{ 'h1-0': 'First push' }, { 'p-0': 'Second push' }]);
    expect(selectMasterMarkup(doc, SECTION)).toContain('First push');
    expect(selectMasterMarkup(doc, SECTION)).toContain('Second push');

    await flushDurableSourceWritesThrough(projectId, 2);
    const source = runtime.read(SECTION);
    expect(source).toContain('<h1>First push</h1>');
    expect(source).toContain('<p>Second push</p>');
  });

  it('settings/no-overrides push queues no write-back', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const doc = newDoc();
    seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SECTION, currentPageId: 'page-1',
    });

    expect(await queuedPayloads()).toEqual([]);
    expect(await db.durableEdits.count()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('resetInstanceToOriginal — drop overrides, no fetch', () => {
  it('clears the placement overrides and does not create a master entry', async () => {
    const doc = newDoc();
    doc.getMap('pages').set('page-1', new Y.Map());
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');
    seedTextOverride(a, 'h1-0', 'Local edit');
    const takeSnapshot = vi.fn();

    const r = await resetInstanceToOriginal({
      doc, dispatch: dispatcher(doc), takeSnapshot,
      instanceId: 'el-a', currentPageId: 'page-1', isBlogSlot: false, builtIn: [],
    });

    expect(r.ok).toBe(true);
    expect(takeSnapshot).toHaveBeenCalled();
    expect(a.get('overrides')).toBeUndefined();
    // reset snaps to the live base — it never bakes a master
    expect(selectMasterMarkup(doc, SECTION)).toBeUndefined();
  });

  it('makes no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const doc = newDoc();
    const a = seedInstance(doc, 'el-a', SECTION, '<section><h1>Heading</h1></section>');
    seedTextOverride(a, 'h1-0', 'Local edit');

    await resetInstanceToOriginal({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', currentPageId: 'page-1', isBlogSlot: false, builtIn: [],
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('push / ↻ on a nested child clears the parent childOverrides (task-098)', () => {
  const SLOT_PATH = 'src/components/library/BlogSlot.astro';
  const CARD_PATH = 'src/components/library/BlogCard.astro';

  // Push's acceptance verifies the target source exists on the project disk.
  beforeEach(() => {
    runtime.close();
    runtime = projectFsRuntime(projectId, {
      [SLOT_PATH]: '<section><slot name="posts" /></section>\n',
      [CARD_PATH]: '<div class="bg-stone-200"><h3>t</h3></div>\n',
    });
  });

  function seedNestedCard(doc: Y.Doc, pageId: string) {
    doc.getMap('pages').set(pageId, new Y.Map());
    const parent = new Y.Map<unknown>();
    parent.set('id', 'el-parent');
    parent.set('pageId', pageId);
    parent.set('astroSource', SLOT_PATH);
    doc.getMap<Y.Map<unknown>>('elements').set('el-parent', parent);

    const card = new Y.Map<unknown>();
    card.set('id', 'el-card');
    card.set('pageId', pageId);
    card.set('parentId', 'el-parent');
    card.set('slotName', 'posts');
    card.set('placementKey', 'posts');
    card.set('astroSource', CARD_PATH);
    // Keys pre-stamped, matching what createElementYMap (addKeysToMarkup) stores.
    card.set('staticMarkup', '<div data-key="el-card:div-0" class="bg-stone-200"><h3 data-key="el-card:h3-0">t</h3></div>');
    card.set('classOverrides', new Y.Map());
    doc.getMap<Y.Map<unknown>>('elements').set('el-card', card);

    // Parent master entry with a per-placement fill on the card root.
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH,
      placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } },
    });
    return card;
  }

  it('push bakes the card (absorbing master-level divergence) and clears the parent entry', async () => {
    const doc = newDoc();
    const card = seedNestedCard(doc, 'page-1');
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-card', selector: 'h3-0', breakpoint: 'base', classes: ['font-bold'],
    });

    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-card', astroSource: CARD_PATH, currentPageId: 'page-1',
    });

    expect(r.ok).toBe(true);
    const cardMaster = selectMasterMarkup(doc, CARD_PATH)!;
    expect(cardMaster).toContain('bg-white');   // parent childOverride absorbed via baseMarkup layering
    expect(cardMaster).toContain('font-bold');  // live override baked
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({}); // parent entry cleared
    expect(((card.get('classOverrides') as Y.Map<unknown> | undefined)?.size ?? 0)).toBe(0);
  });

  it('push is ONE masters transaction (bake + parent-entry clear together)', async () => {
    const doc = newDoc();
    seedNestedCard(doc, 'page-1');
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-card', selector: 'h3-0', breakpoint: 'base', classes: ['font-bold'],
    });
    let fires = 0;
    doc.getMap('masters').observeDeep(() => { fires += 1; });
    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-card', astroSource: CARD_PATH, currentPageId: 'page-1',
    });
    expect(fires).toBe(1);
  });

  it('↻ in the component editor clears the parent entry without touching masters[child]', async () => {
    const doc = newDoc();
    const card = seedNestedCard(doc, COMPONENT_EDITOR_PAGE_ID);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-card', selector: 'h3-0', breakpoint: 'base', classes: ['font-bold'],
    });

    await resetInstanceToOriginal({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-card', currentPageId: COMPONENT_EDITOR_PAGE_ID, isBlogSlot: false, builtIn: [],
    });

    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({});
    // task-118: the override write itself lazily creates masters[CARD_PATH]
    // (data-sq-id anchor, rev 0). Reset must still not BAKE into it: no
    // override classes in the markup, rev untouched.
    const cardMaster = selectMasterMarkup(doc, CARD_PATH);
    expect(cardMaster ?? '').not.toContain('font-bold');
    expect(readMasterMarkupRev(doc, CARD_PATH)).toBe(0);
    expect(((card.get('classOverrides') as Y.Map<unknown> | undefined)?.size ?? 0)).toBe(0);
  });

  it('↻ on a CANVAS card leaves the parent childOverrides intact (entry belongs to the BlogSlot master)', async () => {
    const doc = newDoc();
    seedNestedCard(doc, 'page-1');

    await resetInstanceToOriginal({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-card', currentPageId: 'page-1', isBlogSlot: false, builtIn: [],
    });

    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-white'] } } });
  });
});
