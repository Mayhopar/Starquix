/**
 * task-149: local-mode Push / Reset for an element a COMPONENT renders onto a
 * page. Guards the two things that lose user work if they regress: pushing the
 * wrong file's overrides, and clearing an override whose write never landed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';

const writeClassUpdate = vi.fn();
const writeTextUpdate = vi.fn();
const writeImageUpdate = vi.fn();

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: { writeClassUpdate: (...a: unknown[]) => writeClassUpdate(...a) },
}));
vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: { writeTextUpdate: (...a: unknown[]) => writeTextUpdate(...a) },
}));
vi.mock('@/services/ViteImageWriter', () => ({
  viteImageWriter: { writeImageUpdate: (...a: unknown[]) => writeImageUpdate(...a) },
}));

const {
  localOverridesForPlacement,
  hasLocalMasterOverrides,
  clearLocalOverrides,
  pushLocalOverridesToMaster,
  pushFileValueUndo,
} = await import('../localMasterOverrides');
const { setFileValue, getObservedFileValue } = await import('@/services/classWriteBaseline');

const HEADER = 'src/components/Header.astro';
const PAGE = 'src/pages/about.astro';

/** task-149: two placements of the same component (real hashes from a live run). */
const A = 'p5e23e503da89f633';
const B = 'pf22d94ecd78c8702';

/** Pre-task-149 call shape: file scope, no placement. */
const localOverridesForFile = (doc: Y.Doc, file: string | null) =>
  localOverridesForPlacement(doc, file, undefined);

function addClasses(doc: Y.Doc, key: string, classes: string, edited = true): void {
  doc.transact(() => {
    const e = new Y.Map();
    e.set('classes', classes);
    if (edited) e.set('edited', true);
    doc.getMap('sourceClasses').set(key, e);
  });
}

function addText(doc: Y.Doc, key: string, textContent: string): void {
  doc.transact(() => {
    const e = new Y.Map();
    e.set('textContent', textContent);
    doc.getMap('sourceText').set(key, e);
  });
}

function addImage(doc: Y.Doc, key: string, attrs: Record<string, string>): void {
  doc.transact(() => {
    const e = new Y.Map();
    for (const [k, v] of Object.entries(attrs)) e.set(k, v);
    doc.getMap('sourceImageAttributes').set(key, e);
  });
}

describe('localOverridesForFile', () => {
  it('keeps the registered source version and revision in every master Push tier', () => {
    const doc = new Y.Doc();
    const key = `${HEADER}:7:3`;
    addClasses(doc, key, 'text-red-500'); addText(doc, key, 'Hi'); addImage(doc, key, { src: '/logo.png' });
    doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)!.set('sourceLocation', new Y.Map<unknown>(Object.entries({
      file: HEADER, line: 7, column: 3, sourceVersion: 'owned-source', sourceRevision: 4,
    })));
    const found = localOverridesForFile(doc, HEADER);
    expect(found).toHaveLength(3);
    expect(found.map(entry => entry.sourceLocation)).toEqual([
      { file: HEADER, line: 7, column: 3, sourceVersion: 'owned-source', sourceRevision: 4 },
      { file: HEADER, line: 7, column: 3, sourceVersion: 'owned-source', sourceRevision: 4 },
      { file: HEADER, line: 7, column: 3, sourceVersion: 'owned-source', sourceRevision: 4 },
    ]);
    doc.destroy();
  });
  // 2026-10-04 (desktop image bug, same mechanism): a coordinate key is only an
  // index. An image/text override carries no identity of its own, so it used
  // to BORROW the class registration on its key — left there by an older
  // gesture on ANOTHER element (rev 9). Push then projected that old element
  // forward and wrote onto it. The current admitted scan names the element the
  // override is painted on; a borrowed registration is never an identity.
  it('an image/text override without its own identity takes the current scan, not a stale class registration on the reused key', async () => {
    const { admitLocalSourceScan, setLocalExpectedRoute, _resetLocalPageSyncForTests } = await import('@/utils/localPageSync');
    _resetLocalPageSyncForTests();
    const doc = new Y.Doc();
    doc.getMap('meta').set('projectId', 'browser_borrow');
    const key = `${HEADER}:7:3`;
    addClasses(doc, key, 'text-red-500', false); addText(doc, key, 'Hi'); addImage(doc, key, { src: '/logo.png' });
    doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)!.set('sourceLocation', new Y.Map<unknown>(Object.entries({
      file: HEADER, line: 7, column: 3, sourceVersion: 'sOLD', sourceRevision: 9,
    })));
    setLocalExpectedRoute('/');
    admitLocalSourceScan('browser_borrow', '/', [{ key, classes: '', sourceLocation: { file: HEADER, line: 7, column: 3, sourceVersion: 'sNEW' } }]);
    const found = localOverridesForFile(doc, HEADER);
    expect(found.map(entry => [entry.kind, entry.sourceLocation.sourceVersion])).toEqual([['text', 'sNEW'], ['image', 'sNEW']]);
    _resetLocalPageSyncForTests();
    doc.destroy();
  });
  it('collects every tier for ONE component file and nothing else', () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    addText(doc, `${HEADER}:9:1`, 'Hi');
    addImage(doc, `${HEADER}:11:5`, { src: '/logo.png' });
    addClasses(doc, `${PAGE}:2:1`, 'p-8');                 // the page's own element
    addClasses(doc, 'src/components/Footer.astro:3:1', 'mt-4'); // another component

    const found = localOverridesForFile(doc, HEADER);
    expect(found.map((o) => o.kind).sort()).toEqual(['classes', 'image', 'text']);
    expect(found.every((o) => o.sourceLocation.file === HEADER)).toBe(true);
  });

  it('ignores a registered-but-unedited class entry (selection is not divergence)', () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500', false);
    expect(localOverridesForFile(doc, HEADER)).toEqual([]);
    expect(hasLocalMasterOverrides(doc, HEADER)).toBe(false);
  });

  it('is empty for a null file (no component selected)', () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    expect(localOverridesForFile(doc, null)).toEqual([]);
  });
});

describe('clearLocalOverrides', () => {
  it('deletes only the entries handed to it', () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    addClasses(doc, `${PAGE}:2:1`, 'p-8');
    clearLocalOverrides(doc, localOverridesForFile(doc, HEADER));
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3`)).toBe(false);
    expect(doc.getMap('sourceClasses').has(`${PAGE}:2:1`)).toBe(true);
  });
});

describe('pushLocalOverridesToMaster', () => {
  beforeEach(() => {
    writeClassUpdate.mockReset().mockResolvedValue(true);
    writeTextUpdate.mockReset().mockResolvedValue(true);
    writeImageUpdate.mockReset().mockResolvedValue(true);
    // A successful Push records what it put in the file (writeOverride →
    // setClassWriteBaseline) in a MODULE SINGLETON that outlives the test, and
    // since task-186 an override equal to the file's value is not an override.
    // Without this reset the next test's identically-keyed override is born
    // inert — the editor resets the same store on teardown/project switch.
    resetClassWriteBaselines();
  });

  it('writes the master file with masterWrite=true and clears the overrides', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    addText(doc, `${HEADER}:9:1`, 'Hi');

    const res = await pushLocalOverridesToMaster(doc, HEADER);

    // `values` = what actually LANDED — the needles Canvas/reloadPreview.ts waits
    // for in the served HTML before it re-navigates the frame.
    expect(res).toEqual({ pushed: 2, failed: 0, values: ['text-red-500', 'Hi'], reasons: [], landedKeys: [`${HEADER}:7:3`, `${HEADER}:9:1`], droppedFiles: [] });
    // The 3rd arg is the ONE sanctioned bypass of the write-scope law.
    expect(writeClassUpdate).toHaveBeenCalledWith(
      { file: HEADER, line: 7, column: 3 }, 'text-red-500', true, undefined,
    );
    expect(writeTextUpdate).toHaveBeenCalledWith(
      { file: HEADER, line: 9, column: 1 }, 'Hi', true,
    );
    expect(hasLocalMasterOverrides(doc, HEADER)).toBe(false);
  });

  it('KEEPS the override when its write fails — the canvas must not lie', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    addText(doc, `${HEADER}:9:1`, 'Hi');
    writeClassUpdate.mockResolvedValue(false);

    const res = await pushLocalOverridesToMaster(doc, HEADER);

    // The FAILED override contributes no needle: its value never reaches the
    // page, and waiting for it would burn the whole verification cap.
    expect(res).toEqual({
      pushed: 1, failed: 1, values: ['Hi'], landedKeys: [`${HEADER}:9:1`], droppedFiles: [],
      // A plain `false` is the writer declining to send at all — there is no
      // message to relay, so the notice keeps the count and says no more.
      reasons: ['the editor could not write to this file'],
    });
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3`)).toBe(true); // kept
    expect(doc.getMap('sourceText').has(`${HEADER}:9:1`)).toBe(false);   // landed
  });

  it('treats a writer rejection (timeout / server error) as a failure, not a crash', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    writeClassUpdate.mockRejectedValue(new Error('Write request timeout'));

    await expect(pushLocalOverridesToMaster(doc, HEADER)).resolves.toEqual({
      pushed: 0, failed: 1, values: [], reasons: ['Write request timeout'], landedKeys: [], droppedFiles: [],
    });
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3`)).toBe(true);
  });

  it('THREADS the writer\'s refusal reason out of the push, de-duplicated', async () => {
    // The defect this pins: the component-view route toasted the writer's real
    // sentence ("class:list has no editable leading literal — edit it in the
    // source file") while PUSH — the route users actually hit — reported only
    // "Header: 1 change could not be pushed". The rejection was caught here and
    // COUNTED; the message was dropped, leaving a failure indistinguishable
    // from a timeout and with nothing the user could act on.
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    addClasses(doc, `${HEADER}:9:5`, 'p-8');
    writeClassUpdate.mockRejectedValue(
      new Error('class:list has no editable leading literal — edit it in the source file'),
    );

    const res = await pushLocalOverridesToMaster(doc, HEADER);

    expect(res.failed).toBe(2);
    // TWO elements refused for the SAME reason — one sentence, not two.
    expect(res.reasons).toEqual([
      'class:list has no editable leading literal — edit it in the source file',
    ]);
  });

  it('never touches another file\'s overrides', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'text-red-500');
    addClasses(doc, `${PAGE}:2:1`, 'p-8');

    await pushLocalOverridesToMaster(doc, HEADER);

    expect(writeClassUpdate).toHaveBeenCalledTimes(1);
    expect(doc.getMap('sourceClasses').has(`${PAGE}:2:1`)).toBe(true);
  });
});

/**
 * task-149 STEP 7 — Push / Reset / the `*` badge scope to the SELECTED
 * PLACEMENT, not to every render of the component file.
 *
 * Before placement identity, `<Header/>` on `/` and `<Header/>` on `/about`
 * shared one key, so there was only one thing to push. Now they are distinct
 * overrides and a Push on one must leave the other alone — otherwise "Push"
 * silently ships an edit the user made on a page they are not looking at.
 */
describe('placement scoping', () => {
  beforeEach(() => {
    writeClassUpdate.mockReset().mockResolvedValue(true);
    writeTextUpdate.mockReset().mockResolvedValue(true);
    writeImageUpdate.mockReset().mockResolvedValue(true);
    // A successful Push records what it put in the file (writeOverride →
    // setClassWriteBaseline) in a MODULE SINGLETON that outlives the test, and
    // since task-186 an override equal to the file's value is not an override.
    // Without this reset the next test's identically-keyed override is born
    // inert — the editor resets the same store on teardown/project switch.
    resetClassWriteBaselines();
  });

  const seedTwoPlacements = () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3~${A}`, 'text-red-500');
    addText(doc, `${HEADER}:9:1~${A}`, 'Hi from /');
    addClasses(doc, `${HEADER}:7:3~${B}`, 'text-blue-500');
    return doc;
  };

  it('returns only the queried placement\'s overrides', () => {
    const doc = seedTwoPlacements();

    const a = localOverridesForPlacement(doc, HEADER, A);
    expect(a.map((o) => o.key).sort()).toEqual(
      [`${HEADER}:7:3~${A}`, `${HEADER}:9:1~${A}`].sort(),
    );

    const b = localOverridesForPlacement(doc, HEADER, B);
    expect(b.map((o) => o.key)).toEqual([`${HEADER}:7:3~${B}`]);
  });

  it('strips the placement out of the sourceLocation it hands to the writers', () => {
    const doc = seedTwoPlacements();
    const [entry] = localOverridesForPlacement(doc, HEADER, A);
    // The file write targets `file:line:col` — a placement in there would be
    // an unwritable location.
    expect(entry.sourceLocation).toEqual({ file: HEADER, line: 7, column: 3 });
  });

  it('the `*` badge reflects the selected placement only', () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3~${A}`, 'text-red-500');
    expect(hasLocalMasterOverrides(doc, HEADER, A)).toBe(true);
    expect(hasLocalMasterOverrides(doc, HEADER, B)).toBe(false);
  });

  it('Push on placement A writes and clears ONLY A; B keeps rendering', async () => {
    const doc = seedTwoPlacements();

    const res = await pushLocalOverridesToMaster(doc, HEADER, A);

    expect(res).toEqual({ pushed: 2, failed: 0, values: ['text-red-500', 'Hi from /'], reasons: [], landedKeys: [`${HEADER}:7:3~${A}`, `${HEADER}:9:1~${A}`], droppedFiles: [] });
    expect(writeClassUpdate).toHaveBeenCalledTimes(1);
    expect(writeClassUpdate).toHaveBeenCalledWith(
      { file: HEADER, line: 7, column: 3 }, 'text-red-500', true, undefined,
    );
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3~${A}`)).toBe(false);
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3~${B}`)).toBe(true);
    expect(hasLocalMasterOverrides(doc, HEADER, B)).toBe(true);
  });

  it('Reset on placement A drops ONLY A', () => {
    const doc = seedTwoPlacements();
    clearLocalOverrides(doc, localOverridesForPlacement(doc, HEADER, A));
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3~${A}`)).toBe(false);
    expect(doc.getMap('sourceText').has(`${HEADER}:9:1~${A}`)).toBe(false);
    expect(doc.getMap('sourceClasses').has(`${HEADER}:7:3~${B}`)).toBe(true);
  });

  /**
   * A LAYOUT IS A COMPONENT (owner model, 2026-08-04 — the reversal of the
   * 2026-08-03 "layout chrome is SHARED" ruling).
   *
   * In the owner's words: *"Layout is a component, so to update every page user
   * must update master instance"* — and a push updates every instance EXCEPT
   * those already carrying their own override.
   *
   * While layout chrome was rooted at the layout FILE, every route shared ONE
   * placement, so a layout could not hold a per-route override at all and this
   * contract was inexpressible for layouts. Now the tagger hashes a layout
   * invocation per-route like any component, so a layout runs through the exact
   * same code path a component does.
   *
   * HONEST SCOPE: this pins the STORE contract only. It seeds two placements
   * directly, so it would also have passed under the rooted-layout tagger — it
   * is not a revert-detector. What actually detects a re-rooted layout is
   * `vite-plugin/__tests__/sq-tagging-placement.test.ts` (compiled level) and
   * `bridge/parts/__tests__/placement-{live,slot-live}-dom.test.ts` (real bytes).
   */
  it('a LAYOUT behaves exactly like a component: Push on route A leaves route B overriding', async () => {
    const LAYOUT = 'src/layouts/Base.astro';
    const doc = new Y.Doc();
    addClasses(doc, `${LAYOUT}:8:3~${A}`, 'bg-red-500');   // layout chrome edited on /
    addClasses(doc, `${LAYOUT}:8:3~${B}`, 'bg-blue-500');  // …and differently on /about

    // The two routes are genuinely separate overrides — not one shared entry.
    expect(hasLocalMasterOverrides(doc, LAYOUT, A)).toBe(true);
    expect(hasLocalMasterOverrides(doc, LAYOUT, B)).toBe(true);

    const res = await pushLocalOverridesToMaster(doc, LAYOUT, A);

    expect(res).toEqual({ pushed: 1, failed: 0, values: ['bg-red-500'], reasons: [], landedKeys: [`src/layouts/Base.astro:8:3~${A}`], droppedFiles: [] });
    // The master file was written with A's value…
    expect(writeClassUpdate).toHaveBeenCalledWith(
      { file: LAYOUT, line: 8, column: 3 }, 'bg-red-500', true, undefined,
    );
    // …A is now clean (it renders the master), and B keeps its own edit.
    expect(doc.getMap('sourceClasses').has(`${LAYOUT}:8:3~${A}`)).toBe(false);
    expect(hasLocalMasterOverrides(doc, LAYOUT, B)).toBe(true);
  });

  /**
   * BUG A (task-185) — Push wrote the master file and left the master's OWN
   * override holding the PRE-push value, with no route out of the UI.
   *
   * Measured on the owner's project: after ⋮ → Push the file, the
   * `__sq_component_view` endpoint and the page route all served bg-red-500,
   * while the master editor rendered bg-zinc-800. The leftover was the BARE key
   * (`file:line:col`, no placement) for the same element of the same file —
   * created earlier by clicking that element in the master view and editing it
   * there. `localOverridesForPlacement` matches placement by STRICT EQUALITY,
   * so `undefined !== A`: it never entered `entries`, never entered `done`, and
   * `clearLocalOverrides` never saw it.
   *
   * The dead end needs the post-push rescan too: it hits the `override !== now`
   * branch and stamps `baseClasses` to the POST-push file value, so base === now
   * and ↻ is STRUCTURALLY unable to fire. (An anchored survivor is refused by
   * noteSourceBaseValue's only-if-absent rule and would still light ↻ — that is
   * why the residue alone is recoverable and this pair is not.)
   *
   * ⚠️ This deletes a stored override, which brushes the repo's "never purge
   * stored overrides" rule. It is not a sweep: scoped to the one file just
   * written, only when a write actually landed, and only for the bare key that
   * addresses that same file. NO KEY_SCHEME change.
   */
  it('Push also drops the master\'s OWN bare-key override — it describes a file that no longer exists', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:6:1`, 'w-full bg-zinc-800 md:fixed');      // master-view edit
    addClasses(doc, `${HEADER}:6:1~${A}`, 'w-full bg-red-500 md:fixed');  // the instance edit

    const res = await pushLocalOverridesToMaster(doc, HEADER, A);

    // The WRITE stays placement-scoped — Push must never ship an edit made on a
    // page the user is not looking at (task-149).
    expect(res.pushed).toBe(1);
    expect(writeClassUpdate).toHaveBeenCalledTimes(1);
    expect(writeClassUpdate).toHaveBeenCalledWith(
      { file: HEADER, line: 6, column: 1 }, 'w-full bg-red-500 md:fixed', true, undefined,
    );
    // The CLEAR does not: the file now says bg-red-500, so a surviving bare-key
    // override repaints the pre-push value over the master forever.
    expect(doc.getMap('sourceClasses').has(`${HEADER}:6:1`)).toBe(false);
    expect(hasLocalMasterOverrides(doc, HEADER, undefined)).toBe(false);
  });

  it('but keeps the bare-key override when the write FAILED — the file never moved', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:6:1`, 'w-full bg-zinc-800 md:fixed');
    addClasses(doc, `${HEADER}:6:1~${A}`, 'w-full bg-red-500 md:fixed');
    writeClassUpdate.mockResolvedValue(false);

    const res = await pushLocalOverridesToMaster(doc, HEADER, A);

    expect(res).toMatchObject({ pushed: 0, failed: 1 });
    expect(doc.getMap('sourceClasses').has(`${HEADER}:6:1`)).toBe(true);
    expect(doc.getMap('sourceClasses').has(`${HEADER}:6:1~${A}`)).toBe(true);
  });

  it('leaves ANOTHER component\'s bare-key override alone', async () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:6:1~${A}`, 'w-full bg-red-500 md:fixed');
    addClasses(doc, 'src/components/Footer.astro:3:1', 'mt-4');
    addClasses(doc, `${PAGE}:2:1`, 'p-8');

    await pushLocalOverridesToMaster(doc, HEADER, A);

    expect(doc.getMap('sourceClasses').has('src/components/Footer.astro:3:1')).toBe(true);
    expect(doc.getMap('sourceClasses').has(`${PAGE}:2:1`)).toBe(true);
  });

  it('an undefined placement matches only unscoped keys (WC-shaped docs)', () => {
    const doc = new Y.Doc();
    addClasses(doc, `${HEADER}:7:3`, 'bare');
    addClasses(doc, `${HEADER}:8:3~${A}`, 'scoped');

    expect(localOverridesForPlacement(doc, HEADER, undefined).map((o) => o.key)).toEqual([
      `${HEADER}:7:3`,
    ]);
    expect(localOverridesForPlacement(doc, HEADER, A).map((o) => o.key)).toEqual([
      `${HEADER}:8:3~${A}`,
    ]);
  });
});


describe('pushFileValueUndo — ⌘Z of a Push re-points what the file renders', () => {
  beforeEach(() => { resetClassWriteBaselines(); writeClassUpdate.mockReset(); });

  it('undo restores the pre-push file value, redo the pushed one (only for landed keys)', async () => {
    const doc = new Y.Doc();
    const key = `${HEADER}:7:3~s${A.slice(1)}`;
    const other = `${HEADER}:9:1~s${A.slice(1)}`;
    addClasses(doc, key, 'py-24');
    addClasses(doc, other, 'mt-4');
    setFileValue('classes', key, 'py-12');
    setFileValue('classes', other, 'mt-0');
    const entries = localOverridesForPlacement(doc, HEADER, `s${A.slice(1)}`);
    const undo = pushFileValueUndo(doc, entries);
    // Push landed ONE of the two; its writer stamped the pushed value.
    setFileValue('classes', key, 'py-24');
    undo.setLanded([key]);

    undo.reverse();
    // Without this the restored override equals the stale "file" value → no `*`.
    expect(getObservedFileValue('classes', key)).toBe('py-12');
    expect(getObservedFileValue('classes', other)).toBe('mt-0');
    undo.forward();
    expect(getObservedFileValue('classes', key)).toBe('py-24');
    doc.destroy();
  });

  it('falls back to the ↻ base anchor when no file value was ever observed', () => {
    const doc = new Y.Doc();
    const key = `${HEADER}:7:3~s${A.slice(1)}`;
    addClasses(doc, key, 'py-24');
    (doc.getMap('sourceClasses').get(key) as Y.Map<unknown>).set('baseClasses', 'py-12');
    const undo = pushFileValueUndo(doc, localOverridesForPlacement(doc, HEADER, `s${A.slice(1)}`));
    undo.setLanded([key]);
    undo.reverse();
    expect(getObservedFileValue('classes', key)).toBe('py-12');
    doc.destroy();
  });
});
