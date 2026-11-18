// Gap 38 (task-148 remainder): AI structural ops in the LOCAL (files-truth)
// runtime were dead or lying — delete/move took doc ids only (file-keyed
// scanned elements unreachable), and layout/SEO tools mutated the disposable
// session doc while reporting success (local iframes never receive doc-RENDER,
// and the doc evaporates on reopen).
//
// delete_element / move_element now route through THE SAME modules the UI uses
// (localStructuralOps deleteLocalElement / moveLocalElement + the reparent
// planner); layout tools refuse honestly (SEO tools: localSeoTools.test.ts). Non-local pins at the bottom.
//
// Contract (426889ee / fdd2d12f): local delete/move no longer call
// viteStructuralWriter.writeRemove/writeMove — they run a durable source
// gesture (prepareSourceGesture → acceptFileChanges) against the instance's
// route table. The tests drive the REAL route table on a temp disk
// (projectFsRuntime) and assert the resulting file bytes.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';

vi.mock('@/services/ViteStructuralWriter', () => ({
  viteStructuralWriter: {
    writeInsert: vi.fn(),
    writeAppendPage: vi.fn(),
    writeRemove: vi.fn(),
    writeMove: vi.fn(),
    writeImport: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { _resetStructuralWriteInFlightForTests, releaseStructuralWrite, tryAcquireStructuralWrite } from '@/components/Editor/localStructuralOps';
import { _resetLocalPageSyncForTests, setLocalPageFile } from '@/utils/localPageSync';
import { generateCommandTools } from '../commandTools';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ScannedLayout } from '@/hooks/useLayoutLibrary';

const writeRemove = viteStructuralWriter.writeRemove as ReturnType<typeof vi.fn>;
const writeMove = viteStructuralWriter.writeMove as ReturnType<typeof vi.fn>;

const PAGE_FILE = 'src/pages/index.astro';
// Fresh id per test: the durable/materializer/projection layers keep
// in-memory state keyed by projectId that outlives db.delete().
let PROJECT_ID = '';
// Line/column layout matches the scanned keys below: main 5:1, <Card /> usage
// 7:3, hero section 9:1.
const PAGE_SOURCE = [
  '---',
  "import Card from '../components/Card.astro';",
  '---',
  '',
  '<main>',
  '  <h1>Title</h1>',
  '  <Card />',
  '</main>',
  '<section>hero</section>',
  '',
].join('\n');
const CARD_SOURCE = '---\n---\n<article>card</article>\n';
let runtime: ReturnType<typeof projectFsRuntime>;

function scanned(partial: Partial<ScannedElement> & { key: string; tagName: string }): ScannedElement {
  return {
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: null,
    hasSourceTracking: true,
    ...partial,
  } as ScannedElement;
}

const mainEl = scanned({
  key: `${PAGE_FILE}:5:1`,
  tagName: 'main',
  sourceLocation: { file: PAGE_FILE, line: 5, column: 1 },
});
const heroEl = scanned({
  key: `${PAGE_FILE}:9:1`,
  tagName: 'section',
  sourceLocation: { file: PAGE_FILE, line: 9, column: 1 },
});
/** Rendered by a component: own file is the COMPONENT's, usage tag in the page. */
const cardRootEl = scanned({
  key: 'src/components/Card.astro:3:1',
  tagName: 'article',
  sourceLocation: { file: 'src/components/Card.astro', line: 3, column: 1 },
  usageLocation: { file: PAGE_FILE, line: 7, column: 3 },
});
/** Component-rendered, NO usage tag in the page file — must stay refused. */
const orphanCompEl = scanned({
  key: 'src/components/Nav.astro:2:1',
  tagName: 'nav',
  sourceLocation: { file: 'src/components/Nav.astro', line: 2, column: 1 },
});
const SCAN = [mainEl, heroEl, cardRootEl, orphanCompEl];

const testLayout: ScannedLayout = {
  name: 'BaseLayout',
  path: 'layouts/BaseLayout.astro',
  props: [],
  slots: ['default'],
} as unknown as ScannedLayout;

function seedPage(doc: Y.Doc, pageId: string) {
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('rootElementIds', new Y.Array());
  doc.getMap('pages').set(pageId, page);
}

/** ctx for a local_ project showing page "index" backed by PAGE_FILE. */
function localCtx(over: Parameters<typeof makeCtx>[0] = {}) {
  const ctx = makeCtx({
    currentPageId: 'index',
    getScannedElements: () => SCAN,
    getCurrentPageFile: () => PAGE_FILE,
    layoutLibrary: [testLayout],
    ...over,
  });
  ctx.doc.getMap('meta').set('projectId', PROJECT_ID);
  seedPage(ctx.doc, 'index');
  // The cross-file law reads the surface file from module state (Editor arms
  // it in real usage) — arm it or every same-file write classifies 'unknown'
  // → cross-file and refuses.
  setLocalPageFile(PAGE_FILE);
  return ctx;
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  PROJECT_ID = `browser_lf_${crypto.randomUUID()}`;
  markFilesTruth(PROJECT_ID); // mode lives in the registry, never the id
  setActiveSaveProjectId(PROJECT_ID);
  runtime = projectFsRuntime(PROJECT_ID, {
    [PAGE_FILE]: PAGE_SOURCE,
    'src/components/Card.astro': CARD_SOURCE,
  });
});

afterEach(() => {
  runtime.close();
  unmarkFilesTruth(PROJECT_ID);
  setActiveSaveProjectId(null);
  unmarkFilesTruth('browser_release');
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Materialize every accepted edit, then read the page file from disk. */
async function pageOnDisk() {
  await flushDurableSourceWrites(PROJECT_ID);
  return runtime.read(PAGE_FILE);
}

// ============================================================================
// delete_element — local routes through deleteLocalElement (files-truth)
// ============================================================================

describe('delete_element (local)', () => {
  it('removes a page-file element via writeRemove and pushes a restore undo', async () => {
    const pushStructuralUndo = vi.fn();
    const ctx = localCtx({ pushStructuralUndo });
    const tools = generateCommandTools(ctx);
    const result = await (tools.delete_element as ExecTool).execute({ elementId: heroEl.key });
    expect(result.success).toBe(true);
    expect(await pageOnDisk()).not.toContain('<section>hero</section>');
    expect(runtime.read(PAGE_FILE)).toContain('<main>');
    // The doc is a disposable session copy — no doc mutation on this path.
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(pushStructuralUndo).toHaveBeenCalledTimes(1);
    const record = pushStructuralUndo.mock.calls[0][0];
    expect(record.structuralOp.forward[0]).toMatchObject({ kind: 'remove', loc: { file: PAGE_FILE, line: 9, column: 1 }, allowRootRemoval: true });
    expect(record.structuralOp.inverse.at(-1)).toMatchObject({
      kind: 'restore',
      text: expect.stringContaining('<section>hero</section>'),
    });
  });

  it('re-targets a component root to its <Component /> usage tag in the page file', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.delete_element as ExecTool).execute({ elementId: cardRootEl.key });
    expect(result.success).toBe(true);
    // The <Card /> usage tag left the PAGE; the component file is untouched.
    expect(await pageOnDisk()).not.toContain('<Card />');
    expect(runtime.read(PAGE_FILE)).toContain('<h1>Title</h1>');
    expect(runtime.read('src/components/Card.astro')).toBe(CARD_SOURCE);
  });

  it('refuses a doc-style id with a sourceKey steer, NO write', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.delete_element as ExecTool).execute({ elementId: 'element-123-abc' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/sourceKey/i);
    expect(await db.durableEdits.count()).toBe(0);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('cross-file element with no page usage → success:false, component file untouched', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.delete_element as ExecTool).execute({ elementId: orphanCompEl.key });
    expect(result.success).toBe(false);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read('src/components/Card.astro')).toBe(CARD_SOURCE);
    expect(runtime.read(PAGE_FILE)).toBe(PAGE_SOURCE);
  });

  it('failed write → success:false, never false success', async () => {
    // The write is a durable acceptance now — refuse it at the store.
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValue(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.delete_element as ExecTool).execute({ elementId: heroEl.key });
    expect(result.success).toBe(false);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read(PAGE_FILE)).toBe(PAGE_SOURCE);
  });

  // Owner 2026-11-10: no refusal — the delete waits its turn, then lands.
  it('another structural write in flight → waits its turn, then deletes', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // simulate pending op
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const pending = (tools.delete_element as ExecTool).execute({ elementId: heroEl.key });
    await new Promise((r) => setTimeout(r, 0));
    expect(await db.durableEdits.count()).toBe(0);
    releaseStructuralWrite();
    expect((await pending).success).toBe(true);
    expect(await db.durableEdits.count()).toBe(1);
  });
});

// ============================================================================
// move_element — local routes through the reparent planner + moveLocalElement
// ============================================================================

describe('move_element (local)', () => {
  it('expresses (parent,index) as a before-anchor and writes via writeMove', async () => {
    const pushStructuralUndo = vi.fn();
    const ctx = localCtx({ pushStructuralUndo });
    const tools = generateCommandTools(ctx);
    // Move hero to root index 0 → anchor: before main (same planner as the canvas drop).
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: heroEl.key, newParentKey: null, insertIndex: 0,
    });
    expect(result.success).toBe(true);
    const disk = await pageOnDisk();
    expect(disk.indexOf('<section>hero</section>')).toBeGreaterThan(-1);
    expect(disk.indexOf('<section>hero</section>')).toBeLessThan(disk.indexOf('<main>'));
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(pushStructuralUndo).toHaveBeenCalledTimes(1);
    expect(pushStructuralUndo.mock.calls[0][0].structuralOp.forward[0]).toMatchObject({
      kind: 'move',
      from: { file: PAGE_FILE, line: 9, column: 1 },
      to: { file: PAGE_FILE, line: 5, column: 1 },
      position: 'before',
      allowRootRemoval: true,
    });
  });

  it('reparent INTO a container with no children → inside-end of the parent', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: heroEl.key, newParentKey: mainEl.key, insertIndex: 0,
    });
    expect(result.success).toBe(true);
    // Last child of <main>: after <Card />, before </main>.
    const disk = await pageOnDisk();
    const hero = disk.indexOf('<section>hero</section>');
    expect(hero).toBeGreaterThan(disk.indexOf('<Card />'));
    expect(hero).toBeLessThan(disk.indexOf('</main>'));
    expect(disk.match(/<section>hero<\/section>/g)).toHaveLength(1);
  });

  it('refuses a non-current pageId (local writes target the shown page only)', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'about', elementKey: heroEl.key, newParentKey: null, insertIndex: 0,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/select_page/);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('refuses a doc-style elementKey with a sourceKey steer', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: 'element-123', newParentKey: null, insertIndex: 0,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/sourceKey/i);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('no anchorable sibling and no anchorable parent → honest failure', async () => {
    // Only the dragged element itself at the root — nothing to anchor to.
    const ctx = localCtx({ getScannedElements: () => [heroEl] });
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: heroEl.key, newParentKey: null, insertIndex: 0,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/anchor/i);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('failed write → success:false, never false success', async () => {
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValue(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: heroEl.key, newParentKey: null, insertIndex: 0,
    });
    expect(result.success).toBe(false);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read(PAGE_FILE)).toBe(PAGE_SOURCE);
  });
});

// ============================================================================
// layout tools — doc-only SET_PAGE_LAYOUT renders nothing in local: they edit
// the page FILE (localSourceTools.ts, covered in localSourceTools.test.ts)
// ============================================================================

describe('layout tools (local)', () => {
  it.each(['apply_layout', 'detach_layout', 'set_layout_props'] as const)(
    '%s never dispatches a doc command and reports a failed file edit',
    async (toolName) => {
      const ctx = localCtx();
      const tools = generateCommandTools(ctx);
      const params = toolName === 'apply_layout'
        ? { pageId: 'index', layoutName: 'BaseLayout' }
        : toolName === 'set_layout_props'
          ? { pageId: 'index', props: { theme: 'dark' } }
          : { pageId: 'index' };
      const result = await (tools[toolName] as ExecTool).execute(params);
      // No BaseLayout in this project / the page has no layout → an honest failure.
      expect(result.success).toBe(false);
      expect(ctx.dispatch).not.toHaveBeenCalled();
    },
  );
});

// ============================================================================
// non-local pins — the doc path stays byte-identical
// ============================================================================

describe('non-local projects keep the doc path', () => {
  function nonLocalCtx() {
    const ctx = makeCtx({
      currentPageId: 'index',
      getScannedElements: () => SCAN,
      layoutLibrary: [testLayout],
    });
    ctx.doc.getMap('meta').set('projectId', 'browser_xyz');
    seedPage(ctx.doc, 'index');
    return ctx;
  }

  it('delete_element dispatches REMOVE_ELEMENT, never the local writer', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.delete_element as ExecTool).execute({ elementId: 'element-123' });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'REMOVE_ELEMENT' }));
    expect(writeRemove).not.toHaveBeenCalled();
  });

  it('move_element dispatches REPARENT_ELEMENT, never the local writer', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: 'element-123', newParentKey: null, insertIndex: 0,
    });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'REPARENT_ELEMENT' }));
    expect(writeMove).not.toHaveBeenCalled();
  });

  it('apply_layout dispatches SET_PAGE_LAYOUT', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.apply_layout as ExecTool).execute({ pageId: 'index', layoutName: 'BaseLayout' });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PAGE_LAYOUT' }));
  });

  it('update_page_seo dispatches UPDATE_PAGE_SEO', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.update_page_seo as ExecTool).execute({
      pageId: 'index', field: 'title', value: 'Hello',
    });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_PAGE_SEO' }));
  });
});
