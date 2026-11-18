/**
 * task-160 — what happens to a `data-sq-id` stamp when OUR writers move bytes.
 *
 * Two directions, opposite answers, and both are load-bearing:
 *
 *   INSERT / APPEND-PAGE → **STRIP**. Spliced markup can be a copy of a stamped
 *     invocation (duplicate a component, paste an AI block that echoed one
 *     back). Writing an id that already belongs to a different invocation is
 *     worse than a sliding ordinal: the next open poisons BOTH holders and both
 *     lose their styling. New markup starts unstamped and is stamped on the
 *     next open, like everything else the user writes.
 *
 *   MOVE → **PRESERVE**. A move relocates the file's own existing bytes; the
 *     stamp riding along IS the feature — identity follows the element, which
 *     is exactly what a coordinate or an ordinal could not do.
 *
 * `prepareSourceGesture.apply` strips again as an acceptance-side backstop.
 * The plugin-side backstop (`assertNoStamp`) is covered in
 * `vite-plugin/__tests__/localStructuralStamp.test.ts`, because a stale client
 * that forgot to strip must not be able to corrupt the project either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { viteStructuralWriter } from '../ViteStructuralWriter';
import { stripStamps, containsStamp } from '@/utils/stampAttr';

const STAMPED = '<SiteNav data-sq-id="s0123456789abcdef" class="p-4" />';
const CLEAN = '<SiteNav class="p-4" />';

type Sent = { markup?: string };

// Since c8535b79 the writer no longer posts to the plugin: every structural op
// goes through `acceptStructuralOperations` (in-editor transform + durable
// project acceptance). That call is the new "last hop" — capture the ops there.
const accepted = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('../durableEdits/structuralAcceptance', () => ({
  acceptStructuralOperations: vi.fn(async (ops: Array<Record<string, unknown>>) => {
    accepted.calls.push(...ops);
    return ops.map(() => ({ success: true }));
  }),
}));

function captureSend(): { calls: Sent[] } {
  accepted.calls.length = 0;
  return { calls: accepted.calls as Sent[] };
}

beforeEach(() => vi.restoreAllMocks());

describe('insert paths STRIP the stamp', () => {
  it('writeInsert never sends a stamped attribute to the plugin', async () => {
    const { calls } = captureSend();
    await viteStructuralWriter.writeInsert(
      { file: 'src/pages/index.astro', line: 4, column: 1 },
      STAMPED,
      'after',
    );
    expect(calls).toHaveLength(1);
    expect(containsStamp(calls[0].markup!)).toBe(false);
    expect(calls[0].markup).toBe(CLEAN);
  });

  it('writeAppendPage never sends a stamped attribute to the plugin', async () => {
    const { calls } = captureSend();
    await viteStructuralWriter.writeAppendPage('src/pages/index.astro', STAMPED);
    expect(calls).toHaveLength(1);
    expect(containsStamp(calls[0].markup!)).toBe(false);
  });

  it('leaves unstamped markup byte-identical', async () => {
    const { calls } = captureSend();
    const markup = '<div class="x"><p>hi</p></div>';
    await viteStructuralWriter.writeInsert(
      { file: 'src/pages/index.astro', line: 4, column: 1 },
      markup,
      'after',
    );
    expect(calls[0].markup).toBe(markup);
  });

  it('leaves a hand-authored opt-out alone (it is not a stamp)', async () => {
    const { calls } = captureSend();
    const markup = '<SiteNav data-sq-id={undefined} />';
    await viteStructuralWriter.writeInsert(
      { file: 'src/pages/index.astro', line: 4, column: 1 },
      markup,
      'after',
    );
    expect(calls[0].markup).toBe(markup);
  });
});

describe('move PRESERVES the stamp', () => {
  it('writeMove sends no markup at all — it relocates the file’s own bytes', async () => {
    const { calls } = captureSend();
    await viteStructuralWriter.writeMove(
      { file: 'src/pages/index.astro', line: 4, column: 1 },
      { file: 'src/pages/index.astro', line: 9, column: 1 },
      'after',
    );
    expect(calls).toHaveLength(1);
    // Nothing to strip: the plugin re-splices the existing source region, so
    // the stamp travels with the element by construction. If this ever starts
    // carrying markup, the strip decision has to be revisited deliberately.
    expect(calls[0].markup).toBeUndefined();
  });
});

describe('stripStamps — the shared helper', () => {
  it('removes only grammar-valid stamps', () => {
    expect(stripStamps(STAMPED)).toBe(CLEAN);
    expect(stripStamps('<X data-sq-id="nope" />')).toBe('<X data-sq-id="nope" />');
    expect(stripStamps("<X data-sq-id='s0123456789abcdef' />")).toBe('<X />');
  });

  it('removes every stamp in a multi-element fragment', () => {
    const many =
      '<A data-sq-id="s1111111111111111" /><B data-sq-id="s2222222222222222" x="1" />';
    expect(containsStamp(stripStamps(many))).toBe(false);
    expect(stripStamps(many)).toBe('<A /><B x="1" />');
  });
});
