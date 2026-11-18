/**
 * REGRESSION (owner, 2026-08-11): "when i upload photo in content tab in media
 * component nothing happens, i keep seeing a placeholder".
 *
 * One of the three links in that chain lives in the preview REFRESH ladder. The
 * chip under a component is the REAL Astro render of the post file, fetched over
 * HTTP; Astro re-syncs the content collection BEFORE the route renders the new
 * body, so the first fetch after a write usually returns the PRE-write render.
 *
 * The old ladder (PostBodyEditor, ~lines 196-216 before this change) was:
 *
 *     const refreshPreviews = (attempt = 0) => {
 *       fetchComponentPreviews(...).then(previews => {
 *         if (previews && editor) { …paint… }
 *         if (attempt < 3) {
 *           if (previewRetryTimer.current) clearTimeout(previewRetryTimer.current);
 *           previewRetryTimer.current =
 *             setTimeout(() => refreshPreviews(attempt + 1), 600 * (attempt + 1));
 *         }
 *       });
 *     };
 *
 * Three defects, each modelled below as `oldLadder` so the failure is visible
 * rather than asserted from memory:
 *   1. 4 attempts over ~3.6s, then it gives up FOREVER — a slower re-render
 *      leaves the pre-write chip on screen as if it were current.
 *   2. ONE shared timer ref: two concurrent ladders cancel each other, and an
 *      in-flight stale fetch still paints ON TOP of a newer render.
 *   3. A failed fetch (or a preview/component count drift) is swallowed — the
 *      editor says nothing at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDocMemo,
  createPreviewLadder,
  previewProblemToShow,
  PREVIEW_EDITOR_NOT_READY,
  PREVIEW_RETRY_DELAYS_MS,
  PREVIEW_STALE_MESSAGE,
  PREVIEW_UNREACHABLE_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
} from '../PostBodyEditor';
import type { ComponentPreviews } from '../componentPreview';

/** One chunk per component, body lines 1, 2, … — the ladder only cares that
 *  two renders differ, not how they pair. */
const previews = (...html: string[]): ComponentPreviews => ({
  chunks: html.map((h, i) => ({ bodyLine: i + 1, html: h })),
  css: '',
});

/** Long enough for the whole retry schedule to play out. */
const WHOLE_LADDER_MS = PREVIEW_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 1000;

/** The first chunk's html — what the chip would paint. */
const first = (p: ComponentPreviews) => p.chunks[0].html;

/** The shape that shipped, reduced to its timing/paint behaviour. */
function oldLadder(deps: {
  fetch: () => Promise<ComponentPreviews | null>;
  apply: (p: ComponentPreviews) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = (attempt = 0): void => {
    void deps.fetch().then(p => {
      if (p) deps.apply(p);
      if (attempt < 3) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => refresh(attempt + 1), 600 * (attempt + 1));
      }
    });
  };
  return { refresh };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('preview ladder — the write must become visible or be reported', () => {
  /** Renders "old" for the first `staleFetches` fetches, then "new". */
  function slowInstance(staleFetches: number) {
    let n = 0;
    return vi.fn(async () => (++n <= staleFetches ? previews('old') : previews('new')));
  }

  it('the OLD ladder gives up after 4 fetches and leaves the pre-write render', async () => {
    const fetch = slowInstance(6);
    const painted: string[] = [];
    oldLadder({ fetch, apply: p => painted.push(first(p)) }).refresh();
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch).toHaveBeenCalledTimes(4);
    // The upload IS on disk; the editor just never looked again.
    expect(painted.at(-1)).toBe('old');
  });

  it('re-arms until the render actually CHANGES, then stops', async () => {
    const fetch = slowInstance(6);
    const painted: string[] = [];
    let onScreen = 'old'; // what the chip already shows before the write
    const apply = (p: ComponentPreviews) => {
      const changed = first(p) !== onScreen;
      onScreen = first(p);
      painted.push(first(p));
      return { changed, mismatch: null };
    };
    const onProblem = vi.fn();
    createPreviewLadder({ fetch, apply, onProblem }).refresh(true);
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch).toHaveBeenCalledTimes(7);
    expect(painted.at(-1)).toBe('new');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });

  it('stops on the first change — it does not burn the whole budget', async () => {
    const fetch = slowInstance(1);
    let onScreen = 'old';
    const apply = (p: ComponentPreviews) => {
      const changed = first(p) !== onScreen;
      onScreen = first(p);
      return { changed, mismatch: null };
    };
    createPreviewLadder({ fetch, apply, onProblem: vi.fn() }).refresh(true);
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('SAYS the chip is stale when the render never catches up', async () => {
    const fetch = vi.fn(async () => previews('old'));
    const onProblem = vi.fn();
    createPreviewLadder({
      fetch,
      apply: () => ({ changed: false, mismatch: null }),
      onProblem,
    }).refresh(true);
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    // The old ladder had no reporting channel at all — it just stopped.
    expect(onProblem).toHaveBeenLastCalledWith(PREVIEW_STALE_MESSAGE);
  });

  it('SAYS the preview could not be reached', async () => {
    const onProblem = vi.fn();
    createPreviewLadder({
      fetch: async () => null,
      apply: () => ({ changed: true, mismatch: null }),
      onProblem,
    }).refresh();
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(onProblem).toHaveBeenLastCalledWith(PREVIEW_UNREACHABLE_MESSAGE);
  });

  it('retries on — and then reports — a preview/component count drift', async () => {
    const drift = 'component previews out of sync: 4 preview(s) for 3 component(s)';
    const fetch = vi.fn(async () => previews('a', 'b', 'c', 'd'));
    const onProblem = vi.fn();
    createPreviewLadder({
      fetch,
      apply: () => ({ changed: true, mismatch: drift }),
      onProblem,
    }).refresh();
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    expect(onProblem).toHaveBeenLastCalledWith(drift);
  });

  it('a mount refresh stops as soon as the render lines up', async () => {
    const fetch = vi.fn(async () => previews('a'));
    const onProblem = vi.fn();
    createPreviewLadder({
      fetch,
      apply: () => ({ changed: true, mismatch: null }),
      onProblem,
    }).refresh();
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });
});

describe('preview ladder — concurrent ladders must not sabotage each other', () => {
  /** Ladder A's fetch is still in flight when ladder B starts and finishes. */
  function racingFetches() {
    let resolveA: (p: ComponentPreviews | null) => void = () => {};
    const fetch = vi
      .fn<() => Promise<ComponentPreviews | null>>()
      .mockImplementationOnce(() => new Promise(res => { resolveA = res; }))
      .mockImplementation(async () => previews('new'));
    return { fetch, settleA: () => resolveA(previews('old')) };
  }

  it('the OLD shape lets a stale in-flight fetch paint over the newer render', async () => {
    const { fetch, settleA } = racingFetches();
    const painted: string[] = [];
    const ladder = oldLadder({ fetch, apply: p => painted.push(first(p)) });
    ladder.refresh(); // A — pending
    ladder.refresh(); // B — supersedes A in intent, not in code
    await vi.advanceTimersByTimeAsync(0);
    settleA();
    await vi.advanceTimersByTimeAsync(0);

    expect(painted).toEqual(['new', 'old']); // the chip regressed to pre-write
  });

  it('a superseded ladder never paints, and never fires its timer', async () => {
    const { fetch, settleA } = racingFetches();
    const apply = vi.fn(() => ({ changed: true, mismatch: null }));
    const ladder = createPreviewLadder({ fetch, apply, onProblem: vi.fn() });
    ladder.refresh();
    ladder.refresh();
    await vi.advanceTimersByTimeAsync(0);
    settleA();
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(previews('new'));
  });

  it('the second ladder gets its FULL budget — the first does not shorten it', async () => {
    // Two ladders started back to back, both watching a render that never
    // changes: the survivor must still spend every retry it is entitled to.
    const fetch = vi.fn(async () => previews('old'));
    const onProblem = vi.fn();
    const ladder = createPreviewLadder({
      fetch,
      apply: () => ({ changed: false, mismatch: null }),
      onProblem,
    });
    ladder.refresh(true);
    await vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAYS_MS[0] + 1);
    const spentByFirst = fetch.mock.calls.length;
    ladder.refresh(true);
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch.mock.calls.length - spentByFirst).toBe(PREVIEW_RETRY_DELAYS_MS.length + 1);
    expect(onProblem).toHaveBeenLastCalledWith(PREVIEW_STALE_MESSAGE);
  });

  it('a lax refresh does not DOWNGRADE a strict one in flight', async () => {
    // PostWriteQueue.onWritten fires a plain refreshPreviews() right beside the
    // post-write one. Only the strict ladder watches for the write to appear —
    // if the lax call could take over, the ladder would stop on the first fetch
    // (still the PRE-write render) and the chip would stay stale in silence.
    let n = 0;
    const fetch = vi.fn(async () => (++n <= 3 ? previews('old') : previews('new')));
    let onScreen = 'old';
    const apply = (p: ComponentPreviews) => {
      const changed = first(p) !== onScreen;
      onScreen = first(p);
      return { changed, mismatch: null };
    };
    const onProblem = vi.fn();
    const ladder = createPreviewLadder({ fetch, apply, onProblem });
    ladder.refresh(true);
    await vi.advanceTimersByTimeAsync(0);
    ladder.refresh(); // the queue's own hook, one tick later
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    // Still watching for the change: it fetched past the stale renders.
    expect(fetch.mock.calls.length).toBeGreaterThan(3);
    expect(onScreen).toBe('new');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });

  it('a lax refresh after the strict ladder ENDED stays lax', async () => {
    const fetch = vi.fn(async () => previews('old'));
    const onProblem = vi.fn();
    const ladder = createPreviewLadder({
      fetch,
      apply: () => ({ changed: false, mismatch: null }),
      onProblem,
    });
    ladder.refresh(true);
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);
    expect(onProblem).toHaveBeenLastCalledWith(PREVIEW_STALE_MESSAGE);

    ladder.refresh();
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(onProblem).toHaveBeenLastCalledWith(null); // aligned render, no change wanted
  });

  it('cancel() ends the ladder — an unmounted editor keeps no timers', async () => {
    const fetch = vi.fn(async () => previews('old'));
    const onProblem = vi.fn();
    const ladder = createPreviewLadder({
      fetch,
      apply: () => ({ changed: false, mismatch: null }),
      onProblem,
    });
    ladder.refresh(true);
    await vi.advanceTimersByTimeAsync(0);
    ladder.cancel();
    const spent = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(WHOLE_LADDER_MS);

    expect(fetch.mock.calls.length).toBe(spent);
    expect(onProblem).not.toHaveBeenCalled();
  });
});

/**
 * F6 (2026-08-12 review) — what the editor SAYS, and when it stays quiet.
 *
 * Every one of these strings is rendered verbatim inside an alert, so each one
 * has to be a sentence a user can read. PREVIEW_EDITOR_NOT_READY was an
 * internal fragment ("the editor was not ready when the preview arrived") shown
 * as if it were one.
 */
describe('user-facing preview copy', () => {
  const SENTENCES = {
    PREVIEW_UNREACHABLE_MESSAGE,
    PREVIEW_STALE_MESSAGE,
    PREVIEW_EDITOR_NOT_READY,
    UPLOAD_UNAVAILABLE_MESSAGE,
  };

  for (const [name, text] of Object.entries(SENTENCES)) {
    it(`${name} reads as a sentence`, () => {
      expect(text[0]).toBe(text[0].toUpperCase());
      expect(text.trimEnd().endsWith('.')).toBe(true);
    });
  }
});

/**
 * The other half of F6: a mid-ladder mismatch is not an alarm.
 *
 * While the post still has unsaved or in-flight changes the site render CANNOT
 * match the doc — the editor is a line ahead of the file the instance
 * rendered — and the pending flush starts a ladder of its own that will match.
 * The "N of M block(s) below couldn't be matched" banner fired for exactly that
 * and made a correct editor look broken. The mismatch still drives the RETRY;
 * only the statement to the user is held back.
 */
describe('a preview problem is only reported when it is the user’s problem', () => {
  const MISMATCH = "1 of 2 block(s) below couldn't be matched to the site preview.";

  it('is silent while a write is still pending', () => {
    expect(previewProblemToShow(MISMATCH, true)).toBeNull();
    expect(previewProblemToShow(PREVIEW_STALE_MESSAGE, true)).toBeNull();
  });

  it('is stated once the post is saved and the render still does not line up', () => {
    expect(previewProblemToShow(MISMATCH, false)).toBe(MISMATCH);
  });

  it('never invents a problem out of a clear ladder', () => {
    expect(previewProblemToShow(null, false)).toBeNull();
    expect(previewProblemToShow(null, true)).toBeNull();
  });
});

/**
 * The ladder calls `apply` up to PREVIEW_RETRY_DELAYS_MS.length + 1 times per
 * write, and each call measured body lines by re-serializing every block of the
 * document. ProseMirror doc nodes are immutable, so the answer cannot change
 * while the doc object does not.
 */
describe('per-doc memo', () => {
  it('computes once per doc identity, and again when the doc changes', () => {
    const compute = vi.fn((doc: { n: number }) => doc.n * 2);
    const memo = createDocMemo(compute);
    const first = { n: 1 };
    const second = { n: 2 };

    expect(memo(first)).toBe(2);
    expect(memo(first)).toBe(2);
    expect(memo(first)).toBe(2);
    expect(compute).toHaveBeenCalledTimes(1);

    expect(memo(second)).toBe(4);
    expect(compute).toHaveBeenCalledTimes(2);
    // …and going back is a fresh computation, never a wrong cached answer.
    expect(memo(first)).toBe(2);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('caches a falsy result too', () => {
    const compute = vi.fn(() => 0);
    const memo = createDocMemo(compute);
    const doc = {};
    expect(memo(doc)).toBe(0);
    expect(memo(doc)).toBe(0);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
