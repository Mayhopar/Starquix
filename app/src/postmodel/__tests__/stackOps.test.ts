import { describe, it, expect } from 'vitest';
import { bindImport, parsePostBody, serializePostDoc, insertBlock } from '../postModel';
import { mdxCompiles } from '../compileGate';
import { rowBlock, columnBlock } from '../stackOps';

const STACK = '../../components/sq/Stack.astro';
const MEDIA = '../../components/sq/Media.astro';

describe('layout builders + bindImport', () => {
  it('text-image row with both imports compiles and re-parses as an editable stack', async () => {
    let doc = parsePostBody('One.\n');
    const s = bindImport(doc, 'Stack', STACK); doc = s.doc;
    const m = bindImport(doc, 'Media', MEDIA); doc = m.doc;
    doc = insertBlock(doc, doc.blocks.length, rowBlock(s.localName, 'text-image', m.localName));
    const text = serializePostDoc(doc);
    expect(text).toBe(`import Stack from '${STACK}';\nimport Media from '${MEDIA}';\n\nOne.\n\n<Stack direction="row">\n<div>\n\n</div>\n<div>\n\n<Media items={[null]} />\n\n</div>\n</Stack>\n`);
    expect(await mdxCompiles(text)).toEqual({ ok: true });
    expect(parsePostBody(text).blocks.some(b => b.kind === 'stack')).toBe(true);
  });

  it('bindImport reuses an existing import of the same path; a taken name gets a suffix', () => {
    const doc = parsePostBody(`import Stack from '${STACK}';\n\nx\n`);
    expect(bindImport(doc, 'Stack', STACK)).toMatchObject({ localName: 'Stack', at: null });
    expect(bindImport(doc, 'Stack', './mine/Stack.astro').localName).toBe('Stack1');
  });

  it('colored column carries its attrs', async () => {
    const doc = insertBlock(bindImport(parsePostBody('A.\n'), 'Stack', STACK).doc, 2, columnBlock('Stack', { class: 'bg-[#000000] text-white', text: 'auto' }));
    const text = serializePostDoc(doc);
    expect(text).toContain('<Stack class="bg-[#000000] text-white" text="auto">\n\n</Stack>');
    expect(await mdxCompiles(text)).toEqual({ ok: true });
  });
});
