// task-101 → task-102 — BlogSlot settings under the ONE-LOGIC sparse
// inheritance contract (docs/plans/2026-07-03-unified-blog-settings-inheritance-design.md):
//   rule 1: master change, untouched instance → follows live, NO indicator
//   rule 2: instance override, master silent → * (diverged), never ↻
//   rule 3: instance override THEN master bump on that field → ↻ (outdated)
// * = override existence (not value comparison); ↻ = existence + master rev
// moved past my baseRev + a conflicting field actually differs.
//
// Durable contract (7932857b / c8535b79): Push and ↻ are async and run in the
// durable acceptance lane — the doc needs a projectId and IndexedDB.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { applyCommand } from '../commands';
import { pushInstanceToSource, resetInstanceToOriginal } from '../instanceLifecycle';
import { selectMasterMarkup } from '../masters';
import type { EditorCommand } from '../types';
import {
  BLOG_SLOT_DEFAULTS_KEY,
  BLOG_SLOT_COMPONENT_TYPE,
  UNBOUND_COLLECTION_ID,
} from '@/core/collections/types';
import {
  blogSlotSettingsDivergence,
  blogSlotSettingsOutdated,
  resolveBlogSettings,
  readBlogSettingsRaw,
  readMasterSettingsRev,
  readInstanceSettingsBaseRev,
} from '@/core/collections/yjsAccessors';

const SLOT_SOURCE = 'src/components/library/BlogSlot.astro';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_blogslot_push_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, {
    [SLOT_SOURCE]: '<div><article data-blog-source="posts">card</article></div>\n',
    'src/components/Section.astro': '<section/>\n',
  });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });

/** A project doc: projectId (durable lane) + the page the placements live on. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  doc.getMap('pages').set('page-1', new Y.Map());
  return doc;
}

function dispatcher(doc: Y.Doc) {
  return (c: EditorCommand) => applyCommand(doc, c);
}

/** Canvas BlogSlot instance element (componentType drives push's isBlogSlot detection). */
function seedBlogSlot(doc: Y.Doc, id: string) {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  el.set('astroSource', SLOT_SOURCE);
  el.set('staticMarkup', '<div><article data-blog-source="posts">card</article></div>');
  el.set('componentType', BLOG_SLOT_COMPONENT_TYPE);
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

function setSettings(doc: Y.Doc, slotKey: string, settings: Record<string, unknown>) {
  applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey, settings } as EditorCommand);
}

describe('blogSlotSettingsDivergence — * = override existence', () => {
  it('master untouched + untouched instance → null (no false asterisk)', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
  });

  it('rule 2: instance override, master silent → diverged, returns resolved settings', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    const d = blogSlotSettingsDivergence(doc, 'el-a');
    expect(d).not.toBeNull();
    expect(d!.postsPerPage).toBe(6);
    expect(d!.pagination).toBe('none'); // inherited app default fills the rest
  });

  it('override EQUAL to the master value still counts (existence, not comparison)', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { sortBy: 'title-asc' });
    setSettings(doc, 'el-a', { sortBy: 'title-asc' });
    expect(blogSlotSettingsDivergence(doc, 'el-a')).not.toBeNull();
  });

  it('rule 1: master change alone never lights the asterisk', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 9, pagination: 'numbered' });
    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
  });

  it('a structural pagination child alone (no raw override) is NOT a settings divergence', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    const child = new Y.Map<unknown>();
    child.set('id', 'el-a-pg');
    child.set('parentId', 'el-a');
    child.set('slotName', 'pagination');
    child.set('componentType', 'BlogPaginationNumbered');
    doc.getMap<Y.Map<unknown>>('elements').set('el-a-pg', child);
    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
  });
});

describe('blogSlotSettingsOutdated — ↻ = overrides exist AND master moved past my edit', () => {
  it('rule 1: master change, untouched instance → NO indicator (follows live)', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 6 });
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
    expect(resolveBlogSettings(doc, 'el-a').postsPerPage).toBe(6); // live inheritance
  });

  it('rule 2: instance override, master silent → diverged=* true, outdated=↻ false', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    expect(blogSlotSettingsDivergence(doc, 'el-a')).not.toBeNull();
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
  });

  it('rule 3: instance override THEN master bump on that field → outdated=↻ true', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 9 });
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(true);
  });

  it('master bump on a field I did NOT override → no ↻ (no nag)', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { sortBy: 'title-asc' });
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
    expect(blogSlotSettingsDivergence(doc, 'el-a')).not.toBeNull(); // still *
  });

  it('re-editing locally after a master bump re-bases → ↻ clears', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 9 });
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(true);
    setSettings(doc, 'el-a', { postsPerPage: 12 }); // restamps baseRev
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
  });

  it('override equal to the master value after its bump → no ↻ (nothing actually differs)', () => {
    const doc = new Y.Doc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 9 });
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 9 }); // rev moved, values agree
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
  });
});

describe('pushInstanceToSource — settings push under sparse inheritance', async () => {
  it('push writes resolved settings to defaults, bumps rev, clears own overrides', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6, sortBy: 'title-asc' });
    const takeSnapshot = vi.fn();

    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot,
      instanceId: 'el-a', astroSource: SLOT_SOURCE, currentPageId: 'page-1',
    });

    expect(r.ok).toBe(true);
    expect(takeSnapshot).toHaveBeenCalled();
    const pushed = readBlogSettingsRaw(doc, BLOG_SLOT_DEFAULTS_KEY);
    // ALL 4 synced fields land (master baseline fully defined after first push)
    expect(pushed).toMatchObject({ postsPerPage: 6, sortBy: 'title-asc', pagination: 'none', postLinkMode: 'auto' });
    expect(readMasterSettingsRev(doc)).toBe(1);
    // own overrides cleared — instance now INHERITS what it pushed
    expect(readBlogSettingsRaw(doc, 'el-a')).toEqual({});
    expect(readInstanceSettingsBaseRev(doc, 'el-a')).toBe(1);
    // settings-only push must NOT bake/churn the masters overlay
    expect(selectMasterMarkup(doc, SLOT_SOURCE)).toBeUndefined();
  });

  it('after push, this instance shows neither * nor ↻; a conflicting sibling shows ↻', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    seedBlogSlot(doc, 'el-b');
    seedBlogSlot(doc, 'el-c');
    setSettings(doc, 'el-b', { postsPerPage: 12 }); // conflicting override, baseRev 0
    setSettings(doc, 'el-a', { postsPerPage: 6 });

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SLOT_SOURCE, currentPageId: 'page-1',
    });

    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
    // untouched sibling follows live, no indicator
    expect(blogSlotSettingsOutdated(doc, 'el-c')).toBe(false);
    expect(resolveBlogSettings(doc, 'el-c').postsPerPage).toBe(6);
    // conflicting sibling: master moved past its edit → ↻
    expect(blogSlotSettingsOutdated(doc, 'el-b')).toBe(true);
  });

  it('Phase-5 pin: push never writes a real collectionId and never touches the master element id', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });

    await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SLOT_SOURCE, currentPageId: 'page-1',
    });

    const bindings = doc.getMap('blogSlotBindings');
    const defaults = bindings.get(BLOG_SLOT_DEFAULTS_KEY) as Y.Map<unknown>;
    expect(defaults.get('collectionId')).toBe(UNBOUND_COLLECTION_ID);
    // only the defaults key + the instance's own binding exist — nothing keyed by a master element id
    expect([...bindings.keys()].sort()).toEqual([BLOG_SLOT_DEFAULTS_KEY, 'el-a'].sort());
  });

  it('repeat push is blocked (overrides cleared by the first push)', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    const push = () => pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SLOT_SOURCE, currentPageId: 'page-1',
    });
    expect((await push()).ok).toBe(true);
    const second = await push();
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('No local overrides to push');
  });

  it('combined markup + settings push does both', async () => {
    const doc = newDoc();
    const el = seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    // markup override (same shape pushBakesMaster.test.ts uses)
    const overrides = new Y.Map<Y.Map<unknown>>();
    const o = new Y.Map<unknown>();
    o.set('text', 'Pushed');
    overrides.set('article-0', o);
    el.set('overrides', overrides);

    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SLOT_SOURCE, currentPageId: 'page-1',
    });

    expect(r.ok).toBe(true);
    expect(selectMasterMarkup(doc, SLOT_SOURCE)).toContain('Pushed');
    expect(readBlogSettingsRaw(doc, BLOG_SLOT_DEFAULTS_KEY).postsPerPage).toBe(6);
    expect(readBlogSettingsRaw(doc, 'el-a')).toEqual({});
    expect(el.get('overrides')).toBeUndefined();
  });

  it('non-BlogSlot instance with no overrides still refuses (settings branch is BlogSlot-only)', async () => {
    const doc = newDoc();
    const el = new Y.Map<unknown>();
    el.set('id', 'el-x'); el.set('pageId', 'page-1');
    el.set('astroSource', 'src/components/Section.astro');
    el.set('staticMarkup', '<section/>');
    doc.getMap<Y.Map<unknown>>('elements').set('el-x', el);
    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-x', astroSource: 'src/components/Section.astro', currentPageId: 'page-1',
    });
    expect(r.ok).toBe(false);
  });
});

describe('resetInstanceToOriginal — settings reset (master wins)', async () => {
  it('reset deletes sparse overrides → * clears immediately (regression: lingering asterisk)', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    expect(blogSlotSettingsDivergence(doc, 'el-a')).not.toBeNull();

    await resetInstanceToOriginal({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', currentPageId: 'page-1', isBlogSlot: true, builtIn: [],
    });

    expect(readBlogSettingsRaw(doc, 'el-a')).toEqual({});
    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
  });

  it('↻ click (reset) after a conflicting master bump → instance follows master, indicator gone', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    setSettings(doc, 'el-a', { postsPerPage: 6 });
    setSettings(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 9 });
    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(true);

    await resetInstanceToOriginal({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', currentPageId: 'page-1', isBlogSlot: true, builtIn: [],
    });

    expect(blogSlotSettingsOutdated(doc, 'el-a')).toBe(false);
    expect(blogSlotSettingsDivergence(doc, 'el-a')).toBeNull();
    expect(resolveBlogSettings(doc, 'el-a').postsPerPage).toBe(9); // follows master live
  });
});

describe('push guard ignores inert sourceClasses registrations (task-102)', async () => {
  it('a click-registered (non-edited) entry alone does NOT enable push', async () => {
    const doc = newDoc();
    seedBlogSlot(doc, 'el-a');
    const entry = new Y.Map<unknown>();
    entry.set('classes', 'rounded-lg old-classes'); // registration cache, no edited flag
    doc.getMap('sourceClasses').set('el-a:article-0', entry);

    const r = await pushInstanceToSource({
      doc, dispatch: dispatcher(doc), takeSnapshot: vi.fn(),
      instanceId: 'el-a', astroSource: SLOT_SOURCE, currentPageId: 'page-1',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('No local overrides to push');
  });
});
