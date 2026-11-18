// Frontmatter-image upload target (files-truth): an `image()` schema field
// gets the post-relative in-collection write (that schema rejects a public
// src); every other field gets the public `/uploads/…` src, which renders
// from any page — a listing card included.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), mutation: vi.fn() }));
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: mocks.read }));
vi.mock('@/services/imageMutationReceipts', () => ({ fetchImageMutation: mocks.mutation }));
vi.mock('@/utils/localMode', () => ({ findLocalProjectEntry: () => ({ path: '/project' }), isLocalProjectId: () => true, PROJECT_NOT_READY: 'missing' }));
import { isImageSchemaField, uploadLocalPostFieldImage } from '../imageUpload';

const CONFIG = "import { defineCollection, z } from 'astro:content';\nconst works = defineCollection({ schema: ({ image }) => z.object({ title: z.string(), cover: image(), poster: z.string().optional() }) });\nexport const collections = { works };\n";
/** `works.image` is image(); `news.image` a plain string; `blog` undeclared. */
const TWO_COLLECTIONS = "import { defineCollection, z } from 'astro:content';\nconst works = defineCollection({ schema: ({ image }) => z.object({ title: z.string(), image: image() }) });\nconst news = defineCollection({ schema: z.object({ title: z.string(), image: z.string().optional() }) });\nexport const collections = { works, news };\n";
const file = new File(['x'], 'pic.png', { type: 'image/png' });
const mutationUrl = () => String(mocks.mutation.mock.calls[0][1]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutation.mockResolvedValue(Response.json({ src: '/uploads/pic.png' }));
});

describe('isImageSchemaField', () => {
  it('true only for a field the content config declares with image()', async () => {
    mocks.read.mockResolvedValue(new Response(CONFIG, { status: 200 }));
    expect(await isImageSchemaField('cover', 'works')).toBe(true);
    expect(await isImageSchemaField('poster', 'works')).toBe(false);
    expect(await isImageSchemaField('coverImage', 'works')).toBe(false);
  });

  // Owner's site 2026-09-12: `works` declares `image: image()`; a `blog`
  // collection added in the editor has NO config entry (raw frontmatter). A
  // name-keyed check over the whole config sent the blog upload post-relative
  // (`./images/uploads/…`) — the post editor resolved it, the listing card
  // could not (Chrome's broken-image icon). The check is per COLLECTION.
  it('is scoped to the post\'s own collection — an undeclared or z.string() collection is never image()', async () => {
    mocks.read.mockResolvedValue(new Response(TWO_COLLECTIONS, { status: 200 }));
    expect(await isImageSchemaField('image', 'works')).toBe(true);
    expect(await isImageSchemaField('image', 'news')).toBe(false);
    expect(await isImageSchemaField('image', 'blog')).toBe(false);
  });

  it('false without a content config (legacy location tried after the Astro 5 name)', async () => {
    mocks.read.mockResolvedValue(new Response('nope', { status: 404 }));
    expect(await isImageSchemaField('cover', 'works')).toBe(false);
    expect(mocks.read.mock.calls.map(c => String(c[0]))).toEqual([
      '/__sq/local/file?file=src%2Fcontent.config.ts&probe=1',
      '/__sq/local/file?file=src%2Fcontent%2Fconfig.ts&probe=1',
    ]);
  });
});

describe('uploadLocalPostFieldImage', () => {
  it('image() field → in-collection write (postFile param), post-relative src', async () => {
    mocks.read.mockResolvedValue(new Response(CONFIG, { status: 200 }));
    mocks.mutation.mockResolvedValue(Response.json({ src: './images/uploads/pic.png' }));
    await expect(uploadLocalPostFieldImage('browser_x', 'src/content/works/a.md', file, 'cover', 'works')).resolves.toBe('./images/uploads/pic.png');
    expect(mutationUrl()).toContain('postFile=src%2Fcontent%2Fworks%2Fa.md');
  });

  it('a post in a collection the config does not declare → public upload even when another collection has image() for that name', async () => {
    mocks.read.mockResolvedValue(new Response(TWO_COLLECTIONS, { status: 200 }));
    await expect(uploadLocalPostFieldImage('browser_x', 'src/content/blog/test.mdx', file, 'image', 'blog')).resolves.toBe('/uploads/pic.png');
    expect(mutationUrl()).not.toContain('postFile');
  });

  it('any other field → public upload (no postFile), root-relative src', async () => {
    mocks.read.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(uploadLocalPostFieldImage('browser_x', 'src/content/works/a.md', file, 'coverImage', 'works')).resolves.toBe('/uploads/pic.png');
    expect(mutationUrl()).toContain('/__sq/local/asset?');
    expect(mutationUrl()).not.toContain('postFile');
  });
});
