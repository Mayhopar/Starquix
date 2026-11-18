import { describe, it, expect } from 'vitest';
import { overrideChain, sharedChain, planOverride } from '../propOverrides';
import { LIB_BLOG_SLOT, lineOf, TWO_SLOTS } from './fixtures/lists';

const HEADER = `---
---
<header class="w-full">
  <ul class="flex p-6">
    <li>Works</li>
  </ul>
</header>
`;
const MAIN = `---
import Header from '../components/Header.astro';
const { title } = Astro.props;
---
<body>
  <Header />
  <slot />
</body>
`;
const PAGE = `---
import Layout from '../layouts/Main.astro';
---
<Layout title="Works">
  <p>hi</p>
</Layout>
`;
const loc = (file: string, line: number, column: number) => ({ file, line, column });
const scan = [
  { key: 'm-body', parentKey: null, sourceLocation: loc('src/layouts/Main.astro', 5, 1), usageLocation: loc('src/pages/index.astro', 4, 1) },
  { key: 'h-header', parentKey: 'm-body', sourceLocation: loc('src/components/Header.astro', 3, 1), usageLocation: loc('src/layouts/Main.astro', 6, 3) },
  { key: 'h-ul', parentKey: 'h-header', sourceLocation: loc('src/components/Header.astro', 4, 3), usageLocation: loc('src/layouts/Main.astro', 6, 3) },
];
const reader = (files: Record<string, string>) => async (f: string) => files[f] ?? null;
const apply = (files: Record<string, string>, changes: { file: string; afterSource: string }[]) => {
  const next = { ...files };
  for (const c of changes) next[c.file] = c.afterSource;
  return next;
};

describe('overrides live in files as props', () => {
  it('walks element → layout → page', () => {
    expect(overrideChain(scan, 'h-ul', 'src/pages/index.astro')).toEqual([
      { component: 'src/components/Header.astro', usage: loc('src/layouts/Main.astro', 6, 3) },
      { component: 'src/layouts/Main.astro', usage: loc('src/pages/index.astro', 4, 1) },
    ]);
    expect(overrideChain(scan, 'h-ul', 'src/pages/other.astro')).toBeNull();
  });

  it('threads a class override through the layout to the page', async () => {
    let files = { 'src/components/Header.astro': HEADER, 'src/layouts/Main.astro': MAIN, 'src/pages/index.astro': PAGE };
    const hops = overrideChain(scan, 'h-ul', 'src/pages/index.astro')!;
    files = apply(files, await planOverride(reader(files), hops, scan[2].sourceLocation, 'ul', 'class', 'flex p-6 opacity-90'));
    expect(files['src/components/Header.astro']).toContain('<ul class={Astro.props.ulClass ?? "flex p-6"}>');
    expect(files['src/layouts/Main.astro']).toContain('<Header ulClass={Astro.props.headerUlClass} />');
    expect(files['src/pages/index.astro']).toContain('<Layout headerUlClass="flex p-6 opacity-90" title="Works">');

    // A second edit reuses the plumbing and only changes the page.
    const second = await planOverride(reader(files), hops, scan[2].sourceLocation, 'ul', 'class', 'flex p-2');
    expect(second.map(c => c.file)).toEqual(['src/pages/index.astro']);
    files = apply(files, second);
    expect(files['src/pages/index.astro']).toContain('headerUlClass="flex p-2"');

    // Reset drops the page prop, keeps the plumbing.
    files = apply(files, await planOverride(reader(files), hops, scan[2].sourceLocation, 'ul', 'class', null));
    expect(files['src/pages/index.astro']).toBe(PAGE);
    expect(files['src/layouts/Main.astro']).toContain('headerUlClass');
  });

  it('avoids prop names the component already uses', async () => {
    const header = HEADER.replace('---\n---', '---\nconst { ulClass } = Astro.props;\n---');
    const files = { 'src/components/Header.astro': header, 'src/pages/index.astro': '<Header />\n' };
    const hops = [{ component: 'src/components/Header.astro', usage: loc('src/pages/index.astro', 1, 1) }];
    const out = await planOverride(reader(files), hops, loc('src/components/Header.astro', 5, 3), 'ul', 'class', 'p-1');
    expect(out.find(c => c.file.endsWith('Header.astro'))!.afterSource).toContain('Astro.props.ulClass2 ?? "flex p-6"');
    expect(out.find(c => c.file.endsWith('index.astro'))!.afterSource).toBe('<Header ulClass2="p-1" />\n');
  });
});

describe('master edits on a prop-read class', () => {
  it('rewrite the fallback literal and keep the prop', async () => {
    const { updateClassAttribute } = await import('@/vite-plugin/ast-updater');
    const src = '<ul class={Astro.props.ulClass ?? "flex p-6"}>\n</ul>\n';
    const out = await updateClassAttribute(src, 'src/components/Header.astro', loc('src/components/Header.astro', 1, 1), 'flex p-2');
    expect(out).toBe('<ul class={Astro.props.ulClass ?? "flex p-2"}>\n</ul>\n');
    const bare = await updateClassAttribute('<ul class={Astro.props.ulClass}>\n</ul>\n', 'x.astro', loc('x.astro', 1, 1), 'p-1');
    expect(bare).toBe('<ul class={Astro.props.ulClass ?? "p-1"}>\n</ul>\n');
  });
  it('same in the plugin copy', async () => {
    const { replaceOrAddClassAttribute } = await import('../../../../preview-template/src/plugins/sq-source-transforms.js');
    expect(replaceOrAddClassAttribute('<ul class={Astro.props.ulClass ?? "flex p-6"}>', 'a.astro', 'flex p-2')).toBe('<ul class={Astro.props.ulClass ?? "flex p-2"}>');
  });
});

describe('the review gaps (2026-10-07)', () => {
  const HEADER_FILE = 'src/components/Header.astro';
  const one = (file = HEADER_FILE) => [{ component: file, usage: loc('src/pages/index.astro', 1, 1) }];

  it('a name the file already reads as Astro.props.X is taken', async () => {
    const files = { [HEADER_FILE]: '<ul data-x={Astro.props.ulClass}>\n</ul>\n', 'src/pages/index.astro': '<Header />\n' };
    const out = apply(files, await planOverride(reader(files), one(), loc(HEADER_FILE, 1, 1), 'ul', 'class', 'p-1'));
    expect(out[HEADER_FILE]).toContain('class={Astro.props.ulClass2 ?? ""}');
  });

  it('an element with no class gets an empty fallback (the tagger can report it)', async () => {
    const files = { [HEADER_FILE]: '<ul>\n</ul>\n', 'src/pages/index.astro': '<Header />\n' };
    const out = apply(files, await planOverride(reader(files), one(), loc(HEADER_FILE, 1, 1), 'ul', 'class', 'p-1'));
    expect(out[HEADER_FILE]).toBe('<ul class={Astro.props.ulClass ?? ""}>\n</ul>\n');
  });

  it('editing back to the master value drops the page prop', async () => {
    let files = { [HEADER_FILE]: HEADER, 'src/pages/index.astro': '<Header />\n' };
    files = apply(files, await planOverride(reader(files), one(), loc(HEADER_FILE, 4, 3), 'ul', 'class', 'flex p-6 opacity-90'));
    files = apply(files, await planOverride(reader(files), one(), loc(HEADER_FILE, 4, 3), 'ul', 'class', 'p-6 flex'));
    expect(files['src/pages/index.astro']).toBe('<Header />\n');
    // …and an untouched element equal to its master writes nothing at all.
    expect(await planOverride(reader({ [HEADER_FILE]: HEADER, 'src/pages/index.astro': '<Header />\n' }), one(), loc(HEADER_FILE, 4, 3), 'ul', 'class', 'flex p-6')).toEqual([]);
  });

  it('declares the new prop in a typed Props and keeps it out of a rest spread', async () => {
    const header = '---\ninterface Props {\n  title: string;\n}\nconst { title, ...rest } = Astro.props;\n---\n<ul class="flex" {...rest}>\n</ul>\n';
    const files = { [HEADER_FILE]: header, 'src/pages/index.astro': '<Header title="x" />\n' };
    const out = apply(files, await planOverride(reader(files), one(), loc(HEADER_FILE, 7, 1), 'ul', 'class', 'grid'));
    expect(out[HEADER_FILE]).toContain('interface Props { ulClass?: string;\n  title: string;'); // same line: no later location shifts
    expect(out[HEADER_FILE]).toContain('const { ulClass, title, ...rest } = Astro.props;');
    expect(out[HEADER_FILE]).toContain('<ul class={Astro.props.ulClass ?? "flex"} {...rest}>');
  });

  it('a text override reads a prop; the master text stays the fallback', async () => {
    const card = '<div>\n  <h2>Works</h2>\n</div>\n';
    let files = { 'src/components/Card.astro': card, 'src/pages/index.astro': '<Card />\n' };
    const hops = one('src/components/Card.astro');
    files = apply(files, await planOverride(reader(files), hops, loc('src/components/Card.astro', 2, 3), 'h2', 'text', 'Selected "work" & more'));
    expect(files['src/components/Card.astro']).toContain('<h2>{Astro.props.h2Text ?? "Works"}</h2>');
    expect(files['src/pages/index.astro']).toBe('<Card h2Text={"Selected \\"work\\" & more"} />\n');
    files = apply(files, await planOverride(reader(files), hops, loc('src/components/Card.astro', 2, 3), 'h2', 'text', 'Works'));
    expect(files['src/pages/index.astro']).toBe('<Card />\n');
  });

  it('text with inline markup becomes a set:html prop; the original markup stays the fallback', async () => {
    let files = { 'src/components/Card.astro': '<p>Hi <b>there</b></p>\n', 'src/pages/index.astro': '<Card />\n' };
    const hops = one('src/components/Card.astro');
    files = apply(files, await planOverride(reader(files), hops, loc('src/components/Card.astro', 1, 1), 'p', 'text', 'Hello <a href="/x">you</a>'));
    expect(files['src/components/Card.astro']).toBe('<p>{Astro.props.pHtml ? <Fragment set:html={Astro.props.pHtml} /> : <>Hi <b>there</b></>}</p>\n');
    expect(files['src/pages/index.astro']).toBe('<Card pHtml={"Hello <a href=\\"/x\\">you</a>"} />\n');
    // Text values are HTML (the canvas encodes typed text): the markup form keeps them as is; back to the master drops the prop.
    files = apply(files, await planOverride(reader(files), hops, loc('src/components/Card.astro', 1, 1), 'p', 'text', 'a &lt; b'));
    expect(files['src/pages/index.astro']).toBe('<Card pHtml={"a &lt; b"} />\n');
    files = apply(files, await planOverride(reader(files), hops, loc('src/components/Card.astro', 1, 1), 'p', 'text', 'Hi <b>there</b>'));
    expect(files['src/pages/index.astro']).toBe('<Card />\n');
  });

  it('typed `x<y` (arriving as HTML) stays a plain-text prop — never set:html markup', async () => {
    const files = { 'src/components/Card.astro': '<h2>Works</h2>\n', 'src/pages/index.astro': '<Card />\n' };
    const out = apply(files, await planOverride(reader(files), one('src/components/Card.astro'), loc('src/components/Card.astro', 1, 1), 'h2', 'text', 'x&lt;y &amp; z'));
    expect(out['src/components/Card.astro']).toBe('<h2>{Astro.props.h2Text ?? "Works"}</h2>\n');
    expect(out['src/pages/index.astro']).toBe('<Card h2Text={"x<y & z"} />\n');
  });

  it('text with entities: the fallback holds the decoded characters', async () => {
    const files = { 'src/components/Card.astro': '<h2>Tom &amp; Jerry&#39;s</h2>\n', 'src/pages/index.astro': '<Card />\n' };
    const out = apply(files, await planOverride(reader(files), one('src/components/Card.astro'), loc('src/components/Card.astro', 1, 1), 'h2', 'text', 'Tom'));
    expect(out['src/components/Card.astro']).toBe('<h2>{Astro.props.h2Text ?? "Tom & Jerry\'s"}</h2>\n');
    // …and setting it back to that text is no override at all.
    expect(await planOverride(reader(files), one('src/components/Card.astro'), loc('src/components/Card.astro', 1, 1), 'h2', 'text', "Tom & Jerry's")).toEqual([]);
  });

  it('class:list: the page passes the whole class string, the list stays the master', async () => {
    const card = '---\nconst { open } = Astro.props;\n---\n<ul class:list={["flex", { open }]}></ul>\n';
    const files = { 'src/components/Card.astro': card, 'src/pages/index.astro': '<Card />\n' };
    const out = apply(files, await planOverride(reader(files), one('src/components/Card.astro'), loc('src/components/Card.astro', 4, 1), 'ul', 'class', 'flex gap-2'));
    expect(out['src/components/Card.astro']).toContain('<ul class:list={Astro.props.ulClass ?? (["flex", { open }])}>');
    expect(out['src/pages/index.astro']).toBe('<Card ulClass="flex gap-2" />\n');
  });

  it('{...Astro.props} becomes a rest spread without the override props', async () => {
    const files = { 'src/components/Card.astro': '<ul class="flex" {...Astro.props}></ul>\n<p>x</p>\n', 'src/pages/index.astro': '<Card />\n' };
    const hops = one('src/components/Card.astro');
    // Two edits in one batch: the frontmatter the first creates shifts the second's line.
    const batch = new Map<string, { file: string; beforeSource: string; afterSource: string }>();
    const read = async (f: string) => batch.get(f)?.afterSource ?? files[f as keyof typeof files] ?? null;
    const base = async (f: string) => files[f as keyof typeof files] ?? null;
    for (const [line, tag, kind, value] of [[1, 'ul', 'class', 'grid'], [2, 'p', 'text', 'y']] as const) {
      for (const c of await planOverride(read, hops, loc('src/components/Card.astro', line, 1), tag, kind, value, base)) {
        batch.set(c.file, { ...c, beforeSource: batch.get(c.file)?.beforeSource ?? c.beforeSource });
      }
    }
    expect(batch.get('src/components/Card.astro')!.afterSource).toBe(
      '---\nconst { pText, ulClass, ...props } = Astro.props;\n---\n<ul class={Astro.props.ulClass ?? "flex"} {...props}></ul>\n<p>{Astro.props.pText ?? "x"}</p>\n');
    expect(batch.get('src/pages/index.astro')!.afterSource).toBe('<Card pText="y" ulClass="grid" />\n');
  });

  it('a layout that renders no element of its own (wraps another layout) is found on the page', async () => {
    const main = '---\nimport Base from "./Base.astro";\nimport Header from "../components/Header.astro";\n---\n<Base>\n  <Header />\n  <slot />\n</Base>\n';
    const page = '---\nimport Main from "../layouts/Main.astro";\n---\n<Main>\n  <p>hi</p>\n</Main>\n';
    const elements = [
      { key: 'b-body', parentKey: null, sourceLocation: loc('src/layouts/Base.astro', 3, 1), usageLocation: loc('src/layouts/Main.astro', 5, 1) },
      { key: 'h-ul', parentKey: 'b-body', sourceLocation: loc(HEADER_FILE, 4, 3), usageLocation: loc('src/layouts/Main.astro', 6, 3) },
    ];
    const hops = overrideChain(elements, 'h-ul', 'src/pages/index.astro')!;
    expect(hops[1]).toEqual({ component: 'src/layouts/Main.astro', usage: loc('src/pages/index.astro', 0, 0) });
    let files = { [HEADER_FILE]: HEADER, 'src/layouts/Main.astro': main, 'src/pages/index.astro': page };
    files = apply(files, await planOverride(reader(files), hops, loc(HEADER_FILE, 4, 3), 'ul', 'class', 'p-1'));
    expect(files['src/layouts/Main.astro']).toContain('<Header ulClass={Astro.props.headerUlClass} />');
    expect(files['src/pages/index.astro']).toContain('<Main headerUlClass="p-1">');
  });

  it('copies rendered by one usage tag (a loop) share a chain', () => {
    const els = [
      { key: 'c', parentKey: null, sourceLocation: loc('src/components/Card.astro', 1, 1), usageLocation: loc('src/pages/index.astro', 5, 3) },
      { key: 'c#1', parentKey: null, sourceLocation: loc('src/components/Card.astro', 1, 1), usageLocation: loc('src/pages/index.astro', 5, 3) },
      { key: 'd', parentKey: null, sourceLocation: loc('src/components/Card.astro', 1, 1), usageLocation: loc('src/pages/index.astro', 9, 3) },
    ];
    const hops = (k: string) => overrideChain(els, k, 'src/pages/index.astro')!;
    expect(sharedChain(els, 'c', 'src/pages/index.astro', hops('c'))).toBe(true);
    expect(sharedChain(els, 'd', 'src/pages/index.astro', hops('d'))).toBe(false);
  });
});

describe('master text edits on a prop-read text', () => {
  it('rewrite only the fallback literal (both writers)', async () => {
    const { updateTextContent } = await import('@/vite-plugin/ast-updater');
    const src = '<h2>{Astro.props.h2Text ?? "Works"}</h2>\n';
    expect(await updateTextContent(src, 'a.astro', loc('a.astro', 1, 1), 'Projects')).toBe('<h2>{Astro.props.h2Text ?? "Projects"}</h2>\n');
    const plugin = await import('../../../../preview-template/src/plugins/sq-source-transforms.js');
    expect(await plugin.updateTextContent(src, loc('a.astro', 1, 1), 'Projects')).toBe('<h2>{Astro.props.h2Text ?? "Projects"}</h2>\n');
  });
});

describe('<img> src/alt overrides', () => {
  const CARD = 'src/components/Card.astro';
  const hops = [{ component: CARD, usage: loc('src/pages/index.astro', 1, 1) }];
  it('a plain <img> literal becomes a prop; Push rewrites only the fallback', async () => {
    let files = { [CARD]: '<img src="/a.jpg" alt="A" />\n', 'src/pages/index.astro': '<Card />\n' };
    files = apply(files, await planOverride(reader(files), hops, loc(CARD, 1, 1), 'img', 'src', '/b.jpg'));
    files = apply(files, await planOverride(reader(files), hops, loc(CARD, 1, 1), 'img', 'alt', ''));
    expect(files[CARD]).toBe('<img src={Astro.props.imgSrc ?? "/a.jpg"} alt={Astro.props.imgAlt ?? "A"} />\n');
    expect(files['src/pages/index.astro']).toBe('<Card imgAlt={""} imgSrc="/b.jpg" />\n');
    const { updateImageAttribute } = await import('@/vite-plugin/ast-updater');
    expect(await updateImageAttribute(files[CARD], CARD, loc(CARD, 1, 1), 'src', '/b.jpg')).toContain('src={Astro.props.imgSrc ?? "/b.jpg"}');
  });
  it('an astro:assets / dynamic src is refused (stays editor-only)', async () => {
    const files = { [CARD]: '<Image src={hero} alt="" />\n<img src={url} />\n', 'src/pages/index.astro': '<Card />\n' };
    await expect(planOverride(reader(files), hops, loc(CARD, 2, 1), 'img', 'src', '/b.jpg')).rejects.toThrow(/plain <img>/);
  });
});

describe('class:list and markup Push', () => {
  it('a class:list fallback is written like a bare class:list (both writers)', async () => {
    const plugin = await import('../../../../preview-template/src/plugins/sq-source-transforms.js');
    const tag = '<ul class:list={Astro.props.ulClass ?? (["flex p-6", open && "open"])}>';
    const bare = plugin.replaceOrAddClassAttribute('<ul class:list={["flex p-6", open && "open"]}>', 'a.astro', 'flex p-2', 'flex p-6');
    const wrapped = plugin.replaceOrAddClassAttribute(tag, 'a.astro', 'flex p-2', 'flex p-6');
    expect(wrapped).toBe(bare.replace('class:list={', 'class:list={Astro.props.ulClass ?? (').replace(/\}>$/, ')}>'));
    const { updateClassAttribute } = await import('@/vite-plugin/ast-updater');
    expect(await updateClassAttribute(`${tag}\n</ul>\n`, 'a.astro', loc('a.astro', 1, 1), 'flex p-2', 'flex p-6')).toBe(`${wrapped}\n</ul>\n`);
  });
  it('a markup fallback is rewritten in place; markup into a text fallback switches form', async () => {
    const plugin = await import('../../../../preview-template/src/plugins/sq-source-transforms.js');
    expect(plugin.propFallbackText('{Astro.props.pHtml ? <Fragment set:html={Astro.props.pHtml} /> : <>Hi <b>x</b></>}', 'Yo <i>y</i>'))
      .toBe('{Astro.props.pHtml ? <Fragment set:html={Astro.props.pHtml} /> : <>Yo <i>y</i></>}');
    expect(plugin.propFallbackText('{Astro.props.pText ?? "Hi"}', 'Yo <i>y</i>'))
      .toBe('{Astro.props.pText ? <Fragment set:html={Astro.props.pText} /> : <>Yo <i>y</i></>}');
  });
});

describe('a layout nested two levels that renders nothing of its own', () => {
  it('is found through the imports', async () => {
    const HEADER_FILE = 'src/components/Header.astro';
    const main = '---\nimport Base from "./Base.astro";\nimport Header from "../components/Header.astro";\n---\n<Base>\n  <Header />\n</Base>\n';
    const outer = '---\nimport Main from "./Main.astro";\n---\n<Main><slot /></Main>\n';
    const page = '---\nimport Outer from "../layouts/Outer.astro";\n---\n<Outer>\n  <p>hi</p>\n</Outer>\n';
    const elements = [
      { key: 'b-body', parentKey: null, sourceLocation: loc('src/layouts/Base.astro', 3, 1), usageLocation: loc('src/layouts/Main.astro', 5, 1) },
      { key: 'h-ul', parentKey: 'b-body', sourceLocation: loc(HEADER_FILE, 4, 3), usageLocation: loc('src/layouts/Main.astro', 6, 3) },
    ];
    const hops = overrideChain(elements, 'h-ul', 'src/pages/index.astro')!;
    let files = { [HEADER_FILE]: HEADER, 'src/layouts/Main.astro': main, 'src/layouts/Outer.astro': outer, 'src/pages/index.astro': page };
    files = apply(files, await planOverride(reader(files), hops, loc(HEADER_FILE, 4, 3), 'ul', 'class', 'p-1'));
    expect(files['src/layouts/Main.astro']).toContain('<Header ulClass={Astro.props.headerUlClass} />');
    expect(files['src/layouts/Outer.astro']).toContain('<Main headerUlClass={Astro.props.mainHeaderUlClass}><slot /></Main>');
    expect(files['src/pages/index.astro']).toContain('<Outer mainHeaderUlClass="p-1">');
  });
});

describe('identity maps (Push resolves the element by source version)', () => {
  it('the element coordinate rebases through every override write, frontmatter added included', async () => {
    const { projectCoordinate } = await import('@/vite-plugin/source-transform-identity');
    const CARD = 'src/components/Card.astro';
    const files = { [CARD]: '<div {...Astro.props}>\n  <h2 class="text-xl">T</h2>\n</div>\n', 'src/pages/index.astro': '<Card />\n' };
    const out = await planOverride(reader(files), [{ component: CARD, usage: loc('src/pages/index.astro', 1, 1) }], loc(CARD, 2, 3), 'h2', 'class', 'p-1');
    const card = out.find(c => c.file === CARD)!;
    expect(card.afterSource.split('\n')[4]).toBe('  <h2 class={Astro.props.h2Class ?? "text-xl"}>T</h2>'); // 3 frontmatter lines added
    expect(projectCoordinate(loc(CARD, 2, 3), card.identityMaps!)).toMatchObject({ line: 5, column: 3 });
  });
});

describe('BlogSlot layout per instance (task-244 L10)', () => {
  it('editing the posts grid of the 2nd BlogSlot reuses postsClass: only the page changes', async () => {
    const SLOT = 'src/components/BlogSlot.astro', PAGE_FILE = 'src/pages/index.astro';
    const slot = LIB_BLOG_SLOT;
    const usage = { ...lineOf(TWO_SLOTS, '<BlogSlot', 1), file: PAGE_FILE };
    const posts = { ...lineOf(slot, '<div class={Astro.props.postsClass'), file: SLOT };
    const files = { [SLOT]: slot, [PAGE_FILE]: TWO_SLOTS };
    const hops = [{ component: SLOT, usage }];
    const out = await planOverride(reader(files), hops, posts, 'div', 'class', 'grid grid-cols-2 gap-20');
    expect(out.map((c) => c.file)).toEqual([PAGE_FILE]);
    expect(out[0].afterSource).toContain('<BlogSlot sectionClass="" postsClass="grid grid-cols-2 gap-20">');
    expect(out[0].afterSource).toContain('<BlogSlot sectionClass="" postsClass="a">');
  });

  it('re-planning a value the page already passes is a no-op (sectionClass="" is never respelled {""})', async () => {
    const SLOT = 'src/components/BlogSlot.astro', PAGE_FILE = 'src/pages/index.astro';
    const slot = LIB_BLOG_SLOT;
    const out = await planOverride(reader({ [SLOT]: slot, [PAGE_FILE]: TWO_SLOTS }), [{ component: SLOT, usage: { file: PAGE_FILE, ...lineOf(TWO_SLOTS, '<BlogSlot') } }],
      { file: SLOT, ...lineOf(slot, '<section') }, 'section', 'class', '');
    expect(out).toEqual([]);
  });
});

