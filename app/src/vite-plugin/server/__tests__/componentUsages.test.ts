/**
 * task-143 — findComponentUsages: reverse .astro import graph from a
 * component up to src/pages/**. Backs the /__sq/local/component-usages
 * endpoint (Fill → Media usage picker in the component view).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { findComponentUsages } from '../../project-fs';

let root: string;

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sq-usages-'));
  // index → FeaturedWorkList → FeaturedWork (transitive)
  await write('src/pages/index.astro', `---
import FeaturedWorkList from '../components/FeaturedWorkList.astro';
---
<FeaturedWorkList />`);
  await write('src/components/FeaturedWorkList.astro', `---
import FeaturedWork from './FeaturedWork.astro';
---
<FeaturedWork />`);
  await write('src/components/FeaturedWork.astro', '<article />');
  // dynamic route → WorkPost (direct)
  await write('src/pages/works/[slug].astro', `---
import WorkPost from "../../components/WorkPost.astro";
---
<WorkPost />`);
  await write('src/components/WorkPost.astro', '<main />');
  // used by nothing
  await write('src/components/Orphan.astro', '<div />');
  // used ONLY from an .mdx content entry (task-143 second pass — the real
  // personal-site case: SingleImage & co. live solely in works/*.mdx)
  await write('src/components/SingleImage.astro', '<figure />');
  await write('src/content/works/Other.mdx', `---
title: Other
---
import SingleImage from '../../components/SingleImage.astro';

<SingleImage />`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findComponentUsages', () => {
  it('resolves transitive imports up to the page', () => {
    const { usages } = findComponentUsages(root, 'src/components/FeaturedWork.astro');
    expect(usages).toEqual([
      expect.objectContaining({ route: '/', file: 'src/pages/index.astro' }),
    ]);
  });

  it('flags dynamic-route pages', () => {
    const { usages } = findComponentUsages(root, 'src/components/WorkPost.astro');
    expect(usages).toEqual([
      expect.objectContaining({ route: '/works/[slug]', dynamic: true }),
    ]);
  });

  it('component used only from an .mdx content entry → contentUsages with slug', () => {
    const { usages, contentUsages } = findComponentUsages(root, 'src/components/SingleImage.astro');
    expect(usages).toEqual([]);
    expect(contentUsages).toEqual([
      { file: 'src/content/works/Other.mdx', collection: 'works', slug: 'other' },
    ]);
  });

  it('unused component → empty; a page file reports itself', () => {
    expect(findComponentUsages(root, 'src/components/Orphan.astro').usages).toEqual([]);
    expect(findComponentUsages(root, 'src/pages/index.astro').usages).toEqual([
      expect.objectContaining({ route: '/' }),
    ]);
  });

  it('bad inputs fail soft', () => {
    expect(findComponentUsages(root, 'node_modules/x.astro').usages).toEqual([]);
    expect(findComponentUsages(path.join(root, 'nope'), 'src/components/WorkPost.astro').usages).toEqual([]);
  });
});
