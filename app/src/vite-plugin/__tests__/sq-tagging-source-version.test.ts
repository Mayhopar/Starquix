import { describe, expect, it } from 'vitest';
import { parse, transform } from '@astrojs/compiler';
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';

async function tagged(source: string, placements = true) {
  const file = '/rig/src/pages/index.astro';
  const { code } = await transform(source, { filename: file });
  return (await transformCompiledOutput(code, source, file, '/rig', 'relative', parse, { placements }))!.code;
}

describe('compiled source versions', () => {
  it.each(['<p>A</p>', '<p>A</p><script is:inline>console.log(1)</script>'])('versions original bytes in either template shape: %s', async source => {
    const first = await tagged(source);
    const second = await tagged(source.replace('A', 'B'));
    const version = first.match(/data-sq-source-version=\\?"([^"\\]+)/)?.[1];
    expect(version).toMatch(/^s[0-9a-f]+:\d+$/);
    expect(second.match(/data-sq-source-version=\\?"([^"\\]+)/)?.[1]).not.toBe(version);
    if (source === '<p>A</p>') expect(version).toBe('s1ca88cd3:8');
    expect(await tagged(source)).toBe(first);
    expect(await tagged(source, false)).not.toContain('data-sq-source-version');
  });

  it('carries the placing file version separately from its unchanged usage address', async () => {
    const code = await tagged('---\nimport Card from "../components/Card.astro";\n---\n<Card />');
    const prelude = code.slice(0, code.indexOf('\n', code.indexOf('function $$sqTpl(')) + 1);
    const expression = code.match(/"data-sq-p":(.*?),\}/)?.[1];
    expect(expression).toBeTruthy();
    const rendered = new Function(`${prelude}var $$props={};var p={"data-sq-p":${expression}};return [$$sqAt(p),$$sqUv(p)];`)();
    expect(rendered[0]).toMatch(/^src\/pages\/index\.astro:4:\d+$/);
    expect(rendered[1]).toMatch(/^s[0-9a-f]+:\d+$/);
  });
});
