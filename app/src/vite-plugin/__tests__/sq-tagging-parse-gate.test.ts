/**
 * REGRESSION — THE PARSE GATE (task-176, 2026-08-05).
 *
 * The tagger splices `data-sq-*` into COMPILED module text by regex. When the
 * splice lands inside a JS string literal the module stops parsing and the
 * user's page returns HTTP 500. Reproduced live on astro 4.16.19 /
 * `@astrojs/compiler` 2.13.0 before this test existed: a page holding
 * `<div class="g1" set:html="<u>x</u>"></div>` compiles to `${"<u>x</u>"}`, the
 * injector writes `<u data-sq-source="…" >` INSIDE that JS string, and
 * `GET /gate` answered **500** with rollup's
 * `Unexpected token \`ident\`. Expected \`}\`` — the page dead.
 *
 * The gate does not fix the scan (that is the mode-stack lexer, deliberately
 * NOT built here). It makes the whole failure class survivable: the assembled
 * module is parsed before it is returned, and a module that does not parse is
 * dropped (`null`) so astro serves its own untagged one. Degraded and honest,
 * never broken.
 *
 * `fixtures/sq-tagging-parse-gate-fixtures.json` holds VERBATIM compiled
 * modules from a dev server running WITHOUT our plugin (`:4781`) — the tagger's
 * real INPUT — with only the rig's absolute root rewritten to `/rig`:
 *   - `gate`     — the 500 case, `$$render\`` branch
 *   - `clean`    — ordinary elements, `$$render\`` branch (gate must be a no-op)
 *   - `tplclean` — ordinary elements, `__template([…])` branch (a single
 *                  `<script is:inline>` flips 4.16.19 into it)
 *   - `upstream` — `set:html='<u class="q">x</u>'`, where @astrojs/compiler
 *                  ITSELF emits `${"<u class="q">x</u>"}` — invalid JS BEFORE
 *                  the tagger runs. Captured by a direct `transform()` call
 *                  because the dev server cannot even serve that module (the
 *                  plugin-free control answered 500 on both `/upstream` and
 *                  `/src/pages/upstream.astro`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '@astrojs/compiler';
import { parseAst } from 'rollup/parseAst';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import fixtures from './fixtures/sq-tagging-parse-gate-fixtures.json';

interface ParseGateFixture {
  name: string;
  filePath: string;
  source: string;
  compiled: string;
}

const FIXTURES = fixtures as unknown as ParseGateFixture[];
const fixture = (name: string): ParseGateFixture => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing parse-gate fixture: ${name}`);
  return f;
};

/** The injected parser, exactly as `sq-source-plugin.js` supplies it. */
const parseJs = (source: string) => parseAst(source);

async function tag(
  name: string,
  options?: { placements?: boolean; parseJs?: (s: string) => unknown },
) {
  const f = fixture(name);
  return transformCompiledOutput(
    f.compiled,
    f.source,
    f.filePath,
    '/rig',
    'relative',
    parse,
    options,
  );
}

const parses = (code: string): boolean => {
  try {
    parseAst(code);
    return true;
  } catch {
    return false;
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sq-tagging — the parse gate', () => {
  it('the ungated local output really is unparseable — this is the 500, in a unit test', async () => {
    // Without the gate the tagger returns code. That code is what astro served
    // when `GET /gate` answered 500.
    const out = await tag('gate', { placements: true });
    expect(out).not.toBeNull();
    const code = (out as { code: string }).code;
    expect(code).toContain('data-sq-source');
    expect(parses(code)).toBe(false);
    expect(() => parseAst(code)).toThrow();
  });

  it('with parseJs injected, a module the tagger broke is dropped instead of served', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await tag('gate', { placements: true, parseJs });
    expect(out).toBeNull();
    const message = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('/rig/src/pages/gate.astro');
    expect(message).toContain('does not parse');
  });

  it('an input that was ALREADY unparseable is reported as upstream, not as our damage', async () => {
    // @astrojs/compiler 2.13.0 emits `${"<u class="q">x</u>"}` for
    // `set:html='<u class="q">x</u>'`. Confirmed 500 on the plugin-free control.
    expect(parses(fixture('upstream').compiled)).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await tag('upstream', { placements: true, parseJs });
    expect(out).toBeNull();
    const message = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('before tagging');
    expect(message).toContain('upstream');
  });

  it.each([
    ['$$render` branch', 'clean'],
    ['__template branch', 'tplclean'],
  ])('%s: a module that parses is emitted byte-identically with and without the gate', async (
    _label,
    name,
  ) => {
    const gated = await tag(name, { placements: true, parseJs });
    const ungated = await tag(name, { placements: true });
    expect(gated).not.toBeNull();
    expect(ungated).not.toBeNull();
    expect((gated as { code: string }).code).toBe((ungated as { code: string }).code);
    expect(parses((gated as { code: string }).code)).toBe(true);
    expect((gated as { code: string }).code).toContain('data-sq-source');
  });

  it('the 6-arg WC/server path runs no gate at all — same bytes, gate or no gate', async () => {
    // The host plugin calls with 6 args and never supplies `parseJs`, so the
    // free path is byte-identical BY CONSTRUCTION. Pinned here as well as in
    // sq-tagging-goldens.test.ts.
    for (const name of ['gate', 'clean', 'tplclean']) {
      const sixArg = await tag(name);
      const withOptions = await tag(name, { placements: false });
      expect((sixArg as { code: string } | null)?.code).toBe(
        (withOptions as { code: string } | null)?.code,
      );
    }
    // …including the file that 500s in local mode: WC/server behaviour is
    // untouched by this commit, for better and for worse.
    const sixArg = await tag('gate');
    expect(sixArg).not.toBeNull();
    expect(parses((sixArg as { code: string }).code)).toBe(false);
  });
});
