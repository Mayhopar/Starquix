/**
 * Instance override props (utils/propOverrides.ts): an element whose class
 * reads `{Astro.props.X ?? "lit"}` carries the master literal as `data-sq-cf`,
 * so the scan knows what the MASTER says while the DOM shows a page override.
 */
import { it, expect } from 'vitest';
import { parse, transform } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput, elementFallbacks } from '../../../../preview-template/src/plugins/sq-tagging.js';

const SOURCE = `---
---
<nav class="wrap">
  <ul class={Astro.props.ulClass ?? "flex p-6"}><li>a</li></ul>
  <p class={Astro.props.pClass}>b</p>
</nav>
`;

it('emits the master literal as data-sq-cf on the real compiled output', async () => {
  const compiled = (await transform(SOURCE, { filename: '/proj/src/components/Header.astro' })).code;
  const out = await transformCompiledOutput(compiled, SOURCE, '/proj/src/components/Header.astro', '/proj', 'relative', parse, { placements: true });
  const code = (out as { code: string }).code;
  expect(code).toMatch(/<ul data-sq-source=\\?"src\/components\/Header\.astro:4:3\\?"[^>]*data-sq-cf=\\?"flex p-6\\?"/);
  expect(code.match(/data-sq-cf/g)).toHaveLength(1); // no fallback → nothing to report
});

it('any literal rides entity-escaped and decodes back to the value; non-literals do not qualify', () => {
  const at = (value: string) => elementFallbacks({ name: 'p', attributes: [{ kind: 'expression', name: 'class', value }] })?.cf ?? null;
  expect(at('Astro.props.a ?? "x y"')).toBe('x y');
  expect(at("Astro.props.a ?? ''")).toBe('');
  const escaped = at('Astro.props.a ?? "bg-[url(\'x\')] $y"')!;
  expect(escaped).not.toMatch(/['"`$\\<>]/);
  const div = document.createElement('div');
  div.innerHTML = `<p data-sq-cf="${escaped}"></p>`;
  expect(div.firstElementChild!.getAttribute('data-sq-cf')).toBe("bg-[url('x')] $y");
  expect(at('Astro.props.a ?? `x ${y}`')).toBeNull();
  expect(at('cond ? "a" : "b"')).toBeNull();
});

it('text: one expression child with a literal fallback', async () => {
  const src = '---\n---\n<div>\n  <h2>{Astro.props.h2Text ?? "Tom & Jerry\'s"}</h2>\n  <p>{Astro.props.p}</p>\n</div>\n';
  const compiled = (await transform(src, { filename: '/proj/src/components/Card.astro' })).code;
  const out = await transformCompiledOutput(compiled, src, '/proj/src/components/Card.astro', '/proj', 'relative', parse, { placements: true });
  const code = (out as { code: string }).code;
  expect(code).toMatch(/<h2 [^>]*data-sq-tf=\\?"Tom &#38; Jerry&#39;s\\?"/);
  expect(code.match(/data-sq-tf/g)).toHaveLength(1);
});

it('img: a src read from a prop reports its fallback as data-sq-sf', async () => {
  const src = '---\n---\n<div>\n  <img src={Astro.props.imgSrc ?? "/a.jpg"} alt="" />\n</div>\n';
  const compiled = (await transform(src, { filename: '/proj/src/components/Card.astro' })).code;
  const out = await transformCompiledOutput(compiled, src, '/proj/src/components/Card.astro', '/proj', 'relative', parse, { placements: true });
  expect((out as { code: string }).code).toMatch(/<img [^>]*data-sq-sf=\\?"\/a\.jpg\\?"/);
});
