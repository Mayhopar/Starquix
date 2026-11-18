import { describe, it, expect } from 'vitest';
import { buildPickerCategories } from '../pickerCategories';
import { resolveFolderTree, EMPTY_MANIFEST, type FolderManifest } from '@/store/folderManifest';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const comp = (name: string, category: string): ScannedComponent => ({
  name,
  path: `library/${name}.astro`,
  source: 'built-in',
  html: '<div />',
  category,
  props: [],
  slots: [],
  dependencies: [],
});

const cats = (components: ScannedComponent[], manifest: FolderManifest = EMPTY_MANIFEST, themes: Array<{ _id: string; name: string }> = []) =>
  buildPickerCategories({ tree: resolveFolderTree(components, manifest), themes });

describe('buildPickerCategories', () => {
  it('orders fallback categories by anatomy, then themes last', () => {
    const out = cats(
      [comp('Footer', 'Footer'), comp('Hero', 'Hero'), comp('Odd', 'Odd'), comp('MainLayout', 'Layouts')],
      EMPTY_MANIFEST,
      [{ _id: 't1', name: 'Nordic' }],
    );
    expect(out.map((c) => c.name)).toEqual(['Hero', 'Footer', 'Odd', 'Layouts', 'Nordic']);
    expect(out.map((c) => c.kind)).toEqual(['library', 'library', 'library', 'library', 'theme']);
  });

  it('groups uncategorized components under Uncategorized, last', () => {
    const out = cats([comp('Div', ''), comp('Hero', 'Hero')]);
    expect(out.map((c) => c.name)).toEqual(['Hero', 'Uncategorized']);
  });

  // The whole point of retargeting: the picker reads the SAME tree as the
  // Assets panel, so a manifest folder shows up here under the same name.
  it('reads the manifest, and a nested folder reads as "Parent / Child"', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_out'],
      folders: {
        f_out: { name: 'Marketing pages', children: ['comp:library/CTA.astro', 'f_in'] },
        f_in: { name: 'Heroes', children: ['comp:library/HeroSplit.astro'] },
      },
    };
    const out = cats([comp('CTA', 'CTA'), comp('HeroSplit', 'Hero')], manifest);
    expect(out.map((c) => c.name)).toEqual(['Marketing pages', 'Marketing pages / Heroes']);
    expect(out[0].kind === 'library' && out[0].components.map((c) => c.name)).toEqual(['CTA']);
    expect(out[1].kind === 'library' && out[1].components.map((c) => c.name)).toEqual(['HeroSplit']);
  });

  it('omits an empty folder — there is nothing to pick in it', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_empty'],
      folders: { f_empty: { name: 'Empty', children: [] } },
    };
    expect(cats([], manifest)).toEqual([]);
  });
});
