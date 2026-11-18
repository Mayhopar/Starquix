import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { contentOps, setLocalContentSource } from '../content-ops';
import { postFileName } from '../postFileName';

// task-138: with a project armed, discovery reads the project's REAL files
// through the instance's /__sq/local/content route — never localStorage.

const DIR = 'wc://p';

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }));
const localFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/sqLocalBase', () => ({ localFetch }));
vi.mock('@/services/durableEdits/acceptance', () => ({
  inspectAcceptedProject: async (_id: string, read: (rev: number) => Promise<unknown>) => read(1),
}));
vi.mock('@/services/durableEdits/projectedSource', () => ({
  withProjectedSource: async (_id: string, _rev: number, run: () => Promise<unknown>) => run(),
  projectedSourceFiles: () => [],
}));

beforeEach(() => {
  localStorage.clear();
  h.files = {};
  localFetch.mockReset().mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ files: { ...h.files } }) }));
  setLocalContentSource(DIR);
});

afterEach(() => {
  setLocalContentSource(null);
});

describe('contentOps with a project armed (task-138)', () => {
  it('fetchCollections reads real files from the content route', async () => {
    h.files = {
      'src/content/blog/hello.md': '---\ntitle: "Hello"\ndate: 2026-07-01\n---\nbody',
      'src/content/blog/older.md': '---\ntitle: "Old"\ndate: 2026-06-01\n---\n',
    };

    const cols = await contentOps.fetchCollections();
    expect(localFetch).toHaveBeenCalledWith(`/__sq/local/content?path=${encodeURIComponent(DIR)}`);
    expect(cols).toHaveLength(1);
    expect(cols[0].name).toBe('blog');
    expect(cols[0].posts.map(p => p.slug)).toEqual(['hello', 'older']);
  });

  // Imported-adoption phase 0 (ledger C1/C3): real themes nest entries
  // (astro-paper `src/content/posts/<sub>/`, astro-sphere per-post folders).
  it('nested entries appear in the collection with a path slug', async () => {
    h.files = {
      'src/content/blog/2024/post.mdx': '---\ntitle: "Nested"\ndate: 2026-01-02\n---\n',
      'src/content/blog/top.md': '---\ntitle: "Top"\ndate: 2026-01-01\n---\n',
    };
    const cols = await contentOps.fetchCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].posts.map(p => p.slug)).toEqual(['2024/post', 'top']);
  });

  it('loose files at the content root stay dropped (decision, not accident)', async () => {
    h.files = {
      'src/content/about.md': '---\ntitle: "About"\n---\n',
      'src/content/blog/real.md': '---\ntitle: "Real"\n---\n',
    };
    const cols = await contentOps.fetchCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].name).toBe('blog');
  });

  it('writeContentConfig is a no-op — never clobbers the user config', async () => {
    await contentOps.writeContentConfig([]);
    expect(localFetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('sq:content-files:default')).toBeNull();
  });

  it('disarmed source lists nothing — no localStorage tier fallback', async () => {
    setLocalContentSource(null);
    localStorage.setItem('starquix:last-project-id', 'proj-x');
    localStorage.setItem('sq:content-files:proj-x', JSON.stringify({
      'src/content/blog/a.md': '---\ntitle: "A"\n---\n',
    }));

    expect(await contentOps.fetchCollections()).toEqual([]);
    expect(localFetch).not.toHaveBeenCalled();
  });
});

// The header and the tree used to print `${slug}.md` unconditionally, so an
// .mdx post on disk still read as ".md" — the exact symptom of a bug that was
// already fixed, reported from the UI.
describe('postFileName', () => {
  it('reports the real extension of the file on disk', () => {
    expect(postFileName({ slug: 'a', filePath: 'src/content/works/A.mdx' })).toBe('A.mdx');
    expect(postFileName({ slug: 'a', filePath: 'src/content/works/A.md' })).toBe('A.md');
  });

  it('falls back to <slug>.mdx (new posts are .mdx) only when there is no usable file path', () => {
    expect(postFileName({ slug: 'a' })).toBe('a.mdx');
    expect(postFileName({ slug: 'a', filePath: 'src/content/works' })).toBe('a.mdx');
  });
});
