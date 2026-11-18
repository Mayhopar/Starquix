/**
 * task-149 STEP 0 — byte-equality contract for THE shared tagger.
 *
 * `preview-template/src/plugins/sq-tagging.js` is shared by the host Vite
 * plugin (WC + server mode, `app/src/vite-plugin/index.ts:340`, 6 args) and the
 * local-mode instance plugin (`sq-source-plugin.js`). Every local-mode-only
 * behaviour must be gated behind the 7th `options` param, so the 6-arg call —
 * the ONLY shape WC/server ever uses — has to keep producing the exact bytes it
 * produced before placement identity existed.
 *
 * The corpus in `fixtures/sq-tagging-goldens.json` was captured from the tagger
 * on base commit 07143656, BEFORE any placement work. `compiled` is the literal
 * output of @astrojs/compiler 4.16.19 stored verbatim, so this test does not
 * depend on the installed compiler version.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import goldens from './fixtures/sq-tagging-goldens.json';
import templateGoldens from './fixtures/sq-tagging-template-goldens.json';

interface Golden {
  name: string;
  source: string;
  filePath: string;
  compiled: string;
  expected: string | null;
}

const CORPUS = goldens as unknown as Golden[];
/**
 * The memoised `__template` corpus, captured verbatim from a live astro dev
 * 4.16.19 rig. `expected` was recorded BEFORE the 2026-08-04 fix that made the
 * `__template` branch emit component placements, so it pins that the branch's
 * rewrite left WC/server bytes untouched.
 */
const TEMPLATE_CORPUS = templateGoldens as unknown as Golden[];

describe('sq-tagging goldens — the WC/server byte-equality contract', () => {
  it('has a corpus covering every compiled shape we know about', () => {
    expect(CORPUS.map((g) => g.name).sort()).toEqual(
      [
        'component',
        'dotted',
        'dynamicCmp',
        'emptyProps',
        'fragmentHtml',
        'island',
        'layout',
        'loop',
        'namedLikeHtml',
        'page',
        'propsSpread',
        'spread',
        'voidsAndSkips',
      ].sort(),
    );
  });

  for (const g of CORPUS) {
    it(`6-arg call is byte-identical to the golden: ${g.name}`, async () => {
      const out = await transformCompiledOutput(
        g.compiled,
        g.source,
        g.filePath,
        '/proj',
        'relative',
        parse,
      );
      expect(out ? (out as { code: string }).code : null).toBe(g.expected);
    });

    it(`{ placements: false } is byte-identical to the golden: ${g.name}`, async () => {
      const out = await transformCompiledOutput(
        g.compiled,
        g.source,
        g.filePath,
        '/proj',
        'relative',
        parse,
        { placements: false },
      );
      expect(out ? (out as { code: string }).code : null).toBe(g.expected);
    });
  }

  describe('memoised __template corpus — same contract', () => {
    it('covers the shapes the branch has to handle', () => {
      expect(TEMPLATE_CORPUS.map((g) => g.name).sort()).toEqual(
        ['Base', 'Card', 'Header', 'Multi', 'Plain', 'index', 'nested'].sort(),
      );
    });

    for (const g of TEMPLATE_CORPUS) {
      it(`6-arg call is byte-identical to the golden: ${g.name}`, async () => {
        const out = await transformCompiledOutput(
          g.compiled,
          g.source,
          g.filePath,
          '/rig',
          'relative',
          parse,
        );
        expect(out ? (out as { code: string }).code : null).toBe(g.expected);
      });

      it(`{ placements: false } is byte-identical to the golden: ${g.name}`, async () => {
        const out = await transformCompiledOutput(
          g.compiled,
          g.source,
          g.filePath,
          '/rig',
          'relative',
          parse,
          { placements: false },
        );
        expect(out ? (out as { code: string }).code : null).toBe(g.expected);
      });
    }
  });
});
