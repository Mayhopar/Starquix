// Findings 11/18 (2026-08-12 adversarial review): AI local structural ops ran
// at machine speed — the model reads read_source_elements once, the first
// write shifts every line below its splice, and the second delete/move/insert
// in the same run addressed whatever element NOW sat at the stale file:line —
// silent wrong-element corruption of the user's real file.
//
// First fix (868b04c2): a post-write scan-staleness FENCE — AI ops refused
// until the rescan re-vouched. Retired on purpose by 426889ee ("preserve
// accepted source identities before preview acknowledgement"): every accepted
// source gesture records identity maps, and later gestures project pre-write
// scan keys through them — so chained ops no longer need (or get) a refusal.
// The stale flag survives as a DIAGNOSTIC only (commandTools: "diagnostic;
// never an edit gate").
//
// The hazard is the same, so this file still pins it — as outcomes on disk:
// chained AI ops with PRE-write keys hit the element the model meant.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
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
import * as storage from '@/services/durableEdits/store';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import {
  _resetLocalPageSyncForTests,
  setLocalPageFile,
  setLocalExpectedRoute,
  setLocalScannedRoute,
  isLocalScanStaleAfterWrite,
} from '@/utils/localPageSync';
import { clearLocalPendingSelection } from '@/utils/localPendingSelection';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedElement } from '@/context/SelectionContext';

const PAGE_FILE = 'src/pages/index.astro';
// main 5:1 · One 6:3 · Two 7:3 · hero 9:1 — matches the scanned keys below.
const PAGE_SOURCE = [
  '---',
  '---',
  '',
  '',
  '<main>',
  '  <p>One</p>',
  '  <p>Two</p>',
  '</main>',
  '<section>hero</section>',
  '',
].join('\n');

function scanned(partial: Partial<ScannedElement> & { key: string; tagName: string }): ScannedElement {
  return {
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: null,
    hasSourceTracking: true,
    ...partial,
  } as ScannedElement;
}

const at = (line: number, column: number) => ({ file: PAGE_FILE, line, column });
const mainEl = scanned({ key: `${PAGE_FILE}:5:1`, tagName: 'main', sourceLocation: at(5, 1) });
const oneEl = scanned({ key: `${PAGE_FILE}:6:3`, tagName: 'p', parentKey: mainEl.key, sourceLocation: at(6, 3) });
const twoEl = scanned({ key: `${PAGE_FILE}:7:3`, tagName: 'p', parentKey: mainEl.key, sourceLocation: at(7, 3) });
const heroEl = scanned({ key: `${PAGE_FILE}:9:1`, tagName: 'section', sourceLocation: at(9, 1) });
/** The PRE-write scan — never refreshed inside a test (that is the hazard). */
const SCAN = [mainEl, oneEl, twoEl, heroEl];

let projectId = '';
let runtime: ReturnType<typeof projectFsRuntime>;

function seedPage(doc: Y.Doc, pageId: string) {
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('rootElementIds', new Y.Array());
  doc.getMap('pages').set(pageId, page);
}

/** ctx for a files-truth project with the page-sync gate ARMED and vouched —
 *  exactly the state the Editor arms in real local usage. */
function localCtx() {
  const ctx = makeCtx({
    currentPageId: 'index',
    getScannedElements: () => SCAN,
    getCurrentPageFile: () => PAGE_FILE,
  });
  ctx.doc.getMap('meta').set('projectId', projectId);
  seedPage(ctx.doc, 'index');
  setLocalPageFile(PAGE_FILE);
  setLocalExpectedRoute('/');
  setLocalScannedRoute('/');
  return ctx;
}

async function pageOnDisk() {
  await flushDurableSourceWrites(projectId);
  return runtime.read(PAGE_FILE);
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  clearLocalPendingSelection();
  // Fresh id per test: durable/projection layers keep per-project memory.
  projectId = `browser_lf_fence_${crypto.randomUUID()}`;
  markFilesTruth(projectId);
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [PAGE_FILE]: PAGE_SOURCE });
});

afterEach(() => {
  runtime.close();
  unmarkFilesTruth(projectId);
  setActiveSaveProjectId(null);
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  clearLocalPendingSelection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI local structural ops with a post-write stale scan hit the intended element (findings 11/18)', () => {
  it('delete_element then delete_element with PRE-write keys → both intended elements gone, nothing else', async () => {
    const tools = generateCommandTools(localCtx());
    expect((await (tools.delete_element as ExecTool).execute({ elementId: oneEl.key })).success).toBe(true);
    // Two's scanned key (7:3) is stale — Two now sits on line 6.
    expect((await (tools.delete_element as ExecTool).execute({ elementId: twoEl.key })).success).toBe(true);
    const disk = await pageOnDisk();
    expect(disk).not.toContain('<p>One</p>');
    expect(disk).not.toContain('<p>Two</p>');
    expect(disk).toContain('<main>');
    expect(disk).toContain('</main>');
    expect(disk).toContain('<section>hero</section>');
  });

  it('stale-after-write is a diagnostic marker the rescan clears — never a refusal', async () => {
    let scan = SCAN;
    const ctx = localCtx();
    ctx.getScannedElements = () => scan;
    const tools = generateCommandTools(ctx);
    expect(isLocalScanStaleAfterWrite()).toBe(false);
    expect((await (tools.delete_element as ExecTool).execute({ elementId: oneEl.key })).success).toBe(true);
    expect(isLocalScanStaleAfterWrite()).toBe(true);
    // The write reaches the file, HMR rescans: fresh coordinates (Two → 6:3).
    expect(await pageOnDisk()).not.toContain('<p>One</p>');
    const twoFresh = scanned({ key: `${PAGE_FILE}:6:3`, tagName: 'p', parentKey: mainEl.key, sourceLocation: at(6, 3) });
    scan = [mainEl, twoFresh, scanned({ key: `${PAGE_FILE}:8:1`, tagName: 'section', sourceLocation: at(8, 1) })];
    // Post-HMR ELEMENTS_SCANNED for the same route (scanning.ts does this).
    setLocalScannedRoute('/');
    expect(isLocalScanStaleAfterWrite()).toBe(false);
    expect((await (tools.delete_element as ExecTool).execute({ elementId: twoFresh.key })).success).toBe(true);
    const disk = await pageOnDisk();
    expect(disk).not.toMatch(/<p>(One|Two)<\/p>/);
    expect(disk).toContain('<section>hero</section>');
  });

  it('delete_element then move_element with a PRE-write key → the intended element moves', async () => {
    const tools = generateCommandTools(localCtx());
    expect((await (tools.delete_element as ExecTool).execute({ elementId: oneEl.key })).success).toBe(true);
    // hero's key (9:1) is stale — move it to root index 0 (before <main>).
    const moved = await (tools.move_element as ExecTool).execute({
      pageId: 'index', elementKey: heroEl.key, newParentKey: null, insertIndex: 0,
    });
    expect(moved.success).toBe(true);
    const disk = await pageOnDisk();
    expect(disk).not.toContain('<p>One</p>');
    expect(disk.match(/<section>hero<\/section>/g)).toHaveLength(1);
    expect(disk.indexOf('<section>hero</section>')).toBeLessThan(disk.indexOf('<main>'));
    expect(disk).toContain('<p>Two</p>');
  });

  it('delete_element then add_page_content anchored to a PRE-write key → lands after the intended anchor', async () => {
    const tools = generateCommandTools(localCtx());
    expect((await (tools.delete_element as ExecTool).execute({ elementId: oneEl.key })).success).toBe(true);
    const added = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'text', tag: 'p', textContent: 'hello', afterId: twoEl.key,
    });
    expect(added.success).toBe(true);
    const disk = await pageOnDisk();
    const hello = disk.indexOf('hello');
    expect(hello).toBeGreaterThan(disk.indexOf('<p>Two</p>'));
    expect(hello).toBeLessThan(disk.indexOf('</main>'));
    expect(disk).not.toContain('<p>One</p>');
  });

  it('add_page_content then delete_element with a PRE-write key → the intended element is deleted', async () => {
    const tools = generateCommandTools(localCtx());
    const added = await (tools.add_page_content as ExecTool).execute({
      pageId: 'index', type: 'text', tag: 'p', textContent: 'hello', beforeId: oneEl.key,
    });
    expect(added.success).toBe(true);
    // One's key (6:3) is stale — "hello" now sits on line 6.
    expect((await (tools.delete_element as ExecTool).execute({ elementId: oneEl.key })).success).toBe(true);
    const disk = await pageOnDisk();
    expect(disk).toContain('hello');
    expect(disk).not.toContain('<p>One</p>');
    expect(disk).toContain('<p>Two</p>');
  });

  it('a FAILED write does not mark the scan stale — the retry proceeds', async () => {
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tools = generateCommandTools(localCtx());
    expect((await (tools.delete_element as ExecTool).execute({ elementId: heroEl.key })).success).toBe(false);
    expect(isLocalScanStaleAfterWrite()).toBe(false);
    expect(runtime.read(PAGE_FILE)).toBe(PAGE_SOURCE);
    const retry = await (tools.delete_element as ExecTool).execute({ elementId: heroEl.key });
    expect(retry.success).toBe(true);
    expect(await pageOnDisk()).not.toContain('<section>hero</section>');
  });
});
