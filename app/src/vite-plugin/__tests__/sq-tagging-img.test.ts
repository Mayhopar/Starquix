/**
 * task-141: <img> (and <video>) must receive data-sq-source keys — resolved
 * media needs a source location for src swap / un-resolve, and Astro strips
 * data-astro-source-* client-side so the bridge fallback is dead in live DOM.
 * Imports THE shared tagger (single source, parity law).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';

const SOURCE = `---
---
<section class="page">
  <img class="w-64" src="/a.jpg" alt="" />
  <video class="w-64" src="/b.mp4"></video>
  <br />
  <input type="text" />
</section>
`;

// Minimal $$render-style compiled output the tagger's second branch handles.
const COMPILED = '$$render`<section class="page">\n  <img class="w-64" src="/a.jpg" alt="" />\n  <video class="w-64" src="/b.mp4"></video>\n  <br />\n  <input type="text" />\n</section>`;\n},';

describe('sq-tagging img/video (task-141)', () => {
  it('tags img and video with data-sq-source; other void elements stay untagged', async () => {
    const out = await transformCompiledOutput(
      COMPILED, SOURCE, '/proj/src/pages/index.astro', '/proj', 'relative', parse,
    );
    expect(out).toBeTruthy();
    const code = (out as { code: string }).code;
    expect(code).toMatch(/<img data-sq-source="src\/pages\/index\.astro:\d+:\d+"/);
    expect(code).toMatch(/<video data-sq-source="src\/pages\/index\.astro:\d+:\d+"/);
    expect(code).toMatch(/<section data-sq-source=/);
    expect(code).not.toMatch(/<br data-sq-source/);
    expect(code).not.toMatch(/<input data-sq-source/);
  });
});
