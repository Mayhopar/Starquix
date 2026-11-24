/**
 * REGRESSION — THE ALIGNMENT GATE (issue #7 investigation, 2026-11-24).
 *
 * The scan pairs the k-th compiled `<T` with the k-th AST `T`. Markup inside a
 * JS string of a template expression is a `<T` with no AST element behind it:
 * `set:html={`… <a href="/terms">terms</a>.`}` compiles to
 * `${$$unescapeHTML(`… <a href="/terms">terms</a>.`)}`. That ghost took the
 * signup link's address, the signup link took the login link's, and editing the
 * signup link on the canvas rewrote the LOGIN line on disk (results-L3.json
 * probes.shift: class and text both landed on line 9).
 *
 * The contract: a tag whose compiled occurrences do not pair 1:1 with the AST's
 * gets no address at all (not editable), never a neighbour's.
 */
import { describe, it, expect } from 'vitest';
import { parse, transform } from '@astrojs/compiler';
import { parseAst } from 'rollup/parseAst';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';

const FILE = '/rig/src/pages/shiftpage.astro';
// The probe page verbatim (designs/issue-7/probes.mjs `shift`).
const SOURCE = `---
import Layout from '../layouts/Layout.astro';
const product = 'Acme';
---
<Layout title="Shift page">
  <main id="probe-shift" class="p-8">
    <p id="shift-terms" class="text-sm" set:html={\`By signing up to \${product} you agree to our <a href="/terms">terms</a>.\`} />
    <a id="shift-signup" href="/signup" class="mt-4 block rounded bg-black px-4 py-2 text-white">Probe SHIFT signup</a>
    <a id="shift-login" href="/login" class="mt-4 block underline">Probe SHIFT login</a>
  </main>
</Layout>
`;

/** `id` → the `data-sq-source` on that opening tag, or null. */
function keysById(code: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of code.matchAll(/<[a-z][a-z0-9-]*([^<>]*)>/gi)) {
    const id = /(?:^|\s)id="([^"]*)"/.exec(m[1]);
    if (id) out[id[1]] = /data-sq-source="([^"]*)"/.exec(m[1])?.[1] ?? null;
  }
  return out;
}

describe('sq-tagging — a tag that does not pair 1:1 with the AST gets no address', () => {
  for (const [label, options] of [
    ['6-arg (WC/server)', undefined],
    ['{ placements, parseJs } (local)', { placements: true, parseJs: (s: string) => parseAst(s) }],
  ] as const) {
    it(`${label}: the set:html ghost <a> shifts no real link onto its neighbour's line`, async () => {
      const compiled = (await transform(SOURCE, { filename: FILE })).code;
      expect(compiled).toContain('$$unescapeHTML(`By signing up'); // the ghost really is in the scanned bytes
      const out = await transformCompiledOutput(compiled, SOURCE, FILE, '/rig', 'relative', parse, options);
      const code = (out as { code: string }).code;
      const keys = keysById(code);

      // Untagged, never a neighbour's address (8:5 = signup, 9:5 = login).
      expect(keys['shift-signup']).toBeNull();
      expect(keys['shift-login']).toBeNull();
      // Nothing is spliced into the user's string, so nothing leaks into the rendered HTML.
      expect(code).toMatch(/our <a href="\/terms">terms<\/a>/);
      // The gate is per tag: the file's other elements keep their own addresses.
      expect(keys['probe-shift']).toBe('src/pages/shiftpage.astro:6:3');
      expect(keys['shift-terms']).toBe('src/pages/shiftpage.astro:7:5');
    });
  }
});
