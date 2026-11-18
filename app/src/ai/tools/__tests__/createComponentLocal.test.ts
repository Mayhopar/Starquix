// create_component in a LOCAL (files-truth) project, 2026-09-21: the tool used
// to refuse every local project ("not supported in local projects yet"). It
// now delegates to the editor's REAL insertLocalComponent theme-template path
// (markup materialized as src/components/<Name>.astro, import + `<Name />`
// written into the page file, replaced section removed in the same guarded
// sequence). The insert module has its own end-to-end suite; this test pins
// the tool → module contract: a theme template built from the markup, the
// replace key threaded through, honest refusals before any write.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/components/Editor/localComponentInsert', () => ({
  insertLocalComponent: vi.fn(),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { insertLocalComponent } from '@/components/Editor/localComponentInsert';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { markFilesTruth, filesTruthPath } from '@/utils/localMode';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedElement } from '@/context/SelectionContext';

const insert = insertLocalComponent as ReturnType<typeof vi.fn>;
const PAGE_FILE = 'src/pages/index.astro';
const LOCAL_ID = 'browser_lf_my-astro-site';
const HERO = '<section class="p-12"><h1>Sit better.</h1></section>';

const heroEl = {
  key: `${PAGE_FILE}:12:5`,
  sourceKey: `${PAGE_FILE}:12:5`,
  tagName: 'section',
  classes: 'p-12',
  rect: { top: 0, left: 0, width: 100, height: 100 },
  parentKey: null,
  hasSourceTracking: true,
  sourceLocation: { file: PAGE_FILE, line: 12, column: 5 },
} as unknown as ScannedElement;

function localCtx() {
  const ctx = makeCtx({
    currentPageId: 'index',
    getScannedElements: () => [heroEl],
    getCurrentPageFile: () => PAGE_FILE,
    componentLibrary: [],
  });
  ctx.doc.getMap('meta').set('projectId', LOCAL_ID);
  const page = new Y.Map();
  page.set('id', 'index');
  page.set('rootElementIds', new Y.Array());
  ctx.doc.getMap('pages').set('index', page);
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  localStorage.clear();
  markFilesTruth(LOCAL_ID);
  insert.mockResolvedValue({ ok: true, file: PAGE_FILE, insertedLine: 14 });
});

describe('create_component in a local (files-truth) project', () => {
  it('runs the real insert path with a theme template built from the markup and the replace key threaded through', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.create_component as ExecTool).execute({
      name: 'Landing Hero', staticMarkup: HERO, replaceElementId: heroEl.key,
    });

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    const args = insert.mock.calls[0][0];
    expect(args.component).toMatchObject({ name: 'Landing Hero', html: HERO }); // no `source` → theme-template materialize
    expect('source' in args.component).toBe(false);
    expect(args.replaceKey).toBe(heroEl.key);
    expect(args.localProjectPath).toBe(filesTruthPath(LOCAL_ID));
    expect(args.pageFile).toBe(PAGE_FILE);
    expect(args.scannedByKey.get(heroEl.key)).toBe(heroEl);
    expect(args.pushUndo).toBe(ctx.pushStructuralUndo);
    expect(result.message).toMatch(/src\/components\//);
    expect(result.data).toMatchObject({ file: PAGE_FILE, insertedLine: 14 });
    expect(ctx.dispatch).not.toHaveBeenCalled(); // files-truth: never a doc-only ghost
  });

  it('an unknown replaceElementId is refused before any write; a module refusal is relayed verbatim', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const r1 = await (tools.create_component as ExecTool).execute({ name: 'Nope', staticMarkup: '<div>x</div>', replaceElementId: 'src/pages/index.astro:99:1' });
    expect(r1.success).toBe(false);
    expect(r1.message).toMatch(/not on the current page/);
    expect(insert).not.toHaveBeenCalled();

    insert.mockResolvedValue({ ok: false, reason: 'only components from your own project can be inserted in local mode' });
    const r2 = await (tools.create_component as ExecTool).execute({ name: 'Footer', staticMarkup: '<footer>x</footer>' });
    expect(r2.success).toBe(false);
    expect(r2.message).toMatch(/create_component failed: only components/);
    expect(insert.mock.calls[0][0].replaceKey).toBeNull();
  });
});
