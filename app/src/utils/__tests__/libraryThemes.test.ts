import { describe, it, expect } from 'vitest';
import {
  builtInsForTheme, isProjectCopyOf, libraryTags, projectComponentsForTheme, resolveProjectTheme, themedComponentFile,
} from '../libraryThemes';

describe('libraryThemes', () => {
  it('reads @theme and @name from the frontmatter JSDoc only', () => {
    expect(libraryTags('---\n/**\n * @category Hero\n * @theme classic\n * @name Hero\n */\n---\n<section />'))
      .toEqual({ theme: 'classic', section: 'Hero' });
    expect(libraryTags('<section />')).toEqual({ theme: null, section: null });
    // A Tailwind v4 `@theme { … }` block in the markup is CSS, not a section theme.
    expect(libraryTags('---\nconst a = 1;\n---\n<style>@theme inline { --x: 1; }</style>').theme).toBeNull();
  });

  it('shows shared built-ins in every theme and themed ones only in their theme', () => {
    const lib = [{ name: 'Media' }, { name: 'Hero', theme: 'starquix' }, { name: 'Hero', theme: 'classic' }];
    expect(builtInsForTheme(lib, 'starquix')).toEqual([{ name: 'Media' }, { name: 'Hero', theme: 'starquix' }]);
    expect(builtInsForTheme(lib, 'classic')).toEqual([{ name: 'Media' }, { name: 'Hero', theme: 'classic' }]);
    expect(builtInsForTheme(lib, 'upload:abc')).toEqual([{ name: 'Media' }]);
  });

  describe('themedComponentFile (insert naming)', () => {
    const existing = (entries: Record<string, { theme?: string | null; section?: string | null }>) =>
      new Map(Object.entries(entries));

    it('uses the plain name when it is free', () => {
      expect(themedComponentFile('Hero', 'starquix', existing({}))).toBe('Hero');
    });
    it('reuses this section\'s copy in this theme (the user\'s edits win)', () => {
      expect(themedComponentFile('Hero', 'starquix', existing({ 'Hero.astro': { theme: 'starquix', section: 'Hero' } }))).toBe('Hero');
    });
    it('an untagged legacy copy counts as Classic; the user\'s own same-name file is never reused', () => {
      expect(themedComponentFile('Hero', 'classic', existing({ 'Hero.astro': { section: 'Hero' } }))).toBe('Hero');
      expect(themedComponentFile('Hero', 'starquix', existing({ 'Hero.astro': { section: 'Hero' } }))).toBe('HeroStarquix');
      expect(themedComponentFile('Hero', 'classic', existing({ 'Hero.astro': {} }))).toBe('HeroClassic');
    });
    it('suffixes the theme when another file owns the name, reuses an earlier suffixed copy, numbers a double collision', () => {
      const starquixHero = { 'Hero.astro': { theme: 'starquix', section: 'Hero' } };
      expect(themedComponentFile('Hero', 'classic', existing(starquixHero))).toBe('HeroClassic');
      expect(themedComponentFile('Hero', 'classic', existing({ ...starquixHero, 'HeroClassic.astro': { theme: 'classic', section: 'Hero' } })))
        .toBe('HeroClassic');
      expect(themedComponentFile('Hero', 'classic', existing({ ...starquixHero, 'HeroClassic.astro': { theme: 'starquix', section: 'Hero' } })))
        .toBe('HeroClassic2');
    });
  });

  describe('isProjectCopyOf (one card per section in ⌘K)', () => {
    const starquixHero = { path: 'library/Hero.astro', theme: 'starquix', section: 'Hero' };
    it('shared built-ins dedupe by file name, as before themes', () => {
      expect(isProjectCopyOf({ path: 'src/components/Media.astro' }, { path: 'library/Media.astro' })).toBe(true);
    });
    it('a themed built-in is hidden only by its own copy (section + theme), whatever the file name', () => {
      expect(isProjectCopyOf({ path: 'src/components/Hero.astro', theme: 'starquix', section: 'Hero' }, starquixHero)).toBe(true);
      expect(isProjectCopyOf({ path: 'src/components/HeroStarquix2.astro', theme: 'starquix', section: 'Hero' }, starquixHero)).toBe(true);
      expect(isProjectCopyOf({ path: 'src/components/Hero.astro', section: 'Hero' }, starquixHero)).toBe(false); // legacy Classic
      expect(isProjectCopyOf({ path: 'src/components/Hero.astro', section: 'Hero' }, { path: 'library/classic/Hero.astro', theme: 'classic', section: 'Hero' })).toBe(true);
      expect(isProjectCopyOf({ path: 'src/components/Hero.astro' }, starquixHero)).toBe(false); // the user's own Hero
    });
  });

  describe('projectComponentsForTheme (⌘K never offers another theme\'s copy)', () => {
    const starquix = [{ path: 'library/Hero.astro', theme: 'starquix', section: 'Hero' }, { path: 'library/Media.astro' }];
    const classic = [{ path: 'library/classic/Hero.astro', theme: 'classic', section: 'Hero' }];
    const project = [
      { path: 'src/components/Hero.astro', theme: 'starquix', section: 'Hero' },
      { path: 'src/components/HeroClassic.astro', theme: 'classic', section: 'Hero' },
      { path: 'src/components/Media.astro', section: 'Media' },
      { path: 'src/components/Header.astro' }, // an imported site's own header (no @name)
    ];
    const names = (list: Array<{ path: string }>) => list.map((c) => c.path.split('/').pop());
    it('Classic active: the Starquix copy is hidden; the Classic copy, shared parts and own files stay', () => {
      expect(names(projectComponentsForTheme(project, classic, 'classic')))
        .toEqual(['HeroClassic.astro', 'Media.astro', 'Header.astro']);
    });
    it('Starquix active: Classic and untagged legacy copies are hidden; own files stay', () => {
      const legacy = [...project, { path: 'src/components/Footer.astro', section: 'Footer' }];
      const lib = [...starquix, { path: 'library/Footer.astro', theme: 'starquix', section: 'Footer' }];
      expect(names(projectComponentsForTheme(legacy, lib, 'starquix'))).toEqual(['Hero.astro', 'Media.astro', 'Header.astro']);
    });
    it('an uploaded theme hides nothing (no built-in sections are active)', () => {
      expect(projectComponentsForTheme(project, [], 'upload:t1')).toHaveLength(4);
    });
  });

  describe('resolveProjectTheme (per-project default)', () => {
    const uploaded = new Set(['t1']);
    it('a saved built-in or existing upload wins', () => {
      expect(resolveProjectTheme('classic', uploaded)).toBe('classic');
      expect(resolveProjectTheme('upload:t1', uploaded)).toBe('upload:t1');
    });
    it('no record = an existing project from before themes = Classic', () => {
      expect(resolveProjectTheme(undefined, uploaded)).toBe('classic');
    });
    it('a deleted upload or unknown id falls back to Starquix', () => {
      expect(resolveProjectTheme('upload:gone', uploaded)).toBe('starquix');
      expect(resolveProjectTheme('nope', uploaded)).toBe('starquix');
    });
  });
});
