/**
 * Delete-a-layout, LOCAL half: the layout's whole Astro document is inlined
 * into every direct importer. Pure functions, so every case in the design's §6
 * ledger is a unit test.
 *
 * Design: docs/plans/2026-08-25-delete-layout-design.md §4.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
import {
  splitFrontmatter, rewriteRelativeImports, materializeProps, spliceChildrenBySlot,
  attrsToLiteralBody, inlineLayoutIntoImporter,
} from '../../../../../preview-template/src/plugins/sq-inline-layout.js';

describe('splitFrontmatter', () => {
  it('splits on the fences and keeps the template verbatim', () => {
    const { frontmatter, template } = splitFrontmatter("---\nconst a = 1;\n---\n<div>x</div>\n");
    expect(frontmatter).toBe('const a = 1;');
    expect(template).toBe('<div>x</div>\n');
  });
  it('returns an empty frontmatter when there are no fences', () => {
    expect(splitFrontmatter('<div/>').frontmatter).toBe('');
  });
});

describe('rewriteRelativeImports', () => {
  // A layout at src/layouts/ inlined into src/pages/blog/index.astro is one
  // directory deeper — every relative specifier has to move with it (C9).
  it('re-points a specifier for the importer depth', () => {
    const out = rewriteRelativeImports(
      "import '../styles/global.css';\nimport Header from '../components/Header.astro';",
      'src/layouts', 'src/pages/blog',
    );
    expect(out).toContain("'../../styles/global.css'");
    expect(out).toContain("'../../components/Header.astro'");
  });
  it('leaves bare and aliased specifiers alone', () => {
    const src = "import x from 'astro:content';\nimport y from '@lib/y';";
    expect(rewriteRelativeImports(src, 'src/layouts', 'src/pages/blog')).toBe(src);
  });
  it('is a no-op at the same depth', () => {
    const src = "import '../styles/a.css';";
    expect(rewriteRelativeImports(src, 'src/layouts', 'src/pages')).toBe(src);
  });
});

// Every `kind` the compiler emits, pinned against a REAL parse below so this
// mapping cannot silently drift from what the parser actually reports.
describe('attrsToLiteralBody', () => {
  const body = (attrs: Parameters<typeof attrsToLiteralBody>[0]) => attrsToLiteralBody(attrs);

  it('maps each attribute kind to its literal form', () => {
    expect(body([
      { kind: 'quoted', name: 'title', value: 'About' },
      { kind: 'expression', name: 'n', value: '1 + 2' },
      { kind: 'empty', name: 'flag', value: '' },
      { kind: 'spread', name: 'rest', value: '' },
      { kind: 'shorthand', name: 'title', value: '' },
      { kind: 'template-literal', name: 'tpl', value: 'hi' },
    ])).toBe('title: "About", n: (1 + 2), flag: true, ...rest, title, tpl: `hi`');
  });

  it('is empty when the call site passes nothing', () => {
    expect(body([])).toBe('');
  });

  // `data-x: "q"` is not a valid identifier key — unquoted it would not parse.
  it('quotes a name that is not a JS identifier', () => {
    expect(body([{ kind: 'quoted', name: 'data-x', value: 'q' }])).toBe('"data-x": "q"');
  });

  it('escapes a quoted value rather than splicing it raw', () => {
    expect(body([{ kind: 'quoted', name: 't', value: 'a"b' }])).toBe('t: "a\\"b"');
  });

  it('reads the kinds off a REAL parse, not a hand-written fixture', async () => {
    const src = "---\n---\n<L title=\"About\" n={1+2} flag {...rest} {title} tpl=`hi` data-x='q'></L>\n";
    const { ast } = await parse(src, { position: true });
    const find = (n: { type?: string; name?: string; children?: unknown[] }): never =>
      (n?.type === 'component' && n.name === 'L' ? n : (n?.children ?? []).reduce<unknown>((a, c) => a ?? find(c as never), null)) as never;
    const node = find(ast as never) as unknown as { attributes: Parameters<typeof attrsToLiteralBody>[0] };
    expect(body(node.attributes))
      .toBe('title: "About", n: (1+2), flag: true, ...rest, title, tpl: `hi`, "data-x": "q"');
  });
});

describe('materializeProps', () => {
  // One substitution keeps defaults, renames and destructuring working without
  // analysing a single prop (design §4 step 5).
  it('replaces Astro.props with the call-site literal', () => {
    expect(materializeProps("const { title = 'L1' } = Astro.props;", '{ title: "About" }'))
      .toBe(`const { title = 'L1' } = { title: "About" };`);
  });
  it('replaces every occurrence, including Astro.props.x', () => {
    expect(materializeProps('const t = Astro.props.title;', '{ title: "A" }'))
      .toBe('const t = ({ title: "A" }).title;');
  });
});

describe('spliceChildrenBySlot', () => {
  it('fills the default slot', () => {
    expect(spliceChildrenBySlot('<main><slot /></main>', [{ slot: '', source: '<h1>Hi</h1>' }]))
      .toBe('<main><h1>Hi</h1></main>');
  });
  it('routes a named child and drops the slot attribute (C8)', () => {
    const out = spliceChildrenBySlot(
      '<aside><slot name="side" /></aside><main><slot /></main>',
      [{ slot: 'side', source: '<nav slot="side">n</nav>' }, { slot: '', source: '<p>b</p>' }],
    );
    expect(out).toBe('<aside><nav>n</nav></aside><main><p>b</p></main>');
  });
  it('keeps the fallback when nothing fills the slot (C6)', () => {
    expect(spliceChildrenBySlot('<main><slot>empty</slot></main>', []))
      .toBe('<main>empty</main>');
  });
  it('copies child bytes verbatim, never re-indenting', () => {
    const child = '<pre>\n  keep\n    me\n</pre>';
    expect(spliceChildrenBySlot('<main><slot /></main>', [{ slot: '', source: child }]))
      .toContain(child);
  });
});

// ── The parts that run the real parser ───────────────────────────────────

const LAYOUT = `---
import '../styles/global.css';
interface Props { title?: string; }
const { title = 'Layout1' } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <title>{title}</title>
  </head>
  <body>
    <slot />
    <script is:inline src="/scripts/bridge.js"></script>
  </body>
</html>
`;

async function inline(importerSource: string, importerRelDir = 'src/pages/blog', layoutSource = LAYOUT) {
  return inlineLayoutIntoImporter({
    layoutSource, layoutName: 'Foo', layoutRelDir: 'src/layouts',
    importerSource, importerRelDir,
    parse: parse as never,
  });
}

describe('inlineLayoutIntoImporter', () => {
  it('produces a standalone document: head, styles and bridge script survive', async () => {
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\n---\n<Foo title=\"About\"><h1>Hi</h1></Foo>\n");
    expect('error' in r).toBe(false);
    const out = (r as { content: string }).content;
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<title>{title}</title>');
    expect(out).toContain('/scripts/bridge.js');
    // C9: src/layouts/../styles → src/styles, reached from src/pages/blog.
    expect(out).toContain("import '../../styles/global.css';");
    // Props materialized from the call site, default kept working.
    expect(out).toContain(`const { title = 'Layout1' } = { title: "About" };`);
    // Children spliced at the slot, verbatim.
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).not.toContain('<slot');
  });

  it('drops the layout import from the importer frontmatter', async () => {
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\nconst x = 1;\n---\n<Foo><p>b</p></Foo>\n");
    const out = (r as { content: string }).content;
    expect(out).not.toContain('layouts/Foo.astro');
    // Everything else the importer declared survives.
    expect(out).toContain('const x = 1;');
  });

  it('refuses a file that uses the layout twice (C7)', async () => {
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\n---\n<Foo><p>a</p></Foo>\n<Foo><p>b</p></Foo>\n");
    expect('error' in r && r.error).toMatch(/more than once/);
  });

  it('handles a self-closing usage with no children (C6)', async () => {
    // The self-closing node reports NO position.end and starts one byte late —
    // both confirmed against the pinned @astrojs/compiler.
    const layout = "---\n---\n<main><slot>empty</slot></main>\n";
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\n---\n<Foo />\n", 'src/pages/blog', layout);
    const out = (r as { content: string }).content;
    expect(out).toContain('<main>empty</main>');
    expect(out).not.toContain('<Foo');
  });

  it('matches a COMPONENT node, not an element node', async () => {
    // Astro splits `element` (lowercase) from `component` (PascalCase); a
    // walker matching only `element` finds nothing here.
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\n---\n<Foo><span>x</span></Foo>\n");
    expect('error' in r).toBe(false);
    expect((r as { content: string }).content).toContain('<span>x</span>');
  });

  it('routes a named-slot child and keeps content outside the usage', async () => {
    const layout = "---\n---\n<aside><slot name=\"side\" /></aside><main><slot /></main>\n";
    const r = await inline(
      "---\nimport Foo from '../../layouts/Foo.astro';\n---\n<Foo><nav slot=\"side\">n</nav><p>b</p></Foo>\n",
      'src/pages/blog', layout,
    );
    const out = (r as { content: string }).content;
    expect(out).toContain('<aside><nav>n</nav></aside>');
    expect(out).toContain('<p>b</p>');
  });

  // A DEAD import must not block the delete: refusing would let one stray
  // import make a layout undeletable, and leaving it breaks the route the
  // moment the file is gone.
  it('drops a dead import instead of refusing', async () => {
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\nconst x = 1;\n---\n<div>plain</div>\n");
    expect('error' in r).toBe(false);
    const out = (r as { content: string }).content;
    expect(out).not.toContain('layouts/Foo.astro');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('<div>plain</div>');
    // The layout's own document is NOT pulled in — nothing rendered it.
    expect(out).not.toContain('<!doctype html>');
  });

  it('leaves a file with a lone dead import with no frontmatter at all', async () => {
    const r = await inline("---\nimport Foo from '../../layouts/Foo.astro';\n---\n<div>plain</div>\n");
    expect((r as { content: string }).content).toBe('<div>plain</div>\n');
  });
});
