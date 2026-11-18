/**
 * task-160 — the tagger's half: a `data-sq-id` in the USER's source becomes the
 * placement identity, and nothing derived can move it.
 *
 * Unlike the golden-corpus tests, every fixture here is COMPILED at test time
 * by the real `@astrojs/compiler` `transform`, because the point being proved
 * is what happens when the authored source changes — a frozen corpus cannot
 * express "now delete the sibling above it".
 *
 * The M6 row of the round-12 matrix (delete a same-name sibling above a styled
 * invocation → its id slides onto the neighbour's) is the entire reason this
 * task exists; `keeps its identity when …` below is that row, at the tagger
 * level. The live `astro dev` counterpart is the task-160 rig in the ledger.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { transform, parse } from '@astrojs/compiler';
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';

const ROOT = '/rig';

/** Compile a `.astro` source the way astro dev does, then run the tagger. */
async function tagSource(
  source: string,
  relPath: string,
  opts?: { placements?: boolean },
): Promise<string> {
  const filePath = `${ROOT}/${relPath}`;
  const { code } = await transform(source, { filename: filePath, sourcemap: false });
  const out = await transformCompiledOutput(
    code,
    source,
    filePath,
    ROOT,
    'relative',
    parse,
    opts?.placements === false ? undefined : { placements: true },
  );
  return out ? out.code : code;
}

/** Every `$$sqSite($$props, s, q, l)` argument triple emitted by a module. */
function sites(code: string): Array<[string, string, string]> {
  return [...code.matchAll(/\$\$sqSite\(\$\$props,"([^"]*)","([^"]*)","([^"]*)"\)/g)].map(
    (m) => [m[1], m[2], m[3]] as [string, string, string],
  );
}

/**
 * The identity a browser would actually see in `data-sq-placement`, computed by
 * running the module's OWN injected prelude — not by re-implementing the hash.
 * `{}` stands in for a page's `$$props`, whose `data-sq-p` is absent, so the
 * parent chain is `''`: the top of the chain, where a collision is total.
 */
function renderedIdentity(code: string, index = 0): string {
  const at = code.indexOf('function $$sqTpl(');
  const prelude = code.slice(0, code.indexOf('\n', at) + 1);
  const sqSite = new Function(`${prelude}return $$sqSite;`)() as (
    p: unknown, s: string, q: string, l: string,
  ) => string;
  const [s, q, l] = sites(code)[index];
  return String(sqSite({}, s, q, l)).split(' ')[0];
}

const ID_A = 's1111111111111111';
const ID_B = 's2222222222222222';

/**
 * The identity string a stamped invocation gets — `<placing file>|#<stamp>`.
 * Round 14: the file is part of it, or the same stamp in two files is one id.
 */
const stampSite = (file: string, id: string): string => `${file}|#${id}`;
const INDEX = 'src/pages/index.astro';

const FM = `---\nimport SiteNav from '../components/SiteNav.astro';\n---\n`;

afterEach(() => vi.restoreAllMocks());

describe('a stamped invocation takes its identity from the user’s source', () => {
  it('uses #<data-sq-id> as the identity, keeping the ordinal as the second chain', async () => {
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n`,
      'src/pages/index.astro',
    );
    expect(sites(code)).toEqual([
      [
        stampSite(INDEX, ID_A),
        'src/pages/index.astro|../components/SiteNav.astro#0',
        // column 2, not 1: the compiler reports the FIRST template node one
        // position late (it points at the tag name). Long-standing, unchanged
        // here, and the reason `findTagStart` in the stamper accepts both.
        'src/pages/index.astro:4:2',
      ],
    ]);
  });

  it('two stamped invocations of ONE component stay distinct', async () => {
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n<SiteNav data-sq-id="${ID_B}" />\n`,
      'src/pages/index.astro',
    );
    const s = sites(code).map((t) => t[0]);
    expect(s).toEqual([stampSite(INDEX, ID_A), stampSite(INDEX, ID_B)]);
  });

  it('an UNSTAMPED invocation falls back to the ordinal, unchanged from task-159', async () => {
    const code = await tagSource(`${FM}<SiteNav />\n`, 'src/pages/index.astro');
    const [s, q] = sites(code)[0];
    expect(s).toBe(q);
    expect(s).toBe('src/pages/index.astro|../components/SiteNav.astro#0');
  });

  it('data-sq-id={undefined} is a real per-invocation opt-out', async () => {
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id={undefined} />\n`,
      'src/pages/index.astro',
    );
    const [s, q] = sites(code)[0];
    expect(s).toBe(q); // not `#…` — the expression form is never read as a stamp
  });

  it('a malformed stamp value is an opt-out too, never an identity', async () => {
    const code = await tagSource(`${FM}<SiteNav data-sq-id="nope" />\n`, 'src/pages/index.astro');
    const [s, q] = sites(code)[0];
    expect(s).toBe(q);
  });
});

describe('THE defect this task exists for — M6, at the tagger level', () => {
  const styled = `<SiteNav data-sq-id="${ID_B}" />`;

  it('keeps its identity when a same-name sibling ABOVE it is DELETED', async () => {
    const before = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n${styled}\n`,
      'src/pages/index.astro',
    );
    const after = await tagSource(`${FM}${styled}\n`, 'src/pages/index.astro');
    // The ORDINAL chain slides — that is the bug, still visible in chain 2.
    expect(sites(before)[1][1]).toBe('src/pages/index.astro|../components/SiteNav.astro#1');
    expect(sites(after)[0][1]).toBe('src/pages/index.astro|../components/SiteNav.astro#0');
    // The STAMPED chain does not move.
    expect(sites(after)[0][0]).toBe(stampSite(INDEX, ID_B));
    expect(sites(before)[1][0]).toBe(stampSite(INDEX, ID_B));
  });

  it('keeps its identity when a same-name sibling is INSERTED above it', async () => {
    const before = await tagSource(`${FM}${styled}\n`, 'src/pages/index.astro');
    const after = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n${styled}\n`,
      'src/pages/index.astro',
    );
    expect(sites(after)[1][0]).toBe(sites(before)[0][0]);
    expect(sites(after)[1][1]).not.toBe(sites(before)[0][1]); // the ordinal DID slide
  });

  it('keeps its identity when same-name siblings are REORDERED', async () => {
    const a = `<SiteNav data-sq-id="${ID_A}" />`;
    const before = await tagSource(`${FM}${a}\n${styled}\n`, 'src/pages/index.astro');
    const after = await tagSource(`${FM}${styled}\n${a}\n`, 'src/pages/index.astro');
    const idOf = (code: string, want: string) =>
      sites(code).find((t) => t[0] === want)!;
    expect(idOf(after, stampSite(INDEX, ID_B))[0]).toBe(idOf(before, stampSite(INDEX, ID_B))[0]);
    // …while the ordinal chain swapped the two around, which is the transplant.
    expect(idOf(after, stampSite(INDEX, ID_B))[1]).not.toBe(idOf(before, stampSite(INDEX, ID_B))[1]);
  });

  it('survives lines added above, an import rename and re-indentation', async () => {
    const base = await tagSource(`${FM}${styled}\n`, 'src/pages/index.astro');
    const moved = await tagSource(
      `---\n// a comment\n// another\nimport Nav from '../components/SiteNav.astro';\n---\n<div>\n    <Nav data-sq-id="${ID_B}" />\n</div>\n`,
      'src/pages/index.astro',
    );
    expect(sites(moved)[0][0]).toBe(sites(base)[0][0]);
  });
});

describe('a duplicated stamp poisons EVERY holder — never first-wins', () => {
  it('both copies fall back to the ordinal and a warning names the id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n<SiteNav data-sq-id="${ID_A}" />\n`,
      'src/pages/index.astro',
    );
    const s = sites(code);
    expect(s[0][0]).toBe(s[0][1]); // ordinal, not `#…`
    expect(s[1][0]).toBe(s[1][1]);
    expect(s[0][0]).not.toBe(s[1][0]); // still distinct from each other
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain(ID_A);
  });

  it('a THIRD, unique stamp in the same file is unaffected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n<SiteNav data-sq-id="${ID_A}" />\n<SiteNav data-sq-id="${ID_B}" />\n`,
      'src/pages/index.astro',
    );
    expect(sites(code)[2][0]).toBe(stampSite(INDEX, ID_B));
  });
});

/**
 * ROUND 14 — the stamp alone was NOT a placement identity.
 *
 * `stamped = '#' + stamp` dropped the placing file, so two page-root
 * invocations carrying the same `data-sq-id` in DIFFERENT files hashed to one
 * id (both `s94d7730f04273a2f` for `#s0123456789abcdef`). `buildIdentityByNode`
 * only ever sees ONE module, so its duplicate poison cannot see that at all —
 * a cross-file duplicate was structurally invisible and silently transplanted.
 *
 * The identity is now `<placing file>|#<stamp>`. The file is a property of the
 * INVOCATION's home, not of its position in it, so every "moves within its
 * file" case below still holds — that is the property the stamp exists for and
 * it is asserted here rather than assumed.
 */
describe('a stamp is scoped to the file that places it', () => {
  it('the SAME stamp in two different files is NOT the same placement', async () => {
    const a = await tagSource(`${FM}<SiteNav data-sq-id="${ID_A}" />\n`, 'src/pages/a.astro');
    const b = await tagSource(`${FM}<SiteNav data-sq-id="${ID_A}" />\n`, 'src/pages/b.astro');
    // The identity STRING carries the placing file…
    expect(sites(a)[0][0]).toBe(`src/pages/a.astro|#${ID_A}`);
    expect(sites(b)[0][0]).toBe(`src/pages/b.astro|#${ID_A}`);
    // …so the hash the browser sees differs, which is what stops the transplant.
    expect(renderedIdentity(b)).not.toBe(renderedIdentity(a));
  });

  it('copy/pasting a stamped invocation into another page cannot inherit its overrides', async () => {
    const original = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n`,
      'src/pages/index.astro',
    );
    // Verbatim paste into a second page, both at page root — the reviewer's case.
    const pasted = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n`,
      'src/pages/about.astro',
    );
    expect(renderedIdentity(pasted)).not.toBe(renderedIdentity(original));
  });

  it('MOVING the invocation within its own file keeps the identity', async () => {
    const top = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_B}" />\n<p>a</p>\n<p>b</p>\n`,
      'src/pages/index.astro',
    );
    const bottom = await tagSource(
      `${FM}<p>a</p>\n<p>b</p>\n<SiteNav data-sq-id="${ID_B}" />\n`,
      'src/pages/index.astro',
    );
    expect(sites(bottom)[0][0]).toBe(sites(top)[0][0]);
    expect(renderedIdentity(bottom)).toBe(renderedIdentity(top));
  });

  it('nesting it deeper inside plain markup keeps the identity', async () => {
    const flat = await tagSource(`${FM}<SiteNav data-sq-id="${ID_B}" />\n`, 'src/pages/index.astro');
    const nested = await tagSource(
      `${FM}<div>\n  <section>\n    <SiteNav data-sq-id="${ID_B}" />\n  </section>\n</div>\n`,
      'src/pages/index.astro',
    );
    expect(renderedIdentity(nested)).toBe(renderedIdentity(flat));
  });

  it('two stamped invocations in one file still differ from each other', async () => {
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n<SiteNav data-sq-id="${ID_B}" />\n`,
      'src/pages/index.astro',
    );
    expect(renderedIdentity(code, 0)).not.toBe(renderedIdentity(code, 1));
  });

  it('a stamped identity can never collide with an ordinal one', async () => {
    // `<file>|#s<16 hex>` has no trailing `#<digits>`; `<file>|<specifier>#<n>`
    // always does. Even a `#`-prefixed node subpath specifier cannot forge one.
    const stamped = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n`,
      'src/pages/index.astro',
    );
    expect(sites(stamped)[0][0]).toMatch(/\|#s[0-9a-f]{16}$/);
    expect(sites(stamped)[0][1]).toMatch(/#\d+$/);
  });
});

describe('WC / server are untouched', () => {
  it('emits no placement machinery at all without { placements: true }', async () => {
    const code = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n<p>x</p>\n`,
      'src/pages/index.astro',
      { placements: false },
    );
    expect(code).not.toContain('$$sqSite');
    expect(code).not.toContain('data-sq-p');
    expect(code).not.toContain('data-sq-placement');
    expect(code).not.toContain('$$sqH');
    // …but the source tagging it DOES own is unchanged.
    expect(code).toContain('data-sq-source="src/pages/index.astro:');
  });

  it('a stamp in the source never changes the WC bytes', async () => {
    const withStamp = await tagSource(
      `${FM}<SiteNav data-sq-id="${ID_A}" />\n<p>x</p>\n`,
      'src/pages/index.astro',
      { placements: false },
    );
    const without = await tagSource(
      `${FM}<SiteNav />\n<p>x</p>\n`,
      'src/pages/index.astro',
      { placements: false },
    );
    // The only difference is the user's own attribute, carried through verbatim.
    expect(withStamp.replace(`"data-sq-id":"${ID_A}"`, '')).toBe(without);
  });
});
