// task-142: local-mode Layers — component-file subtree roots read as
// components (purple + name); same-file internals stay plain rows.
import { describe, it, expect } from 'vitest';
import { localComponentRootName } from '../resolveLabel';

describe('localComponentRootName', () => {
  it('component root under a page parent → component name', () => {
    expect(localComponentRootName(
      'src/components/FeaturedWork.astro:11:1',
      'src/components/FeaturedWorkList.astro:18:1',
    )).toBe('FeaturedWork');
    expect(localComponentRootName(
      'src/components/Main.astro:7:1',
      'src/pages/index.astro:4:1',
    )).toBe('Main');
    expect(localComponentRootName('src/layouts/Base.astro:3:1', null)).toBe('Base');
  });

  it('same-file internals are NOT roots', () => {
    expect(localComponentRootName(
      'src/components/FeaturedWork.astro:26:6',
      'src/components/FeaturedWork.astro:11:1',
    )).toBeNull();
  });

  it('component-editor view: the VIEWED file’s own rows are internals, nested components stay roots', () => {
    const viewed = 'src/components/DoubleImage.astro';
    // top-level rows of the viewed component (parentKey null) — plain rows
    expect(localComponentRootName('src/components/DoubleImage.astro:6:1', null, viewed)).toBeNull();
    expect(localComponentRootName('src/components/DoubleImage.astro:31:1', null, viewed)).toBeNull();
    // a DIFFERENT component nested inside the viewed one — still purple
    expect(localComponentRootName('src/components/Credit.astro:2:1', 'src/components/DoubleImage.astro:6:1', viewed)).toBe('Credit');
  });

  it('pages, dynamic and node_modules keys never match', () => {
    expect(localComponentRootName('src/pages/index.astro:4:1', null)).toBeNull();
    expect(localComponentRootName('dynamic:img:0@abc', 'src/components/X.astro:1:1')).toBeNull();
    expect(localComponentRootName('/Users/x/proj/node_modules/astro/components/Image.astro:38:2', null)).toBeNull();
  });
});
