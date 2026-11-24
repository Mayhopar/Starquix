/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md):
 * mixed editing — the AI agent (write_file / edit_file) and the editor work on
 * the same files, but the editor also keeps its own copy of every instance
 * override (Yjs `sourceClasses`, mirrored to localStorage) and that copy wins:
 * it is repainted over what the files render, it is the merge base of the next
 * manual edit, and a new session writes it back into the files.
 * In the user's journal: the agent changed `h2Class` on the page at 19:54:12Z
 * (rev 1276); the editor wrote the pre-agent value back at 19:57:58Z (rev 1279).
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 * Harness: the in-memory file system of propOverrideMigration.test.ts; every
 * test is a fresh session (module state: settling set, `written` memo, file cells).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { makeFakeCtx, makeFakeIframe } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';

const files: Record<string, string> = {};
vi.mock('@/services/pendingProjectMutations', async (orig) => ({ ...(await orig<object>()), getActiveSaveProjectId: () => 'browser_p' }));
vi.mock('@/utils/localWriteScope', async (orig) => ({ ...(await orig<object>()), captureLocalWriteOrigin: () => ({ armed: true, pageFile: 'src/pages/blog/index.astro' }) }));
vi.mock('@/services/durableEdits/projectedSource', () => ({
  readProjectedSourceState: async (_p: string, f: string) => files[f] ?? null,
  withProjectedSource: async (_p: string, _r: number, run: () => Promise<unknown>) => run(),
}));
vi.mock('@/services/durableEdits/acceptance', () => ({ inspectAcceptedProject: async (_p: string, read: (r: number) => Promise<unknown>) => read(1) }));
vi.mock('@/services/durableEdits/fileAcceptance', () => ({
  acceptFileChanges: async (_f: string, plan: () => Promise<{ file: string; afterSource: string }[]>) => {
    for (const c of await plan()) files[c.file] = c.afterSource; return {};
  },
  finishAcceptedFiles: async () => ({}),
}));

const CARD = 'src/components/BlogCard.astro';
const PAGE = 'src/pages/blog/index.astro';
const PL = 's73bb06627ed37e6c';
const MASTER = 'flex flex-col';
const USER = 'grid gap-4';      // the user's instance override, made in the editor
const AGENT = 'contents';       // what the agent wrote into the page afterwards
const CARD_SRC = ['---', 'const { post } = Astro.props;', '---', '<article class="a1">', `  <div class={Astro.props.divClass ?? "${MASTER}"}>`,
  '    <h2 class="t1">T</h2>', '    <time class="d1">D</time>', '  </div>', '</article>', ''].join('\n');
const pageSrc = (divClass: string) => ['---', "import BlogCard from '../../components/BlogCard.astro';", 'const post = 1;', '---', '<main>',
  `  <BlogCard divClass="${divClass}" post={post} />`, '</main>', ''].join('\n');
const USAGE = { file: PAGE, line: 6, column: 3 };
const DIV = `${CARD}:5:3~${PL}`;
const rect = { top: 0, left: 0, width: 10, height: 10 };
/** The <div> as one scan reports it: `classes` = what the page renders, `masterClasses` = the component's fallback literal. */
const div = (classes: string) => ({ key: DIV, parentKey: null, tagName: 'div', classes, masterClasses: MASTER,
  sourceLocation: { file: CARD, line: 5, column: 3 }, usageLocation: USAGE, rect });

async function session() {
  vi.resetModules();
  const [{ handleElementsScanned }, lmo, po, cmds, { applyCommand }] = await Promise.all([
    import('@/components/Canvas/viewportMessages/scanning'), import('@/store/localMasterOverrides'),
    import('@/utils/propOverrides'), import('../propOverrideCommands'), import('@/store/commands')]);
  const scanInto = (doc: Y.Doc, elements: ReturnType<typeof div>[]) => {
    const { iframe, postMessage } = makeFakeIframe();
    po.noteScan(elements);
    handleElementsScanned(makeFakeCtx({ refs: { iframe }, env: { doc } }), { elements });
    return postMessage.mock.calls.map(([m]) => m as { type: string; payload: { key: string; classes: string } }).filter(m => m.type === 'UPDATE_CLASSES').map(m => m.payload.classes);
  };
  const overrides = (doc: Y.Doc) => lmo.localOverridesForPlacement(doc, CARD, PL).map(e => e.value);
  return { ...po, ...cmds, applyCommand, scanInto, overrides };
}

beforeEach(() => { for (const f of Object.keys(files)) delete files[f]; files[CARD] = CARD_SRC; files[PAGE] = pageSrc(USER); localStorage.clear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('REPRO: the editor\'s copy of an override outranks the files (agent + manual editing)', () => {
  it.fails('one copy: after the agent changes a page prop, the canvas keeps the agent\'s value', async () => {
    const s = await session();
    const doc = new Y.Doc();
    s.scanInto(doc, [div(USER)]);                 // the page passes the user's override: the editor mirrors it
    expect(s.overrides(doc)).toEqual([USER]);
    files[PAGE] = pageSrc(AGENT);                 // the agent's edit_file; the dev server re-renders
    const repaints = s.scanInto(doc, [div(AGENT)]);
    expect(repaints).toEqual([]);                 // DESIRED. Today: [USER] — the stale editor entry is painted over the agent's value
    expect(s.overrides(doc)).toEqual([AGENT]);    // DESIRED: the editor's view follows the file. Today it still says USER
  });

  it.fails('a new session does not write a stale editor entry back over a page prop the agent changed', async () => {
    files[PAGE] = pageSrc(AGENT);                 // on disk: the agent's value
    const doc = new Y.Doc();                      // restored from sq:source-classes: the user's older override
    const s = await session();                    // new session: the in-memory "already written" memo is empty
    s.applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: DIV, classes: MASTER, sourceLocation: { file: CARD, line: 5, column: 3 } });
    s.applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: DIV, classes: USER });
    s.noteScan([div(AGENT)]);
    await s.migrateEditorOverrides(doc, new Set([DIV])); // runs after every scan
    expect(files[PAGE]).toBe(pageSrc(AGENT));     // DESIRED. Today the scan rewrites the page to divClass="grid gap-4"
  });

  it.fails('the prop plan refuses a coordinate that no longer names the scanned element', async () => {
    const s = await session();
    // The scan said <h2> is at 6:5. Since then the master was reordered (<time> first); the canvas has not rescanned yet.
    files[CARD] = CARD_SRC.replace('    <h2 class="t1">T</h2>\n    <time class="d1">D</time>', '    <time class="d1">D</time>\n    <h2 class="t1">T</h2>');
    const plan = s.planOverride(async f => files[f] ?? null, [{ component: CARD, usage: USAGE }], { file: CARD, line: 6, column: 5 }, 'h2', 'class', 'text-4xl');
    // DESIRED: refused (tag / source version mismatch). Today it resolves and gives the <time> the h2's prop:
    // `<time class={Astro.props.h2Class ?? "d1"}>` + `h2Class="text-4xl"` on the page.
    await expect(plan).rejects.toThrow();
  });

  it.fails('a transient editor class on the node is never seeded as an instance override', async () => {
    files[PAGE] = pageSrc(MASTER).replace(` divClass="${MASTER}"`, ''); // the page passes nothing
    const s = await session();
    const doc = new Y.Doc();
    s.scanInto(doc, [div(`${MASTER} sq-ai-appear`)]); // the AI highlight animation class is still on the element when the scan runs
    // DESIRED: []. Today the DOM class is stored as an override (found in the user's sq:source-classes: `… sq-ai-appear`).
    expect(s.overrides(doc)).toEqual([]);
  });
});
