/**
 * Mutation behavior — each case is a confirmed review finding as a fixture.
 * Only the dirty block re-stringifies; neighbors emit their original slices.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Paragraph, Heading } from 'mdast';
import {
  parsePostBody,
  serializePostDoc,
  insertBlock,
  makeParagraphBlock,
  gcUnusedImports,
  insertComponent,
  type PostDoc,
} from '../postModel';
import { mdxCompiles } from '../compileGate';

const corpus = (name: string) => readFileSync(join(__dirname, 'corpus', name), 'utf8');

/** Replace text in every text node of a block's mdast and mark it dirty. */
function editBlockText(doc: PostDoc, index: number, find: string, replace: string) {
  const block = doc.blocks[index];
  if (!('mdast' in block)) throw new Error('not an editable block');
  const walk = (node: { value?: string; children?: unknown[] }) => {
    if (typeof node.value === 'string') node.value = node.value.replace(find, replace);
    for (const child of node.children ?? []) walk(child as { value?: string });
  };
  walk(block.mdast as Paragraph);
  block.dirty = true;
}

describe('postModel mutations', () => {
  it('editing the last paragraph does not duplicate or reorder the footnote definition (finding 1)', () => {
    const doc = parsePostBody(corpus('footnote.txt'));
    const last = doc.blocks.length - 1;
    editBlockText(doc, last, 'Last paragraph.', 'Last paragraph edited.');
    const out = serializePostDoc(doc);
    expect(out.match(/\[\^1\]:/g)).toHaveLength(1);
    expect(out.indexOf('[^1]: The footnote text.')).toBeLessThan(out.indexOf('Last paragraph edited.'));
    expect(out).toContain('Text with a note.[^1]');
  });

  it('editing a setext heading keeps it a heading (finding: setext demotion)', () => {
    const doc = parsePostBody(corpus('setext.txt'));
    editBlockText(doc, 0, 'My Heading', 'My New Heading');
    const out = serializePostDoc(doc);
    const headingLine = out.split('\n')[0];
    const isAtx = /^#{1,2} My New Heading$/.test(headingLine);
    const isSetext = headingLine === 'My New Heading' && /^[=-]+$/.test(out.split('\n')[1]);
    expect(isAtx || isSetext).toBe(true);
    expect((doc.blocks[0] as { mdast: Heading }).mdast.type).toBe('heading');
    expect(out).toContain('Body para.');
  });

  it('editing after a hard break keeps the two-space break (finding: hard-break corruption)', () => {
    const doc = parsePostBody(corpus('hardbreak.txt'));
    editBlockText(doc, 0, 'beta', 'betaX');
    expect(serializePostDoc(doc)).toBe('alpha  \nbetaX');
  });

  it('inserting a paragraph before the first block keeps a blank-line separator (draft-merge finding)', () => {
    const doc = parsePostBody('First.\n\nSecond.');
    const out = serializePostDoc(insertBlock(doc, 0, makeParagraphBlock('New.')));
    expect(out).toBe('New.\n\nFirst.\n\nSecond.');
  });

  it(".md format: raw HTML round-trips as passthrough (remark-mdx would throw on <br>)", () => {
    const src = 'Line one<br>\n\nSecond para.';
    expect(() => parsePostBody(src)).toThrow();
    const doc = parsePostBody(src, 'md');
    expect(serializePostDoc(doc)).toBe(src);
  });

  it('inserting into an empty body produces just the paragraph', () => {
    const doc = parsePostBody('');
    const out = serializePostDoc(insertBlock(doc, 0, makeParagraphBlock('Hello.')));
    expect(out).toBe('Hello.\n');
  });
});

describe('insertComponent', () => {
  const MEDIA = {
    name: 'Media',
    importPath: '../../components/Media.astro',
    markup: (n: string) => `<${n} items={[null]} class="col-span-8" />`,
  };

  it('finding 7: an existing NAMED import of the same name forces Media1', async () => {
    const doc = parsePostBody("import { Media } from './lib'\n\nProse.");
    const { doc: out, localName } = insertComponent(doc, 2, MEDIA);
    expect(localName).toBe('Media1');
    const body = serializePostDoc(out);
    expect(body).toContain("import Media1 from '../../components/Media.astro';");
    expect(body).toContain('<Media1 items={[null]} class="col-span-8" />');
    expect((await mdxCompiles(body)).ok).toBe(true);
  });

  it('finding 8: an import inside a fence neither reuses nor collides', async () => {
    const doc = parsePostBody("```js\nimport Media from './fake'\n```\n\nProse.");
    const { doc: out, localName } = insertComponent(doc, 2, MEDIA);
    expect(localName).toBe('Media');
    const body = serializePostDoc(out);
    expect(body).toContain("import Media from '../../components/Media.astro';");
    // the fence is untouched, byte-for-byte
    expect(body).toContain("```js\nimport Media from './fake'\n```");
    expect((await mdxCompiles(body)).ok).toBe(true);
  });

  it('an existing default import of the SAME path is reused, whatever its name', async () => {
    const doc = parsePostBody("import Pic from '../../components/Media.astro';\n\nProse.");
    const { doc: out, localName } = insertComponent(doc, 2, MEDIA);
    expect(localName).toBe('Pic');
    const body = serializePostDoc(out);
    expect(body.match(/^import /gm)).toHaveLength(1); // no second import
    expect(body).toContain('<Pic items={[null]} class="col-span-8" />');
    expect((await mdxCompiles(body)).ok).toBe(true);
  });

  it('empty body: import above, component below, blank-line separated', async () => {
    const doc = parsePostBody('');
    const { doc: out } = insertComponent(doc, 0, MEDIA);
    const body = serializePostDoc(out);
    expect(body).toBe(
      "import Media from '../../components/Media.astro';\n\n<Media items={[null]} class=\"col-span-8\" />\n",
    );
    expect((await mdxCompiles(body)).ok).toBe(true);
  });

  it('insert before the first block keeps the import on top and a blank line below it', async () => {
    const doc = parsePostBody('First paragraph.\n\nSecond.');
    const { doc: out } = insertComponent(doc, 0, MEDIA);
    const body = serializePostDoc(out);
    expect(body).toBe(
      "import Media from '../../components/Media.astro';\n\n<Media items={[null]} class=\"col-span-8\" />\n\nFirst paragraph.\n\nSecond.",
    );
    expect((await mdxCompiles(body)).ok).toBe(true);
  });

  it('groups the new import with an existing import block (single newline)', async () => {
    const doc = parsePostBody("import A from './a.astro';\n\nProse.");
    const { doc: out } = insertComponent(doc, 2, MEDIA);
    const body = serializePostDoc(out);
    expect(body).toContain("import A from './a.astro';\nimport Media from '../../components/Media.astro';");
    expect((await mdxCompiles(body)).ok).toBe(true);
  });
});

describe('gcUnusedImports', () => {
  const TWO_MEDIA =
    "import DoubleImage from './DoubleImage.astro';\nimport SingleImage from './SingleImage.astro';\n\n<DoubleImage src1=\"a\" />\n\n<DoubleImage src1=\"b\" />\n\n<SingleImage src=\"c\" />\n\nProse.";

  it('deleting one of two <DoubleImage>s keeps the import', () => {
    const original = parsePostBody(TWO_MEDIA);
    const doc = { ...original, blocks: original.blocks.filter((_, i) => i !== 1) }; // drop first DoubleImage
    const out = serializePostDoc(gcUnusedImports(doc, original));
    expect(out).toContain("import DoubleImage from './DoubleImage.astro';");
    expect(out.match(/<DoubleImage/g)).toHaveLength(1);
  });

  it('deleting the last usage drops exactly that import line', () => {
    const original = parsePostBody(TWO_MEDIA);
    // remove BOTH DoubleImage components
    const doc = {
      ...original,
      blocks: original.blocks.filter(b => !(b.kind === 'component' && b.name === 'DoubleImage')),
    };
    const out = serializePostDoc(gcUnusedImports(doc, original));
    expect(out).not.toContain('DoubleImage');
    expect(out).toContain("import SingleImage from './SingleImage.astro';");
    expect(out).toContain('<SingleImage src="c" />');
  });

  it('a name still referenced by a fence keeps its import (timepad case)', () => {
    const src =
      "import SingleImage from './SingleImage.astro';\n\n<SingleImage src=\"c\" />\n\n```js\n<SingleImage src=\"x\" />\n```";
    const original = parsePostBody(src);
    const doc = {
      ...original,
      blocks: original.blocks.filter(b => b.kind !== 'component'),
    };
    const out = serializePostDoc(gcUnusedImports(doc, original));
    expect(out).toContain("import SingleImage from './SingleImage.astro';");
  });

  it('an untouched doc is untouched (identity, byte-for-byte)', () => {
    const original = parsePostBody(TWO_MEDIA);
    expect(serializePostDoc(gcUnusedImports(original, original))).toBe(TWO_MEDIA);
  });

  it('an ESM block that becomes all-dead is removed entirely', () => {
    const src = "import OnlyOne from './OnlyOne.astro';\n\n<OnlyOne />\n\nProse.";
    const original = parsePostBody(src);
    const doc = { ...original, blocks: original.blocks.filter(b => b.kind !== 'component') };
    const out = serializePostDoc(gcUnusedImports(doc, original));
    expect(out).not.toContain('OnlyOne');
    expect(out).toContain('Prose.');
  });
});
