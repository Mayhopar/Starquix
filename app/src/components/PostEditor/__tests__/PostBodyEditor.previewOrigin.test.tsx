/**
 * Two ways the editor used to go quiet on a user who was doing everything
 * right, both from the owner's report ("nothing happens, I keep seeing a
 * placeholder"). These drive the REAL node views (no storage mock) because both
 * defects live in the join between the React component and the chip DOM.
 *
 * F2 — the preview ORIGIN arriving after the node views mounted. In WC the
 * container URL only exists once the dev server has booted; a slow local spawn
 * does the same. The origin was assigned in an effect keyed on `[editor]` only,
 * so a chip mounted before the boot kept a null origin forever: every
 * `/uploads/x.png` unresolvable, the permanent grey "Loading preview…" frame,
 * and no refetch either — the mount refresh had already returned early on the
 * missing origin, and nothing re-ran it.
 *
 * F3 — an upload tile with no uploader behind it. Canvas passes `onUploadMedia`
 * only while a preview server is running, so before that the tile rendered, was
 * clickable, opened nothing and said nothing. That is the reported symptom in
 * its purest form: a click that is a silent no-op.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));

import { PostBodyEditor, UPLOAD_UNAVAILABLE_MESSAGE } from '../PostBodyEditor';
import type { PostWriteQueue } from '@/postmodel/writeQueue';

const ORIGIN = 'http://localhost:4399';
const FILLED = '<Media items={["/uploads/p.png"]} class="col-span-8" />\n\nProse.';
const EMPTY = '<Media items={[null]} class="col-span-8" />\n\nProse.';

const queue = { enqueue: vi.fn(async () => {}), size: 0 } as unknown as PostWriteQueue;

/** The instance is unreachable on purpose: the ONLY way a photo can appear is
 *  the model render, which is what the origin unlocks. */
let fetchSpy: ReturnType<typeof vi.fn>;

function view(body: string, props: Record<string, unknown> = {}) {
  return (
    <PostBodyEditor
      body={body}
      format="mdx"
      queue={queue}
      frontmatterRef={{ current: {} } as React.RefObject<Record<string, unknown>>}
      collection="works"
      slug="untitled"
      filePath="src/content/works/untitled.mdx"
      previewOrigin={null}
      {...props}
    />
  );
}

const chip = () => document.querySelector('.sq-component-preview') as HTMLElement;
const postViewFetches = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url).includes('/__sq_post_view/'));

beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: false, text: async () => '' }) as unknown as Response);
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('the preview origin can arrive after the chips have mounted', () => {
  it('re-resolves the model sources and re-runs the fetch on a null → origin transition', async () => {
    const { rerender, unmount } = render(view(FILLED));
    try {
      // Mounted before the preview server exists: the model says this slot is
      // filled, but no URL on this page can load `/uploads/p.png` yet.
      expect(chip().querySelector('img')).toBeNull();
      expect(chip().querySelector('[data-sq-slot-state="filled"]')).not.toBeNull();
      expect(postViewFetches()).toHaveLength(0);

      await act(async () => {
        rerender(view(FILLED, { previewOrigin: ORIGIN }));
      });

      // The photo the user uploaded, at last — and a fetch that will replace it
      // with the real render as soon as the instance serves one.
      expect(chip().querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/uploads/p.png`);
      expect(postViewFetches().length).toBeGreaterThan(0);
      expect(String(postViewFetches()[0][0])).toBe(`${ORIGIN}/__sq_post_view/works/untitled`);
    } finally {
      unmount();
    }
  });

  it('does not refetch when the origin has not changed', async () => {
    const { rerender, unmount } = render(view(FILLED, { previewOrigin: ORIGIN }));
    try {
      const spent = postViewFetches().length;
      expect(spent).toBeGreaterThan(0);
      await act(async () => {
        rerender(view(FILLED, { previewOrigin: ORIGIN }));
      });
      expect(postViewFetches()).toHaveLength(spent);
    } finally {
      unmount();
    }
  });
});

describe('an upload tile with no uploader behind it', () => {
  it('SAYS why the click cannot do anything, instead of nothing', async () => {
    const { unmount } = render(view(EMPTY)); // no onUploadMedia — no preview server
    try {
      const tile = chip().querySelector('.sq-media-placeholder-tile') as HTMLElement;
      expect(tile).not.toBeNull();
      // It also READS as unavailable rather than as a live button.
      expect(tile.hasAttribute('data-sq-slot-blocked')).toBe(true);
      expect(tile.title).toBe(UPLOAD_UNAVAILABLE_MESSAGE);

      await act(async () => {
        fireEvent.click(tile);
      });

      expect(screen.getByRole('alert').textContent).toContain(UPLOAD_UNAVAILABLE_MESSAGE);
    } finally {
      unmount();
    }
  });

  it('opens the dialog — with no notice — once uploading is possible', async () => {
    const onUploadMedia = vi.fn(async () => '/uploads/photo.png');
    const { unmount } = render(view(EMPTY, { onUploadMedia, previewOrigin: ORIGIN }));
    try {
      const tile = chip().querySelector('.sq-media-placeholder-tile') as HTMLElement;
      expect(tile.hasAttribute('data-sq-slot-blocked')).toBe(false);

      await act(async () => {
        fireEvent.click(tile);
      });

      expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
      expect(screen.queryByText(UPLOAD_UNAVAILABLE_MESSAGE)).toBeNull();
    } finally {
      unmount();
    }
  });

  it('stops blocking the tile as soon as an uploader arrives mid-session', async () => {
    const onUploadMedia = vi.fn(async () => '/uploads/photo.png');
    const { rerender, unmount } = render(view(EMPTY));
    try {
      expect(
        (chip().querySelector('.sq-media-placeholder-tile') as HTMLElement).hasAttribute(
          'data-sq-slot-blocked',
        ),
      ).toBe(true);

      await act(async () => {
        rerender(view(EMPTY, { onUploadMedia, previewOrigin: ORIGIN }));
      });

      expect(
        (chip().querySelector('.sq-media-placeholder-tile') as HTMLElement).hasAttribute(
          'data-sq-slot-blocked',
        ),
      ).toBe(false);
    } finally {
      unmount();
    }
  });
});

/**
 * F6, second half — the editor must not alarm the user about a state it caused
 * and is about to resolve.
 *
 * While a write is pending the doc is AHEAD of the file the instance rendered,
 * so the render cannot pair with the chips and the ladder ends on "N of M
 * block(s) below couldn't be matched". Shown mid-ladder, that banner made a
 * correct editor look broken. Once the write has landed and the render still
 * does not line up, it IS the user's problem and is stated.
 */
describe('a mismatch is only reported once the post is saved', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Longer than the whole retry schedule. */
  const LADDER_MS = 15_000;
  /** A render carrying no stamped blocks at all: nothing can pair. */
  const EMPTY_RENDER = '<html><body><main></main></body></html>';

  const makeQueue = (enqueue: () => Promise<void>) =>
    ({ enqueue: vi.fn(enqueue), size: 0 }) as unknown as PostWriteQueue;

  async function binTheOnlyPhoto(queue: PostWriteQueue) {
    fetchSpy.mockImplementation(
      async () => ({ ok: true, text: async () => EMPTY_RENDER }) as unknown as Response,
    );
    const rendered = render(view(FILLED, { previewOrigin: ORIGIN, queue }));
    await act(async () => {
      fireEvent.click(chip().querySelector('.sq-slot-bin') as HTMLElement);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LADDER_MS);
    });
    return rendered;
  }

  it('stays silent while the write has not landed', async () => {
    // The queue never settles: the post is dirty for the whole ladder.
    const { unmount } = await binTheOnlyPhoto(makeQueue(() => new Promise<void>(() => {})));
    try {
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('states it once the write has landed and the render still does not pair', async () => {
    const { unmount } = await binTheOnlyPhoto(makeQueue(async () => {}));
    try {
      expect(screen.getByRole('alert').textContent).toContain("Some block previews are unavailable.");
    } finally {
      unmount();
    }
  });
});
