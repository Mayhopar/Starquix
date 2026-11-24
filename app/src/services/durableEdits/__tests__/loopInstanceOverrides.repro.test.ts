/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md):
 * one usage tag that renders several copies (a `.map` loop — the blog list).
 *
 * `sharedChain` (utils/propOverrides.ts) makes `capturePropOverride` refuse a
 * loop usage: "one usage tag cannot carry a per-copy value". The refusal also
 * runs inside Reset and Push (`dropPropOverrides` → `captureForKey`), so for a
 * loop they drop NOTHING from the page — and the props the editor wrote while
 * the usage still rendered ONE copy stay in the page file and keep beating the
 * master. The editor entries are cleared anyway, so the editor reports a clean
 * instance while the canvas renders the override.
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 * Harness: the in-memory file system of propOverrideMigration.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

const files: Record<string, string> = {};
vi.mock('@/services/pendingProjectMutations', async (orig) => ({ ...(await orig<object>()), getActiveSaveProjectId: () => 'browser_p' }));
vi.mock('@/utils/localWriteScope', async (orig) => ({ ...(await orig<object>()), captureLocalWriteOrigin: () => ({ armed: true, pageFile: 'src/pages/blog.astro' }) }));
vi.mock('../projectedSource', () => ({
  readProjectedSourceState: async (_p: string, f: string) => files[f] ?? null,
  withProjectedSource: async (_p: string, _r: number, run: () => Promise<unknown>) => run(),
}));
vi.mock('../acceptance', () => ({ inspectAcceptedProject: async (_p: string, read: (r: number) => Promise<unknown>) => read(1) }));
vi.mock('../fileAcceptance', () => ({
  acceptFileChanges: async (_f: string, plan: () => Promise<{ file: string; afterSource: string }[]>) => {
    for (const c of await plan()) files[c.file] = c.afterSource; return {};
  },
  finishAcceptedFiles: async () => ({}),
}));
const writeClassUpdate = vi.fn();
vi.mock('@/services/ViteClassWriter', () => ({ viteClassWriter: { writeClassUpdate: (...a: unknown[]) => writeClassUpdate(...a) } }));

import { migrateEditorOverrides, capturePropOverride } from '../propOverrideCommands';
import { noteScan } from '@/utils/propOverrides';
import { applyCommand } from '@/store/commands';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { makeFakeCtx, makeFakeIframe } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import { localOverridesForPlacement, resetLocalOverrides, pushLocalOverridesToMaster } from '@/store/localMasterOverrides';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const PAGE = 'src/pages/blog.astro';
const P = 's4db83f82b016cfb0';
const MASTER = 'text-xl';
const OVERRIDE = 'text-xl italic';
const LOOP = '{posts.map((post) => ';
const rect = { top: 0, left: 0, width: 10, height: 10 };
const WITHOUT_PROP = `${LOOP}<Card post={post} />)}\n`;
const WITH_PROP = `${LOOP}<Card h2Class="text-xl italic" post={post} />)}\n`; // the editor inserts its prop first

/** One component file per test: the planner's "already written" memo is module state. */
function arrange(card: string) {
  const key = (copy: number) => `${card}:1:1~${P}${copy ? `#${copy}` : ''}`;
  const loc = { file: card, line: 1, column: 1 };
  const el = (copy: number, classes: string, masterClasses?: string) => ({ key: key(copy), parentKey: null, tagName: 'h2', classes, masterClasses,
    sourceLocation: loc, usageLocation: { file: PAGE, line: 1, column: LOOP.length + 1 }, rect });
  const scan = (count: number, classes: string, masterClasses?: string) => Array.from({ length: count }, (_, copy) => el(copy, classes, masterClasses));
  files[card] = '<h2 class="text-xl">Card title</h2>\n';
  files[PAGE] = WITHOUT_PROP;
  const doc = new Y.Doc();
  const ctx = makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc } });
  /** A design-bar class edit on one copy, as the editor stores it. */
  const edit = (copy: number, classes: string) => {
    applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key(copy), classes: MASTER, sourceLocation: loc });
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key(copy), classes });
  };
  return { key, loc, scan, doc, ctx, edit };
}

/** One post: the user restyles the title on the page — the page passes the prop. Then three more posts are added. */
async function editedWithOneCopyThenGrownToFour(card: string) {
  const t = arrange(card);
  noteScan(t.scan(1, MASTER));
  t.edit(0, OVERRIDE);
  await migrateEditorOverrides(t.doc, new Set([t.key(0)])); // the same planner the edit itself uses
  expect(files[PAGE]).toBe(WITH_PROP);
  expect(files[card]).toBe('<h2 class={Astro.props.h2Class ?? "text-xl"}>Card title</h2>\n');
  const four = t.scan(4, OVERRIDE, MASTER); // every copy renders the page's prop; the tagger reports the master
  noteScan(four);
  handleElementsScanned(t.ctx, { elements: four });
  return { ...t, four };
}

beforeEach(() => { for (const f of Object.keys(files)) delete files[f]; localStorage.clear(); writeClassUpdate.mockReset(); });
afterEach(() => { resetClassWriteBaselines(); _resetLocalPageSyncForTests(); });

describe('REPRO: a loop usage (one tag, N copies) — Reset / Push / edit', () => {
  it.fails('Reset removes the page prop that was written while the usage rendered one copy', async () => {
    const card = 'src/components/CardReset.astro';
    const t = await editedWithOneCopyThenGrownToFour(card);
    const entries = localOverridesForPlacement(t.doc, card, P);
    expect(entries.length).toBeGreaterThan(0); // `*` is lit, Reset is offered
    await resetLocalOverrides(t.doc, entries);
    expect(localOverridesForPlacement(t.doc, card, P)).toEqual([]); // the editor reports a clean instance…
    expect(files[PAGE]).toBe(WITHOUT_PROP); // …DESIRED: and the page stopped passing the prop. Today it still does.
  });

  it.fails('after Reset, an instance that still renders an override is still reported as overridden', async () => {
    const card = 'src/components/CardSettle.astro';
    const t = await editedWithOneCopyThenGrownToFour(card);
    await resetLocalOverrides(t.doc, localOverridesForPlacement(t.doc, card, P));
    // The prop was not dropped, so every later scan renders the override again.
    for (let i = 0; i < 3; i++) handleElementsScanned(t.ctx, { elements: t.four });
    const stillInFiles = files[PAGE].includes('h2Class=');
    const editorKnows = localOverridesForPlacement(t.doc, card, P).length > 0;
    // DESIRED: files and editor agree. Today: the prop is in the file, the editor holds nothing (`*` dark, Reset/Push gone).
    expect(stillInFiles).toBe(editorKnows);
  });

  const pushWritesMaster = () => writeClassUpdate.mockImplementation(async (loc: { file: string }, classes: string) => {
    files[loc.file] = files[loc.file].replace(/\?\? "[^"]*"/, `?? ${JSON.stringify(classes)}`);
    return true;
  });

  it.fails('Push bakes the value into the master AND removes the page prop', async () => {
    const card = 'src/components/CardPush.astro';
    const t = await editedWithOneCopyThenGrownToFour(card);
    pushWritesMaster();
    const result = await pushLocalOverridesToMaster(t.doc, card, P);
    expect(result.failed).toBe(0);
    expect(files[card]).toBe('<h2 class={Astro.props.h2Class ?? "text-xl italic"}>Card title</h2>\n');
    expect(files[PAGE]).toBe(WITHOUT_PROP); // DESIRED. Today the prop stays and keeps beating whatever the master says next.
  });

  it.fails('Push writes one source element once, not once per rendered copy', async () => {
    const card = 'src/components/CardPushOnce.astro';
    const t = await editedWithOneCopyThenGrownToFour(card);
    pushWritesMaster();
    await pushLocalOverridesToMaster(t.doc, card, P);
    expect(writeClassUpdate).toHaveBeenCalledTimes(1); // Today 4: four read-modify-writes of the same line, each reloading the frame.
  });

  it.fails('an edit on any copy of a loop usage is captured as ONE prop on the usage tag', () => {
    const card = 'src/components/CardEdit.astro';
    const t = arrange(card);
    noteScan(t.scan(4, MASTER));
    const origin = { armed: true, pageFile: PAGE } as Parameters<typeof capturePropOverride>[2];
    const target = capturePropOverride(t.key(1), t.loc, origin);
    expect(target).not.toBeNull(); // Today null → "kept in the editor only", stored under the per-copy key `…#1`.
    expect((target as { refused?: string } | null)?.refused).toBeUndefined(); // A refused capture (fix/refuse-unwritable-edits) is not a capture.
  });

  it.fails('Push never writes two different values to one source element (per-copy entries that disagree)', async () => {
    const card = 'src/components/CardCopies.astro';
    const t = arrange(card);
    noteScan(t.scan(4, MASTER));
    // The state decoded from the user's project: copy #0 holds one value, copies #1..#3 another.
    for (let copy = 0; copy < 4; copy++) {
      t.edit(copy, copy === 0 ? 'text-xl grid' : 'text-xl flex flex-col');
    }
    writeClassUpdate.mockResolvedValue(true);
    await pushLocalOverridesToMaster(t.doc, card, P);
    const written = new Set(writeClassUpdate.mock.calls.map(call => call[1] as string));
    expect([...written]).toHaveLength(1); // Today 2: `grid` is written, then overwritten by the last copy's `flex flex-col`.
  });

  /** Four copies: the edit on copy #0 is refused as a prop and stays in the editor only. Every scan runs the migration. */
  async function editedWhileFourCopies(card: string) {
    const t = arrange(card);
    const four = t.scan(4, MASTER);
    noteScan(four);
    t.edit(0, 'text-xl underline');
    await migrateEditorOverrides(t.doc, new Set(four.map(e => e.key)));
    expect(files[PAGE]).toBe(WITHOUT_PROP); // nothing written: one tag, four copies
    return t;
  }

  it.fails('the "migrated" record lists only values that were actually written to a file', async () => {
    await editedWhileFourCopies('src/components/CardRecord.astro');
    // DESIRED: empty — the write was refused. Today the refused value is recorded as migrated ("once per value, ever").
    expect(JSON.parse(localStorage.getItem('sq:override-migrated:browser_p') ?? '{}')).toEqual({});
  });

  it.fails('N → 1: an edit made while the usage rendered N copies does not stay editor-only forever', async () => {
    const card = 'src/components/CardShrink.astro';
    const t = await editedWhileFourCopies(card);
    // Three posts are deleted: one copy left, the override is now expressible as a prop. The next scans:
    noteScan(t.scan(1, MASTER));
    for (let i = 0; i < 2; i++) await migrateEditorOverrides(t.doc, new Set([t.key(0)]));
    const inFiles = files[PAGE].includes('h2Class=');
    const inEditor = localOverridesForPlacement(t.doc, card, P).length > 0;
    // DESIRED: files and editor agree. Today: painted on the canvas from the editor store, absent from the files
    // (export / deploy / the AI agent never see it) — and never migrated, because it is already recorded as migrated.
    expect(inFiles).toBe(inEditor);
  });
});
