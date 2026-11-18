/**
 * THE bug (owner, 2026-08-12): uploading a photo into a Media slot left a
 * BROKEN IMAGE in the chip preview. Everything upstream of the picture was
 * correct (the .mdx, the requested name, the file bytes — a valid JPEG), but
 * the <img> settled `complete === true, naturalWidth === 0`: the preview
 * origin could not be a subresource of the editor page. Byte mode stops
 * minting such URLs — it reads the bytes and hands the DOM a `blob:` URL.
 *
 * These pin the resolver's whole contract, including the parts that keep URL
 * mode (what the editor uses) on the path it already works on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PostMediaResolver,
  containerPathFor,
  mimeForPath,
  retargetMedia,
  urlMediaSource,
  MEDIA_PATH_ATTR,
  MEDIA_PENDING_ATTR,
  MEDIA_SRCSET_ATTR,
  PENDING_MEDIA_SRC,
  POSTER_PATH_ATTR,
  type MediaByteReader,
} from '../mediaResolver';

const UNLOADABLE_ORIGIN = 'https://unloadable-origin.example';
const LOCAL_ORIGIN = 'http://localhost:55996';

const bytes = (n = 8) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1));

/** Everything queued: the reads, their `.finally`, and the coalesced notify. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('containerPathFor — the file a root-relative URL is served from', () => {
  it('maps site-root URLs into public/ — uploads AND boot-snapshot assets', () => {
    // The reported case, and the case that proved it was never about uploads.
    expect(containerPathFor('/uploads/fc739d94-5544.jpg')).toBe('public/uploads/fc739d94-5544.jpg');
    expect(containerPathFor('/assets/logos/Halden.svg')).toBe('public/assets/logos/Halden.svg');
  });

  it('drops the cache-busting query and decodes the name', () => {
    expect(containerPathFor('/uploads/a.png?v=2')).toBe('public/uploads/a.png');
    expect(containerPathFor('/uploads/my%20photo.png')).toBe('public/uploads/my photo.png');
  });

  it('turns Vite’s dev FS route back into an absolute container path', () => {
    expect(containerPathFor('/@fs/home/projects/x/src/a.png?origWidth=1600')).toBe(
      '/home/projects/x/src/a.png',
    );
  });

  it('follows Astro’s image endpoint to the file it optimizes', () => {
    const href = encodeURIComponent('/@fs/home/projects/x/src/a.png?origWidth=1600');
    expect(containerPathFor(`/_image?href=${href}&w=400&f=webp`)).toBe('/home/projects/x/src/a.png');
  });

  it('refuses what no file backs, and refuses to climb out of the project', () => {
    expect(containerPathFor('/@vite/client')).toBeNull();
    expect(containerPathFor('/_image')).toBeNull();
    expect(containerPathFor('/_actions/thing')).toBeNull();
    expect(containerPathFor('/')).toBeNull();
    expect(containerPathFor('/uploads/../../etc/passwd')).toBeNull();
    expect(containerPathFor('./images/hero.png')).toBeNull();
  });
});

describe('mimeForPath — a Blob without a type will not play as video', () => {
  it('types images and videos from the extension', () => {
    expect(mimeForPath('public/uploads/a.JPG')).toBe('image/jpeg');
    expect(mimeForPath('public/uploads/a.png')).toBe('image/png');
    expect(mimeForPath('public/uploads/a.svg')).toBe('image/svg+xml');
    expect(mimeForPath('public/uploads/clip.mp4')).toBe('video/mp4');
    expect(mimeForPath('public/uploads/clip.mov')).toBe('video/quicktime');
    expect(mimeForPath('public/uploads/clip.webm')).toBe('video/webm');
  });

  it('stays honest rather than mislabelling an unknown file', () => {
    expect(mimeForPath('public/uploads/thing.bin')).toBe('');
  });
});

describe('URL mode — LOCAL and server mode are untouched', () => {
  it('resolves against the instance origin, exactly as before', () => {
    const source = urlMediaSource(LOCAL_ORIGIN);
    expect(source.readsBytes).toBe(false);
    expect(source.urlFor('/uploads/p.png')).toBe(`${LOCAL_ORIGIN}/uploads/p.png`);
    expect(source.urlFor('https://cdn.test/a.png')).toBe('https://cdn.test/a.png');
    // Astro resolves these through its asset pipeline — no URL to guess.
    expect(source.urlFor('./images/hero.png')).toBeNull();
    expect(source.urlFor(null)).toBeNull();
  });

  it('reads NOTHING — a byte reader must never be consulted in URL mode', async () => {
    const read = vi.fn<MediaByteReader>(async () => bytes());
    const resolver = new PostMediaResolver(() => {});
    resolver.configure(LOCAL_ORIGIN, null);
    try {
      expect(resolver.urlFor('/uploads/p.png')).toBe(`${LOCAL_ORIGIN}/uploads/p.png`);
      await settle();
      expect(read).not.toHaveBeenCalled();
    } finally {
      resolver.release();
    }
  });
});

describe('byte mode', () => {
  let resolver: PostMediaResolver;
  let notified: number;
  let read: ReturnType<typeof vi.fn<MediaByteReader>>;

  beforeEach(() => {
    notified = 0;
    read = vi.fn<MediaByteReader>(async () => bytes());
    resolver = new PostMediaResolver(() => {
      notified += 1;
    });
    resolver.configure(UNLOADABLE_ORIGIN, read);
  });
  afterEach(() => resolver.release());

  it('NEVER returns a container-origin URL — that is the whole bug', async () => {
    expect(resolver.readsBytes).toBe(true);
    expect(resolver.urlFor('/uploads/p.png')).toBeNull(); // pending, not a lie
    await settle();
    const url = resolver.urlFor('/uploads/p.png');
    expect(url).toMatch(/^blob:/);
    expect(url).not.toContain('unloadable-origin.example');
    expect(read).toHaveBeenCalledWith('public/uploads/p.png');
  });

  it('does not block first paint, and re-renders once the bytes land', async () => {
    expect(resolver.urlFor('/uploads/p.png')).toBeNull();
    expect(notified).toBe(0); // nothing awaited, nothing re-rendered yet
    await settle();
    expect(notified).toBeGreaterThan(0);
  });

  it('reads a file ONCE and hands out the same URL however often a chip re-renders', async () => {
    resolver.urlFor('/uploads/p.png');
    await settle();
    const first = resolver.urlFor('/uploads/p.png');
    for (let i = 0; i < 20; i++) expect(resolver.urlFor('/uploads/p.png')).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('re-renders ONCE for a batch of arrivals, not once per file', async () => {
    resolver.urlFor('/uploads/a.png');
    resolver.urlFor('/uploads/b.png');
    resolver.urlFor('/uploads/c.png');
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(notified).toBe(1);
  });

  it('revokes every URL it minted on release — a chip re-renders on every edit', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    resolver.urlFor('/uploads/a.png');
    resolver.urlFor('/uploads/b.png');
    await settle();
    const urls = [resolver.urlFor('/uploads/a.png'), resolver.urlFor('/uploads/b.png')];
    resolver.release();
    expect(revoke.mock.calls.map(c => c[0]).sort()).toEqual([...urls].sort());
    revoke.mockRestore();
  });

  /**
   * StrictMode's dev double-mount fires the owning component's mount cleanup —
   * and therefore `release()` — before the real run, WITH a read already in
   * flight. A terminal dispose left that read landing on a dead object and every
   * byte-mode chip on its pending frame forever in dev.
   */
  it('still resolves after a release, and orphans the read that outlived it', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    resolver.urlFor('/uploads/p.png'); // read in flight
    resolver.release(); // ← the teardown that is not a teardown
    await settle();
    // The orphaned read minted nothing that survives, and left nothing behind.
    expect(resolver.urlFor('/uploads/p.png')).toBeNull(); // re-requested, pending
    await settle();
    expect(resolver.urlFor('/uploads/p.png')).toMatch(/^blob:/);
    // Exactly one revoke: the orphaned URL. The live one is still live.
    expect(revoke).toHaveBeenCalledTimes(1);
    revoke.mockRestore();
  });

  it('serves absolute and data: sources without touching the FS', async () => {
    expect(resolver.urlFor('https://cdn.test/a.png')).toBe('https://cdn.test/a.png');
    expect(resolver.urlFor('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    await settle();
    expect(read).not.toHaveBeenCalled();
  });

  it('types the Blob from the file, so a .mp4 slot really plays', async () => {
    const created = vi.spyOn(URL, 'createObjectURL');
    resolver.urlFor('/uploads/clip.mp4');
    await settle();
    expect((created.mock.calls[0][0] as Blob).type).toBe('video/mp4');
    created.mockRestore();
  });

  describe('a path the container cannot serve', () => {
    it('stays null — the caller draws its pending frame, never a broken <img>', async () => {
      read.mockRejectedValue(new Error('ENOENT'));
      expect(resolver.urlFor('/uploads/gone.png')).toBeNull();
      await settle();
      expect(resolver.urlFor('/uploads/gone.png')).toBeNull();
    });

    it('is not re-read on every re-render', async () => {
      read.mockRejectedValue(new Error('ENOENT'));
      resolver.urlFor('/uploads/gone.png');
      await settle();
      for (let i = 0; i < 10; i++) resolver.urlFor('/uploads/gone.png');
      await settle();
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('IS retried on the next configure — the FS may still have been coming up', async () => {
      read.mockRejectedValueOnce(new Error('ENOENT'));
      resolver.urlFor('/uploads/late.png');
      await settle();
      expect(resolver.urlFor('/uploads/late.png')).toBeNull();

      resolver.configure(UNLOADABLE_ORIGIN, read); // the ladder's next tick
      expect(resolver.urlFor('/uploads/late.png')).toBeNull(); // pending again
      await settle();
      expect(resolver.urlFor('/uploads/late.png')).toMatch(/^blob:/);
    });

    it('keeps SUCCESSES across a configure — no re-read, no second URL', async () => {
      resolver.urlFor('/uploads/p.png');
      await settle();
      const url = resolver.urlFor('/uploads/p.png');
      resolver.configure(UNLOADABLE_ORIGIN, read);
      expect(resolver.urlFor('/uploads/p.png')).toBe(url);
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('treats an empty file as nothing to show', async () => {
      read.mockResolvedValue(new Uint8Array(0));
      resolver.urlFor('/uploads/empty.png');
      await settle();
      expect(resolver.urlFor('/uploads/empty.png')).toBeNull();
    });
  });
});

describe('retargetMedia — the REAL Astro render, re-pointed at loadable bytes', () => {
  const frag = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
  };

  it('replaces the instance URL with the resolved one', () => {
    const root = frag(
      `<img ${MEDIA_PATH_ATTR}="/uploads/p.png" src="${UNLOADABLE_ORIGIN}/uploads/p.png">`,
    );
    retargetMedia(root, { readsBytes: true, urlFor: () => 'blob:resolved' });
    const img = root.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('blob:resolved');
    expect(root.innerHTML).not.toContain('unloadable-origin.example');
  });

  it('gives an unresolved element the neutral frame — never a broken <img>', () => {
    const root = frag(`<img ${MEDIA_PATH_ATTR}="/uploads/p.png" src="${UNLOADABLE_ORIGIN}/uploads/p.png">`);
    retargetMedia(root, { readsBytes: true, urlFor: () => null });
    const img = root.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(PENDING_MEDIA_SRC);
    expect(img.hasAttribute(MEDIA_PENDING_ATTR)).toBe(true);
    expect(root.innerHTML).not.toContain('unloadable-origin.example');
  });

  it('parks an unresolved VIDEO on its poster rather than a dead src', () => {
    const root = frag(`<video ${MEDIA_PATH_ATTR}="/uploads/c.mp4" src="${UNLOADABLE_ORIGIN}/uploads/c.mp4">`);
    retargetMedia(root, { readsBytes: true, urlFor: () => null });
    const video = root.querySelector('video')!;
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.getAttribute('poster')).toBe(PENDING_MEDIA_SRC);
  });

  it('resolves a poster independently of the src', () => {
    const root = frag(
      `<video ${MEDIA_PATH_ATTR}="/uploads/c.mp4" ${POSTER_PATH_ATTR}="/uploads/c.png"
        src="${UNLOADABLE_ORIGIN}/uploads/c.mp4" poster="${UNLOADABLE_ORIGIN}/uploads/c.png">`,
    );
    retargetMedia(root, {
      readsBytes: true,
      urlFor: src => (src === '/uploads/c.mp4' ? 'blob:clip' : 'blob:poster'),
    });
    const video = root.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('blob:clip');
    expect(video.getAttribute('poster')).toBe('blob:poster');
  });

  it('drops srcset — the browser would prefer its unloadable candidates', () => {
    const root = frag(
      `<img ${MEDIA_PATH_ATTR}="/uploads/p.png" ${MEDIA_SRCSET_ATTR}="/a.png 1x"
        src="${UNLOADABLE_ORIGIN}/uploads/p.png" srcset="${UNLOADABLE_ORIGIN}/a.png 1x" sizes="100vw">`,
    );
    retargetMedia(root, { readsBytes: true, urlFor: () => 'blob:resolved' });
    const img = root.querySelector('img')!;
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.hasAttribute('sizes')).toBe(false);
    expect(img.getAttribute('src')).toBe('blob:resolved');
  });

  it('leaves an unstamped absolute source alone', () => {
    const root = frag('<img src="https://cdn.test/a.png">');
    retargetMedia(root, { readsBytes: true, urlFor: () => 'blob:nope' });
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://cdn.test/a.png');
  });
});

// Three reviewers flagged this: absolutize() stamps <iframe> and <source> too,
// so an unresolvable one was handed IMAGE artwork — a working embed downgraded
// to a grey box, and a <source> candidate the browser then PREFERS over a
// sibling the parent could still resolve.
describe('retargetMedia: non-<img> stamped elements', () => {
  const never: MediaSource = { readsBytes: true, urlFor: () => null };

  it('leaves an <iframe> alone instead of painting image artwork over it', () => {
    const root = document.createElement('div');
    root.innerHTML = `<iframe ${MEDIA_PATH_ATTR}="/embed.html" src="https://unloadable-origin.example/embed.html"></iframe>`;
    retargetMedia(root, never);
    const f = root.querySelector('iframe')!;
    expect(f.getAttribute('src')).toBe('https://unloadable-origin.example/embed.html');
    expect(f.hasAttribute(MEDIA_PENDING_ATTR)).toBe(false);
  });

  it('drops an unresolvable <source> so the parent <img> src still wins', () => {
    const root = document.createElement('div');
    root.innerHTML =
      `<picture><source ${MEDIA_PATH_ATTR}="/a.webp"><img ${MEDIA_PATH_ATTR}="/a.png"></picture>`;
    retargetMedia(root, never);
    expect(root.querySelector('source')).toBeNull();
    expect(root.querySelector('img')!.getAttribute('src')).toBe(PENDING_MEDIA_SRC);
  });
});
