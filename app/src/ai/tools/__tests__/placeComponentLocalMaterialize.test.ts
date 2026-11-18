// Materialize-on-insert end-to-end (gaps 11/36): the AI's
// place_component_instance in a LOCAL project runs the REAL
// insertLocalComponent → materializeLibraryComponent path for a built-in
// library component — the built-in's bytes are copied into the project's
// src/components/ via the mocked host endpoints, then the normal import +
// insert writes land in the page file. Before the fix the tool refused every
// non-user-project component outright, so this flow was unreachable.
//
// Contract (durable file acceptance): materialize no longer POSTs
// /__sq/local/component-create and the insert no longer calls
// viteStructuralWriter.writeImport/writeInsert — the copied component file,
// the import and the tag are ONE accepted source gesture materialized through
// the instance route table. The test drives that REAL route table on a temp
// disk (projectFsRuntime); only the editor-host /__sq/component-html read of
// the built-in's raw bytes is stubbed.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const PAGE_FILE = 'src/pages/index.astro';
// <main> at 5:1 — matches the scanned key below.
const PAGE_SOURCE = '---\n---\n\n\n<main>\n  <h1>Home</h1>\n</main>\n';
const NAVBAR_RAW = '---\nconst year = 2026;\n---\n<nav>built-in navbar</nav>\n';

let LOCAL_ID = '';
let runtime: ReturnType<typeof projectFsRuntime>;

const mainEl = {
  key: `${PAGE_FILE}:5:1`,
  tagName: 'main',
  classes: '',
  rect: { top: 0, left: 0, width: 100, height: 100 },
  parentKey: null,
  hasSourceTracking: true,
  sourceLocation: { file: PAGE_FILE, line: 5, column: 1 },
} as unknown as ScannedElement;

const builtinNavbar: ScannedComponent = {
  name: 'Navbar',
  path: 'library/Navbar.astro',
  source: 'built-in',
  html: '<nav>built-in navbar</nav>',
  category: 'Header',
  props: [],
  slots: [],
  dependencies: [],
};

function localCtx() {
  const ctx = makeCtx({
    currentPageId: 'index',
    getScannedElements: () => [mainEl],
    getCurrentPageFile: () => PAGE_FILE,
    componentLibrary: [builtinNavbar],
  });
  ctx.doc.getMap('meta').set('projectId', LOCAL_ID);
  const page = new Y.Map();
  page.set('id', 'index');
  page.set('rootElementIds', new Y.Array());
  ctx.doc.getMap('pages').set('index', page);
  return ctx;
}

/** Editor-host raw-bytes reads of the built-in library (not an instance route). */
let htmlReads: string[];

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  localStorage.clear();
  LOCAL_ID = `browser_lf_my-astro-site-${crypto.randomUUID()}`;
  markFilesTruth(LOCAL_ID);
  setActiveSaveProjectId(LOCAL_ID);
  runtime = projectFsRuntime(LOCAL_ID, { [PAGE_FILE]: PAGE_SOURCE });
  htmlReads = [];

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/__sq/component-html')) {
      const params = new URL(url, 'http://x').searchParams;
      htmlReads.push(params.get('path') ?? '');
      if (params.get('path') === 'library/Navbar.astro' && params.get('raw') === '1') {
        return new Response(NAVBAR_RAW, { headers: { 'content-type': 'text/plain' } });
      }
      return new Response('not found', { status: 404 });
    }
    return new Response('unexpected fetch: ' + url, { status: 500 });
  });
});

afterEach(() => {
  runtime.close();
  unmarkFilesTruth(LOCAL_ID);
  setActiveSaveProjectId(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('place_component_instance materializes a built-in in local mode', () => {
  it('copies the library bytes into src/components/ and inserts the tag', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.place_component_instance as ExecTool).execute({
      componentPath: 'library/Navbar.astro',
    });

    expect(result.success).toBe(true);
    expect(htmlReads).toEqual(['library/Navbar.astro']);
    await flushDurableSourceWrites(LOCAL_ID);
    // Materialized with the REAL library bytes...
    expect(runtime.read('src/components/Navbar.astro')).toBe(NAVBAR_RAW);
    // ...then the normal insert flow: import into the page file + tag inside-end of <main>.
    const page = runtime.read(PAGE_FILE);
    expect(page).toMatch(/import Navbar from ['"]\.\.\/components\/Navbar\.astro['"]/);
    const tag = page.indexOf('<Navbar />');
    expect(tag).toBeGreaterThan(page.indexOf('<h1>Home</h1>'));
    expect(tag).toBeLessThan(page.indexOf('</main>'));
    // Files-truth: no doc dispatch on the local branch.
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ file: PAGE_FILE });
  });

  it('endpoint failure surfaces as an honest tool failure, nothing written', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      new Response('boom', { status: 500 })); // component-html down
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.place_component_instance as ExecTool).execute({
      componentPath: 'Navbar',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/could not read the built-in source/i);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read(PAGE_FILE)).toBe(PAGE_SOURCE);
    expect(existsSync(join(runtime.root, 'src/components/Navbar.astro'))).toBe(false);
  });
});
