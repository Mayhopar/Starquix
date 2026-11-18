/**
 * task-149 STEP 1 — shipped bug in THE shared tagger, independent of placement
 * identity.
 *
 * `collectElements` lowercases `n.name` and applies the HTML VOID_ELEMENTS /
 * SKIP_ELEMENTS sets to `type === 'component'` AST nodes too. A component
 * called `Base.astro`, `Link.astro`, `Source.astro`, `Meta.astro`,
 * `Input.astro`, `Template.astro`, `Style.astro`, `Script.astro` or
 * `Slot.astro` is therefore silently dropped from the collected element list —
 * and `Base`/`Link` are ubiquitous Astro component names.
 *
 * Today that only costs the (unused) component entries. It becomes load-bearing
 * the moment placement identity matches AST component nodes to compiled
 * `$$renderComponent` call sites: a dropped node means a whole `<Base>` subtree
 * gets no placement.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { collectElements } from '../../../../preview-template/src/plugins/sq-tagging.js';

interface Collected {
  line: number;
  column: number;
  tagName: string;
}

async function collect(source: string): Promise<Collected[]> {
  const { ast } = await parse(source, { position: true });
  const out: Collected[] = [];
  collectElements(ast, out);
  return out;
}

describe('sq-tagging collectElements — component nodes vs HTML skip sets', () => {
  it('collects components whose names collide with void/skip HTML tags', async () => {
    const els = await collect(`---
import Base from '../layouts/Base.astro';
import Link from '../components/Link.astro';
import Meta from '../components/Meta.astro';
import Input from '../components/Input.astro';
import Source from '../components/Source.astro';
import Template from '../components/Template.astro';
import Style from '../components/Style.astro';
import Script from '../components/Script.astro';
import Slot from '../components/Slot.astro';
---
<Base>
  <Link href="/x" />
  <Meta />
  <Input />
  <Source />
  <Template />
  <Style />
  <Script />
  <Slot />
  <p>real markup</p>
</Base>
`);
    const names = els.map((e) => e.tagName);
    expect(names).toContain('Base');
    expect(names).toContain('Link');
    expect(names).toContain('Meta');
    expect(names).toContain('Input');
    expect(names).toContain('Source');
    expect(names).toContain('Template');
    expect(names).toContain('Style');
    expect(names).toContain('Script');
    expect(names).toContain('Slot');
    expect(names).toContain('p');
  });

  it('still drops the REAL void/skip HTML elements', async () => {
    const els = await collect(`---
---
<section>
  <br />
  <input type="text" />
  <link rel="x" href="/y" />
  <meta name="a" content="b" />
  <base href="/" />
  <style>.a{}</style>
  <script>1</script>
  <template><i>t</i></template>
  <slot />
  <img src="/a.jpg" alt="" />
  <video src="/b.mp4"></video>
</section>
`);
    const names = els.map((e) => e.tagName);
    expect(names).toContain('section');
    // task-141: img/video ARE tracked void/media elements
    expect(names).toContain('img');
    expect(names).toContain('video');
    // `template` is deliberately absent from this list: it lives only in
    // SKIP_INJECTION_TAGS (the injector's set), never in VOID_ELEMENTS /
    // SKIP_ELEMENTS, so collectElements has always collected it. Confirmed by
    // running this assertion against the pre-fix tagger.
    for (const dropped of ['br', 'input', 'link', 'meta', 'base', 'style', 'script', 'slot']) {
      expect(names).not.toContain(dropped);
    }
  });

  it('still drops Fragment components on both spellings', async () => {
    const els = await collect(`---
const html = '<b>x</b>';
---
<div><Fragment set:html={html} /><p>after</p></div>
`);
    expect(els.map((e) => e.tagName)).toEqual(['div', 'p']);
  });
});
