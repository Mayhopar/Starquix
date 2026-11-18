/**
 * Binding laws #2/#3: one write path, strict FIFO, compile-gated, slug-bound.
 * Findings 2/3 (interleaved writes) and the cross-post write are killed here.
 */
import { describe, it, expect, vi } from 'vitest';
import { parsePostBody } from '../postModel';
import { PostWriteQueue } from '../writeQueue';

const FM = { title: 'x' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PostWriteQueue', () => {
  it('runs rapid enqueues strictly in order, one in flight', async () => {
    const first = deferred();
    const calls: string[] = [];
    const writePost = vi.fn(async (_c: string, _s: string, _f: unknown, body: string) => {
      calls.push(body);
      if (calls.length === 1) await first.promise;
    });
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });

    q.enqueue(parsePostBody('One.'), FM);
    q.enqueue(parsePostBody('Two.'), FM);
    await vi.waitFor(() => expect(writePost).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['One.']); // second not started while first is in flight
    first.resolve();
    await q.flushNow();
    expect(calls).toEqual(['One.', 'Two.']);
  });

  it('dispose() aborts pending jobs silently — no write', async () => {
    const writePost = vi.fn(async () => {});
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });
    q.dispose();
    q.enqueue(parsePostBody('One.'), FM);
    await q.flushNow();
    expect(writePost).not.toHaveBeenCalled();
  });

  it('refuses a body that does not compile; no write, error surfaced', async () => {
    // parsePostBody itself throws on contiguous duplicate imports (acorn runs at
    // parse), so the uncompilable doc is built the way a bad import INSERT would
    // build it: two ESM passthrough blocks that serialize contiguous.
    const writePost = vi.fn(async () => {});
    const onRefused = vi.fn();
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost, onRefused });
    const doc = parsePostBody("import { Media } from './x'");
    doc.blocks.push({ kind: 'passthrough', source: "import Media from './y'", gapBefore: '\n', nodeType: 'mdxjsEsm' });
    q.enqueue(doc, FM);
    await expect(q.flushNow()).rejects.toThrow();
    expect(writePost).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onRefused.mock.calls[0][0]).toMatch(/Media|already/i);
  });

  it('only ever writes the slug it was constructed for', async () => {
    const writePost = vi.fn(async () => {});
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });
    q.enqueue(parsePostBody('One.'), FM);
    q.enqueue(parsePostBody('Two.'), FM);
    await q.flushNow();
    for (const call of writePost.mock.calls) {
      expect(call[0]).toBe('works');
      expect(call[1]).toBe('a');
    }
    expect(writePost).toHaveBeenCalledTimes(2);
  });

  it('skips a write whose body AND frontmatter match the last written ones', async () => {
    const writePost = vi.fn(async () => {});
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });
    q.enqueue(parsePostBody('One.'), FM);
    q.enqueue(parsePostBody('One.'), FM); // e.g. unmount flush right after debounce flush
    await q.flushNow();
    expect(writePost).toHaveBeenCalledTimes(1);
    q.enqueue(parsePostBody('Two.'), FM);
    await q.flushNow();
    expect(writePost).toHaveBeenCalledTimes(2);
  });

  it('a frontmatter-only change is NOT a duplicate (title edits were silently dropped)', async () => {
    // Regression (owner, 2026-08-10): dedup compared the BODY only, so editing
    // the title with an untouched body serialized identical bytes and the
    // write was skipped — the title never reached disk.
    const writePost = vi.fn(async () => {});
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });
    q.enqueue(parsePostBody('One.'), { title: 'Old' });
    await q.flushNow();
    q.enqueue(parsePostBody('One.'), { title: 'New title' });
    await q.flushNow();
    expect(writePost).toHaveBeenCalledTimes(2);
    expect(writePost.mock.calls[1][2]).toEqual({ title: 'New title' });
  });

  it('undo after a flush writes the pre-edit body back (disk follows the model)', async () => {
    const original = 'The original paragraph.';
    const bodies: string[] = [];
    const writePost = vi.fn(async (_c: string, _s: string, _f: unknown, body: string) => {
      bodies.push(body);
    });
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });
    // type → flush
    q.enqueue(parsePostBody('The edited paragraph.'), FM);
    await q.flushNow();
    // undo → flush: the model is back at the original, so the disk must follow
    q.enqueue(parsePostBody(original), FM);
    await q.flushNow();
    expect(bodies[bodies.length - 1]).toBe(original);
  });


  it('suspend() drops jobs; resume() restores writing (rename window guard)', async () => {
    const writePost = vi.fn(async () => {});
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost });
    q.suspend();
    q.enqueue(parsePostBody('Dropped.'), FM);
    await q.flushNow();
    expect(writePost).not.toHaveBeenCalled();
    q.resume();
    q.enqueue(parsePostBody('Written.'), FM);
    await q.flushNow();
    expect(writePost).toHaveBeenCalledTimes(1);
  });

  it('reports written bodies via onWritten', async () => {
    const writePost = vi.fn(async () => {});
    const onWritten = vi.fn();
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost, onWritten });
    q.enqueue(parsePostBody('One.'), FM);
    await q.flushNow();
    expect(onWritten).toHaveBeenCalledWith('One.');
  });

  it('a failed write surfaces via onRefused and does not wedge the queue', async () => {
    const writePost = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error('disk gone'));
    const onRefused = vi.fn();
    const q = new PostWriteQueue({ collection: 'works', slug: 'a', writePost, onRefused });
    q.enqueue(parsePostBody('One.'), FM);
    await expect(q.flushNow()).rejects.toThrow('disk gone');
    expect(onRefused).toHaveBeenCalledTimes(1);
    q.enqueue(parsePostBody('Two.'), FM);
    await q.flushNow();
    expect(writePost).toHaveBeenCalledTimes(2);
  });
});

it('explicit retry saves the retained post job after a transient write failure', async () => {
  let fail = true; const bodies: string[] = [];
  const q = new PostWriteQueue({ collection: 'retry', slug: 'a', writePost: async (_c, _s, _fm, body) => {
    if (fail) throw new Error('offline'); bodies.push(body);
  } });
  await expect(q.enqueue(parsePostBody('Kept.'), FM)).rejects.toThrow('offline');
  fail = false;
  await q.flushNow();
  expect(bodies).toEqual(['Kept.']);
});
it('a correction from a remounted post editor supersedes its previous compile refusal', async () => {
  const { flushPendingPostWrites } = await import('../writeQueue');
  const bad = parsePostBody("import { Media } from './x'");
  bad.blocks.push({ kind: 'passthrough', source: "import Media from './y'", gapBefore: '\n', nodeType: 'mdxjsEsm' });
  const q = new PostWriteQueue({ projectId: 'remount_p', collection: 'remount', slug: 'a', writePost: async () => {} });
  await expect(q.enqueue(bad, FM)).rejects.toThrow();
  const next = new PostWriteQueue({ projectId: 'remount_p', collection: 'remount', slug: 'a', writePost: async () => {} });
  await next.enqueue(parsePostBody('Corrected.'), FM);
  await flushPendingPostWrites('remount_p');
});

it('snapshots queued values and computes against the last successful write when executing', async () => {
  const first = deferred();
  const baselines: unknown[] = [];
  const titles: unknown[] = [];
  const q = new PostWriteQueue({ collection: 'baseline', slug: 'a', baseline: { frontmatter: { title: 'Old' }, body: 'Body.' },
    writePost: async (_c, _s, fm, _body, options) => {
      baselines.push(options?.baseline); titles.push(fm.title);
      if (baselines.length === 1) await first.promise;
    },
  });
  const draft = { title: 'First' };
  q.enqueue(parsePostBody('Body.'), draft);
  draft.title = 'Mutated';
  q.enqueue(parsePostBody('Body two.'), { title: 'Second' });
  await vi.waitFor(() => expect(titles).toEqual(['First']));
  first.resolve(); await q.flushNow();
  expect(baselines).toEqual([
    { frontmatter: { title: 'Old' }, body: 'Body.' },
    { frontmatter: { title: 'First' }, body: 'Body.' },
  ]);
});

it('failed jobs never advance the baseline used by a later correction', async () => {
  const baselines: unknown[] = [];
  const baseline = { frontmatter: { title: 'Old' }, body: 'Body.' };
  const q = new PostWriteQueue({ collection: 'baseline', slug: 'failure', baseline,
    writePost: async (_c, _s, _fm, _body, options) => {
      baselines.push(options?.baseline);
      if (baselines.length === 1) throw new Error('refused');
    },
  });
  await expect(q.enqueue(parsePostBody('First.'), { title: 'First' })).rejects.toThrow('refused');
  await q.enqueue(parsePostBody('Second.'), { title: 'Second' });
  expect(baselines).toEqual([baseline, baseline]);
});

it('an unrelated remount success cannot discard an older unknown write outcome', async () => {
  const { hasPendingPostWrites } = await import('../writeQueue');
  const baseline = { frontmatter: { title: 'Old' }, body: 'Body.' };
  const old = new PostWriteQueue({ projectId: 'unknown_keep', collection: 'keep', slug: 'a', baseline,
    writePost: async () => { throw new Error('connection lost after send'); },
  });
  await expect(old.enqueue(parsePostBody('My draft.'), baseline.frontmatter)).rejects.toThrow();
  const next = new PostWriteQueue({ projectId: 'unknown_keep', collection: 'keep', slug: 'a', baseline, writePost: async () => {} });
  await next.enqueue(parsePostBody('Body.'), { title: 'New title' });
  expect(hasPendingPostWrites('unknown_keep')).toBe(true);
  old.dispose();
});

describe('PostWriteQueue.rebase', () => {
  // Regression (owner 2026-09-13): every save after "+ Add field" / a rename refused — see rebase().
  it('takes the observed post as baseline before the first write, never after one', async () => {
    const writePost = vi.fn(async () => {});
    const q = new PostWriteQueue({ collection: 'news', slug: 'a', writePost, baseline: { frontmatter: { title: 'A' }, body: '' } });
    q.rebase({ frontmatter: { title: 'A', image: '' }, body: '' });
    await q.enqueue(parsePostBody(''), { title: 'A', image: '/x.png' });
    expect(writePost.mock.calls[0][4]).toMatchObject({ baseline: { frontmatter: { title: 'A', image: '' } } });
    q.rebase({ frontmatter: { title: 'stale' }, body: 'stale' });
    await q.enqueue(parsePostBody(''), { title: 'A2', image: '/x.png' });
    expect(writePost.mock.calls[1][4]).toMatchObject({ baseline: { frontmatter: { title: 'A', image: '/x.png' } } });
  });
});
