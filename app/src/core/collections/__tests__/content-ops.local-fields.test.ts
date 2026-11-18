/**
 * Gap 18: frontmatter schema management in files-truth projects. The writes
 * themselves ("+ Add field" / field delete, schema follows the field) are
 * accepted by `services/durableEdits/collectionAcceptance` (tested there);
 * this file covers the no-project no-ops, surgical key removal, and that
 * discovery re-infers fields — including 'date' for ISO date STRINGS, which
 * parseFrontmatter produces (never Date instances).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  contentOps,
  setLocalContentSource,
  hasLocalContentSource,
  removeFrontmatterKey,
} from '../content-ops';

const DIR = 'wc://fields';

const FILES: Record<string, string> = {
  'src/content/works/alpha.mdx': '---\ntitle: "Alpha"\ndate: 2026-07-01\n---\nbody A',
  'src/content/works/beta.md': '---\ntitle: "Beta"\ndate: 2026-06-01\nrating: "5"\n---\nbody B',
  'src/content/blog/other.md': '---\ntitle: "Other"\n---\nother body',
};

const localFetch = vi.hoisted(() => vi.fn());
const acceptCollectionFieldChange = vi.hoisted(() => vi.fn());
vi.mock('@/utils/sqLocalBase', () => ({ localFetch }));
vi.mock('@/services/durableEdits/collectionAcceptance', () => ({ acceptCollectionFieldChange }));
vi.mock('@/services/durableEdits/acceptance', () => ({
  inspectAcceptedProject: async (_id: string, read: (rev: number) => Promise<unknown>) => read(1),
}));
vi.mock('@/services/durableEdits/projectedSource', () => ({
  withProjectedSource: async (_id: string, _rev: number, run: () => Promise<unknown>) => run(),
  projectedSourceFiles: () => [],
}));

function serveFiles(files: Record<string, string>) {
  localFetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ files }) }));
}

beforeEach(() => {
  localFetch.mockReset();
  acceptCollectionFieldChange.mockReset().mockResolvedValue(undefined);
  setLocalContentSource(DIR);
});

afterEach(() => {
  setLocalContentSource(null);
});

describe('hasLocalContentSource', () => {
  it('mirrors the armed local source', () => {
    expect(hasLocalContentSource()).toBe(true);
    setLocalContentSource(null);
    expect(hasLocalContentSource()).toBe(false);
  });
});

describe('addLocalCollectionField / removeLocalCollectionField', () => {
  it('hand the armed project to the collection acceptance owner and announce the change', async () => {
    const changed = vi.fn();
    window.addEventListener('sq:content-changed', changed);
    const undoEntry = { stage: vi.fn(), commit: vi.fn() };
    await contentOps.addLocalCollectionField('works', 'rating', '', 'text');
    await contentOps.removeLocalCollectionField('works', 'rating', undoEntry);
    expect(acceptCollectionFieldChange.mock.calls).toEqual([
      [DIR, 'works', { action: 'add', name: 'rating', defaultValue: '', type: 'text' }],
      // the remove carries the editor's claimed undo: one ⌘Z puts the key back (owner 2026-11-10)
      [DIR, 'works', { action: 'remove', name: 'rating' }, undoEntry],
    ]);
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener('sq:content-changed', changed);
  });

  it('no-op when no project is armed', async () => {
    setLocalContentSource(null);
    await contentOps.addLocalCollectionField('works', 'rating', '');
    await contentOps.removeLocalCollectionField('works', 'rating');
    expect(acceptCollectionFieldChange).not.toHaveBeenCalled();
    expect(localFetch).not.toHaveBeenCalled();
  });
});

describe('removeFrontmatterKey', () => {
  it('removes the key line and preserves every other byte', () => {
    const raw = '---\ntitle: "A"\nrating: "5"\ndate: 2026-07-01\n---\nbody\n\nmore';
    expect(removeFrontmatterKey(raw, 'rating')).toBe(
      '---\ntitle: "A"\ndate: 2026-07-01\n---\nbody\n\nmore',
    );
  });

  it('takes the removed key\'s indented continuation lines with it', () => {
    const raw = '---\ntitle: "A"\ntags:\n  - one\n  - two\ndate: 2026-07-01\n---\nbody';
    expect(removeFrontmatterKey(raw, 'tags')).toBe(
      '---\ntitle: "A"\ndate: 2026-07-01\n---\nbody',
    );
  });

  it('does not remove keys that merely share a prefix', () => {
    const raw = '---\ndate: 2026-07-01\ndateModified: 2026-08-01\n---\n';
    expect(removeFrontmatterKey(raw, 'date')).toBe(
      '---\ndateModified: 2026-08-01\n---\n',
    );
  });

  it('returns null when the key is absent or there is no frontmatter block', () => {
    expect(removeFrontmatterKey('---\ntitle: "A"\n---\nbody', 'rating')).toBeNull();
    expect(removeFrontmatterKey('no frontmatter here', 'title')).toBeNull();
  });
});

describe('field inference (local discovery round-trip)', () => {
  it("infers 'date' for ISO date STRINGS — parseFrontmatter never yields Date instances", async () => {
    serveFiles(FILES);
    const cols = await contentOps.fetchCollections();
    const works = cols.find(c => c.name === 'works')!;
    expect(works.inferredFields).toContainEqual({ name: 'date', type: 'date' });
  });
});

describe('inferFieldsFromPosts — empty values cast no vote', () => {
  const infer = async (files: Record<string, string>, collection = 'works') => {
    serveFiles(files);
    return (await contentOps.fetchCollections()).find(c => c.name === collection)!.inferredFields;
  };

  it('an image in one post + empty in the others stays an image field (the "+ Add field" then first-upload shape)', async () => {
    const fields = await infer({
      'src/content/works/a.md': '---\ntitle: "A"\ncover: "/uploads/a.png"\n---\n',
      'src/content/works/b.md': '---\ntitle: "B"\ncover: ""\n---\n',
      'src/content/works/c.md': '---\ntitle: "C"\ncover:\n---\n',
    });
    expect(fields).toContainEqual({ name: 'cover', type: 'image' });
  });

  it('a key with no value anywhere is an image field by NAME (coverImage, thumbnail, …), text otherwise', async () => {
    const fields = await infer({
      'src/content/works/a.md': '---\ntitle: "A"\ncoverImage: ""\nnotes: ""\n---\n',
      'src/content/works/b.md': '---\ntitle: "B"\ncoverImage: ""\nnotes: ""\n---\n',
    });
    expect(fields).toContainEqual({ name: 'coverImage', type: 'image' });
    expect(fields).toContainEqual({ name: 'notes', type: 'text' });
  });

  it('a date in one post + empty in another keeps the date input', async () => {
    const fields = await infer({
      'src/content/works/a.md': '---\ntitle: "A"\npublished: 2026-07-01\n---\n',
      'src/content/works/b.md': '---\ntitle: "B"\npublished: ""\n---\n',
    });
    expect(fields).toContainEqual({ name: 'published', type: 'date' });
  });

  it('a real value that is NOT an image still wins over the name hint', async () => {
    const fields = await infer({
      'src/content/works/a.md': '---\ntitle: "A"\nhero: "Big headline"\n---\n',
      'src/content/works/b.md': '---\ntitle: "B"\nhero: ""\n---\n',
    });
    expect(fields).toContainEqual({ name: 'hero', type: 'text' });
  });
});
