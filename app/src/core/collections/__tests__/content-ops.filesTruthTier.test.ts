/**
 * Files are truth: the doc-era localStorage content tier (`sq:content-files:*`,
 * keyed by the GLOBAL `starquix:last-project-id`) is gone. Runtime-proven
 * 2026-09-10: importing personal-site got the previous doc-truth project's
 * `src/pages/lol/**` mounted into it from that tier. With the tier removed, a
 * leftover key must never surface as content — armed or not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contentOps, setLocalContentSource } from '../content-ops';

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The tier of ANOTHER project, still named by the global last-project-id.
  localStorage.setItem('starquix:last-project-id', 'browser_previous');
  localStorage.setItem('sq:content-files:browser_previous', JSON.stringify({
    'src/pages/lol/index.astro': '<Layout />',
    'src/content/lol/welcome-to-your-blog.mdx': '---\ntitle: "LOL!"\n---\n',
  }));
});
afterEach(() => { setLocalContentSource(null); localStorage.clear(); vi.unstubAllGlobals(); });

describe('contentOps with no project armed (no localStorage tier)', () => {
  it('fetchCollections lists nothing — the leftover tier never surfaces', async () => {
    expect(await contentOps.fetchCollections()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes refuse with the no-project error and leave localStorage untouched', async () => {
    const before = JSON.stringify({ ...localStorage });
    const noProject = /No project is open/;
    await expect(contentOps.createPost('blog', 'a', { title: 'A' }, 'x')).rejects.toThrow(noProject);
    await expect(contentOps.updatePost('blog', 'a', { title: 'A' }, 'x')).rejects.toThrow(noProject);
    await expect(contentOps.deletePost('blog', 'a')).rejects.toThrow(noProject);
    await expect(contentOps.deleteCollection('blog')).rejects.toThrow(noProject);
    expect(JSON.stringify({ ...localStorage })).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
