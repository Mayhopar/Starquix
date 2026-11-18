/**
 * task-207 T1: the post editor's PostWriteQueue drains asynchronously on
 * unmount (tab switch back to the canvas), so a debounced/unmount flush can
 * still be in flight when a canvas Media edit arrives. Unserialized, the two
 * writes race: whichever lands last clobbers the other — in local mode a real
 * .mdx regression, in WC a poisoned container file. saveMediaEdit must await
 * every in-flight flush for its {collection, slug} BEFORE reading the post, so
 * the canvas edit rebases on the flushed body and both edits survive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: {
    fetchCollections: vi.fn(),
    updatePost: vi.fn(),
  },
}));

import { contentOps } from '@/core/collections/content-ops';
import { parsePostBody } from '@/postmodel/postModel';
import { PostWriteQueue, awaitPostWritesSettled } from '@/postmodel/writeQueue';
import { saveMediaEdit } from '../saveMediaEdit';

const FM = { title: 'T' };

// The body as it sits ON DISK before the editor's flush lands.
const OLD_BODY = [
  'import Media from "../../components/sq/Media.astro";', // line 1
  '',                                                     // line 2
  'Old paragraph.',                                       // line 3
  '',                                                     // line 4
  '<Media items={["a.png"]} class="col-span-8" />',       // line 5
  '',
].join('\n');

// The editor doc's newer body — same Media invocation, edited prose.
const NEW_BODY = OLD_BODY.replace('Old paragraph.', 'Newer editor paragraph.');

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** One shared "file": queue writePost and contentOps mocks read/write it. */
function armSharedFile(initialBody: string) {
  const file = { body: initialBody };
  (contentOps.fetchCollections as ReturnType<typeof vi.fn>).mockImplementation(async () => [
    { name: 'works', posts: [{ slug: 'p1', frontmatter: FM, body: file.body, filePath: 'x' }], inferredFields: [] },
  ]);
  (contentOps.updatePost as ReturnType<typeof vi.fn>).mockImplementation(
    async (_c: string, _s: string, _f: unknown, body: string) => { file.body = body; },
  );
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canvas saveMediaEdit vs in-flight PostWriteQueue flush (task-207 T1)', () => {
  it('a canvas edit issued while a flush is in flight survives, and keeps the flushed body', async () => {
    const file = armSharedFile(OLD_BODY);
    const gate = deferred();
    const queue = new PostWriteQueue({
      collection: 'works',
      slug: 'p1',
      // The in-flight unmount flush: compile-gated already, write held open.
      writePost: async (_c, _s, _f, body) => {
        await gate.promise;
        file.body = body;
      },
    });

    // Tab switch: unmount drains the queue asynchronously (PostEditor does
    // `void queue.flushNow()`), leaving this write in flight…
    void queue.enqueue(parsePostBody(NEW_BODY, 'mdx'), FM);

    // …and the user immediately edits the Media unit on the canvas.
    const savePromise = saveMediaEdit({
      collection: 'works',
      slug: 'p1',
      bodyLine: 5,
      mutate: (src) => src.replace('col-span-8', 'col-span-12'),
    });

    // Give an unserialized implementation every chance to do its stale write.
    await new Promise((r) => setTimeout(r, 30));
    gate.resolve(); // the flush lands
    const next = await savePromise;
    await queue.flushNow();
    await awaitPostWritesSettled('works', 'p1');

    // Both edits survive: the flush's newer prose AND the canvas width edit.
    expect(next).toContain('col-span-12');
    expect(file.body).toContain('Newer editor paragraph.');
    expect(file.body).toContain('col-span-12');
    expect(file.body).not.toContain('col-span-8');
  });

  it('awaitPostWritesSettled is a no-op when nothing is pending', async () => {
    armSharedFile(OLD_BODY);
    await expect(awaitPostWritesSettled('works', 'p1')).resolves.toBeUndefined();
  });

  it('a queue for a DIFFERENT post never blocks a canvas edit', async () => {
    const file = armSharedFile(OLD_BODY);
    const gate = deferred(); // never resolved — the other post's flush hangs
    const other = new PostWriteQueue({
      collection: 'works',
      slug: 'other-post',
      writePost: async () => { await gate.promise; },
    });
    void other.enqueue(parsePostBody('Unrelated.', 'mdx'), FM);

    const next = await saveMediaEdit({
      collection: 'works',
      slug: 'p1',
      bodyLine: 5,
      mutate: (src) => src.replace('col-span-8', 'col-span-12'),
    });
    expect(next).toContain('col-span-12');
    expect(file.body).toContain('col-span-12');
    gate.resolve(); // drain so the hanging tail doesn't leak across tests
    await other.flushNow();
  });
});
