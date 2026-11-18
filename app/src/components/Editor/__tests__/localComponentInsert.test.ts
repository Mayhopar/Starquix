// task-133 Task 5: ⌘K user-component insert in local mode — import first,
// THEN insert (sequentially, against the post-import source), no doc
// dispatch, pending selection stashed only on full success.
//
// Files-truth migration (2026-09): since fdd2d12f the insert no longer calls
// viteStructuralWriter. prepareSourceGesture applies the import + insert
// transforms to the PROJECTED source of a `browser_` project, the whole
// gesture is accepted durably as ONE file batch, and the materializer writes
// it to the instance afterwards. These tests therefore run the real transforms
// over a real page file (projectFsRuntime) and assert on the resulting source
// and undo records instead of on writer-call arguments.
import 'fake-indexeddb/auto'; // before any module that constructs the Dexie db
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { ScannedElement } from '@/context/SelectionContext';

/** Per-test fault injection for the pure structural transform (the only way a
 *  real import/insert/append can fail on a well-formed page). */
const transformFault: { kind: string | null; once: boolean } = { kind: null, once: false };
vi.mock('@/services/durableEdits/structuralTransform', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/durableEdits/structuralTransform')>();
  return {
    ...real,
    applyStructuralTransform: (source: string, op: Parameters<typeof real.applyStructuralTransform>[1]) => {
      if (transformFault.kind === op.kind) {
        if (transformFault.once) transformFault.kind = null;
        throw new Error('void tag');
      }
      return real.applyStructuralTransform(source, op);
    },
  };
});

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { insertLocalComponent } from '../localComponentInsert';
import {
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
} from '../localStructuralOps';
import { peekLocalPendingSelection } from '@/utils/localPendingSelection';
import {
  setLocalExpectedRoute,
  setLocalScannedRoute,
  setLocalPageFile,
  admitLocalSourceScan,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import { LOCAL_CROSS_FILE_WRITE_EVENT } from '@/utils/localWriteScope';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { openDurableInsertProject, type DurableInsertProject } from './localInsertDurableHarness';

const PAGE = 'src/pages/index.astro';
const CARD = 'src/components/Card.astro';
const HERO_FILE = 'src/components/hero.astro';
const IMPORT_LINE = "import Hero from '../components/hero.astro';";

/** Existing frontmatter (import add = lineDelta 1); <section> at 5:3. */
const PAGE_SRC = `---
const title = 'Home';
---
<main>
  <section>
  </section>
</main>
`;
const PAGE_AFTER_INSERT = `---
${IMPORT_LINE}
const title = 'Home';
---
<main>
  <section>
    <Hero />
  </section>
</main>
`;
const PAGE_AFTER_APPEND = `---
${IMPORT_LINE}
const title = 'Home';
---
<main>
  <section>
  </section>
  <Hero />
</main>
`;
const CARD_SRC = '<div class="card">\n  <p>card</p>\n</div>\n';

const heroComponent = {
  name: 'hero',
  path: HERO_FILE,
  source: 'user-project' as const,
  html: '<section></section>',
  category: 'Other',
  props: [],
  slots: [],
  dependencies: [],
};

const el = (over: Partial<ScannedElement> = {}): ScannedElement => ({
  key: `${PAGE}:5:3`,
  tagName: 'section',
  classes: '',
  sourceLocation: { file: PAGE, line: 5, column: 3 },
  rect: { top: 0, left: 0, width: 10, height: 10 },
  parentKey: null,
  hasSourceTracking: true,
  ...over,
});

let project: DurableInsertProject;
/** Page source after every accepted edit reached disk. */
const pageOnDisk = async (file = PAGE) => { await project.flush(); return project.read(file); };
const acceptedBatches = async () => (await listUnmaterialized(project.projectId)).length;

/** Files whose write was refused as an instance-scope edit of a master. */
let refusals: string[] = [];
const onRefusal = (e: Event) => refusals.push((e as CustomEvent).detail.file);
beforeAll(() => window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal));
afterAll(() => window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal));

async function open(files: Record<string, string> = {}) {
  project = await openDurableInsertProject({ [PAGE]: PAGE_SRC, [HERO_FILE]: '<section></section>\n', [CARD]: CARD_SRC, ...files });
}

beforeEach(async () => {
  vi.clearAllMocks();
  refusals = [];
  transformFault.kind = null; transformFault.once = false;
  await open();
});
afterEach(async () => {
  await project.close();
  vi.unstubAllGlobals();
});

describe('insertLocalComponent', () => {
  it('writes import then insert IN ORDER with the right args, stashes pending selection', async () => {
    const pushUndo = vi.fn();
    const selection = el();
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });

    expect(r).toEqual({ ok: true, file: PAGE, insertedLine: 7 });
    expect(pushUndo.mock.calls[0][0].structuralOp.forward.map((op: { kind: string }) => op.kind)).toEqual(['import', 'insert']);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_INSERT);
    // line 5 + lineDelta 1 — the import add shifted the body down; the new
    // <Hero /> lands on its own line inside the section (line 7).
    expect(peekLocalPendingSelection()).toMatchObject({ file: PAGE, predicted: `${PAGE}:7:` });
  });

  // task-133 Task 8 review (HIGH, first-insert misplacement): a newly added
  // import shifts every body line down, so the insert target must be offset
  // by the import's lineDelta — a stale line resolves the WRONG element (or
  // throws / lands after </html>).
  it('added:true adjusts the insert line by lineDelta (created frontmatter = 3)', async () => {
    await project.close();
    await open({ [PAGE]: '<main>\n  <section>\n  </section>\n</main>\n' });
    const selection = el({ key: `${PAGE}:2:3`, sourceLocation: { file: PAGE, line: 2, column: 3 } });
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE });
    expect(r).toEqual({ ok: true, file: PAGE, insertedLine: 6 });
    expect(await pageOnDisk()).toBe(`---\n${IMPORT_LINE}\n---\n<main>\n  <section>\n    <Hero />\n  </section>\n</main>\n`);
  });

  it('added:false (pre-existing import) leaves the insert line UNADJUSTED', async () => {
    await project.close();
    await open({ [PAGE]: `---\n${IMPORT_LINE}\n---\n<main>\n  <section>\n  </section>\n</main>\n` });
    const pushUndo = vi.fn();
    const selection = el();
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    expect(r).toEqual({ ok: true, file: PAGE, insertedLine: 6 });
    expect(pushUndo.mock.calls[0][0].structuralOp.forward).toMatchObject([
      { kind: 'insert', loc: { file: PAGE, line: 5, column: 3 }, markup: '<Hero />', position: 'inside-end' },
    ]);
    expect(await pageOnDisk()).toBe(`---\n${IMPORT_LINE}\n---\n<main>\n  <section>\n    <Hero />\n  </section>\n</main>\n`);
  });

  // (Deleted: "added:true with a missing lineDelta (legacy reply) falls back
  // to 0" — there is no wire reply any more. Since fdd2d12f the import result
  // is computed in-process by applyStructuralTransform, which always returns
  // lineDelta; the legacy-reply shape cannot occur.)

  // Sequencing rule, files-truth form: both transforms hit the SAME file, so
  // the insert is computed against the post-import source and the pair lands
  // as ONE accepted batch — never a second write against pre-import lines.
  it('import and insert are accepted as ONE batch against the post-import source (sequencing rule)', async () => {
    const selection = el();
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE });
    const rows = await listUnmaterialized(project.projectId);
    expect(rows).toHaveLength(1);
    const batches = rows.flatMap(row => row.commands).filter(c => c.kind === 'file-batch') as Array<{ payload: { files: Array<{ file: string; afterSource: string }> } }>;
    expect(batches).toHaveLength(1);
    expect(batches[0].payload.files).toEqual([expect.objectContaining({ file: PAGE, afterSource: PAGE_AFTER_INSERT })]);
  });

  // THE write-scope law (2026-08-02 incident) still holds — the master is never
  // written from a page view — but task-149 REVERSES the old "cross-file
  // selection ⇒ refuse" pin for ⌘K: on a real page everything visible belongs
  // to some component, so refusing meant "add a component" did nothing at all.
  // The insert is now ANCHORED BACK into the page file (nearest page-file
  // ancestor, else the page body). The refusal stays for draws.
  it('cross-file selection with NO page-file ancestor → page-body append, no refusal', async () => {
    const pushUndo = vi.fn();
    const selection = el({
      key: `${CARD}:1:1`,
      sourceLocation: { file: CARD, line: 1, column: 1 },
    });
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    expect(r.ok).toBe(true);
    expect(pushUndo.mock.calls[0][0].structuralOp.forward).toEqual([
      { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: false },
      { kind: 'append-page', pageFile: PAGE, markup: '<Hero />' },
    ]);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
    expect(project.read(CARD)).toBe(CARD_SRC); // the master is untouched
    expect(refusals).toEqual([]);
  });

  it('cross-file selection WITH a page-file ancestor → inserts inside that ancestor', async () => {
    const wrapper = el();
    const selection = el({
      key: `${CARD}:1:1`,
      tagName: 'div',
      sourceLocation: { file: CARD, line: 1, column: 1 },
      parentKey: wrapper.key,
    });
    const pushUndo = vi.fn();
    const r = await insertLocalComponent({
      component: heroComponent, selection, scannedElements: [wrapper, selection], pageFile: PAGE, pushUndo,
    });
    expect(r.ok).toBe(true);
    // lineDelta 1 from the import add shifts the body target down one line.
    expect(pushUndo.mock.calls[0][0].structuralOp.forward[1]).toMatchObject(
      { kind: 'insert', loc: { file: PAGE, line: 6, column: 3 }, markup: '<Hero />', position: 'inside-end' },
    );
    expect(await pageOnDisk()).toBe(PAGE_AFTER_INSERT);
    expect(project.read(CARD)).toBe(CARD_SRC);
    expect(refusals).toEqual([]);
  });

  it('component view: inserting INTO the open component is same-file and proceeds', async () => {
    // Editor's currentPageFile IS the component file while the component view is open.
    setLocalPageFile(CARD);
    const selection = el({ key: `${CARD}:1:1`, tagName: 'div', sourceLocation: { file: CARD, line: 1, column: 1 } });
    const pushUndo = vi.fn();
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: CARD, pushUndo });
    expect(r.ok).toBe(true);
    expect(pushUndo.mock.calls[0][0].structuralOp.forward[0]).toEqual(
      { kind: 'import', pageFile: CARD, name: 'Hero', importPath: './hero.astro', remove: false },
    );
    // created frontmatter (3 lines) shifts the div from 1 to 4
    expect(pushUndo.mock.calls[0][0].structuralOp.forward[1]).toMatchObject(
      { kind: 'insert', loc: { file: CARD, line: 4, column: 1 }, markup: '<Hero />', position: 'inside-end' },
    );
    expect(await pageOnDisk(CARD)).toBe(`---\nimport Hero from './hero.astro';\n---\n<div class="card">\n  <p>card</p>\n  <Hero />\n</div>\n`);
    expect(project.read(PAGE)).toBe(PAGE_SRC);
    expect(refusals).toEqual([]);
  });

  // task-149: an empty-template component renders nothing — inserting it looks
  // like a dead editor ("Added X", canvas unchanged). Refused before any write.
  it('component with an empty template: toast, NO writes', async () => {
    const r = await insertLocalComponent({
      component: { ...heroComponent, name: 'Header', html: '\n  \n' },
      selection: null, scannedElements: [], pageFile: PAGE,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining('no markup') });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('no markup'));
    expect(await acceptedBatches()).toBe(0);
    expect(await pageOnDisk()).toBe(PAGE_SRC);
  });

  it('component whose html the scan did not report is NOT treated as empty', async () => {
    const { html: _drop, ...noHtml } = heroComponent;
    const r = await insertLocalComponent({
      component: noHtml as typeof heroComponent, selection: null, scannedElements: [], pageFile: PAGE,
    });
    expect(r.ok).toBe(true);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
  });

  it('non-user-project component: toast, NO writes', async () => {
    await insertLocalComponent({
      component: { ...heroComponent, source: 'built-in' as const },
      selection: null, scannedElements: [], pageFile: PAGE,
    });
    expect(toast).toHaveBeenCalled();
    expect(await acceptedBatches()).toBe(0);
    expect(await pageOnDisk()).toBe(PAGE_SRC);
  });

  it('theme template (no source field): toast, NO writes', async () => {
    await insertLocalComponent({
      component: { id: 't1', name: 'Hero', category: 'Hero', image: '', html: '', themeId: 'th', componentPath: 'x' },
      selection: null, scannedElements: [], pageFile: PAGE,
    });
    expect(toast).toHaveBeenCalled();
    expect(await acceptedBatches()).toBe(0);
    expect(await pageOnDisk()).toBe(PAGE_SRC);
  });

  it('no pageFile: its own toast copy (not "click an element" — wrong advice for a doc-only page), no writes', async () => {
    await insertLocalComponent({ component: heroComponent, selection: null, scannedElements: [], pageFile: null });
    expect(toast).toHaveBeenCalledWith('This page has no source file yet — structural edits need a real page file');
    expect(await acceptedBatches()).toBe(0);
    expect(await pageOnDisk()).toBe(PAGE_SRC);
  });

  it('component-instance selection: toast, no writes', async () => {
    const selection = el({ key: `${PAGE}:5:3#1` });
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE });
    expect(toast).toHaveBeenCalled();
    expect(await acceptedBatches()).toBe(0);
    expect(await pageOnDisk()).toBe(PAGE_SRC);
  });

  // Fix 1 (task-148) REVERSES the old "no target → toast, no writes" pin: an
  // empty scan is the normal component-only page shape, and now routes to the
  // page-body anchor (see the page-body describe block at the bottom).
  it('empty scan (no selection): page-body append, no refusal toast', async () => {
    const r = await insertLocalComponent({ component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE });
    expect(r.ok).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
  });

  it('import failure: toast.error, insert NOT attempted, no pending selection', async () => {
    transformFault.kind = 'import';
    const selection = el();
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE });
    expect(r.ok).toBe(false);
    expect(await acceptedBatches()).toBe(0);
    expect(await pageOnDisk()).toBe(PAGE_SRC);
    expect(peekLocalPendingSelection()).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });

  // (Deleted: "import returning false (writes not armed)" — the `false` reply
  // was viteStructuralWriter's unarmed-transport answer. Since fdd2d12f the
  // import is an in-process transform on the projected source; there is no
  // arming state that can answer `false`. Import failure is covered above.)

  it('insert rejection: toast.error with reason, no pending selection', async () => {
    transformFault.kind = 'insert';
    const selection = el();
    const r = await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^Couldn't add the component/) });
    expect(await pageOnDisk()).toBe(PAGE_SRC); // no stray import: nothing was accepted
    expect(peekLocalPendingSelection()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't add the component/));
  });

  // (Deleted: "insert failure ({success:false})" — a {success:false} reply was
  // a writer wire shape; gesture.apply either returns {success:true,…} or
  // throws (fdd2d12f), which the rejection test above covers.)

  // Task 7 review follow-up: the ⌘K insert shares THE one in-flight guard with
  // draws/deletes/moves — a component insert landing during any pending
  // structural write races the same file (stale-line corruption class).
  // Fix 2 (task-148): the refusal is surfaced — an invisible no-op made
  // "nothing happens" the dominant experience.
  // Owner 2026-11-10: never "Still saving the last change" — it waits its turn.
  it('in-flight structural write (shared guard): the insert waits its turn, then lands — no toast', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // simulate a pending draw/delete/move
    const selection = el();
    const pending = insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE });
    await new Promise((r) => setTimeout(r, 0));
    expect(await acceptedBatches()).toBe(0);
    releaseStructuralWrite();
    expect((await pending).ok).toBe(true);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_INSERT);
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('guard is released after a successful insert (second insert proceeds)', async () => {
    const selection = el();
    const args = { component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE };
    expect((await insertLocalComponent(args)).ok).toBe(true);
    expect((await insertLocalComponent(args)).ok).toBe(true);
    expect((await pageOnDisk()).match(/<Hero \/>/g)).toHaveLength(2);
  });

  it('guard is released after a failed insert (next insert proceeds)', async () => {
    transformFault.kind = 'insert'; transformFault.once = true;
    const selection = el();
    const args = { component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE };
    expect((await insertLocalComponent(args)).ok).toBe(false);
    expect((await insertLocalComponent(args)).ok).toBe(true);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_INSERT);
  });
});

// task-133 Task 8: successful inserts push an undo record; the import ops are
// included ONLY when the import was newly added (added:true).
describe('undo records (Task 8)', () => {
  it('newly added import: forward [import-add, insert], inverse [remove, import-remove]', async () => {
    const pushUndo = vi.fn();
    const selection = el();
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(pushUndo.mock.calls[0][0].structuralOp).toMatchObject({
      forward: [
        { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: false },
        // ADJUSTED loc (5 + lineDelta 1): redo replays import-add first, so
        // post-import coordinates are the correct replay target.
        { kind: 'insert', loc: { file: PAGE, line: 6, column: 3 }, markup: '<Hero />', position: 'inside-end' },
      ],
      inverse: [
        { kind: 'restore-region', loc: { file: PAGE, line: 7, column: 1 }, lineCount: 1, segment: '' },
        { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: true },
      ],
    });
    expect(pushUndo.mock.calls[0][0].structuralOp.inverse[1]).not.toHaveProperty('removeFences');
  });

  it('pre-existing import (added:false): NO import ops in the record', async () => {
    await project.close();
    await open({ [PAGE]: `---\n${IMPORT_LINE}\n---\n<main>\n  <section>\n  </section>\n</main>\n` });
    const pushUndo = vi.fn();
    const selection = el();
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    expect(pushUndo.mock.calls[0][0].structuralOp).toMatchObject({
      forward: [
        { kind: 'insert', loc: { file: PAGE, line: 5, column: 3 }, markup: '<Hero />', position: 'inside-end' },
      ],
      inverse: [
        { kind: 'restore-region', loc: { file: PAGE, line: 6, column: 1 }, lineCount: 1, segment: '' },
      ],
    });
  });

  it('failed insert: nothing pushed', async () => {
    transformFault.kind = 'insert';
    const pushUndo = vi.fn();
    const selection = el();
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    expect(pushUndo).not.toHaveBeenCalled();
  });

  // LIVE SMOKE (Critical): a mid-line splice (single-line target) SPLITS the
  // target's line; the inverse must be a region restore carrying the original
  // line bytes — remove-at-insertedLine left the split behind, making every
  // deeper undo entry resolve (and delete) the WRONG element.
  it('mid-line splice: inverse restore-region carries the original line bytes', async () => {
    await project.close();
    await open({ [PAGE]: `---\nconst title = 'Home';\n---\n<main>\n  <section><p>Second page.</p></section>\n</main>\n` });
    const pushUndo = vi.fn();
    const selection = el();
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    const record = pushUndo.mock.calls[0][0];
    expect(record.structuralOp.inverse[0]).toEqual({
      kind: 'restore-region',
      loc: { file: PAGE, line: 6, column: 1 },
      lineCount: 3,
      segment: '  <section><p>Second page.</p></section>\n',
    });
  });

  // (Deleted: "legacy reply without region fields: inverse falls back to
  // remove-at-insertedLine" — the reply is produced in-process by
  // applyStructuralTransform since fdd2d12f and always carries the region
  // fields; the legacy shape cannot occur.)

  // review: when the forward import CREATED the frontmatter (lineDelta 3),
  // the inverse import op must carry removeFences so undo collapses the
  // then-empty `---\n---` pair — residue leaves deeper entries +2 lines stale.
  it('created frontmatter (lineDelta 3): inverse import op carries removeFences', async () => {
    await project.close();
    await open({ [PAGE]: '<main>\n  <section>\n  </section>\n</main>\n' });
    const pushUndo = vi.fn();
    const selection = el({ key: `${PAGE}:2:3`, sourceLocation: { file: PAGE, line: 2, column: 3 } });
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    expect(pushUndo.mock.calls[0][0].structuralOp).toMatchObject({
      forward: [
        { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: false },
        { kind: 'insert', loc: { file: PAGE, line: 5, column: 3 }, markup: '<Hero />', position: 'inside-end' },
      ],
      inverse: [
        { kind: 'restore-region', loc: { file: PAGE, line: 6, column: 1 }, lineCount: 1, segment: '' },
        { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: true, removeFences: true },
      ],
    });
  });

  it('existing frontmatter (lineDelta 1): inverse import op has NO removeFences', async () => {
    const pushUndo = vi.fn();
    const selection = el();
    await insertLocalComponent({ component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE, pushUndo });
    const record = pushUndo.mock.calls[0][0];
    expect(record.structuralOp.inverse[1]).toEqual(
      { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: true },
    );
    expect('removeFences' in record.structuralOp.inverse[1]).toBe(false);
  });
});

// ── Fix 1 (task-148): component-only pages have NO scanned node keyed to the
// page file (layout + component tags, no {...Astro.props} spread) — the
// commonest real Astro page shape. ⌘K must still insert: the anchor is
// resolved from the file itself (append-page).
describe('insertLocalComponent — page-body anchor', () => {
  it('no scanned node for the page file → import then APPEND-PAGE (not insert)', async () => {
    const pushUndo = vi.fn();
    const res = await insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE, pushUndo,
    });

    expect(pushUndo.mock.calls[0][0].structuralOp.forward.map((op: { kind: string }) => op.kind)).toEqual(['import', 'append-page']);
    expect(res).toEqual({ ok: true, file: PAGE, insertedLine: 8 });
    expect(peekLocalPendingSelection()).toMatchObject({ file: PAGE, predicted: `${PAGE}:8:` });
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
    // (The success toast was retired in 426889ee — success is the canvas.)
  });

  it('pushes an undo record: append forward, region-restore + import strip inverse', async () => {
    const pushUndo = vi.fn();
    await insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE, pushUndo,
    });
    expect(pushUndo).toHaveBeenCalledTimes(1);
    const record = pushUndo.mock.calls[0][0];
    expect(record.structuralOp.forward).toEqual([
      { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: false },
      { kind: 'append-page', pageFile: PAGE, markup: '<Hero />' },
    ]);
    expect(record.structuralOp.inverse).toEqual([
      { kind: 'restore-region', loc: { file: PAGE, line: 8, column: 1 }, lineCount: 1, segment: '' },
      { kind: 'import', pageFile: PAGE, name: 'Hero', importPath: '../components/hero.astro', remove: true },
    ]);
  });

  it('a scanned element on the page file still uses an insert (regression pin)', async () => {
    const pushUndo = vi.fn();
    const selection = el();
    await insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [selection], pageFile: PAGE, pushUndo,
    });
    const kinds = pushUndo.mock.calls[0][0].structuralOp.forward.map((op: { kind: string }) => op.kind);
    expect(kinds).toContain('insert');
    expect(kinds).not.toContain('append-page');
  });

  it('failed append → honest reason, no pending selection, no undo', async () => {
    transformFault.kind = 'append-page';
    const pushUndo = vi.fn();
    const res = await insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE, pushUndo,
    });
    expect(res.ok).toBe(false);
    expect(pushUndo).not.toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
    expect(await pageOnDisk()).toBe(PAGE_SRC);
    expect(toast.error).toHaveBeenCalled();
  });
});

// ── Wrong-file-write guard (live-smoke Critical): a structural write must
// never target a page the user is not looking at. currentPageFile flips
// synchronously with the page id; the scan (and the iframe) lag. Observed
// live: ⌘K right after a Pages-row click wrote into the PREVIOUS page's file.
describe('insertLocalComponent — page-switch-in-flight guard', () => {
  beforeEach(() => {
    _resetLocalPageSyncForTests();
    setLocalPageFile(PAGE);
  });

  // Owner 2026-11-10: "it must just SWITCH, no delays no errors". The old
  // refusal ("Still switching pages") is gone: a ⌘K made before the
  // switched-to page has scanned lands on THAT page once its scan arrives —
  // never in the page the user just left (the live-smoke Critical stays fixed).
  it('scan still on the previous page → waits, then inserts into the page the user switched to; no toast', async () => {
    const ABOUT = 'src/pages/about.astro';
    await project.close();
    await open({ [ABOUT]: PAGE_SRC });
    setLocalExpectedRoute('/'); setLocalScannedRoute('/'); setLocalPageFile(PAGE);
    setLocalExpectedRoute('/about'); setLocalPageFile(ABOUT); // the Pages click
    const pending = insertLocalComponent({
      component: heroComponent, selection: el(), scannedElements: [el()], pageFile: PAGE, // captured on '/'
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await acceptedBatches()).toBe(0);
    admitLocalSourceScan(undefined, '/about', []);
    expect(await pending).toMatchObject({ ok: true, file: ABOUT });
    expect(await pageOnDisk(ABOUT)).toBe(PAGE_AFTER_APPEND);
    expect(await pageOnDisk()).toBe(PAGE_SRC); // the page the user left is untouched
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('no scan yet (boot) → waits for the first scan, then inserts', async () => {
    setLocalExpectedRoute('/layout-only');
    const pending = insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await acceptedBatches()).toBe(0);
    admitLocalSourceScan(undefined, '/layout-only', []);
    expect((await pending).ok).toBe(true);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
  });

  it('scan matches the current page → proceeds', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/layout-only');
    const res = await insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE,
    });
    expect(res.ok).toBe(true);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
  });

  it('gate disarmed (non-local runtime) → proceeds, byte-identical behavior', async () => {
    const res = await insertLocalComponent({
      component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE,
    });
    expect(res.ok).toBe(true);
  });

  it('a page switch after the insert started never cancels it: it finishes on its own page, no toast', async () => {
    setLocalExpectedRoute('/'); setLocalScannedRoute('/');
    const pending = insertLocalComponent({ component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE });
    setLocalExpectedRoute('/about'); setLocalPageFile('src/pages/about.astro'); // clicked away mid-insert
    expect((await pending).ok).toBe(true);
    expect(await pageOnDisk()).toBe(PAGE_AFTER_APPEND);
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(refusals).toEqual([]);
  });

  it('while it waits for the page, the in-flight guard stays free for other writes', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/');
    void insertLocalComponent({ component: heroComponent, selection: null, scannedElements: [], pageFile: PAGE });
    await new Promise((r) => setTimeout(r, 0));
    expect(tryAcquireStructuralWrite()).toBe(true); // never taken while waiting
  });
});
