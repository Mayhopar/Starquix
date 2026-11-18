import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePostBody, serializePostDoc, makeParagraphBlock, gcUnusedImports, type StackBlock, type PostBlock } from '../postModel';
import { mdxCompiles } from '../compileGate';
import { componentAtLine } from '@/core/postmedia/saveMediaEdit';

const corpus = (n: string) => readFileSync(join(__dirname, 'corpus', n), 'utf8');
const stacks = (blocks: PostBlock[]) => blocks.filter((b): b is StackBlock => b.kind === 'stack');

describe('PostDoc stack block', () => {
  it('parses a row into one stack with two slots of the right kinds', () => {
    const doc = parsePostBody(corpus('stack-row.txt'));
    const [s] = stacks(doc.blocks);
    expect(s).toMatchObject({ direction: 'row', attrs: { ratio: '1:2' }, name: 'Stack' });
    expect(s.slots.map(sl => sl.map(b => b.kind))).toEqual([['paragraph', 'paragraph'], ['component']]);
    expect(s.head).toBe('<Stack direction="row" ratio="1:2">\n<div>');
    expect(s.between).toBe('\n\n</div>\n<div>');
    expect(s.tail).toBe('\n\n</div>\n</Stack>');
  });

  it('nested: column holds a row; its children classified recursively', () => {
    const doc = parsePostBody(corpus('stack-nested.txt'));
    const [col] = stacks(doc.blocks);
    expect(col.direction).toBe('column');
    expect(col.attrs).toEqual({ width: 'edge', class: 'bg-[#1f3a2e] text-white', text: 'auto' });
    expect(col.slots[0].map(b => b.kind)).toEqual(['paragraph', 'stack', 'paragraph']);
    const row = col.slots[0][1] as StackBlock;
    expect(row.slots.map(sl => sl.map(b => b.kind))).toEqual([['heading', 'list'], ['component']]);
  });

  it('deep nesting / expression attrs / unbound Stack → passthrough (P6)', () => {
    const deep = parsePostBody(corpus('stack-deep-passthrough.txt'));
    const [outer] = stacks(deep.blocks);
    expect(outer.slots[0].map(b => b.kind)).toEqual(['paragraph', 'passthrough']);
    expect(stacks(parsePostBody(corpus('stack-expression-attr.txt')).blocks)).toHaveLength(0);
    expect(stacks(parsePostBody('<Stack>\n\nx\n\n</Stack>\n').blocks)).toHaveLength(0); // no import → not ours
    const theirs = "import Stack from '../../components/Stack.astro';\n\n<Stack>\n\nx\n\n</Stack>\n";
    expect(stacks(parsePostBody(theirs).blocks)).toHaveLength(0);
  });

  it('editing a child re-stringifies only that child; head/tail bytes identical', async () => {
    const src = corpus('stack-row.txt');
    const doc = parsePostBody(src);
    const s = stacks(doc.blocks)[0];
    s.slots[0][1] = { ...makeParagraphBlock('Changed.'), gapBefore: s.slots[0][1].gapBefore };
    const out = serializePostDoc(doc);
    expect(out).toBe(src.replace('Second paragraph.', 'Changed.'));
    expect(await mdxCompiles(out)).toEqual({ ok: true });
  });

  it('dirty attrs rewrite only the tags; children bytes identical', async () => {
    const src = corpus('stack-row.txt');
    const doc = parsePostBody(src);
    const s = stacks(doc.blocks)[0];
    s.attrs = { ...s.attrs, ratio: '2:1' };
    s.dirty = true;
    const out = serializePostDoc(doc);
    expect(out).toBe(src.replace('ratio="1:2"', 'ratio="2:1"'));
    expect(await mdxCompiles(out)).toEqual({ ok: true });
  });

  it('empty slot round-trips and survives regeneration', async () => {
    const src = "import Stack from '../../components/sq/Stack.astro';\n\n<Stack direction=\"row\">\n<div>\n</div>\n<div>\n\nB\n\n</div>\n</Stack>\n";
    const doc = parsePostBody(src);
    expect(serializePostDoc(doc)).toBe(src);
    const s = stacks(doc.blocks)[0];
    expect(s.slots[0]).toEqual([]);
    s.dirty = true;
    const out = serializePostDoc(doc);
    expect(out).toContain('<div>\n\n</div>\n<div>\n\nB\n\n</div>');
    expect(await mdxCompiles(out)).toEqual({ ok: true });
  });

  it('CRLF body round-trips with a stack', () => {
    const src = corpus('stack-row.txt').replace(/\n/g, '\r\n');
    expect(serializePostDoc(parsePostBody(src))).toBe(src);
  });

  it('componentAtLine finds a Media inside a row inside a column', () => {
    const src = corpus('stack-nested.txt');
    const line = src.split('\n').findIndex(l => l.startsWith('<Media')) + 1;
    expect(componentAtLine(parsePostBody(src), line)?.name).toBe('Media');
  });

  it('removing the last stack GCs the Stack import', () => {
    const src = corpus('stack-column-colored.txt');
    const original = parsePostBody(src);
    const doc = { ...original, blocks: original.blocks.filter(b => b.kind !== 'stack') };
    expect(serializePostDoc(gcUnusedImports(doc, original))).not.toContain('import Stack');
  });
});

describe('D3 nesting', () => {
  it('a row inside a row slot stays passthrough', () => {
    const src = "import Stack from '../../components/sq/Stack.astro';\n\n<Stack direction=\"row\">\n<div>\n\n<Stack direction=\"row\">\n<div>\n\na\n\n</div>\n<div>\n\nb\n\n</div>\n</Stack>\n\n</div>\n<div>\n\nc\n\n</div>\n</Stack>\n";
    const doc = parsePostBody(src);
    const [row] = stacks(doc.blocks);
    expect(row.slots[0].map(b => b.kind)).toEqual(['passthrough']);
    expect(serializePostDoc(doc)).toBe(src);
  });
});
