/**
 * task-149 STEP 2 — render-time placement identity in THE shared tagger.
 *
 * Local mode keys elements `file:line:col` from `data-sq-source`, which is the
 * DEFINING file and therefore identical on every page that renders a component.
 * `{ placements: true }` adds a second, per-INVOCATION axis:
 *
 *   - each compiled `$$renderComponent(…,{…})` gets a `data-sq-p` prop whose
 *     value is a hash of (parent placement, authored invocation site);
 *   - each tagged element gets `data-sq-placement="${$$sqPl($$props)}"`, which
 *     reads that prop back inside the callee.
 *
 * task-159 changed WHAT the invocation site is and added a transitional second
 * chain. The prop now carries a PAIR, `"<q-id> <p-id>"`:
 *
 *   q — the STRUCTURAL id, over `<file>|<import specifier><member>#<ordinal>`
 *   p — the LEGACY coordinate id, over `<file>:<line>:<col>`, byte-identical to
 *       what this tagger emitted before, so a stored override key can be
 *       recognised and rekeyed onto its new address exactly once.
 *
 * The coordinate assertions below were flipped to the ordinal shape. They were
 * not wrong — they pinned a real contract — but that contract made an override
 * TRANSFER to its neighbour when a line was inserted above it (measured on
 * served bytes, see sq-tagging-ordinal-stability.test.ts). The legacy shape is
 * still asserted, as the second argument.
 *
 * Byte-equality of the 6-arg (WC/server) call is asserted separately, in
 * `sq-tagging-goldens.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import goldens from './fixtures/sq-tagging-goldens.json';
import templateGoldens from './fixtures/sq-tagging-template-goldens.json';
import { withoutSourceVersionEnvelope } from './taggingVersionTestUtils';

interface Golden {
  name: string;
  source: string;
  filePath: string;
  compiled: string;
  expected?: string | null;
  /** Only on the template corpus: does this module use the memoised form? */
  templated?: boolean;
}
const CORPUS = goldens as unknown as Golden[];
const byName = (n: string) => CORPUS.find((g) => g.name === n)!;

/**
 * Captured verbatim from a live `astro dev` 4.16.19 (the plugin's own `code` /
 * `originalCode` arguments), rig paths rewritten to `/rig/`. Two of the four
 * modules compile to the memoised `__template` form — see the describe block
 * at the bottom of this file.
 */
const TEMPLATE_CORPUS = templateGoldens as unknown as Golden[];

async function tag(g: Golden, projectRoot = '/proj'): Promise<string> {
  const out = await transformCompiledOutput(
    g.compiled,
    g.source,
    g.filePath,
    projectRoot,
    'relative',
    parse,
    { placements: true },
  );
  expect(out).toBeTruthy();
  return withoutSourceVersionEnvelope((out as { code: string }).code);
}

/** The template corpus was captured from a rig rooted at `/rig`. */
const tagTpl = (g: Golden) => tag(g, '/rig');

describe('sq-tagging placement identity ({ placements: true })', () => {
  it('prepends a dependency-free prelude that imports nothing', async () => {
    const code = await tag(byName('page'));
    expect(code.startsWith('function $$sqH(')).toBe(true);
    const prelude = code.slice(0, code.indexOf('\nimport {'));
    expect(prelude).toContain('function $$sqSite(');
    expect(prelude).toContain('function $$sqPl(');
    // task-159/160: BOTH transitional chains have their own reader.
    expect(prelude).toContain('function $$sqLq(');
    expect(prelude).toContain('function $$sqLp(');
    // The whole point of hand-rolling the hash: dev bundling can tree-shake
    // unused names out of astro's runtime import list, so the helpers must not
    // reference $$addAttribute (or anything else) from it.
    expect(prelude).not.toMatch(/\$\$addAttribute|\brequire\b|\bimport\b/);
  });

  it('gives two invocations of ONE component on ONE page distinct placements', async () => {
    const code = await tag(byName('page'));
    const sites = [
      ...code.matchAll(/'Card',Card,\{"data-sq-p":\$\$sqSite\(\$\$props,"([^"]+)","([^"]+)","([^"]+)"\)/g),
    ];
    expect(sites).toHaveLength(2);
    expect(sites[0][1]).not.toBe(sites[1][1]);
    // task-160 shape: the STAMPED site. These fixtures carry no `data-sq-id`,
    // so it falls back to task-159's ordinal — identical to argument 2.
    expect(sites[0][1]).toBe('src/pages/page.astro|../components/Card.astro#0');
    expect(sites[1][1]).toBe('src/pages/page.astro|../components/Card.astro#1');
    expect(sites[0][2]).toBe(sites[0][1]);
    expect(sites[1][2]).toBe(sites[1][1]);
    // …and the legacy coordinate chain, unchanged, as the third argument.
    expect(sites[0][3]).toBe('src/pages/page.astro:7:3');
    expect(sites[1][3]).toBe('src/pages/page.astro:8:3');
  });

  it('stamps data-sq-placement on every tagged element, page files included', async () => {
    const code = await tag(byName('page'));
    // Every data-sq-source in the emitted template is immediately followed by
    // the placement attribute — no element may be left unscoped — and by the
    // transitional legacy attribute (task-159).
    const sources = [
      ...code.matchAll(
        / data-sq-source="[^"]+"( data-sq-placement="[^"]*" data-sq-lq="[^"]*" data-sq-lp="[^"]*" data-sq-usage="[^"]*")?/g,
      ),
    ];
    expect(sources.length).toBeGreaterThan(0);
    for (const m of sources) {
      expect(m[1]).toBe(
        ' data-sq-placement="${$$sqPl($$props)}" data-sq-lq="${$$sqLq($$props)}" data-sq-lp="${$$sqLp($$props)}" data-sq-usage="${$$sqAt($$props)}"',
      );
    }
  });

  /**
   * OWNER MODEL (2026-08-04, REVERSES the 2026-08-03 "layout chrome is SHARED"
   * ruling — that ruling was made on a false description of server mode).
   *
   * In the owner's words: *"You edit instance of a component, it makes override.
   * Then u can push it to master and every instance will get this update, unless
   * it carries an override already. So it works like in figma. **Layout is a
   * component**, so to update every page user must update master instance."*
   *
   * A LAYOUT IS NOT SPECIAL. Its placement on each page is an INSTANCE, so a
   * layout invocation hashes per-invocation and per-route exactly like any other
   * component: `$$sqSite($$props, "<page>:<line>:<col>")`. Editing layout chrome
   * on page 1 scopes the override to page 1; changing every page means editing
   * the master (or pushing, which updates every instance that is not already
   * overriding).
   *
   * DO NOT "fix" this back to a shared/rooted layout identity. The premise for
   * that (server mode shares layout chrome across routes) is false — live
   * recordings on identical fixtures show server holds layout chrome PER PAGE.
   */
  describe('a LAYOUT is just a component — per-invocation, per-route', () => {
    it('hashes a layout invocation at the invoking page, like any component', async () => {
      const code = await tag(byName('page'));
      expect(code).toContain(
        `'Base',Base,{"data-sq-p":$$sqSite($$props,"src/pages/page.astro|../layouts/Base.astro#0","src/pages/page.astro|../layouts/Base.astro#0","src/pages/page.astro:5:1")`,
      );
      // No layout special-case may survive: the chain is never rooted at the file.
      expect(code).not.toContain(`$$sqSite(null,`);
    });

    it('two DIFFERENT pages importing the same layout emit DIFFERENT site strings', async () => {
      const fromPage = await tag(byName('page'));            // src/pages/page.astro|…Base.astro#0
      const fromOther = await tag(byName('namedLikeHtml'));  // src/pages/namedLikeHtml.astro|…#0
      const siteOf = (code: string) =>
        /'Base',Base,\{"data-sq-p":\$\$sqSite\((?:\$\$props|null),"([^"]+)"/.exec(code)?.[1];

      expect(siteOf(fromPage)).toBe('src/pages/page.astro|../layouts/Base.astro#0');
      expect(siteOf(fromOther)).not.toBe(siteOf(fromPage));
    });

    it('a NON-layout component hashes the page invocation site the same way', async () => {
      const code = await tag(byName('page'));
      const sites = [
        ...code.matchAll(/'Card',Card,\{"data-sq-p":\$\$sqSite\(\$\$props,"([^"]+)"/g),
      ].map((m) => m[1]);
      expect(sites).toEqual([
        'src/pages/page.astro|../components/Card.astro#0',
        'src/pages/page.astro|../components/Card.astro#1',
      ]);
    });

    it('a component the LAYOUT places chains off the layout placement', async () => {
      // `layout` fixture = the layout module itself; <Header /> chains off
      // $$props — which is now the layout's own PER-ROUTE placement, so the
      // header scopes per route too.
      const code = await tag(byName('layout'));
      expect(code).toContain(
        `'Header',Header,{"data-sq-p":$$sqSite($$props,"src/pages/layout.astro|../components/Header.astro#0","src/pages/layout.astro|../components/Header.astro#0","src/pages/layout.astro:7:3")`,
      );
    });
  });

  /**
   * task-159 — the ORDINAL is per import SPECIFIER, and it counts only
   * invocations that actually receive an identity.
   *
   * Two counters live in `buildPlacementPropReplacements` and they are
   * deliberately different: the MATCHING counter aligns AST nodes to compiled
   * call sites by (name, occurrence) and must keep counting every invocation
   * (that alignment is unchanged by task-159); the IDENTITY counter skips
   * everything `isTaggablePlacementComponent` rejects, so a `client:load`
   * island or a `.jsx` sibling can never renumber its `.astro` neighbours.
   */
  describe('the identity ordinal', () => {
    it('a client:load sibling consumes a MATCHING ordinal but not an IDENTITY one', async () => {
      // The `island` fixture places <Counter client:load/> (a .jsx island) and
      // <Image/> (astro:assets) alongside a taggable <Card/>. Neither may shift
      // the Card's number.
      const code = await tag(byName('island'));
      const sites = [...code.matchAll(/\$\$sqSite\(\$\$props,"([^"]+)"/g)].map((m) => m[1]);
      for (const s of sites) expect(s).toMatch(/#\d+$/);
      // Every emitted identity is the FIRST of its specifier — nothing was
      // pushed to #1 by the untaggable siblings.
      for (const s of sites) expect(s.endsWith('#0')).toBe(true);
    });

    it('a dotted member path stays in the slot key, so N.Item and N.Other never interleave', async () => {
      const dotted = await tag(byName('dotted'));
      expect(dotted).toContain('"src/pages/dotted.astro|./N.astro.Item#0"');
    });
  });

  it('never injects into a client:* island or a non-.astro component', async () => {
    const code = await tag(byName('island'));
    // Counter is ./Counter.jsx AND client:load; Image is from astro:assets.
    expect(code).toContain(`'Counter',Counter,{"client:load":true`);
    expect(code).not.toMatch(/'Counter',Counter,\{"data-sq-p"/);
    expect(code).not.toMatch(/'Image',Image,\{"data-sq-p"/);
  });

  it('never injects into Fragment (skipped on the AST and the call-site counter)', async () => {
    const code = await tag(byName('fragmentHtml'));
    expect(code).not.toMatch(/'Fragment',Fragment,\{"data-sq-p"/);
    // The sibling <p> is still placement-tagged.
    expect(code).toContain(' data-sq-placement="${$$sqPl($$props)}"');
  });

  it('never injects into a locally-computed component expression (no import)', async () => {
    const code = await tag(byName('dynamicCmp'));
    expect(code).toContain(`'Cmp',Cmp,{}`);
    expect(code).not.toMatch(/'Cmp',Cmp,\{"data-sq-p"/);
  });

  it('handles empty props, spreads and dotted names without breaking the object literal', async () => {
    const empty = await tag(byName('emptyProps'));
    expect(empty).toContain(
      `'Card',Card,{"data-sq-p":$$sqSite($$props,"src/pages/emptyProps.astro|./Card.astro#0","src/pages/emptyProps.astro|./Card.astro#0","src/pages/emptyProps.astro:4:7"),}`,
    );

    const spread = await tag(byName('spread'));
    expect(spread).toMatch(
      /'Card',Card,\{"data-sq-p":\$\$sqSite\(\$\$props,"[^"]+","[^"]+","[^"]+"\),\.\.\.\(props\)\}/,
    );

    const dotted = await tag(byName('dotted'));
    expect(dotted).toMatch(
      /'N\.Item',N\.Item,\{"data-sq-p":\$\$sqSite\(\$\$props,"[^"]+","[^"]+","[^"]+"\),\}/,
    );
  });

  it('gives a .map() loop ONE placement — the single authored invocation site', async () => {
    const code = await tag(byName('loop'));
    const sites = [...code.matchAll(/\$\$sqSite\(\$\$props,"([^"]+)","[^"]+","[^"]+"\)/g)].map((m) => m[1]);
    expect(sites).toHaveLength(1);
  });

  it('reaches components whose names collide with HTML void/skip tags (STEP 1)', async () => {
    const code = await tag(byName('namedLikeHtml'));
    expect(code).toMatch(/'Base',Base,\{"data-sq-p"/);
    expect(code).toMatch(/'Link',Link,\{"data-sq-p"/);
  });

  /**
   * BLAST RADIUS of injecting `data-sq-p` into the user's real `Astro.props`.
   * The `propsSpread` fixture is a component whose root does
   * `<div {...Astro.props}>` and which also forwards `{...Astro.props}` to a
   * child component — the two ways a user project can observe the prop.
   *
   * Measured, not inferred (the live counterpart is in
   * `bridge/parts/__tests__/placement-live-dom.test.ts`, over real astro dev
   * bytes).
   */
  describe('{...Astro.props} — what the injected prop can touch', () => {
    it('an element root that spreads props is tagged BEFORE the spread (task-167)', async () => {
      const code = await tag(byName('propsSpread'));
      // UPDATED for task-167. This used to assert the root carried NOTHING —
      // `<div${$$spreadAttributes(Astro.props)} …` was invisible to the tag
      // regex. It is now tagged like any other element, with the attributes
      // spliced immediately after the tag name and BEFORE the `${…}`, so the
      // spread's own output still lands after them.
      //
      // The blast radius this describe block exists to bound is UNCHANGED: the
      // stray runtime attribute is still the forwarded `data-sq-p` alone.
      // `data-sq-source`/`-placement` are attributes we emit deliberately on
      // every tagged element, and duplicate-attribute resolution keeps OURS
      // (HTML parsers take the first occurrence) if the spread carries one.
      expect(code).toContain(
        '<div data-sq-source="src/pages/propsSpread.astro:5:1"' +
          ' data-sq-placement="${$$sqPl($$props)}"' +
          ' data-sq-lq="${$$sqLq($$props)}" data-sq-lp="${$$sqLp($$props)}"' +
          ' data-sq-usage="${$$sqAt($$props)}"' +
          '${$$spreadAttributes(Astro.props)} class="wrap">',
      );
      // The sibling <span> is unaffected.
      expect(code).toContain(
        '<span data-sq-source="src/pages/propsSpread.astro:5:61" data-sq-placement="${$$sqPl($$props)}" data-sq-lq="${$$sqLq($$props)}" data-sq-lp="${$$sqLp($$props)}" data-sq-usage="${$$sqAt($$props)}">',
      );
    });

    it('forwarding {...Astro.props} to a CHILD component overrides the child’s own placement', async () => {
      const code = await tag(byName('propsSpread'));
      // Our key is inserted at the HEAD of the props object, so a later spread
      // carrying the parent's own `data-sq-p` wins. The child then renders
      // under the PARENT's placement — two such siblings collapse onto one
      // identity and fall back to the bridge's positional #N. Recorded as a
      // knownIssue in app/systems.json; pinning the emitted order here so a
      // fix (emitting the key last) has a test to flip.
      expect(code).toMatch(
        /'Card',Card,\{"data-sq-p":\$\$sqSite\(\$\$props,"src\/pages\/propsSpread\.astro\|\.\/Card\.astro#0","src\/pages\/propsSpread\.astro\|\.\/Card\.astro#0","src\/pages\/propsSpread\.astro:5:36"\),\.\.\.\(Astro\.props\)\}/,
      );
    });
  });

  it('emits syntactically valid JavaScript for every fixture', async () => {
    // A regex assertion cannot see a broken object literal or an unbalanced
    // template literal. A real parser can. (esbuild refuses to run under
    // jsdom — its TextEncoder invariant fails — so use acorn.)
    const acorn = await import('acorn');
    for (const g of CORPUS) {
      const code = await tag(g);
      expect(() =>
        acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' }),
      ).not.toThrow();
    }
  });

  /**
   * Regression 2026-08-04 — the memoised `__template` branch emitted NO
   * placements at all, so every element of such a file fell back to a bare
   * key: two `<Plain/>` on one page and the same component on two pages all
   * collapsed onto one identity. That is the cross-page-leak defect from a
   * second, independent cause.
   *
   * The old code called the branch unreachable. These fixtures are the real
   * modules @astrojs/compiler 4.16.19 handed the plugin inside a live
   * `astro dev`: a `<script is:inline>` is enough to reach it, in a LAYOUT and
   * in a leaf COMPONENT alike.
   */
  describe('memoised __template modules (reachable, not legacy)', () => {
    const tplByName = (n: string) => TEMPLATE_CORPUS.find((g) => g.name === n)!;

    it('the fixtures really are the __template shape (both branches represented)', () => {
      expect(tplByName('Plain').templated).toBe(true);
      expect(tplByName('Base').templated).toBe(true);
      expect(tplByName('Multi').templated).toBe(true);
      expect(tplByName('nested').templated).toBe(true);
      expect(tplByName('Card').templated).toBe(false);
      expect(tplByName('index').templated).toBe(false);
      expect(tplByName('Header').templated).toBe(false);
    });

    it('stamps data-sq-placement on every tagged element of a __template component', async () => {
      const code = await tagTpl(tplByName('Plain'));
      const sources = [...code.matchAll(/ data-sq-source=\\"[^"]+\\"( data-sq-placement=\\"[^"]*\\")?/g)];
      expect(sources.length).toBeGreaterThan(0);
      for (const m of sources) expect(m[1]).toBeTruthy();
    });

    it('substitutes the placement OUTSIDE the memo, per render', async () => {
      const code = await tagTpl(tplByName('Plain'));
      // Wrapping inside `_a || (_a = …)` would freeze the first render's
      // placement onto every later one; the wrap must sit on $$render's arg.
      expect(code).toMatch(/\$\$render\(\$\$sqTpl\(_a \|\| \(_a = __template\(/);
      // task-159: both substitutions ride the SAME wrap offsets.
      expect(code).toMatch(/\)\),\$\$sqPl\(\$\$props\),\$\$sqLq\(\$\$props\),\$\$sqLp\(\$\$props\),\$\$sqAt\(\$\$props\)\)/);
      expect(code).toContain('function $$sqTpl(');
    });

    it('never hands the placement to __template as its `raw` parameter', async () => {
      // The self-inflicted bug this pins: `__template([…],$$sqPl($$props))`
      // parsed fine and rendered `data-sq-placement=""` on every element.
      const code = await tagTpl(tplByName('Plain'));
      expect(code).not.toMatch(/__template\(\[[\s\S]*?\]\s*,\s*\$\$sqPl/);
    });

    it('emits the sentinel ONLY where the wrap exists, so it can never leak', async () => {
      for (const g of TEMPLATE_CORPUS) {
        const out = await transformCompiledOutput(
          g.compiled, g.source, g.filePath, '/rig', 'relative', parse, { placements: true },
        );
        const code = (out as { code: string } | null)?.code ?? '';
        if (code.includes('\\u0000sqp\\u0000')) expect(code).toContain('$$sqTpl(');
        // task-159: the legacy sentinel obeys the same fail-closed rule.
        if (code.includes('\\u0000sql\\u0000')) expect(code).toContain('$$sqTpl(');
      }
    });

    it('a __template LAYOUT gets placements too (its chrome is addressable)', async () => {
      const code = await tagTpl(tplByName('Base'));
      expect(code).toContain('$$sqTpl(');
      expect(code).toMatch(/data-sq-source=\\"src\/layouts\/Base\.astro:\d+:\d+\\" data-sq-placement=/);
    });

    it('leaves the 6-arg (WC/server) call byte-identical — no wrap, no prelude', async () => {
      for (const g of TEMPLATE_CORPUS) {
        const out = await transformCompiledOutput(
          g.compiled, g.source, g.filePath, '/rig', 'relative', parse,
        );
        const code = (out as { code: string } | null)?.code ?? '';
        expect(code).not.toContain('$$sqTpl');
        expect(code).not.toContain('$$sqH');
        expect(code).not.toContain('sqp');
      }
    });

    /**
     * THE CELL ROUND 3 LEFT EMPTY (regression 2026-08-04, second fix).
     *
     * Round 3 only ever tested a `__template` module PLACED BY a page. It never
     * tested a `__template` module that PLACES something — and the branch
     * `return`ed long before `buildPlacementPropReplacements`, its only call
     * site. So a layout carrying one `<script is:inline>` (analytics, a
     * theme-flash guard, `define:vars` JSON-LD — the things that live in a ROOT
     * layout, the one file that places site-wide <Header/>/<Nav/>/<Footer/>)
     * handed every component it placed a BARE key.
     *
     * Measured on a live astro dev 4.16.19 rig before the fix: `<Header/>`'s
     * `<h1>` rendered `data-sq-placement=""` on `/` AND on `/about`, while the
     * same layout without the script gave `p29d5caf80024f194`. Two `<Card/>` in
     * one such layout also collapsed onto one bare identity.
     */
    describe('a __template module that PLACES a component', () => {
      it('gives every component it places a data-sq-p prop', async () => {
        const code = await tagTpl(tplByName('Multi'));
        expect(code).toContain(
          `"Header", Header, {"data-sq-p":$$sqSite($$props,"src/layouts/Multi.astro|../components/Header.astro#0","src/layouts/Multi.astro|../components/Header.astro#0","src/layouts/Multi.astro:9:5"),`,
        );
      });

      it('gives two invocations of ONE component distinct sites (no collapse)', async () => {
        const code = await tagTpl(tplByName('Multi'));
        const sites = [
          ...code.matchAll(/"Card", Card, \{"data-sq-p":\$\$sqSite\(\$\$props,"([^"]+)"/g),
        ].map((m) => m[1]);
        expect(sites).toEqual([
          'src/layouts/Multi.astro|../components/Card.astro#0',
          'src/layouts/Multi.astro|../components/Card.astro#1',
        ]);
      });

      it('still wraps its own strings so its own elements stay per-placement', async () => {
        const code = await tagTpl(tplByName('Multi'));
        expect(code).toMatch(/\$\$render\(\$\$sqTpl\(_a \|\| \(_a = __template\(/);
        expect(code).toMatch(/\)\),\$\$sqPl\(\$\$props\),\$\$sqLq\(\$\$props\),\$\$sqLp\(\$\$props\),\$\$sqAt\(\$\$props\)\)/);
        expect(code).not.toMatch(/__template\(\[[\s\S]*?\]\s*,\s*\$\$sqPl/);
      });

      it('reaches an invocation that sits BEFORE the array (slot-closure shape)', async () => {
        // `nested` is a PAGE whose `__template` lives inside the layout's slot
        // closure: <Clean> is compiled before the array, <Card /> after it.
        // Both must be tagged, in source order.
        const code = await tagTpl(tplByName('nested'));
        expect(code).toContain(
          `"Clean", Clean, {"data-sq-p":$$sqSite($$props,"src/pages/nested.astro|../layouts/Clean.astro#0","src/pages/nested.astro|../layouts/Clean.astro#0","src/pages/nested.astro:5:1"),`,
        );
        expect(code).toContain(
          `"Card", Card, {"data-sq-p":$$sqSite($$props,"src/pages/nested.astro|../components/Card.astro#0","src/pages/nested.astro|../components/Card.astro#0","src/pages/nested.astro:7:3"),`,
        );
      });

      it('ships the prelude whenever it emitted $$sqSite', async () => {
        for (const name of ['Multi', 'nested']) {
          const code = await tagTpl(tplByName(name));
          expect(code.startsWith('function $$sqH(')).toBe(true);
          expect(code).toContain('function $$sqSite(');
        }
      });

      it('is silent no more: warns when a placement has no compiled call site', async () => {
        const g = tplByName('Multi');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          await transformCompiledOutput(
            // Reformat past RENDER_COMPONENT_PATTERN so nothing matches.
            g.compiled.replace(/\$\$renderComponent\(/g, '$$$$renderComponentX('),
            g.source,
            g.filePath,
            '/rig',
            'relative',
            parse,
            { placements: true },
          );
          const msgs = warn.mock.calls.map((c) => String(c[0]));
          expect(msgs.some((m) => m.includes('no compiled call site for <Header>'))).toBe(true);
          expect(msgs.some((m) => m.includes('no compiled call site for <Card>'))).toBe(true);
        } finally {
          warn.mockRestore();
        }
      });
    });

    it('emits syntactically valid JavaScript for every __template fixture', async () => {
      const acorn = await import('acorn');
      for (const g of TEMPLATE_CORPUS) {
        const code = await tagTpl(g);
        expect(() =>
          acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' }),
        ).not.toThrow();
      }
    });
  });

  /**
   * task-148 item 7 — FIELD 3, THE USAGE SITE.
   *
   * The tagger already computed `<placing file>:<line>:<col>` for every
   * invocation and hashed it away into the `p…` chain; field 3 now carries it
   * verbatim so "remove this component from THIS page" has a write target that
   * is not derived. Ledger:
   * ../../../../docs/archive/plans/2026-08-10-task-148-usage-selection-ledger.md
   */
  describe('field 3 — the raw invocation site (task-148 item 7)', () => {
    /** Evaluate the emitted prelude and hand back its helpers. */
    async function helpers() {
      const code = await tag(byName('page'));
      const prelude = code.slice(0, code.indexOf('\nimport {'));
      return new Function(
        `${prelude}\nreturn { sqSite: $$sqSite, sqPl: $$sqPl, sqLq: $$sqLq, sqLp: $$sqLp, sqAt: $$sqAt };`,
      )() as {
        sqSite: (p: unknown, s: string, q: string, l: string) => string;
        sqPl: (p: unknown) => string;
        sqLq: (p: unknown) => string;
        sqLp: (p: unknown) => string;
        sqAt: (p: unknown) => string;
      };
    }

    it('appends the site RAW, leaving fields 0-2 byte-identical (C-B4)', async () => {
      const h = await helpers();
      const site = 'src/pages/index.astro:21:5';
      const value = h.sqSite(undefined, 'S', 'Q', site);
      const fields = value.split(' ');
      expect(fields).toHaveLength(4);
      expect(fields[3]).toBe(site);

      // THE INVARIANT THIS FEATURE MUST NOT BREAK: field 2 is the hash of the
      // very same string, and it must still be what it was BEFORE field 3
      // existed — otherwise KEY_SCHEME bumps and every stored override is set
      // aside. `pf2c6bf26aa640ff4` was captured off the LIVE fixture instance
      // (served bytes, 2026-08-10) with the pre-change tagger.
      expect(fields[2]).toBe('pf2c6bf26aa640ff4');
      expect(h.sqPl({ 'data-sq-p': value })).toBe(fields[0]);
      expect(h.sqLq({ 'data-sq-p': value })).toBe(fields[1]);
      expect(h.sqLp({ 'data-sq-p': value })).toBe('pf2c6bf26aa640ff4');
    });

    it('reads field 3 back with slice().join(" "), so a SPACED path survives (C-B1)', async () => {
      const h = await helpers();
      const spaced = 'src/components/My Card.astro:3:1';
      const value = h.sqSite(undefined, 'S', 'Q', spaced);
      // `[3]` would truncate this to "src/components/My" — a different file,
      // and a write target pointing at nothing. That is why the field is LAST.
      expect(h.sqAt({ 'data-sq-p': value })).toBe(spaced);
    });

    it('a page file\'s own element has no prop, so the usage is "" (C-B3)', async () => {
      const h = await helpers();
      // Page files receive no `data-sq-p`; the empty value is a real answer and
      // parses to "no usage", which is what terminates the re-target.
      expect(h.sqAt(undefined)).toBe('');
      expect(h.sqAt({})).toBe('');
    });

    it('chains fields 0-2 off the parent but never chains field 3', async () => {
      const h = await helpers();
      const parent = h.sqSite(undefined, 'S1', 'Q1', 'src/layouts/Base.astro:9:5');
      const child = h.sqSite({ 'data-sq-p': parent }, 'S2', 'Q2', 'src/components/Card.astro:6:3');
      const cf = child.split(' ');
      // 0-2 differ from the un-chained form (they hash the parent in)…
      expect(cf.slice(0, 3)).not.toEqual(
        h.sqSite(undefined, 'S2', 'Q2', 'src/components/Card.astro:6:3').split(' ').slice(0, 3),
      );
      // …but field 3 is this invocation's OWN site, never the parent's. A
      // chained value would name the wrong file and the re-target would write
      // a file the user is not looking at.
      expect(cf[3]).toBe('src/components/Card.astro:6:3');
    });
  });
});
