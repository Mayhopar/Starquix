// task-133 Task 9: AI structural tools in the LOCAL (files-truth) runtime.
// Kills the "false success" lie: doc-only commands render NOTHING in a local
// iframe (no doc-RENDER), so every structural tool must either produce a
// resolved real-file write or return {success:false} with the reason.
// Non-local behavior stays byte-identical (pins at the bottom).
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { getDurableProjectState } from '@/services/durableEdits/store';

vi.mock('@/services/ViteStructuralWriter', () => ({
  viteStructuralWriter: {
    writeInsert: vi.fn(),
    writeAppendPage: vi.fn(),
    writeRemove: vi.fn(),
    writeMove: vi.fn(),
    writeImport: vi.fn(),
  },
}));
vi.mock('@/components/Editor/localComponentInsert', () => ({
  insertLocalComponent: vi.fn(),
}));
vi.mock('@/components/Canvas/localDrawInsert', () => ({
  insertLocalDrawnElement: vi.fn(),
}));
vi.mock('@/store/localPages', () => ({
  createLocalDocPage: vi.fn(),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { insertLocalComponent } from '@/components/Editor/localComponentInsert';
import { insertLocalDrawnElement } from '@/components/Canvas/localDrawInsert';
import { _resetStructuralWriteInFlightForTests, releaseStructuralWrite, tryAcquireStructuralWrite } from '@/components/Editor/localStructuralOps';
import { createLocalDocPage } from '@/store/localPages';
import { markFilesTruth, filesTruthPath } from '@/utils/localMode';
import {
  setLocalExpectedRoute,
  setLocalScannedRoute,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const writeInsert = viteStructuralWriter.writeInsert as ReturnType<typeof vi.fn>;
const writeAppendPage = viteStructuralWriter.writeAppendPage as ReturnType<typeof vi.fn>;
const mockComponentInsert = insertLocalComponent as ReturnType<typeof vi.fn>;
const mockDrawInsert = insertLocalDrawnElement as ReturnType<typeof vi.fn>;

const PAGE_FILE = 'src/pages/index.astro';

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
const SCAN = [mainEl];

const userComp: ScannedComponent = {
  name: 'Hero',
  path: 'src/components/Hero.astro',
  source: 'user-project',
  html: '<section>hero</section>',
  category: '',
  props: [],
  slots: [],
  dependencies: [],
};
const builtinComp: ScannedComponent = {
  ...userComp,
  name: 'Navbar',
  path: 'library/Navbar.astro',
  source: 'built-in',
};

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
    componentLibrary: [userComp, builtinComp],
    ...over,
  });
  ctx.doc.getMap('meta').set('projectId', 'browser_lf_abc123');
  seedPage(ctx.doc, 'index');
  return ctx;
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  writeInsert.mockResolvedValue({ success: true, insertedLine: 12, file: PAGE_FILE });
  writeAppendPage.mockResolvedValue({
    success: true, insertedLine: 6, file: PAGE_FILE,
    replacedLine: 6, replacedLineCount: 1, originalSegment: '',
  });
  mockComponentInsert.mockResolvedValue({ ok: true, file: PAGE_FILE, insertedLine: 7 });
  mockDrawInsert.mockResolvedValue({ ok: true, file: PAGE_FILE, insertedLine: 9 });
});

afterEach(() => {
  _resetStructuralWriteInFlightForTests();
  vi.unstubAllGlobals();
});

// ============================================================================
// add_page_content — local branch writes the REAL file
// ============================================================================

describe('add_page_content (local)', () => {
  it('writes frame markup via writeInsert and succeeds only on a resolved write', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section><h1>Hi</h1></section>',
    });
    expect(result.success).toBe(true);
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE_FILE, line: 5, column: 1 },
      '<section><h1>Hi</h1></section>',
      'inside-end',
    );
    // No doc mutation on the local path — the doc is a disposable session copy.
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ file: PAGE_FILE, insertedLine: 12 });
  });

  it('does NOT brace-escape AI markup (Astro expressions are legitimate)', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section><h1>Hi {name}</h1></section>',
    });
    expect(writeInsert.mock.calls[0][1]).toBe('<section><h1>Hi {name}</h1></section>');
  });

  it('does NOT wrap multi-root markup in a data-with-props section (doc machinery)', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<h2>A</h2><p>B</p>',
    });
    expect(writeInsert.mock.calls[0][1]).toBe('<h2>A</h2><p>B</p>');
  });

  it('brace-escapes TEXT content (type "text") — user text is not Astro code', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'text', tag: 'h2', textContent: 'Cost: {price}',
    });
    expect(result.success).toBe(true);
    const written = writeInsert.mock.calls[0][1] as string;
    expect(written).toContain('<h2');
    expect(written).toContain('&#123;price&#125;');
    expect(written).not.toContain('{price}');
  });

  it('returns success:false when the write does not resolve', async () => {
    writeInsert.mockResolvedValue({ success: false });
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not changed/i);
  });

  it('returns success:false when the writer throws', async () => {
    writeInsert.mockRejectedValue(new Error('write channel down'));
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('write channel down');
  });

  it('fails honestly when the page has no backing source file', async () => {
    const ctx = localCtx({ getCurrentPageFile: () => null });
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/source file/i);
    expect(writeInsert).not.toHaveBeenCalled();
  });

  // Fix 1 (task-148) REVERSES the old refusal: an empty/component-only scan is
  // the normal shape of a layout-based page, not a "not ready" state — it now
  // routes to the page-body anchor (see the page-body describe block below).
  it('empty scan → page-body append, never a refusal', async () => {
    const ctx = localCtx({ getScannedElements: () => [] });
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(result.success).toBe(true);
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).toHaveBeenCalledWith(PAGE_FILE, '<section>x</section>');
  });

  it('refuses a non-current pageId (local writes target the shown page only)', async () => {
    const ctx = localCtx();
    seedPage(ctx.doc, 'about');
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'about', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/select_page/);
    expect(writeInsert).not.toHaveBeenCalled();
  });

  // Owner 2026-11-10: no "retry in a moment" — the tool waits its turn.
  it('another structural write in flight → waits its turn, then writes', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // simulate pending op
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const pending = (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(writeInsert).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect((await pending).success).toBe(true);
    expect(writeInsert).toHaveBeenCalledTimes(1);
  });

  it('pushes a structural undo record (insert forward, remove inverse) on success', async () => {
    const pushStructuralUndo = vi.fn();
    const ctx = localCtx({ pushStructuralUndo });
    const tools = generateCommandTools(ctx);
    await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(pushStructuralUndo).toHaveBeenCalledTimes(1);
    const record = pushStructuralUndo.mock.calls[0][0];
    expect(record.structuralOp.forward[0]).toMatchObject({ kind: 'insert', position: 'inside-end' });
    // region fields absent from the reply → exactly ONE remove (old-reply compat).
    expect(record.structuralOp.inverse).toHaveLength(1);
    expect(record.structuralOp.inverse[0]).toMatchObject({
      kind: 'remove',
      loc: { file: PAGE_FILE, line: 12, column: 1 },
    });
  });

  // LIVE SMOKE (Critical): the real reply carries splice-region fields — the
  // inverse is ONE byte-exact region restore. It covers multi-root markup
  // naturally AND rejoins a mid-line-split target (remove ×rootCount did
  // neither reliably); rootCount stays in replies as legacy-fallback data.
  it('region-fields reply: inverse = ONE restore-region (multi-root included)', async () => {
    writeInsert.mockResolvedValue({
      success: true, insertedLine: 12, file: PAGE_FILE, rootCount: 2,
      replacedLine: 12, replacedLineCount: 2, originalSegment: '',
    });
    const pushStructuralUndo = vi.fn();
    const ctx = localCtx({ pushStructuralUndo });
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<h2>A</h2>\n<p>B</p>',
    });
    expect(result.success).toBe(true);
    const record = pushStructuralUndo.mock.calls[0][0];
    expect(record.structuralOp.inverse).toEqual([
      { kind: 'restore-region', loc: { file: PAGE_FILE, line: 12, column: 1 }, lineCount: 2, segment: '' },
    ]);
  });

  it('legacy multi-root reply (no region fields): inverse = remove ×rootCount at the inserted line', async () => {
    writeInsert.mockResolvedValue({ success: true, insertedLine: 12, file: PAGE_FILE, rootCount: 2 });
    const pushStructuralUndo = vi.fn();
    const ctx = localCtx({ pushStructuralUndo });
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<h2>A</h2><p>B</p>',
    });
    expect(result.success).toBe(true);
    const record = pushStructuralUndo.mock.calls[0][0];
    expect(record.structuralOp.inverse).toHaveLength(2);
    for (const op of record.structuralOp.inverse) {
      expect(op).toMatchObject({ kind: 'remove', loc: { file: PAGE_FILE, line: 12, column: 1 } });
    }
  });

  // Gap 13: beforeId/afterId are HONORED now (see the anchors describe below);
  // only parentId/index remain meaningless for the real file.
  it('parentId/index only → appended with an ignored-placement note', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', parentId: 'element-1', index: 2,
    });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/parentId\/index.*ignored|ignored/i);
    // Page-anchor fallback: inside-end of the page's last root.
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE_FILE, line: 5, column: 1 },
      '<section>x</section>',
      'inside-end',
    );
  });
});

// ============================================================================
// add_page_content — beforeId/afterId anchors (gap 13, local)
// ============================================================================

describe('add_page_content — beforeId/afterId anchors (gap 13, local)', () => {
  const heroEl = scanned({
    key: `${PAGE_FILE}:9:1`,
    tagName: 'section',
    sourceLocation: { file: PAGE_FILE, line: 9, column: 1 },
  });
  /** Rendered by a component: own file is the COMPONENT's, usage tag is in the page. */
  const cardRootEl = scanned({
    key: 'src/components/Card.astro:3:1',
    tagName: 'article',
    sourceLocation: { file: 'src/components/Card.astro', line: 3, column: 1 },
    usageLocation: { file: PAGE_FILE, line: 7, column: 3 },
  });
  /** Component-rendered, NO usage tag in the page (e.g. placed by a layout). */
  const orphanCompEl = scanned({
    key: 'src/components/Nav.astro:2:1',
    tagName: 'nav',
    sourceLocation: { file: 'src/components/Nav.astro', line: 2, column: 1 },
  });

  function anchorCtx() {
    return localCtx({ getScannedElements: () => [mainEl, heroEl, cardRootEl, orphanCompEl] });
  }

  it('beforeId (scanned key) → writeInsert BEFORE the anchor location', async () => {
    const ctx = anchorCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', beforeId: heroEl.key,
    });
    expect(result.success).toBe(true);
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE_FILE, line: 9, column: 1 },
      '<section>x</section>',
      'before',
    );
    // Honored placement never carries the ignored-note.
    expect(result.message).not.toMatch(/ignored/i);
  });

  it('afterId (scanned key) → writeInsert AFTER the anchor location', async () => {
    const ctx = anchorCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', afterId: heroEl.key,
    });
    expect(result.success).toBe(true);
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE_FILE, line: 9, column: 1 },
      '<section>x</section>',
      'after',
    );
  });

  it('unknown anchor → honest failure, NO write (anchor-not-found parity)', async () => {
    const ctx = anchorCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', beforeId: 'element-1',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/anchor "element-1"/);
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
  });

  it('instance-suffixed anchor (#n copy) → refusal, NO write', async () => {
    const copy = scanned({
      key: `${PAGE_FILE}:9:1#1`,
      tagName: 'section',
      sourceLocation: { file: PAGE_FILE, line: 9, column: 1 },
    });
    const ctx = localCtx({ getScannedElements: () => [mainEl, copy] });
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', afterId: copy.key,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/copy/i);
    expect(writeInsert).not.toHaveBeenCalled();
  });

  it('component-rendered anchor re-targets to the <Component /> usage tag in the page file', async () => {
    const ctx = anchorCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', beforeId: cardRootEl.key,
    });
    expect(result.success).toBe(true);
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE_FILE, line: 7, column: 3 },
      '<section>x</section>',
      'before',
    );
  });

  it('component-rendered anchor with NO page-file usage → refusal, never a component-file write', async () => {
    const ctx = anchorCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', afterId: orphanCompEl.key,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/shared component/i);
    expect(writeInsert).not.toHaveBeenCalled();
  });

  it('beforeId combined with parentId → refusal', async () => {
    const ctx = anchorCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', beforeId: heroEl.key, parentId: 'element-1',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/omit parentId/);
    expect(writeInsert).not.toHaveBeenCalled();
  });

  it('anchor insert pushes the same structural undo record shape (insert forward)', async () => {
    const pushStructuralUndo = vi.fn();
    const ctx = localCtx({
      getScannedElements: () => [mainEl, heroEl],
      pushStructuralUndo,
    });
    const tools = generateCommandTools(ctx);
    await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>', beforeId: heroEl.key,
    });
    expect(pushStructuralUndo).toHaveBeenCalledTimes(1);
    const record = pushStructuralUndo.mock.calls[0][0];
    expect(record.structuralOp.forward[0]).toMatchObject({
      kind: 'insert',
      loc: { file: PAGE_FILE, line: 9, column: 1 },
      position: 'before',
    });
  });
});

// ============================================================================
// add_drawn_element — local branch reuses insertLocalDrawnElement
// ============================================================================

describe('add_drawn_element (local)', () => {
  it('delegates to insertLocalDrawnElement and reports the real write', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_drawn_element as ExecTool).execute({
      tag: 'div', classes: 'p-4', textContent: 'hi', parentKey: mainEl.key,
    });
    expect(result.success).toBe(true);
    expect(mockDrawInsert).toHaveBeenCalledTimes(1);
    const args = mockDrawInsert.mock.calls[0][0];
    expect(args.draw).toMatchObject({ tag: 'div', classes: 'p-4', textContent: 'hi', parentKey: mainEl.key });
    expect(args.isSlotDraw).toBe(false);
    expect(args.pageFile).toBe(PAGE_FILE);
    expect(args.scannedElements).toEqual(SCAN);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ file: PAGE_FILE, insertedLine: 9 });
  });

  it('surfaces the module failure reason to the AI', async () => {
    mockDrawInsert.mockResolvedValue({ ok: false, reason: 'the file was not changed' });
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_drawn_element as ExecTool).execute({
      tag: 'div', classes: '', textContent: '', parentKey: null,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('the file was not changed');
  });

  it('refuses a non-current pageId', async () => {
    const ctx = localCtx();
    seedPage(ctx.doc, 'about');
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_drawn_element as ExecTool).execute({
      tag: 'div', classes: '', textContent: '', parentKey: null, pageId: 'about',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/select_page/);
    expect(mockDrawInsert).not.toHaveBeenCalled();
  });
});

// ============================================================================
// place_component_instance — local branch reuses insertLocalComponent
// ============================================================================

describe('place_component_instance (local)', () => {
  it('places a user-project component through THE ⌘K insert flow', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.place_component_instance as ExecTool).execute({
      componentPath: 'src/components/Hero.astro',
    });
    expect(result.success).toBe(true);
    expect(mockComponentInsert).toHaveBeenCalledTimes(1);
    const args = mockComponentInsert.mock.calls[0][0];
    expect(args.component).toBe(userComp);
    expect(args.selection).toBeNull(); // v0: page-anchor placement
    expect(args.pageFile).toBe(PAGE_FILE);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ file: PAGE_FILE, insertedLine: 7 });
  });

  it('places a built-in by threading the project path (materialize-on-insert, gaps 11/36)', async () => {
    const LOCAL_ID = 'browser_lf_my-astro-site';
const LOCAL_PATH = filesTruthPath(LOCAL_ID);
    localStorage.clear();
    markFilesTruth(LOCAL_ID);
    const ctx = localCtx();
    ctx.doc.getMap('meta').set('projectId', LOCAL_ID);
    const tools = generateCommandTools(ctx);
    const result = await (tools.place_component_instance as ExecTool).execute({
      componentPath: 'Navbar',
    });
    expect(result.success).toBe(true);
    expect(mockComponentInsert).toHaveBeenCalledTimes(1);
    const args = mockComponentInsert.mock.calls[0][0];
    expect(args.component).toBe(builtinComp);
    // Same arg shape Editor.handleSelectComponent threads — this is what lets
    // insertLocalComponent MATERIALIZE the built-in into src/components/.
    expect(args.localProjectPath).toBe(LOCAL_PATH);
  });

  it('surfaces the module failure reason to the AI', async () => {
    mockComponentInsert.mockResolvedValue({ ok: false, reason: 'could not add the import' });
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.place_component_instance as ExecTool).execute({
      componentPath: 'Hero',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('could not add the import');
  });
});

// ============================================================================
// add_page — local branch reuses the task-145 real-file path
// ============================================================================

describe('add_page (local)', () => {
  const mockCreateLocalDocPage = createLocalDocPage as ReturnType<typeof vi.fn>;
  const LOCAL_ID = 'browser_lf_my-astro-site';
  const LOCAL_PATH = filesTruthPath(LOCAL_ID);

  function localPageCtx(projectId = LOCAL_ID) {
    const ctx = localCtx();
    ctx.doc.getMap('meta').set('projectId', projectId);
    return ctx;
  }

  beforeEach(() => {
    localStorage.clear();
    markFilesTruth(LOCAL_ID);
    mockCreateLocalDocPage.mockResolvedValue('about');
  });

  it('creates the REAL page file via createLocalDocPage (file-first, no doc-only ghost)', async () => {
    const ctx = localPageCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page as ExecTool).execute({
      page: { id: 'page-123', name: 'About' }, __scanTimeoutMs: 10,
    });
    expect(result.success).toBe(true);
    expect(mockCreateLocalDocPage).toHaveBeenCalledWith(ctx.doc, LOCAL_PATH, 'About');
    // No doc-only ADD_PAGE dispatch — createLocalDocPage owns file+doc.
    expect(ctx.dispatch).not.toHaveBeenCalled();
    // Static scan in this ctx → awaitScanChange times out → switchedToPage
    // reports the UNCONFIRMED switch honestly (select_page message-split parity).
    expect(result.data).toMatchObject({ pageId: 'about', switchedToPage: false });
    expect(result.message).toMatch(/scan pending/i);
  });

  it('returns success:false with the reason when the endpoint fails', async () => {
    mockCreateLocalDocPage.mockRejectedValue(new Error('Page create failed (500)'));
    const ctx = localPageCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page as ExecTool).execute({
      page: { id: 'page-123', name: 'About' }, __scanTimeoutMs: 10,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Page create failed (500)');
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('non-local pin: add_page dispatches ADD_PAGE, never the local page path', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1', getScannedElements: () => SCAN });
    ctx.doc.getMap('meta').set('projectId', 'browser_xyz');
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page as ExecTool).execute({
      page: { id: 'page-2', name: 'About' }, __scanTimeoutMs: 10,
    });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_PAGE' }));
    expect(mockCreateLocalDocPage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// create_component / make_component — local file writes
// ============================================================================

describe('component creation (local)', () => {
  // create_component in local projects: supported since 2026-09-21 — see createComponentLocal.test.ts.
  // make_component extracts a scanned element into a file — see localSourceTools.test.ts.

  it('make_component refuses a key that is not on the canvas', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.make_component as ExecTool).execute({ key: 'drawn-1' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not on the canvas/i);
  });
});

// ============================================================================
// Non-local regression pins — old doc paths byte-identical
// ============================================================================

describe('non-local projects keep the doc path', () => {
  function nonLocalCtx() {
    const ctx = makeCtx({ currentPageId: 'page-1', getScannedElements: () => SCAN, componentLibrary: [userComp, builtinComp] });
    ctx.doc.getMap('meta').set('projectId', 'browser_xyz');
    seedPage(ctx.doc, 'page-1');
    return ctx;
  }

  it('add_page_content durably accepts ADD_ELEMENT and never touches the local writer', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<section><h1>Hi</h1></section>',
    });
    expect(result.success).toBe(true);
    const element = ctx.doc.getMap<Y.Map<unknown>>('elements').get(result.data?.elementId as string);
    const id = result.data?.elementId;
    expect(element?.toJSON()).toMatchObject({ pageId: 'page-1', staticMarkup: `<section data-key="${id}:section-0"><h1 data-key="${id}:h1-0">Hi</h1></section>` });
    expect(await getDurableProjectState('browser_xyz')).toMatchObject({ acceptedRevision: 1 });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(writeInsert).not.toHaveBeenCalled();
  });

  it('add_page_content still wraps multi-root markup for the doc renderer', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_page_content as ExecTool).execute({
      pageId: 'page-1', type: 'frame', staticMarkup: '<h2>A</h2><p>B</p>',
    });
    expect(result.success).toBe(true);
    const element = ctx.doc.getMap<Y.Map<unknown>>('elements').get(result.data?.elementId as string);
    const id = result.data?.elementId;
    expect(element?.get('staticMarkup')).toBe(`<section data-key="${id}:section-0" data-with-props='true'><h2 data-key="${id}:h2-0">A</h2><p data-key="${id}:p-0">B</p></section>`);
    expect(await getDurableProjectState('browser_xyz')).toMatchObject({ acceptedRevision: 1 });
  });

  it('add_drawn_element dispatches ADD_DRAWN_ELEMENT, no local module call', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.add_drawn_element as ExecTool).execute({
      tag: 'div', classes: '', textContent: '', parentKey: null,
    });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_DRAWN_ELEMENT' }));
    expect(mockDrawInsert).not.toHaveBeenCalled();
  });

  it('place_component_instance dispatches the add command, no local module call', async () => {
    const ctx = nonLocalCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.place_component_instance as ExecTool).execute({
      componentPath: 'src/components/Hero.astro',
    });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalled();
    expect(mockComponentInsert).not.toHaveBeenCalled();
  });
});

// ── Fix 1 (task-148): AI add_page_content on a component-only page (no
// scanned node keyed to the page file) routes to the page-body anchor instead
// of failing with "the page isn't scanned yet".
describe('add_page_content — page-body anchor (local)', () => {
  it('component-only page → writeAppendPage, success, undo record pushed', async () => {
    const ctx = localCtx({ getScannedElements: () => [] });
    const tools = generateCommandTools(ctx) as unknown as Record<string, ExecTool>;
    const res = await tools.add_page_content.execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>AI</section>',
    });

    expect(res.success).toBe(true);
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).toHaveBeenCalledWith(PAGE_FILE, '<section>AI</section>');
    expect(ctx.pushStructuralUndo).toHaveBeenCalledTimes(1);
    const record = (ctx.pushStructuralUndo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.structuralOp.forward).toEqual([
      { kind: 'append-page', pageFile: PAGE_FILE, markup: '<section>AI</section>' },
    ]);
    expect(record.structuralOp.inverse).toEqual([
      { kind: 'restore-region', loc: { file: PAGE_FILE, line: 6, column: 1 }, lineCount: 1, segment: '' },
    ]);
  });

  it('a scanned page element still uses writeInsert (regression pin)', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx) as unknown as Record<string, ExecTool>;
    await tools.add_page_content.execute({ pageId: 'index', type: 'frame', staticMarkup: '<section>AI</section>' });
    expect(writeInsert).toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
  });

  it('a failed append reports failure, never false success', async () => {
    writeAppendPage.mockResolvedValue({ success: false });
    const ctx = localCtx({ getScannedElements: () => [] });
    const tools = generateCommandTools(ctx) as unknown as Record<string, ExecTool>;
    const res = await tools.add_page_content.execute({ pageId: 'index', type: 'frame', staticMarkup: '<section>AI</section>' });
    expect(res.success).toBe(false);
    expect(ctx.pushStructuralUndo).not.toHaveBeenCalled();
  });
});

// ── Wrong-file-write guard (live-smoke Critical): see utils/localPageSync.ts.
describe('add_page_content — page-switch-in-flight guard (local)', () => {
  beforeEach(() => { _resetLocalPageSyncForTests(); });

  // Owner 2026-11-10: no "retry in a moment" — the tool waits for the page
  // the canvas is switching to, then writes into it.
  it('scan still on the previous page → waits for the page, then writes; never refuses', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/');
    const ctx = localCtx();
    const tools = generateCommandTools(ctx) as unknown as Record<string, ExecTool>;
    const pending = tools.add_page_content.execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
    setLocalScannedRoute('/layout-only');
    const res = await pending;
    expect(res.success).toBe(true);
    expect(res.message).not.toMatch(/switching/i);
    expect(ctx.pushStructuralUndo).toHaveBeenCalled();
  });

  it('scan matching the current page → proceeds', async () => {
    setLocalExpectedRoute('/');
    setLocalScannedRoute('/');
    const ctx = localCtx();
    const tools = generateCommandTools(ctx) as unknown as Record<string, ExecTool>;
    const res = await tools.add_page_content.execute({
      pageId: 'index', type: 'frame', staticMarkup: '<section>x</section>',
    });
    expect(res.success).toBe(true);
    expect(writeInsert).toHaveBeenCalled();
  });
});
