/**
 * Local Push leaves the CURRENT canvas stale — round-7 recording, 2026-08-04.
 *
 * Reproduced on a live local-mode `astro dev` (rig: two `<Card/>` on one page,
 * probe drives the real `sq:write-classes` HMR channel `pushLocalOverridesToMaster`
 * uses):
 *
 *   A. the push write        → `sq:write-result success`, disk changed,
 *                              SERVED BYTES CHANGED, **0 full-reload broadcasts**
 *   B. same file touched from outside, after 5s → **1 full-reload** (the watcher works)
 *   C. same file via a `suppressHmr:false` op    → **1 full-reload**
 *
 * So the cause is `sq-source-plugin.js`'s `performWrite`: every class/text/image
 * write opens a 5s HMR-suppression window on the target file. That is right for
 * an ordinary edit — the parent already patched that exact element into the DOM,
 * and a reload would be pure blink. It is wrong for a **Push**, which writes the
 * MASTER: the other placements of that component on the page you are standing on
 * were never patched, so the suppression swallows the only signal that would
 * refresh them. Served bytes new, canvas old, and a page switch (a fresh HTTP
 * GET) repaints it — exactly what was reported.
 *
 * The fix reuses the one existing mechanism, `Canvas/reloadPreview.ts`, whose
 * other caller is Reset. It re-navigates the frame, so the canvas shows the
 * SERVED bytes rather than the values we asked for — which matters, because the
 * writers transform a value on its way into the file (class sanitisation drops
 * `undefined`/`null`/`false`/`true` tokens; the `class={'lit' + tail}` branch
 * edits only the literal, so the rendered element keeps tail-contributed
 * tokens). A targeted repaint would paint the requested value and make the
 * canvas lie right after the one action whose promise is "the master now renders
 * what you see".
 *
 * It costs the frame's scroll position, which is why undo/redo were deliberately
 * moved OFF this mechanism. Push is a deliberate, confirmed, low-frequency
 * gesture, so it is charged only when something actually landed on disk.
 *
 * ROUND 11 — that reload was a coin flip, and losing it was WORSE than the bug
 * it fixed. Measured live over 5 pushes: it fires 90–200 ms after the write
 * result returns, and `astro dev` needs a comparable interval to re-render the
 * changed `.astro`. When the reload wins, the frame latches the PRE-push HTML
 * for BOTH placements — including the one just pushed, whose overlay Push has
 * already cleared — and never reloads again. 3 of 5 cycles stale, showing the
 * user the value they had just replaced.
 *
 * So Push now snapshots the served bytes BEFORE the writes and re-navigates
 * only once the instance actually serves something else
 * (`Canvas/reloadPreview.ts`, verified-reload half). The loading toast is
 * resolved after that, so the user's "done" signal means the canvas is done.
 * RESET is deliberately NOT routed through it — see the last case.
 *
 * ROUND 15 — "serves something else" was the wrong question. Every body below
 * now carries a per-request nonce, which is all it takes to break a whole-page
 * byte compare: on the live rig two GETs with no write between them already
 * differ, and after a real push the byte compare said "changed" 140 ms before
 * the pushed value was actually served. Push therefore hands the reload the
 * VALUES that landed (`LocalPushResult.values`) and waits until the instance
 * serves them. Removing `{ needles: result.values }` from `DesignBar.tsx` turns
 * the second case below red with `expected 1 to be +0`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const FILE = 'src/components/Header.astro';
const P = '~p5e23e503da89f633';
const PAGE_KEY = 'src/pages/index.astro:5:1';
const ROOT_KEY = `${FILE}:1:1${P}`;
const RICH = 'text-2xl font-bold text-stone-800';

/**
 * ROUND 15 — what the instance serves before and after the push re-renders.
 *
 * Both carry a per-request nonce, because that is the case the whole-page byte
 * compare cannot survive: on a page with a timestamp, a session id or an
 * analytics snippet, EVERY poll differs from the baseline whether or not the
 * edit re-rendered. Only PRE_PUSH vs POST_PUSH differ in the thing that matters
 * — whether the pushed class string is on the page.
 */
const nonce = () => `<meta name="n" content="${Math.random()}">`;
const PRE_PUSH = () => `<html><head>${nonce()}</head><body><h1 class="text-sm">T</h1></body></html>`;
const POST_PUSH = () => `<html><head>${nonce()}</head><body><h1 class="${RICH}">T</h1></body></html>`;

const DOC_INSTANCE = 'el-doc1';
const DOC_SOURCE = 'src/components/Header.astro';
const DOC_MARKUP = '<div class="p-4"><h1 class="text-xl">T</h1><p class="text-sm">B</p></div>';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  localPath: null as string | null,
  selectedKey: '' as string,
  // Literal, not `RICH`: vi.hoisted runs before the module's own consts.
  pushResult: { pushed: 1, failed: 0, values: ['text-2xl font-bold text-stone-800'] },
  pushCalls: 0,
  /** Ordered log of everything the user can perceive: toasts and reloads. */
  timeline: [] as string[],
  errors: [] as string[],
  readCalls: 0,
  rejectRead: 0,
  claim: false,
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(() => { h.timeline.push('toast:info'); }, {
    success: () => { h.timeline.push('toast:success'); },
    error: (message: string) => { h.timeline.push('toast:error'); h.errors.push(message); },
    loading: () => { h.timeline.push('toast:loading'); },
  });
  return { default: toast, toast };
});

vi.mock('@/store/localMasterOverrides', async (orig) => {
  const actual = await orig<typeof import('@/store/localMasterOverrides')>();
  return {
    ...actual,
    readLocalPushFiles: async (...args: Parameters<typeof actual.readLocalPushFiles>) => {
      h.readCalls += 1;
      if (h.readCalls === h.rejectRead) throw new Error('Journal unavailable');
      return actual.readLocalPushFiles(...args);
    },
    pushLocalOverridesToMaster: async () => {
      h.pushCalls += 1;
      return { ...h.pushResult, landedKeys: [], reasons: [], droppedFiles: [] };
    },
  };
});

vi.mock('@/store/instanceLifecycle', async (orig) => {
  const actual = await orig<typeof import('@/store/instanceLifecycle')>();
  return { ...actual, pushInstanceToSource: () => ({ ok: true }) };
});

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => vi.fn(),
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => h.localPath,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({
    scannedByKey: new Map([
      [PAGE_KEY, { key: PAGE_KEY, classes: '', parentKey: null }],
      [ROOT_KEY, { key: ROOT_KEY, classes: RICH, parentKey: PAGE_KEY }],
    ]),
  });
  return ({
  useSelectedElement: () => ({
    key: h.selectedKey,
    sourceLocation: { file: FILE, line: 1, column: 1 },
    tagName: 'div',
    classes: RICH,
    computedStyles: null,
    parentDisplay: null,
    linkHref: null, linkTarget: null, linkAriaLabel: null,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null,
    postSlug: null,
    hasSelection: true,
    isEditingText: false,
  }),
  useSelectionContext: () => ({ additionalSelections: [] }),
  useTextSelection: () => ({
    hasTextSelection: false, isInsideLink: false,
    isLinkInteracting: false, setLinkInteracting: vi.fn(),
  }),
  useScannedElements: scan,
  useScannedElementsRef: () => ({ scannedByKeyRef: { current: scan().scannedByKey } }),
});
});

vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ setClasses: vi.fn(), getClassesFromYjs: () => RICH }),
  useElementClasses: () => RICH,
}));
vi.mock('@/context/StateContext', () => ({
  useActiveState: () => ({ activeState: 'default', isEditingState: false }),
}));
vi.mock('@/context/BreakpointContext', () => ({
  useActiveBreakpoint: () => ({ activeBreakpoint: 'xs', isEditingBreakpoint: false }),
  PRIMARY_BREAKPOINT: 'xs',
}));
vi.mock('@/context/ThemeContext', () => ({
  useActiveTheme: () => ({ activeTheme: 'light', isEditingDark: false }),
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn(), claimSnapshot: () => h.claim ? { attachFiles: vi.fn(), commit: vi.fn() } : undefined }),
}));
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ openPost: vi.fn(), previewPost: vi.fn() }),
}));
vi.mock('@/hooks/useSourceHtml', () => ({
  useSourceHtml: () => ({ sourceHtml: '', refetchSourceHtml: vi.fn(), setSourceHtml: vi.fn() }),
}));
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [], refresh: vi.fn() }),
}));
vi.mock('@/hooks/useBlogSlotContext', () => ({
  useBlogSlotContext: () => ({ isInsideBlogSlot: false, blogSlotKey: null }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: () => {} }),
}));

vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});

vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => null }));
vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => null }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => null }));
vi.mock('../blocks/LayoutAppearanceBlock', () => ({ LayoutAppearanceBlock: () => null }));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => null }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => null }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => null }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => null }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => null }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => null }));
vi.mock('../blocks/SlotBlock', () => ({ SlotBlock: () => null }));
vi.mock('../blocks/SlotTargetBlock', () => ({ SlotTargetBlock: () => null }));
vi.mock('../inputs/ContentFieldPickerPair', () => ({ ContentFieldPickerPair: () => null }));
vi.mock('../tabs/index', () => ({ ClassesTab: () => null, SourceTab: () => null }));
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

import { DesignBar } from '../DesignBar';
import { setLocalComponentViewFile } from '@/services/localComponentView';
import { PREVIEW_RELOAD_EVENT, setPreviewUrlProvider } from '@/components/Canvas/reloadPreview';

function baseDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

/** local: ONE unpushed class edit on the placement's own root element. */
function localDoc(): Y.Doc {
  const doc = baseDoc();
  doc.transact(() => {
    const entry = new Y.Map();
    entry.set('classes', RICH);
    entry.set('edited', true);
    const loc = new Y.Map();
    loc.set('file', FILE); loc.set('line', 1); loc.set('column', 1);
    entry.set('sourceLocation', loc);
    doc.getMap('sourceClasses').set(ROOT_KEY, entry);
  }, 'sync');
  return doc;
}

function docInstanceDoc(): Y.Doc {
  const doc = baseDoc();
  doc.transact(() => {
    const yEl = new Y.Map();
    yEl.set('staticMarkup', DOC_MARKUP);
    yEl.set('astroSource', DOC_SOURCE);
    yEl.set('pageId', PAGE_ID);
    doc.getMap('elements').set(DOC_INSTANCE, yEl);
    doc.getMap('sourceText').set(`${DOC_INSTANCE}:p-0`, 'edited body');
  }, 'sync');
  return doc;
}

// Push / Reset run on the menu click — no dialog (⌘Z takes them back, culture.md Law 6).
function confirmPush() {
  fireEvent.click(screen.getByTitle('Component options'));
  fireEvent.click(screen.getByText('Push changes to source'));
}

function confirmReset() {
  fireEvent.click(screen.getByTitle('Component options'));
  fireEvent.click(screen.getByText('Reset to master'));
}

let reloads = 0;
const countReload = () => { reloads += 1; h.timeline.push('reload'); };

/**
 * What the local instance is currently serving for the frame's URL. Held as a
 * FUNCTION so each probe gets a fresh nonce, exactly like the real page.
 */
const served = { body: PRE_PUSH };

beforeEach(() => {
  reloads = 0;
  h.pushCalls = 0;
  h.pushResult = { pushed: 1, failed: 0, values: [RICH] };
  h.timeline = [];
  h.errors = []; h.readCalls = 0; h.rejectRead = 0; h.claim = false;
  served.body = PRE_PUSH;
  window.addEventListener(PREVIEW_RELOAD_EVENT, countReload);
  setPreviewUrlProvider(() => 'http://localhost:5199/about');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => served.body() })));
  setLocalComponentViewFile(null);
});
afterEach(() => {
  window.removeEventListener(PREVIEW_RELOAD_EVENT, countReload);
  setPreviewUrlProvider(null);
  vi.unstubAllGlobals();
  setLocalComponentViewFile(null);
});

describe('local Push refreshes the canvas it is standing on', () => {
  for (const stage of ['before', 'after'] as const) {
    it(`clears busy feedback when snapshot reading fails ${stage} acceptance and reports what was accepted`, async () => {
      h.doc = localDoc(); h.localPath = '/Users/me/my-astro-site'; h.selectedKey = ROOT_KEY;
      h.claim = true; h.rejectRead = stage === 'before' ? 1 : 2;
      render(<DesignBar />);
      confirmPush();
      await waitFor(() => expect(h.timeline).toContain('toast:error'));
      expect(h.pushCalls).toBe(stage === 'before' ? 0 : 1);
      expect(h.errors[0]).toContain(stage === 'before' ? 'No changes were accepted' : '1 change was accepted');
      expect(h.errors[0]).toContain('Journal unavailable');
      // A retry is available: failure must not strand the handler's busy guard.
      h.rejectRead = 0; served.body = POST_PUSH;
      confirmPush();
      await waitFor(() => expect(h.timeline).toContain('toast:success'));
      expect(h.pushCalls).toBe(stage === 'before' ? 1 : 2);
    });
  }
  it('re-renders the preview from source once the write has landed', async () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = ROOT_KEY;
    render(<DesignBar />);

    confirmPush();

    await waitFor(() => expect(h.pushCalls).toBe(1));
    served.body = POST_PUSH; // astro finished re-rendering
    // The master file on disk moved; every OTHER placement of it on this page
    // still shows the pre-push markup until the frame re-reads the source.
    await waitFor(() => expect(reloads).toBe(1));
  });

  it('asks for the re-render right after the write — no served-bytes poll (seamless 2.6)', async () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = ROOT_KEY;
    render(<DesignBar />);

    confirmPush();
    await waitFor(() => expect(h.pushCalls).toBe(1));
    // The instance may still serve pre-push bytes: the bridge's in-place refresh
    // fetches after the write, and the write's own Vite reload refreshes again.
    await waitFor(() => expect(reloads).toBe(1));
  });

  it('resolves the push toast only after the canvas is consistent', async () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = ROOT_KEY;
    render(<DesignBar />);

    confirmPush();
    await waitFor(() => expect(h.pushCalls).toBe(1));
    served.body = POST_PUSH;
    await waitFor(() => expect(reloads).toBe(1));

    // One toast id, updated in place: it must not say "done" while the frame is
    // still showing the pre-push markup.
    await waitFor(() => expect(h.timeline).toContain('toast:success'));
    expect(h.timeline).toEqual(['toast:loading', 'reload', 'toast:success']);
  });

  it('a push that landed NOTHING does not pay the scroll cost', async () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = ROOT_KEY;
    h.pushResult = { pushed: 0, failed: 1, values: [] };
    render(<DesignBar />);

    confirmPush();

    await waitFor(() => expect(h.pushCalls).toBe(1));
    // Nothing reached disk, so the served bytes are unchanged and a reload
    // would only throw away the user's scroll position. The failed override
    // stays in the doc and keeps painting — the canvas is not lying.
    expect(reloads).toBe(0);
  });

  it('doc-instance push does NOT re-navigate — its master lives in the doc', async () => {
    h.doc = docInstanceDoc();
    h.localPath = null;
    h.selectedKey = DOC_INSTANCE;
    render(<DesignBar />);

    confirmPush();

    // `pushInstanceToSource` writes the masters overlay and the canvas
    // re-renders from the doc. Re-navigating the shell here would discard
    // scroll for no gain, and the ViewportFrame listener is runtime-agnostic —
    // so the restraint has to live at the call site.
    await waitFor(() => expect(h.timeline).toContain('toast:success')); // the push ran and reported
    expect(reloads).toBe(0);
  });

  it('Reset re-navigates IMMEDIATELY — it writes no file, so it has no race', async () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = ROOT_KEY;
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<DesignBar />);

    confirmReset();

    // `handleResetLocalMaster` only deletes doc overlays (clearLocalOverrides);
    // the master file is untouched, so the bytes the instance serves are the
    // bare-master bytes it has been serving all along. There is nothing to wait
    // FOR: routing Reset through the verified path would compare the page
    // against itself, always hit the 3 s cap, and delay the one repaint the
    // user asked for. Push is the only caller that changes a file.
    await waitFor(() => expect(reloads).toBe(1));
    const probedPreview = fetchMock.mock.calls.some(
      ([url]) => typeof url === 'string' && url.startsWith('http://localhost:5199/'),
    );
    expect(probedPreview).toBe(false);
  });
});
