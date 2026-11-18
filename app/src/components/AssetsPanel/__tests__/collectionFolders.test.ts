import { describe, expect, it } from 'vitest';
import type { AssetItem, ResolvedTree } from '@/store/folderManifest';
import { overlayBlogSection } from '../collectionFolders';

const comp = (path: string): AssetItem => ({ id: `comp:${path}`, kind: 'component', name: path.replace(/^.*\/|\.astro$/g, ''), children: [] });
const WORK = 'src/components/WorkCard.astro';
const LIST = 'src/components/WorkList.astro';
const BLOG = 'src/components/BlogCard.astro';
const ART = 'src/components/ArticleCard.astro';
const SLOT = 'src/components/BlogSlot.astro';
const HERO = 'src/components/Hero.astro';
const tree = (): ResolvedTree => ({
  items: [
    { id: 'f_blog', kind: 'folder', name: 'Blog', children: [`comp:${BLOG}`, `comp:${SLOT}`] },
    { id: 'f_misc', kind: 'folder', name: 'Misc', children: [`comp:${ART}`, `comp:${HERO}`] },
    comp(WORK), comp(LIST), comp(BLOG), comp(ART), comp(SLOT), comp(HERO),
  ],
  rootIds: ['f_blog', 'f_misc', `comp:${WORK}`, `comp:${LIST}`],
});
const assignments = new Map([
  [WORK, { card: true, collections: ['works'], typed: 'works', conflict: [] }],
  [LIST, { card: false, collections: ['works'], typed: 'works', conflict: [] }],
  [BLOG, { card: true, collections: ['blog'], typed: null, conflict: [] }],
  [ART, { card: true, collections: [], typed: null, conflict: [] }],
]);

describe('overlayBlogSection — the Blog section (owner 2026-10-10: folders are notes, cards belong nowhere)', () => {
  it('= the Blog folder\'s children + every card outside it; no folder per collection; lists are not cards', () => {
    const out = overlayBlogSection(tree(), { assignments });
    expect(out.blogIds).toEqual([`comp:${BLOG}`, `comp:${SLOT}`, `comp:${WORK}`, `comp:${ART}`]);
    expect(out.items.some((i) => i.id.startsWith('coll:'))).toBe(false);
    expect(out.items.find((i) => i.id === 'f_misc')!.children).toEqual([`comp:${HERO}`]); // ArticleCard pulled into the section
    expect(out.rootIds).toEqual(['f_misc', `comp:${LIST}`, ...out.blogIds]);
    expect(out.blogFolderId).toBe('f_blog');
  });

  it('a user folder inside the Blog folder stays a folder in the section — the cards in it stay put', () => {
    const t = tree();
    t.items = [...t.items.map((i) => (i.id === 'f_blog' ? { ...i, children: [...i.children, 'f_mine'] } : i)),
      { id: 'f_mine', kind: 'folder', name: 'Mine', children: [`comp:${WORK}`] }];
    t.rootIds = t.rootIds.filter((r) => r !== `comp:${WORK}`);
    const out = overlayBlogSection(t, { assignments });
    expect(out.blogIds).toEqual([`comp:${BLOG}`, `comp:${SLOT}`, 'f_mine', `comp:${ART}`]);
    expect(out.items.find((i) => i.id === 'f_mine')!.children).toEqual([`comp:${WORK}`]);
  });

  it('no Blog folder and no cards → unchanged, no section', () => {
    const t: ResolvedTree = { items: [comp(HERO)], rootIds: [`comp:${HERO}`] };
    expect(overlayBlogSection(t, { assignments: new Map() })).toEqual({ ...t, blogIds: [], blogFolderId: null });
  });

  it('the input tree is not mutated', () => {
    const t = tree();
    const before = JSON.stringify(t);
    overlayBlogSection(t, { assignments });
    expect(JSON.stringify(t)).toBe(before);
  });
});

