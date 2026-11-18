import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentOps, parseFrontmatter, setLocalContentSource } from '../content-ops';
import { fieldsFromInferred } from '../localFields';
import { describeProperties } from '@/components/PostEditor/propertyDescriptors';
import { prepareFrontmatterPatch, UnsafeFrontmatterEdit } from '@/postmodel/frontmatterPatch';
import { resetLocalTransportForTests, setLocalTransport } from '@/utils/sqLocalBase';
const file = 'src/content/typed/typed-properties.md';
const fixture = readFileSync(resolve(process.cwd(), 'src/postmodel/__tests__/fixtures/typed-properties.md'), 'utf8');
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { setLocalContentSource(null); resetLocalTransportForTests(); vi.unstubAllGlobals(); });
async function discover(raw: string) {
  const path = 'wc://capability-fixture';
  setLocalContentSource(path);
  const read = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') throw new Error('Discovery must not write');
    return new Response(JSON.stringify({ files: { [file]: raw } }));
  });
  setLocalTransport({ projectPath: path, fetch: read });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Discovery must go through the local transport'); }));
  const collection = (await contentOps.fetchCollections())[0];
  expect(read).toHaveBeenCalledTimes(1);
  return { post: collection.posts[0], fields: fieldsFromInferred(collection.inferredFields) };
}
it('classifies the exact native block-scalar fixture as inspect-only', async () => {
  expect(fixture).toContain('description: |\n  First description line\n  Second description line.\n');
  expect(() => prepareFrontmatterPatch(fixture, { description: 'First revised line\nSecond line — Grüße.' })).toThrow(UnsafeFrontmatterEdit);
  const { post, fields } = await discover(fixture);
  const description = describeProperties(fields, post.frontmatter, 'inferred', post.readOnlyPropertyKeys).find(d => d.key === 'description');
  expect(description?.editor).toBe('readonly');
  expect(post.frontmatter.description).toBe('First description line\nSecond description line.\n');
  expect(post.body).toBe(parseFrontmatter(fixture).body);
});
it.each([
  ['literal', 'description: |-\n  First\n  Second', true],
  ['folded', 'description: >+\n  First\n  Second', true],
  ['anchor', 'description: &desc Before', true],
  ['alias', 'original: &desc Before\ndescription: *desc', true],
  ['physical multiline quote', 'description: "First\n  Second"', true],
  ['escaped multiline quote', 'description: "First\\nSecond"', false],
  ['plain scalar', 'description: Before', false],
  ['boolean', 'description: false', false],
  ['flow list', 'description: ["one", "two"]', false],
  ['block list', 'description:\n  - one\n  - two', true],
] as const)('matches existing writer source capability for %s', async (_name, property, readonly) => {
  const { post } = await discover(`---\n${property}\n---\nBody.\n`);
  expect(post.readOnlyPropertyKeys?.includes('description') ?? false).toBe(readonly);
});
