// add_page_content honesty: no fake "component" type, explicit index support,
// and parented adds append after existing siblings instead of clobbering index 0.
//
// Contract (fdd2d12f): the doc path no longer goes through ctx.dispatch — the
// add is durably ACCEPTED (acceptEditorCommands → durableEdits). So the tests
// need a projectId + IndexedDB (fake-indexeddb) and assert on the accepted doc.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { getDurableProjectState } from '@/services/durableEdits/store';
import { generateCommandTools } from '../commandTools';
import { commandRegistry } from '../commandRegistry';
import { applyCommand } from '@/store/commands';
import type { ClassData } from '@/store/types';
import { makeCtx, type ExecTool } from './testCtx';

const emptyClasses = (): ClassData => ({ base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] });

const PROJECT_ID = 'browser_add_page_content';

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The accepted element the tool reported (by result.data.elementId). */
function added(ctx: ReturnType<typeof makeCtx>, result: { data?: Record<string, unknown> }) {
  const id = result.data?.elementId as string | undefined;
  return id ? (ctx.doc.getMap('elements') as Y.Map<Y.Map<unknown>>).get(id) : undefined;
}
function rootIds(ctx: ReturnType<typeof makeCtx>, pageId = 'page-1') {
  return ((ctx.doc.getMap('pages').get(pageId) as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>).toArray();
}

/** Seed a minimal page so page-existence validation passes (+ the projectId
 *  durable acceptance needs). */
function seedPage(ctx: ReturnType<typeof makeCtx>, pageId = 'page-1') {
  ctx.doc.getMap('meta').set('projectId', PROJECT_ID);
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('rootElementIds', new Y.Array());
  ctx.doc.getMap('pages').set(pageId, page);
}

describe('add_page_content', () => {
  it('fails loudly for an unknown pageId instead of creating an invisible orphan', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'ghost-page', type: 'frame', staticMarkup: '<div>x</div>',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  // Contract change (2026-07-23): markup-less ROOT frames were the systematic
  // "2 invisible divs on every run, every model" source — the schema's
  // "layout containers" wording taught scaffold-first, and this path succeeded
  // with only a warning. Root frames now REQUIRE staticMarkup; parented empty
  // frames (inner structure) stay legal.
  it('rejects a markup-less ROOT frame (the invisible-scaffold hole)', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', classes: 'grid grid-cols-2 gap-8',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/staticMarkup/);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('beforeId anchors a new root section before the target (afterId: after)', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    for (const [id, index] of [['a', 0], ['b', 1]] as const) {
      applyCommand(ctx.doc, {
        type: 'ADD_ELEMENT',
        element: { id, pageId: 'page-1', parentId: null, index, type: 'frame', staticMarkup: '<div>x</div>', classes: emptyClasses() },
      });
    }
    const tools = generateCommandTools(ctx);
    const first = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div>new</div>', beforeId: 'b',
    });
    expect(first.success).toBe(true);
    const newId = first.data?.elementId as string;
    expect(added(ctx, first)?.get('parentId') ?? null).toBeNull();
    expect(rootIds(ctx)).toEqual(['a', newId, 'b']);
    const second = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div>new2</div>', afterId: 'a',
    });
    expect(second.success).toBe(true);
    expect(rootIds(ctx)).toEqual(['a', second.data?.elementId, newId, 'b']);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('fails with steering when the anchor id is not a root of the page', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div>x</div>', beforeId: 'ghost',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/read_page_content/);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  // The add is no longer a ctx.dispatch (fdd2d12f) — the rejection that must
  // propagate is the durable acceptance refusing (e.g. storage quota).
  it('propagates a rejected durable acceptance as failure, nothing added', async () => {
    vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div>x</div>',
    });
    expect(result.success).toBe(false);
    expect(rootIds(ctx)).toEqual([]);
    expect(await db.durableEdits.count()).toBe(0);
  });
  it('schema rejects the removed "component" type', () => {
    const parsed = commandRegistry.add_page_content.schema.safeParse({
      pageId: 'page-1',
      type: 'component',
      staticMarkup: '<div></div>',
    });
    expect(parsed.success).toBe(false);
  });

  it('parented add with explicit index accepts ADD_ELEMENT at that index', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div></div>', parentId: 'parent-1', index: 2,
    });
    expect(result.success).toBe(true);
    expect(added(ctx, result)?.toJSON()).toMatchObject({ parentId: 'parent-1', index: 2 });
    expect(await getDurableProjectState(PROJECT_ID)).toMatchObject({ acceptedRevision: 1 });
  });

  // Guards (2026-07-23): weak models scaffold empty containers ("fill later")
  // and spam bare fragments as separate root adds — the page fills with
  // invisible roots / one drag handle per fragment. One add = ONE complete,
  // visible section.
  it('rejects ROOT markup that renders empty (scaffold-then-fill pattern)', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame',
      staticMarkup: "<div class='py-16 bg-gray-100'><div class='max-w-6xl'></div></div>",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/renders empty/i);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('parented empty-markup adds stay allowed (inner structure containers)', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    applyCommand(ctx.doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'parent-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: emptyClasses() },
    });
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div></div>', parentId: 'parent-1',
    });
    expect(result.success).toBe(true);
  });

  it('wraps multi-top-level ROOT markup into ONE section (one add = one root = one handle)', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame',
      staticMarkup: "<img src='/x.png' alt='a'/><h2>Title</h2><p>Copy</p>",
    });
    expect(result.success).toBe(true);
    // Accepted markup carries data-key stamps (addKeysToMarkup) — match tags, not bytes.
    const markup = added(ctx, result)?.get('staticMarkup') as string;
    expect(markup).toMatch(/^<section/);
    expect(markup).toMatch(/<h2[^>]*>Title<\/h2>/);
    expect(markup).toMatch(/<p[^>]*>Copy<\/p>/);
    expect(rootIds(ctx)).toEqual([result.data?.elementId]);
  });

  it('strips a classless passthrough <div> wrapper around a single <section>', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame',
      staticMarkup: "<div><section class='py-16'><h2>T</h2><p>c</p></section></div>",
    });
    expect(result.success).toBe(true);
    expect((added(ctx, result)?.get('staticMarkup') as string).startsWith('<section')).toBe(true);
  });

  it('keeps a CLASSED div root — its styling is meaningful', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame',
      staticMarkup: "<div class='bg-black py-16'><section><h2>T</h2></section></div>",
    });
    expect(result.success).toBe(true);
    expect((added(ctx, result)?.get('staticMarkup') as string).startsWith('<div')).toBe(true);
  });

  it('parented add without index appends after existing siblings', async () => {
    const ctx = makeCtx();
    seedPage(ctx);
    // Seed two existing children of parent-1 through the real command path.
    for (const id of ['child-a', 'child-b']) {
      applyCommand(ctx.doc, {
        type: 'ADD_ELEMENT',
        element: { id, pageId: 'page-1', parentId: 'parent-1', index: 0, type: 'frame', classes: emptyClasses() },
      });
    }
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<div></div>', parentId: 'parent-1',
    });
    expect(result.success).toBe(true);
    expect(added(ctx, result)?.toJSON()).toMatchObject({ parentId: 'parent-1', index: 2 });
  });
});
