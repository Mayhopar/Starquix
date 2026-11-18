import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractCategory,
  extractProps,
  extractSlots,
  extractDependencies,
  extractPageTemplate,
  extractContentBound,
  discoverComponents,
} from './component-discovery';

describe('extractCategory', () => {
  it('extracts @category from frontmatter comment', () => {
    const content = `---\n/**\n * @category Hero\n */\n---\n<section></section>`;
    expect(extractCategory(content, '/a/b/Hero.astro', '/a')).toBe('Hero');
  });

  it('falls back to directory name', () => {
    const content = `<section></section>`;
    expect(extractCategory(content, '/a/components/hero/MyHero.astro', '/a/components')).toBe('Hero');
  });

  it('returns Uncategorized for root-level components without @category', () => {
    const content = `<section></section>`;
    expect(extractCategory(content, '/a/components/MyComp.astro', '/a/components')).toBe('Uncategorized');
  });
});

describe('extractProps', () => {
  it('extracts props from interface', () => {
    const frontmatter = `interface Props {\n  title: string;\n  subtitle?: string;\n}`;
    const props = extractProps(frontmatter);
    expect(props).toEqual([
      { name: 'title', type: 'string', required: true },
      { name: 'subtitle', type: 'string', required: false },
    ]);
  });

  it('extracts default values from destructuring', () => {
    const frontmatter = `interface Props {\n  title?: string;\n}\nconst { title = "Hello" } = Astro.props;`;
    const props = extractProps(frontmatter);
    expect(props[0].defaultValue).toBe('Hello');
  });

  it('returns empty array when no interface', () => {
    expect(extractProps('')).toEqual([]);
  });
});

describe('extractSlots', () => {
  it('extracts named slots', () => {
    const content = `<slot name="header" />\n<slot name="footer" />`;
    expect(extractSlots(content)).toEqual(['header', 'footer']);
  });

  it('detects default slot', () => {
    const content = `<div><slot /></div>`;
    expect(extractSlots(content)).toEqual(['default']);
  });

  it('returns empty for no slots', () => {
    const content = `<div>Hello</div>`;
    expect(extractSlots(content)).toEqual([]);
  });
});

describe('extractDependencies', () => {
  it('extracts .astro imports', () => {
    const fm = `import Header from './Header.astro';\nimport Card from '../Card.astro';`;
    expect(extractDependencies(fm)).toEqual(['./Header.astro', '../Card.astro']);
  });

  it('ignores non-astro imports', () => {
    const fm = `import { getCollection } from 'astro:content';`;
    expect(extractDependencies(fm)).toEqual([]);
  });
});

describe('extractPageTemplate', () => {
  it('returns null when no @page-template marker is present', () => {
    const content = `---\n/**\n * @category Hero\n */\n---\n<section>hi</section>`;
    expect(extractPageTemplate(content)).toBeNull();
  });

  it('extracts the kind from the @page-template marker', () => {
    const content = `---\n/**\n * @category Pages\n * @page-template blog-post\n */\n---\n<slot />`;
    expect(extractPageTemplate(content)).toBe('blog-post');
  });

  it('accepts kebab and snake kinds', () => {
    expect(extractPageTemplate('---\n// @page-template landing_page\n---')).toBe('landing_page');
    expect(extractPageTemplate('---\n// @page-template blog-list\n---')).toBe('blog-list');
  });
});

describe('discoverComponents', () => {
  it('exposes pageTemplate on discovered components when the marker is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sq-discover-'));
    try {
      await writeFile(
        join(dir, 'BlogPost.astro'),
        `---\n/**\n * @category Pages\n * @page-template blog-post\n */\n---\n<slot />`,
      );
      await writeFile(
        join(dir, 'Plain.astro'),
        `---\n/**\n * @category Hero\n */\n---\n<section />`,
      );

      const components = await discoverComponents(dir);
      const blog = components.find((c) => c.name === 'BlogPost');
      const plain = components.find((c) => c.name === 'Plain');

      expect(blog?.pageTemplate).toBe('blog-post');
      expect(plain?.pageTemplate).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('extractCategory — multi-word (regression 2026-08-09)', () => {
  it('reads a multi-word category verbatim', () => {
    const src = '---\n/**\n * @category Marketing pages\n */\n---\n<div />';
    expect(extractCategory(src, '/x/library/A.astro', '/x')).toBe('Marketing pages');
  });

  it('does not swallow the closing comment delimiter', () => {
    const src = '---\n/**\n * @category Heroes */\n---\n<div />';
    expect(extractCategory(src, '/x/library/A.astro', '/x')).toBe('Heroes');
  });
});

describe('extractContentBound', () => {
  it('true when the frontmatter calls getCollection', () => {
    expect(extractContentBound(`import { getCollection } from 'astro:content';\nconst posts = await getCollection('blog');`)).toBe(true);
  });

  it('true when the frontmatter imports astro:content without a direct call', () => {
    expect(extractContentBound(`import { getEntry } from "astro:content";`)).toBe(true);
  });

  it('false for a plain component', () => {
    expect(extractContentBound(`interface Props { title: string }\nconst { title } = Astro.props;`)).toBe(false);
  });

  it('false for an empty frontmatter', () => {
    expect(extractContentBound('')).toBe(false);
  });
});
