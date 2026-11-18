// THE local-mode write-scope law, enforced at the ONE choke point every source
// write passes through (BaseViteWriter.sendRequest). Data-loss incident
// 2026-08-02: from a PAGE view, class/text/image/tag-swap/structural writes all
// resolved their target from the scanned element's sourceLocation — which for
// anything rendered by `<Header />` is src/components/Header.astro — and edited
// the component file for every page. Instance-scope gestures must never write
// the master; the component view is the escape hatch and stays fully writable.
//
// Since c8535b79 ("add durable structural dispatch core") structural ops no
// longer post SQ_WRITE_* to the iframe: they run through
// `acceptStructuralOperations`, which enforces the SAME law (captured origin →
// `isCrossFileAtOrigin`) and REJECTS with 'Structural edits cannot change
// another surface file' (no refusal event — callers surface the error). Their
// "written" side is proven on a real route table + temp disk (projectFsRuntime).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// :4321 reports stopped throughout — availability comes from the LOCAL instance.
vi.mock('@/services/previewServerStatus', () => ({
  previewServer: {
    onStateChange: vi.fn(() => () => {}),
    getState: vi.fn(() => ({ status: 'stopped', url: null, port: 4321, error: null })),
  },
}));

// localFetch stays spy-able for the variables tests; by default it delegates to
// the real transport so structural acceptance can reach projectFsRuntime.
const realFetch = vi.hoisted(() => ({ fn: null as null | ((path: string, init?: RequestInit) => Promise<Response>) }));
vi.mock('@/utils/sqLocalBase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/sqLocalBase')>();
  realFetch.fn = actual.localFetch;
  return { ...actual, localFetch: vi.fn(actual.localFetch) };
});

import { localFetch } from '@/utils/sqLocalBase';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { ensureVariablesImport, _resetLocalVariablesCss } from '../localVariablesCss';
import { viteClassWriter } from '../ViteClassWriter';
import { viteTextWriter } from '../ViteTextWriter';
import { viteImageWriter } from '../ViteImageWriter';
import { viteMediaWriter } from '../ViteMediaWriter';
import { viteStructuralWriter } from '../ViteStructuralWriter';
import { setServerWriteMode } from '../serverWriteMode';
import {
  setLocalExpectedRoute,
  setLocalPageFile,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import { LOCAL_CROSS_FILE_WRITE_EVENT } from '@/utils/localWriteScope';

const PAGE = 'src/pages/index.astro';
const COMPONENT = 'src/components/Header.astro';
const pageLoc = { file: PAGE, line: 8, column: 3 };
const componentLoc = { file: COMPONENT, line: 5, column: 3 };
// Real sources whose scan-time coordinates match the locs above; each has a
// sibling one line below (the move target).
const PAGE_SRC = "---\nimport Header from '../components/Header.astro';\n---\n<html>\n<body>\n<Header />\n<main>\n  <p>page</p>\n  <p>two</p>\n</main>\n</body>\n</html>\n";
const COMPONENT_SRC = '<header>\n<div>\n<div>\n<div>\n  <a>link</a>\n  <b>two</b>\n</div>\n</div>\n</div>\n</header>\n';
const LAYOUT = 'src/layouts/Layout.astro';
const LAYOUT_SRC = '<html>\n<body>\n<slot />\n</body>\n</html>\n';
const STRUCTURAL_REFUSAL = 'Structural edits cannot change another surface file';

let runtime: ReturnType<typeof projectFsRuntime> | null = null;
let projectSeq = 0;
/** A fresh project (id + temp disk) — per-project materializer state must not leak. */
function openProject(): ReturnType<typeof projectFsRuntime> {
  runtime?.close();
  const id = `browser_cross_file_${++projectSeq}`;
  setActiveSaveProjectId(id);
  runtime = projectFsRuntime(id, { [PAGE]: PAGE_SRC, [COMPONENT]: COMPONENT_SRC, [LAYOUT]: LAYOUT_SRC });
  return runtime;
}
const STRUCTURAL = new Set(['structural insert', 'structural delete', 'structural move', 'structural restore (undo)']);

const writers = [
  viteClassWriter,
  viteTextWriter,
  viteImageWriter,
  viteMediaWriter,
  viteStructuralWriter,
];

let postMessage: ReturnType<typeof vi.fn>;
let iframe: HTMLIFrameElement;
let refusals: string[];
let warning: ReturnType<typeof vi.spyOn>;
let expectedWarnings: string[];
const originalWarn = console.warn;
const onRefusal = (e: Event) => refusals.push((e as CustomEvent).detail.file);

beforeEach(async () => {
  await db.delete();
  await db.open();
  vi.mocked(localFetch).mockImplementation(realFetch.fn!);
  _resetLocalPageSyncForTests();
  _resetLocalVariablesCss();
  postMessage = vi.fn();
  refusals = [];
  expectedWarnings = [];
  warning = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (/^\[Vite(?:Media|Structural)Writer\] refused SQ_WRITE_(?:TAG_SWAP|INSERT|REMOVE|MOVE|RESTORE|IMPORT): src\/(?:components\/Header|layouts\/Layout)\.astro is not the page being edited$/.test(String(args[0]))) expectedWarnings.push(String(args[0]));
    else originalWarn(...args);
  });
  window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal);
  iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
  setServerWriteMode(true);
  for (const w of writers) {
    w.setIframeRef(iframe);
    w.setLocalInstanceState({ status: 'running', url: 'http://localhost:5311' });
  }
});

afterEach(() => {
  expect(expectedWarnings).toHaveLength(refusals.length);
  warning.mockRestore();
  _resetLocalVariablesCss();
  window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal);
  for (const w of writers) {
    w.setIframeRef(null);
    w.setLocalInstanceState(null);
  }
  setServerWriteMode(false);
  runtime?.close();
  runtime = null;
  setActiveSaveProjectId(null);
});

/** Every P0/P1 write path, keyed by the file it targets. */
const paths: Array<[string, (loc: typeof pageLoc) => Promise<unknown>]> = [
  ['class edit', (loc) => viteClassWriter.writeClassUpdate(loc, 'text-xl')],
  ['text edit', (loc) => viteTextWriter.writeTextUpdate(loc, 'hello')],
  ['image edit', (loc) => viteImageWriter.writeImageUpdate(loc, 'src', '/a.png')],
  ['tag swap', (loc) => viteMediaWriter.writeTagSwap(loc, 'video', '/a.mp4')],
  ['structural insert', (loc) => viteStructuralWriter.writeInsert(loc, '<div/>', 'after')],
  ['structural delete', (loc) => viteStructuralWriter.writeRemove(loc, true)],
  ['structural move', (loc) => viteStructuralWriter.writeMove(loc, { ...loc, line: loc.line + 1 }, 'after', true)],
  ['structural restore (undo)', (loc) => viteStructuralWriter.writeRestore(loc, '<div/>')],
];

describe('page view: a write targeting another file is refused', () => {
  beforeEach(() => {
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
  });

  // Instance-overrides ledger (2026-08-03): class / text / image writes now have
  // an override home, so a cross-file one is ABSORBED — still no file write, but
  // no refusal either, because nothing was lost. Everything else has no override
  // tier and keeps the honest refusal.
  const OVERRIDE_TIERS = new Set(['class edit', 'text edit', 'image edit']);

  for (const [name, run] of paths) {
    if (OVERRIDE_TIERS.has(name)) {
      it(`${name} → absorbed as an instance override: NO file write, NO refusal`, async () => {
        const res = await run(componentLoc);
        expect(res).toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
        expect(refusals).toEqual([]);
      });
      continue;
    }
    if (STRUCTURAL.has(name)) {
      it(`${name} → rejected by structural acceptance (file byte-identical, nothing journaled)`, async () => {
        const project = openProject();
        await expect(run(componentLoc)).rejects.toThrow(STRUCTURAL_REFUSAL);
        expect(postMessage).not.toHaveBeenCalled();
        expect(project.read(COMPONENT)).toBe(COMPONENT_SRC);
        expect(await db.durableEdits.count()).toBe(0);
      });
      continue;
    }
    it(`${name} → refused, nothing sent to the iframe (file byte-identical)`, async () => {
      const res = await run(componentLoc);
      expect(res).toBe(false);
      expect(postMessage).not.toHaveBeenCalled();
      expect(refusals).toEqual([COMPONENT]);
    });
  }

  it('the master file is still never written from a page view, override or not', async () => {
    const project = openProject();
    await Promise.allSettled(paths.map(([, run]) => run(componentLoc)));
    expect(postMessage).not.toHaveBeenCalled();
    expect(project.read(COMPONENT)).toBe(COMPONENT_SRC);
  });

  // task-149: the ONE sanctioned way through — the user clicked "Push changes
  // to source" on the instance, so writing the master IS the request. Nothing
  // sets masterWrite implicitly; store/localMasterOverrides.ts is its only
  // caller.
  describe('explicit Push to source (masterWrite)', () => {
    it('writes the component file and raises no refusal', async () => {
      // Not awaited: a real write settles only when the iframe posts its
      // result back, and the assertion is that the message went out at all.
      void viteClassWriter.writeClassUpdate(componentLoc, 'text-xl', true);
      void viteTextWriter.writeTextUpdate(componentLoc, 'hello', true);
      void viteImageWriter.writeImageUpdate(componentLoc, 'src', '/a.png', true);
      await Promise.resolve();

      expect(postMessage).toHaveBeenCalledTimes(3);
      expect(refusals).toEqual([]);
      for (const call of postMessage.mock.calls) {
        expect(call[0].payload.sourceLocation.file).toBe(COMPONENT);
      }
    });

    it('is opt-in: the same calls without the flag are still absorbed', async () => {
      await viteClassWriter.writeClassUpdate(componentLoc, 'text-xl');
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  it('an unknown surface file default-denies (boot / unresolved page)', async () => {
    setLocalPageFile(null);
    expect(await viteClassWriter.writeClassUpdate(pageLoc, 'text-xl')).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('same-file writes are unchanged (regression pin)', async () => {
    for (const [name, run] of paths) {
      if (!STRUCTURAL.has(name)) void run(pageLoc);
    }
    expect(postMessage).toHaveBeenCalledTimes(paths.length - STRUCTURAL.size);
    for (const [name, run] of paths) {
      if (!STRUCTURAL.has(name)) continue;
      const project = openProject();
      await expect(run(pageLoc), name).resolves.toMatchObject({ success: true, file: PAGE });
      await vi.waitFor(() => expect(project.read(PAGE), name).not.toBe(PAGE_SRC));
    }
    expect(refusals).toEqual([]);
  });

  // task-174: the law used to have ONE documented exemption — the CSS-variables
  // write carried no `sourceLocation`, so `typeof targetFile === 'string'` was
  // false in sendRequest and the guard was skipped entirely. That writer is
  // deleted (its message never had a receiver in the whole history of the
  // repo), and the hole went with it: EVERY remaining writer sends a
  // sourceLocation, so the guard now covers 100% of source writes. The pin
  // that keeps it that way is 'every writer payload carries a sourceLocation'
  // in vite-plugin/__tests__/writeBridgeSenderFieldParity.test.ts — a new
  // un-located writer turns it red instead of silently re-opening the hole.
});

describe('component view: the component file IS the surface — every edit proceeds', () => {
  beforeEach(() => {
    setLocalExpectedRoute(`/__sq_component_view/${COMPONENT}`);
    setLocalPageFile(COMPONENT);
  });

  for (const [name, run] of paths) {
    if (STRUCTURAL.has(name)) {
      it(`${name} → written`, async () => {
        const project = openProject();
        await expect(run(componentLoc)).resolves.toMatchObject({ success: true, file: COMPONENT });
        await vi.waitFor(() => expect(project.read(COMPONENT)).not.toBe(COMPONENT_SRC));
        expect(project.read(PAGE)).toBe(PAGE_SRC);
        expect(refusals).toEqual([]);
      });
      continue;
    }
    it(`${name} → written`, async () => {
      void run(componentLoc);
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(refusals).toEqual([]);
    });
  }

  it('a PAGE-file write from the component view is refused (the rule is symmetric)', async () => {
    expect(await viteClassWriter.writeClassUpdate(pageLoc, 'text-xl')).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

// 2026-08-05, owner report "editing the master does nothing". The class write is
// the ONE deferred write (5 s debounce, useClassPersistenceQueue) and the queue
// already judges it against the surface the gesture was made on
// (`isCrossFileAtOrigin`, task-181). The choke point then re-asked the SAME
// question against the CURRENT surface — so a master Fill edit made in the
// component view and flushed after the user walked back to the page was judged
// cross-file and dropped by the OVERRIDE_TIER branch: no postMessage, no toast,
// no console warning. Measured: `crossFileAtOrigin=false` (allow) one line above
// `isLocalCrossFileWrite=true` (refuse), file byte-identical afterwards.
// A supplied origin is now the authority; without one nothing changes.
describe('deferred write: the ORIGIN surface decides, not the current one', () => {
  const componentOrigin = { armed: true, pageFile: COMPONENT };
  const pageOrigin = { armed: true, pageFile: PAGE };

  beforeEach(() => {
    // The user has navigated BACK to the page by the time the debounce fires.
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
  });

  it('a master edit made in the component view still writes the component file', async () => {
    void viteClassWriter.writeClassUpdate(componentLoc, 'text-xl', false, undefined, componentOrigin);
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].payload.sourceLocation.file).toBe(COMPONENT);
    expect(refusals).toEqual([]);
  });

  it('an instance edit made on the page is still absorbed (task-181 pin, both gates agree)', async () => {
    expect(
      await viteClassWriter.writeClassUpdate(componentLoc, 'text-xl', false, undefined, pageOrigin),
    ).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('no origin supplied → unchanged current-surface default-deny', async () => {
    expect(await viteClassWriter.writeClassUpdate(componentLoc, 'text-xl')).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('non-local runtimes are byte-identical (guard disarmed)', () => {
  it('WC/server/legacy: no expected route armed → cross-file writes still go through', async () => {
    setLocalExpectedRoute(null);
    setLocalPageFile(null);
    const project = openProject();
    void viteClassWriter.writeClassUpdate(componentLoc, 'text-xl');
    expect(postMessage).toHaveBeenCalledTimes(1);
    await expect(viteStructuralWriter.writeRemove(componentLoc, true)).resolves.toMatchObject({ success: true, file: COMPONENT });
    await vi.waitFor(() => expect(project.read(COMPONENT)).not.toContain('<a>link</a>'));
    expect(refusals).toEqual([]);
  });
});
it('a deferred image retains its page gesture scope after the master view opens', async () => {
  setLocalExpectedRoute('/'); setLocalPageFile(COMPONENT);
  const result = await viteImageWriter.writeImageUpdate(componentLoc, 'alt', 'instance-only', false, { armed: true, pageFile: PAGE }, true);
  expect(result).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
});


describe('project variables service explicit layout import', () => {
  beforeEach(() => {
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
  });

  it('links variables CSS through the actual writer while ordinary layout import remains refused', async () => {
    const project = openProject();
    await expect(ensureVariablesImport('/project')).resolves.toEqual([LAYOUT]);
    await vi.waitFor(() => expect(project.read(LAYOUT)).toBe(`---\nimport '../styles/sq-variables.css';\n---\n${LAYOUT_SRC}`));
    expect(postMessage).not.toHaveBeenCalled();
    expect(refusals).toEqual([]);
    const linked = project.read(LAYOUT);
    // Without the variables service's explicit masterWrite, the same import
    // into a layout (not the page being edited) is still refused.
    await expect(viteStructuralWriter.writeImport(LAYOUT, 'Other', './Other.astro')).rejects.toThrow(STRUCTURAL_REFUSAL);
    expect(project.read(LAYOUT)).toBe(linked);
  });

  // Deleted: 'retains the job after an actual import failure ACK and retries
  // its queued destination'. The in-memory variables job queue it pinned
  // (hasPendingLocalVariablesCss / flushPendingLocalVariablesCss retry) was
  // retired in 0e8c9652 ("journal content and layout edits"): variables CSS +
  // import now accept durably with the document gesture and the materializer
  // owns retry (see durableEdits/__tests__/featureAcceptance.test.ts).
});
