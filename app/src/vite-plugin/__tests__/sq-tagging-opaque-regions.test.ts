/**
 * REGRESSION — the occurrence shift's MIRROR (task-168, 2026-08-05).
 *
 * ROUND 17 fixed one half of `(tagName, occurrence)` misalignment: a compiled
 * `<T` the injector could not match must still CONSUME its slot. This is the
 * other half — a compiled `<T` with **no AST element behind it at all** must
 * NOT consume a slot, and must not be injected into.
 *
 * Three triggers, all reproduced in served bytes on a live astro dev 4.16.19
 * rig before this test existed:
 *   - an HTML comment containing markup (`<!-- <p class="ghost">x</p> -->`)
 *   - an `is:raw` body (the AST reports it as TEXT; the compiled output
 *     contains the markup literally)
 *   - a `<script is:inline>` body containing an HTML string
 *
 * In every case the ghost tag was TAGGED with the next real sibling's
 * coordinates, that sibling took the one after it, and the last real sibling
 * got no key at all — plus `data-sq-source`/`data-sq-placement` were written
 * INSIDE the comment / raw block / inline script and shipped to the user.
 *
 * `fixtures/sq-tagging-opaque-region-fixtures.json` holds the VERBATIM compiled
 * modules of that rig (only the rig's absolute root was rewritten to `/rig`),
 * captured from a dev server running WITHOUT our plugin so they are the real
 * INPUT to the tagger. Both compiled branches are covered:
 *   - `$$render\`` — Cmt, Raw, Edge, RawCmp
 *   - `__template([…])` — TplCmt, TplRaw, Scr
 *     (a `<script is:inline>` flips 4.16.19 into the memoised branch, which is
 *     why the inline-script case lives there.)
 *
 * The `expected` coordinates below were read off a direct @astrojs/compiler AST
 * parse of each source, NOT off the tagger, so they cannot be circular.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import fixtures from './fixtures/sq-tagging-opaque-region-fixtures.json';

interface OpaqueFixture {
  name: string;
  filePath: string;
  source: string;
  compiled: string;
}

const FIXTURES = fixtures as unknown as OpaqueFixture[];
const fixture = (name: string): OpaqueFixture => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing opaque-region fixture: ${name}`);
  return f;
};

async function tag(name: string, options?: { placements: boolean }) {
  const f = fixture(name);
  const out = await transformCompiledOutput(
    f.compiled,
    f.source,
    f.filePath,
    '/rig',
    'relative',
    parse,
    options,
  );
  expect(out).not.toBeNull();
  return (out as { code: string }).code;
}

/**
 * `class` marker → the `data-sq-source` on that same opening tag, or null.
 * Tolerates the `__template` branch's escaped quotes (`\"`), which is how the
 * injector writes into a JS string literal.
 */
function keysByClass(code: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const tagPattern = /<[a-zA-Z][a-zA-Z0-9-]*([^<>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(code)) !== null) {
    const attrs = m[1];
    const marker = /(?:^|\s)class=\\?["']([^"'\\]*)\\?["']/.exec(attrs);
    if (!marker) continue;
    const key = /data-sq-source=\\?"([^"\\]*)\\?"/.exec(attrs);
    out[marker[1]] = key ? key[1] : null;
  }
  return out;
}

/**
 * Every byte-run the tagger must treat as opaque, located in the OUTPUT:
 * HTML comments, `<script>`/`<style>` bodies. (`is:raw` bodies have no marker
 * of their own in the compiled bytes — they are asserted through their known
 * ghost class names instead.)
 */
function opaqueRuns(code: string): string[] {
  const runs: string[] = [];
  const pattern = /<!--[\s\S]*?-->|<script[\s\S]*?<\\?\/script>|<style[\s\S]*?<\\?\/style>/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code)) !== null) runs.push(m[0]);
  return runs;
}

const BOTH_MODES: Array<[string, { placements: boolean } | undefined]> = [
  ['6-arg (WC/server)', undefined],
  ['{ placements: true } (local)', { placements: true }],
];

describe('sq-tagging — a compiled tag with no AST element behind it must not consume a slot', () => {
  for (const [label, options] of BOTH_MODES) {
    describe(label, () => {
      it('HTML comment, $$render` branch: the ghost is untagged and the three real <p> keep their own coordinates', async () => {
        const keys = keysByClass(await tag('Cmt', options));
        expect(keys.ghost).toBeNull();
        expect(keys.one).toBe('src/components/Cmt.astro:6:3');
        expect(keys.two).toBe('src/components/Cmt.astro:7:3');
        expect(keys.three).toBe('src/components/Cmt.astro:8:3');
      });

      it('HTML comment, __template branch: same, through the memoised string array', async () => {
        const keys = keysByClass(await tag('TplCmt', options));
        expect(keys.tghost).toBeNull();
        expect(keys.tone).toBe('src/components/TplCmt.astro:4:3');
        expect(keys.ttwo).toBe('src/components/TplCmt.astro:5:3');
        expect(keys.tthree).toBe('src/components/TplCmt.astro:6:3');
      });

      it('is:raw body, $$render` branch: the raw <i> is untagged and the three real <i> keep their own coordinates', async () => {
        const keys = keysByClass(await tag('Raw', options));
        expect(keys.raw1).toBeNull();
        expect(keys.i1).toBe('src/components/Raw.astro:6:3');
        expect(keys.i2).toBe('src/components/Raw.astro:7:3');
        expect(keys.i3).toBe('src/components/Raw.astro:8:3');
      });

      it('is:raw body, __template branch: same, through the memoised string array', async () => {
        const keys = keysByClass(await tag('TplRaw', options));
        expect(keys.traw1).toBeNull();
        expect(keys.tem1).toBe('src/components/TplRaw.astro:4:3');
        expect(keys.tem2).toBe('src/components/TplRaw.astro:5:3');
        expect(keys.tem3).toBe('src/components/TplRaw.astro:6:3');
      });

      it('multi-line, unclosed-tag and pseudo-nested comments + a NESTED is:raw body all stay opaque', async () => {
        const keys = keysByClass(await tag('Edge', options));
        // three ghosts across three comments (one multi-line, one holding an
        // unclosed tag, one holding a second `<!--` — HTML comments do not
        // nest, so it ends at the FIRST `-->`)
        expect(keys.mghost).toBeNull();
        expect(keys.unclosed).toBeNull();
        // `<div is:raw><h5 class="rnest"><h5 class="deep">d</h5></h5></div>`
        expect(keys.rnest).toBeNull();
        expect(keys.deep).toBeNull();
        expect(keys.e1).toBe('src/components/Edge.astro:11:3');
        expect(keys.e2).toBe('src/components/Edge.astro:13:3');
        expect(keys.e3).toBe('src/components/Edge.astro:14:3');
      });

      it('is:raw containing a COMPONENT-looking tag never steals the real invocation’s key', async () => {
        const keys = keysByClass(await tag('RawCmp', options));
        // `<div is:raw><Card class="rawcmp" /></div>` used to take the real
        // `<Card />` at 7:3 — a component invocation compiles to
        // `$$renderComponent(…)`, so EVERY literal `<Card` is a ghost.
        expect(keys.rawcmp).toBeNull();
        expect(keys.s1).toBe('src/components/RawCmp.astro:8:3');
        expect(keys.s2).toBe('src/components/RawCmp.astro:9:3');
      });

      it('an inline <script> body holding an HTML string is opaque', async () => {
        const keys = keysByClass(await tag('Scr', options));
        expect(keys.scghost).toBeNull();
        expect(keys.q1).toBe('src/components/Scr.astro:6:3');
        expect(keys.q2).toBe('src/components/Scr.astro:7:3');
        expect(keys.q3).toBe('src/components/Scr.astro:8:3');
      });

      it('NO sq attribute is ever written inside a comment or an inline script — it ships to the user', async () => {
        for (const name of ['Cmt', 'TplCmt', 'Edge', 'Scr', 'TplRaw', 'Raw', 'RawCmp']) {
          for (const run of opaqueRuns(await tag(name, options))) {
            expect(run, `${name}: ${run.slice(0, 160)}`).not.toMatch(/data-sq-/);
          }
        }
      });

      it('NO sq attribute is written inside an is:raw body', async () => {
        // The raw bodies have no marker in the output, so they are located by
        // their ghost class names — the attribute run of a tagged element ends
        // at the `>` that precedes them.
        for (const [name, ghosts] of [
          ['Raw', ['raw1']],
          ['TplRaw', ['traw1']],
          ['Edge', ['rnest', 'deep']],
          ['RawCmp', ['rawcmp']],
        ] as Array<[string, string[]]>) {
          const code = await tag(name, options);
          for (const ghost of ghosts) {
            const idx = code.indexOf(`class=`);
            expect(idx).toBeGreaterThan(-1);
            const tagStart = code.lastIndexOf('<', code.indexOf(ghost));
            const tagEnd = code.indexOf('>', code.indexOf(ghost));
            expect(
              code.slice(tagStart, tagEnd),
              `${name}/${ghost}: ${code.slice(tagStart, tagEnd).slice(0, 160)}`,
            ).not.toMatch(/data-sq-/);
          }
        }
      });
    });
  }
});
