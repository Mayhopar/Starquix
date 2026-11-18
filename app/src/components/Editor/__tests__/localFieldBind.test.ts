// bindLocalField (task-240 Phase 2): the BlogCard master field write — one
// whole-file restore-region write of the COMPONENT file with a whole-file
// undo (the same channel bindLocalBlogSlot uses). Refuses without writing when
// the element cannot be located.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/ViteStructuralWriter', () => ({ viteStructuralWriter: { writeRestoreRegion: vi.fn() } }));
vi.mock('react-hot-toast', () => { const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }); return { default: t }; });
vi.mock('@/utils/localElementSource', () => ({ readLocalFile: (...a: unknown[]) => h.read(...a), writeLocalFile: (...a: unknown[]) => h.writeFile(...a) }));

const h = vi.hoisted(() => ({ read: vi.fn(), writeFile: vi.fn() }));
import toast from 'react-hot-toast';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { bindLocalField, upgradeLocalCardImage, bindLocalCardImageField, readLocalCardImageField } from '../localFieldBind';
import { fileLineSpan } from '../localLayoutApply';
import { _resetStructuralWriteInFlightForTests } from '@/store/structuralWriteGuard';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const write = viteStructuralWriter.writeRestoreRegion as ReturnType<typeof vi.fn>;
const FILE = 'src/components/BlogCard.astro';
const CARD = "---\nconst { post } = Astro.props;\n---\n<article>\n  <h3 class=\"t\">Sample post</h3>\n</article>\n";
const H3 = { file: FILE, line: 5, column: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  h.read.mockResolvedValue(CARD);
  write.mockResolvedValue({ success: true, restoredLine: 1, file: FILE });
});

describe('bindLocalField', () => {
  it('writes the whole component file and pushes a whole-file inverse', async () => {
    const pushUndo = vi.fn();
    const res = await bindLocalField({ loc: H3, tagName: 'h3', field: 'title', fieldType: 'text', pushUndo });
    expect(res).toEqual({ ok: true });
    const [loc, lineCount, segment] = write.mock.calls[0];
    expect(loc).toEqual({ file: FILE, line: 1, column: 1 });
    expect(lineCount).toBe(fileLineSpan(CARD));
    expect(segment).toContain('<h3 class="t">{post.data.title}</h3>');
    expect(pushUndo).toHaveBeenCalledWith(expect.objectContaining({ structuralOp: {
      forward: [{ kind: 'restore-region', loc, lineCount: fileLineSpan(CARD), segment }],
      inverse: [{ kind: 'restore-region', loc, lineCount: fileLineSpan(segment), segment: CARD }],
    } }));
  });

  it('refuses without writing when the element cannot be located', async () => {
    const res = await bindLocalField({ loc: { ...H3, line: 99 }, tagName: 'h3', field: 'title', fieldType: 'text' });
    expect(res.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('an unreadable file refuses without writing', async () => {
    h.read.mockRejectedValue(new Error('404'));
    const res = await bindLocalField({ loc: H3, tagName: 'h3', field: 'title', fieldType: 'text' });
    expect(res.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

/**
 * Owner report 2026-09-12: "these cards have uploaded photos but they do not
 * display" — a BlogCard materialized by an older build still holds the library
 * placeholder box (`<span>{post.data.thumbnail}</span>`), never bound. The
 * pristine box upgrades itself to the bound <img> for the bound collection's
 * image field; a box the user touched (or already bound) is never rewritten.
 */
const PRISTINE = "---\nconst { post } = Astro.props;\n---\n<article class=\"card\">\n  <div class=\"aspect-video bg-gray-100 flex items-center justify-center\">\n    <span class=\"text-gray-400 text-sm\">{post.data.thumbnail}</span>\n  </div>\n  <h3>{post.data.title}</h3>\n</article>\n";
const IMAGE = { name: 'image', type: 'image' };
const COVER = { name: 'cover', type: 'image' };

describe('upgradeLocalCardImage', () => {
  it('binds the pristine placeholder box to the collection\'s image field (plain journaled whole-file write, like the scaffold)', async () => {
    h.read.mockResolvedValue(PRISTINE);
    h.writeFile.mockResolvedValue(undefined);
    const res = await upgradeLocalCardImage({ fields: [{ name: 'title', type: 'text' }, COVER] });
    expect(res).toEqual({ ok: true });
    const [file, segment] = h.writeFile.mock.calls[0];
    expect(file).toBe(FILE);
    expect(write).not.toHaveBeenCalled(); // never the structural writer: it refuses any file but the page being edited
    expect(segment).toContain('<div class="aspect-video bg-gray-100 flex items-center justify-center">\n    <img src={post.data.cover?.src ?? post.data.cover} alt="" class="w-full h-full object-cover" />\n  </div>');
    expect(segment).not.toContain('thumbnail');
  });

  it('prefers an image field named thumbnail (the placeholder already names it), then image, then the first', async () => {
    h.read.mockResolvedValue(PRISTINE);
    h.writeFile.mockResolvedValue(undefined);
    await upgradeLocalCardImage({ fields: [COVER, IMAGE, { name: 'thumbnail', type: 'image' }] });
    expect(h.writeFile.mock.calls[0][1]).toContain('post.data.thumbnail?.src ?? post.data.thumbnail');
    h.writeFile.mockClear();
    await upgradeLocalCardImage({ fields: [COVER, IMAGE] });
    expect(h.writeFile.mock.calls[0][1]).toContain('post.data.image?.src ?? post.data.image');
    h.writeFile.mockClear();
    await upgradeLocalCardImage({ fields: [COVER] });
    expect(h.writeFile.mock.calls[0][1]).toContain('post.data.cover?.src ?? post.data.cover');
  });

  it('nothing to do: no image field, a text `thumbnail` field, a box already bound, or a box the user changed', async () => {
    h.read.mockResolvedValue(PRISTINE);
    expect(await upgradeLocalCardImage({ fields: [{ name: 'title', type: 'text' }] })).toEqual({ ok: true });
    expect(await upgradeLocalCardImage({ fields: [IMAGE, { name: 'thumbnail', type: 'text' }] })).toEqual({ ok: true });
    h.read.mockResolvedValue(PRISTINE.replace('<span class="text-gray-400 text-sm">{post.data.thumbnail}</span>', '<img src={post.data.image?.src ?? post.data.image} alt="" />'));
    expect(await upgradeLocalCardImage({ fields: [IMAGE] })).toEqual({ ok: true });
    h.read.mockResolvedValue(PRISTINE.replace('{post.data.thumbnail}', 'My label'));
    expect(await upgradeLocalCardImage({ fields: [IMAGE] })).toEqual({ ok: true });
    h.read.mockRejectedValue(new Error('404'));
    expect((await upgradeLocalCardImage({ fields: [IMAGE] })).ok).toBe(false);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * Owner rule 2026-09-12: "the photo uploaded into attributes is the one on the
 * card cover" — the attribute the user uploads into becomes the card's image
 * field, whatever the box held before (placeholder, another field, a static
 * image). A box with other markup is never touched.
 */
const BOUND_IMAGE = PRISTINE.replace('<span class="text-gray-400 text-sm">{post.data.thumbnail}</span>', '<img src={post.data.image?.src ?? post.data.image} alt="" class="w-full h-full object-cover" />');
const STATIC = PRISTINE.replace('<span class="text-gray-400 text-sm">{post.data.thumbnail}</span>', '<img src="/uploads/first.png" alt="" class="w-full h-full object-cover" />');

describe('bindLocalCardImageField / readLocalCardImageField', () => {
  it('rebinds a card bound to another field, a static image, or the placeholder to the uploaded-into field', async () => {
    h.writeFile.mockResolvedValue(undefined);
    for (const card of [BOUND_IMAGE, STATIC, PRISTINE]) {
      h.read.mockResolvedValue(card);
      h.writeFile.mockClear();
      expect(await bindLocalCardImageField('cover')).toEqual({ ok: true });
      expect(h.writeFile.mock.calls[0][0]).toBe(FILE);
      expect(h.writeFile.mock.calls[0][1]).toContain('<div class="aspect-video bg-gray-100 flex items-center justify-center">\n    <img src={post.data.cover?.src ?? post.data.cover} alt="" class="w-full h-full object-cover" />\n  </div>');
      expect(h.writeFile.mock.calls[0][1]).not.toContain('first.png');
    }
  });

  it('no-op when already bound to that field; a box holding other markup is left alone', async () => {
    h.writeFile.mockResolvedValue(undefined);
    h.read.mockResolvedValue(BOUND_IMAGE);
    expect(await bindLocalCardImageField('image')).toEqual({ ok: true });
    h.read.mockResolvedValue(PRISTINE.replace('<span class="text-gray-400 text-sm">{post.data.thumbnail}</span>', '<p>Custom</p><img src="/x.png" />'));
    expect((await bindLocalCardImageField('cover')).ok).toBe(false);
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it('readLocalCardImageField reads the bound field, null otherwise', async () => {
    h.read.mockResolvedValue(BOUND_IMAGE);
    expect(await readLocalCardImageField()).toBe('image');
    h.read.mockResolvedValue(STATIC);
    expect(await readLocalCardImageField()).toBeNull();
    h.read.mockRejectedValue(new Error('404'));
    expect(await readLocalCardImageField()).toBeNull();
  });
});
