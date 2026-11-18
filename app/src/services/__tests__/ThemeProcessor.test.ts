import { describe, it, expect } from 'vitest';
import {
  extractHtmlFromAstro,
  stripAstroExpressions,
  stripExpressionAttributes,
  detectCommonPrefix,
  isDocumentLevelFile,
  isComponentPath,
  isPageFile,
  extractSectionsFromPage,
  stripEditorAttributes,
  extractSectionName,
  extractImports,
  getExtension,
  extractComponentName,
  processThemeZip,
} from '../ThemeProcessor';
import JSZip from 'jszip';

// Helper: create a File from a JSZip instance
async function zipToFile(zip: JSZip, name = 'theme.zip'): Promise<File> {
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name, { type: 'application/zip' });
}

// ============================================================================
// extractHtmlFromAstro
// ============================================================================

describe('extractHtmlFromAstro', () => {
  it('strips frontmatter', () => {
    const source = `---
import Layout from '../layouts/Layout.astro';
const title = 'Hello';
---
<div>Hello</div>`;
    expect(extractHtmlFromAstro(source)).toBe('<div>Hello</div>');
  });

  it('strips Astro expressions', () => {
    const source = '<p>{user.name}</p>';
    expect(extractHtmlFromAstro(source)).toBe('<p></p>');
  });

  it('strips nested Astro expressions', () => {
    const source = '<p>{items.map(i => { return i.name })}</p>';
    expect(extractHtmlFromAstro(source)).toBe('<p></p>');
  });

  it('strips slot tags (self-closing)', () => {
    const source = '<div><slot /></div>';
    expect(extractHtmlFromAstro(source)).toBe('<div></div>');
  });

  it('strips slot tags (open/close)', () => {
    const source = '<div><slot name="header">Default</slot></div>';
    expect(extractHtmlFromAstro(source)).toBe('<div></div>');
  });

  it('strips Astro directives', () => {
    const source = '<Counter client:load set:html="test" />';
    expect(extractHtmlFromAstro(source)).toBe('<Counter />');
  });

  it('strips transition directives', () => {
    const source = '<div transition:animate="slide">Content</div>';
    expect(extractHtmlFromAstro(source)).toBe('<div>Content</div>');
  });

  it('strips style tags', () => {
    const source = '<div>Hello</div>\n<style>body { color: red; }</style>';
    expect(extractHtmlFromAstro(source)).toBe('<div>Hello</div>');
  });

  it('strips script tags', () => {
    const source = '<div>Hello</div>\n<script>console.log("hi")</script>';
    expect(extractHtmlFromAstro(source)).toBe('<div>Hello</div>');
  });

  it('collapses excessive newlines', () => {
    const source = '<div>A</div>\n\n\n\n\n<div>B</div>';
    expect(extractHtmlFromAstro(source)).toBe('<div>A</div>\n\n<div>B</div>');
  });

  it('handles combined frontmatter + expressions + directives', () => {
    const source = `---
const items = ['a', 'b'];
---
<ul client:visible>
  {items.map(i => <li>{i}</li>)}
</ul>`;
    const result = extractHtmlFromAstro(source);
    expect(result).not.toContain('---');
    expect(result).not.toContain('client:visible');
    expect(result).toContain('<ul');
    expect(result).toContain('</ul>');
  });

  it('returns empty string for frontmatter-only file', () => {
    const source = `---
export const prerender = true;
---`;
    expect(extractHtmlFromAstro(source)).toBe('');
  });
});

// ============================================================================
// stripAstroExpressions
// ============================================================================

describe('stripExpressionAttributes', () => {
  it('drops attr={expr} whole so the next attribute is not swallowed', () => {
    expect(stripExpressionAttributes(`<a class={p === "" ? "a" : "b"} href="/">W</a>`)).toBe(`<a href="/">W</a>`);
    expect(stripExpressionAttributes(`<X works={featured} class:list={[a, {b: c}]} />`)).toBe(`<X />`);
    expect(stripExpressionAttributes(`<p class="x">{y}</p>`)).toBe(`<p class="x">{y}</p>`);
  });
  it('extractHtmlFromAstro applies it', () => {
    expect(extractHtmlFromAstro(`<a class={c} href="/">W</a>`)).toBe(`<a href="/">W</a>`);
  });
});

describe('stripAstroExpressions', () => {
  it('strips simple expression', () => {
    expect(stripAstroExpressions('{foo}')).toBe('');
  });

  it('strips nested braces', () => {
    expect(stripAstroExpressions('{a{b{c}}}')).toBe('');
  });

  it('preserves non-brace content', () => {
    expect(stripAstroExpressions('hello {world} bye')).toBe('hello  bye');
  });

  it('handles multiple expressions', () => {
    expect(stripAstroExpressions('{a} text {b}')).toBe(' text ');
  });

  it('handles no expressions', () => {
    expect(stripAstroExpressions('<div>plain</div>')).toBe('<div>plain</div>');
  });

  it('handles unclosed brace gracefully', () => {
    const result = stripAstroExpressions('before {unclosed');
    expect(result).toBe('before ');
  });
});

// ============================================================================
// detectCommonPrefix
// ============================================================================

describe('detectCommonPrefix', () => {
  it('returns empty for empty array', () => {
    expect(detectCommonPrefix([])).toBe('');
  });

  it('returns empty when no common prefix', () => {
    expect(detectCommonPrefix(['a.ts', 'b.ts'])).toBe('');
  });

  it('returns empty when file has no slash', () => {
    expect(detectCommonPrefix(['file.txt'])).toBe('');
  });

  it('detects common root directory', () => {
    expect(detectCommonPrefix([
      'theme-v2/src/Hero.astro',
      'theme-v2/src/Footer.astro',
      'theme-v2/package.json',
    ])).toBe('theme-v2/');
  });

  it('returns empty when paths diverge at root', () => {
    expect(detectCommonPrefix([
      'src/Hero.astro',
      'lib/utils.ts',
    ])).toBe('');
  });

  it('only strips first directory level', () => {
    expect(detectCommonPrefix([
      'root/src/a.ts',
      'root/lib/b.ts',
    ])).toBe('root/');
  });
});

// ============================================================================
// isDocumentLevelFile
// ============================================================================

describe('isDocumentLevelFile', () => {
  it('detects <!doctype html>', () => {
    expect(isDocumentLevelFile('<!doctype html>\n<html>')).toBe(true);
  });

  it('detects <html> tag', () => {
    expect(isDocumentLevelFile('<html lang="en">')).toBe(true);
  });

  it('detects <head> tag', () => {
    expect(isDocumentLevelFile('<head>\n<title>Hi</title>\n</head>')).toBe(true);
  });

  it('returns false for component file', () => {
    expect(isDocumentLevelFile('<section class="hero">\n<h1>Hello</h1>\n</section>')).toBe(false);
  });

  it('ignores doctype in frontmatter', () => {
    const source = `---
// <!doctype html> is just a comment
---
<section>Content</section>`;
    expect(isDocumentLevelFile(source)).toBe(false);
  });

  it('detects html tag after frontmatter', () => {
    const source = `---
import Layout from './Layout.astro';
---
<html lang="en">
<body><slot /></body>
</html>`;
    expect(isDocumentLevelFile(source)).toBe(true);
  });
});

// ============================================================================
// isComponentPath
// ============================================================================

describe('isComponentPath', () => {
  it('returns true for component paths', () => {
    expect(isComponentPath('src/components/Hero.astro')).toBe(true);
  });

  it('rejects layouts directory', () => {
    expect(isComponentPath('src/layouts/Base.astro')).toBe(false);
  });

  it('rejects pages directory', () => {
    expect(isComponentPath('src/pages/index.astro')).toBe(false);
  });

  it('case insensitive rejection', () => {
    expect(isComponentPath('src/Layouts/Base.astro')).toBe(false);
    expect(isComponentPath('src/PAGES/index.astro')).toBe(false);
  });

  it('returns true for root-level files', () => {
    expect(isComponentPath('Hero.astro')).toBe(true);
  });
});

// ============================================================================
// isPageFile
// ============================================================================

describe('isPageFile', () => {
  it('detects pages directory', () => {
    expect(isPageFile('src/pages/index.astro')).toBe(true);
  });

  it('returns false for component path', () => {
    expect(isPageFile('src/components/Hero.astro')).toBe(false);
  });

  it('case insensitive', () => {
    expect(isPageFile('src/Pages/about.astro')).toBe(true);
    expect(isPageFile('src/PAGES/about.astro')).toBe(true);
  });

  it('detects nested pages', () => {
    expect(isPageFile('src/pages/blog/post.astro')).toBe(true);
  });
});

// ============================================================================
// extractSectionsFromPage
// ============================================================================

describe('extractSectionsFromPage', () => {
  it('extracts single section', () => {
    const source = '<section class="hero"><h1>Welcome</h1></section>';
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Welcome');
    expect(result[0].html).toContain('<section');
  });

  it('extracts multiple sections', () => {
    const source = `
<section><h1>Hero</h1></section>
<section><h2>Features</h2></section>
<section><h3>Contact</h3></section>`;
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Hero');
    expect(result[1].name).toBe('Features');
    expect(result[2].name).toBe('Contact');
  });

  it('strips frontmatter before extraction', () => {
    const source = `---
import Layout from '../layouts/Layout.astro';
---
<section><h1>Hello</h1></section>`;
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result).toHaveLength(1);
    expect(result[0].html).not.toContain('---');
  });

  it('falls back to Section N naming', () => {
    const source = '<section><p>No heading here</p></section>';
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result[0].name).toBe('Section 1');
  });

  it('strips editor attributes from extracted HTML', () => {
    const source = '<section data-sq-source="test" data-key="k"><h1>Title</h1></section>';
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result[0].html).not.toContain('data-sq-source');
    expect(result[0].html).not.toContain('data-key');
  });

  it('generates correct path from page name', () => {
    const source = '<section><h1>Hero</h1></section>';
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result[0].path).toBe('index/Hero.astro');
  });

  it('returns empty array for page without sections', () => {
    const source = '<div><p>Not a section</p></div>';
    const result = extractSectionsFromPage(source, 'pages/index.astro');
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// stripEditorAttributes
// ============================================================================

describe('stripEditorAttributes', () => {
  it('strips data-sq-source', () => {
    expect(stripEditorAttributes('<div data-sq-source="src/Hero.astro:5:1">')).toBe('<div>');
  });

  it('strips data-key', () => {
    expect(stripEditorAttributes('<div data-key="el-123">')).toBe('<div>');
  });

  it('strips data-with-props', () => {
    expect(stripEditorAttributes("<div data-with-props='{\"a\":1}'>")).toBe('<div>');
  });

  it('strips contenteditable', () => {
    expect(stripEditorAttributes("<p contenteditable='true'>Text</p>")).toBe('<p>Text</p>');
  });

  it('strips multiple attributes at once', () => {
    const html = '<section data-sq-source="test" data-key="k1" data-with-props=\'{}\'>';
    const result = stripEditorAttributes(html);
    expect(result).toBe('<section>');
  });
});

// ============================================================================
// extractSectionName
// ============================================================================

describe('extractSectionName', () => {
  it('extracts from h1', () => {
    expect(extractSectionName('<section><h1>Hero Title</h1></section>', 0)).toBe('Hero Title');
  });

  it('extracts from h2', () => {
    expect(extractSectionName('<section><h2>Features</h2></section>', 0)).toBe('Features');
  });

  it('extracts from h3', () => {
    expect(extractSectionName('<section><h3>Contact Us</h3></section>', 0)).toBe('Contact Us');
  });

  it('strips nested HTML from heading', () => {
    expect(extractSectionName('<section><h1><span>Bold</span> Title</h1></section>', 0)).toBe('Bold Title');
  });

  it('truncates to 4 words', () => {
    expect(extractSectionName('<section><h1>One Two Three Four Five Six</h1></section>', 0))
      .toBe('One Two Three Four');
  });

  it('falls back to Section N', () => {
    expect(extractSectionName('<section><p>No heading</p></section>', 0)).toBe('Section 1');
    expect(extractSectionName('<section><p>No heading</p></section>', 2)).toBe('Section 3');
  });

  it('falls back when heading is empty', () => {
    expect(extractSectionName('<section><h1>   </h1></section>', 0)).toBe('Section 1');
  });
});

// ============================================================================
// extractImports
// ============================================================================

describe('extractImports', () => {
  it('extracts named imports', () => {
    const source = "import { Button } from '../components/Button.astro';";
    expect(extractImports(source)).toEqual(["../components/Button.astro"]);
  });

  it('extracts default imports', () => {
    const source = "import Layout from '../layouts/Layout.astro';";
    expect(extractImports(source)).toEqual(["../layouts/Layout.astro"]);
  });

  it('extracts side-effect imports', () => {
    const source = "import './styles.css';";
    expect(extractImports(source)).toEqual(["./styles.css"]);
  });

  it('extracts multiple imports', () => {
    const source = `import A from './A.astro';
import B from './B.astro';
import './global.css';`;
    expect(extractImports(source)).toEqual(['./A.astro', './B.astro', './global.css']);
  });

  it('returns empty array for no imports', () => {
    expect(extractImports('<div>Hello</div>')).toEqual([]);
  });

  it('handles package imports', () => {
    const source = "import { motion } from 'framer-motion';";
    expect(extractImports(source)).toEqual(['framer-motion']);
  });
});

// ============================================================================
// getExtension
// ============================================================================

describe('getExtension', () => {
  it('extracts .astro', () => {
    expect(getExtension('Hero.astro')).toBe('.astro');
  });

  it('extracts .ts from nested path', () => {
    expect(getExtension('src/utils/helpers.ts')).toBe('.ts');
  });

  it('returns empty for no extension', () => {
    expect(getExtension('Makefile')).toBe('');
  });

  it('lowercases extension', () => {
    expect(getExtension('photo.PNG')).toBe('.png');
  });

  it('handles double extensions (gets last)', () => {
    expect(getExtension('file.test.ts')).toBe('.ts');
  });
});

// ============================================================================
// extractComponentName
// ============================================================================

describe('extractComponentName', () => {
  it('extracts name from simple path', () => {
    expect(extractComponentName('Hero.astro')).toBe('Hero');
  });

  it('extracts name from nested path', () => {
    expect(extractComponentName('src/components/Hero.astro')).toBe('Hero');
  });

  it('handles path without extension', () => {
    expect(extractComponentName('src/utils/helpers')).toBe('helpers');
  });

  it('handles bare filename', () => {
    expect(extractComponentName('Button')).toBe('Button');
  });
});

// ============================================================================
// processThemeZip — integration + security
// ============================================================================

describe('processThemeZip', () => {
  it('processes a simple theme with one component', async () => {
    const zip = new JSZip();
    zip.file('Hero.astro', '<section><h1>Hello</h1></section>');

    const file = await zipToFile(zip);
    const result = await processThemeZip(file);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('Hero.astro');
    expect(result.files[0].isText).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('Hero');
  });

  it('strips common root directory prefix', async () => {
    const zip = new JSZip();
    zip.file('my-theme/src/Hero.astro', '<div>Hero</div>');
    zip.file('my-theme/src/Footer.astro', '<footer>Footer</footer>');

    const file = await zipToFile(zip);
    const result = await processThemeZip(file);

    expect(result.files[0].path).toBe('src/Hero.astro');
    expect(result.files[1].path).toBe('src/Footer.astro');
  });

  it('extracts page sections as separate components', async () => {
    const zip = new JSZip();
    zip.file('src/pages/index.astro', `---
import Layout from '../layouts/Layout.astro';
---
<section><h1>Hero</h1></section>
<section><h2>Features</h2></section>`);

    const file = await zipToFile(zip);
    const result = await processThemeZip(file);

    expect(result.components).toHaveLength(2);
    expect(result.components[0].name).toBe('Hero');
    expect(result.components[1].name).toBe('Features');
  });

  it('skips document-level files', async () => {
    const zip = new JSZip();
    zip.file('src/layouts/Base.astro', `---
---
<html lang="en"><head></head><body><slot /></body></html>`);
    zip.file('src/components/Hero.astro', '<section><h1>Hello</h1></section>');

    const file = await zipToFile(zip);
    const result = await processThemeZip(file);

    // Base.astro is in layouts/ (rejected by isComponentPath) AND is document-level
    // Hero.astro is a valid component
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('Hero');
  });

  it('skips disallowed file extensions', async () => {
    const zip = new JSZip();
    zip.file('Hero.astro', '<div>Hero</div>');
    zip.file('malware.exe', 'bad');
    zip.file('script.sh', 'echo hi');

    const file = await zipToFile(zip);
    const result = await processThemeZip(file);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('Hero.astro');
  });

  it('includes allowed binary files', async () => {
    const zip = new JSZip();
    zip.file('image.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    zip.file('font.woff2', new Uint8Array([0x00]));

    const file = await zipToFile(zip);
    const result = await processThemeZip(file);

    expect(result.files).toHaveLength(2);
    expect(result.files.find(f => f.path === 'image.png')!.isText).toBe(false);
    expect(result.files.find(f => f.path === 'font.woff2')!.isText).toBe(false);
  });

  // Security tests
  describe('security', () => {
    // NOTE: JSZip normalizes paths containing '..' when creating entries,
    // so we can't test path traversal rejection through JSZip-created ZIPs.
    // The defense in processThemeZip guards against malformed ZIPs created
    // by other tools that don't normalize paths.

    it('rejects too many files', async () => {
      const zip = new JSZip();
      for (let i = 0; i < 501; i++) {
        zip.file(`file-${i}.txt`, `content ${i}`);
      }

      const file = await zipToFile(zip);
      await expect(processThemeZip(file)).rejects.toThrow('Too many files (501). Maximum is 500.');
    });

    it('rejects oversized uncompressed content', async () => {
      const zip = new JSZip();
      // Create a file just over the 50MB limit
      // A string of 'A' repeated compresses well but uncompresses to 51MB
      const largeContent = 'A'.repeat(51 * 1024 * 1024);
      zip.file('large.txt', largeContent);

      const file = await zipToFile(zip);
      await expect(processThemeZip(file)).rejects.toThrow('Uncompressed size exceeds 50MB limit.');
    }, 30000);
  });
});
