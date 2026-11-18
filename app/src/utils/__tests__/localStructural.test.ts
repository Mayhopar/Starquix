/**
 * task-133 Task 4: shared placement resolver + post-write selection
 * prediction for local-mode structural ops (utils/localStructural.ts).
 */
import { describe, it, expect } from 'vitest';
import type { ScannedElement } from '@/context/SelectionContext';
import {
  resolveInsertTarget,
  resolvePageFileAnchor,
  predictSelectionKey,
  matchPredictedKey,
  buildLocalComponentInsert,
} from '../localStructural';

const PAGE = 'src/pages/index.astro';

function el(
  over: Partial<ScannedElement> & { key: string; tagName: string }
): ScannedElement {
  return {
    classes: '',
    rect: { top: 0, left: 0, width: 0, height: 0 },
    parentKey: null,
    hasSourceTracking: true,
    ...over,
  };
}

/** Element whose key/sourceLocation agree: `${file}:${line}:${col}`. */
function srcEl(
  file: string,
  line: number,
  col: number,
  tagName: string,
  over: Partial<ScannedElement> = {}
): ScannedElement {
  return el({
    key: `${file}:${line}:${col}`,
    tagName,
    sourceLocation: { file, line, column: col },
    ...over,
  });
}

describe('resolveInsertTarget', () => {
  it('container selected → inside-end at its own location', () => {
    const sel = srcEl(PAGE, 10, 3, 'div');
    expect(resolveInsertTarget(sel, [sel], PAGE)).toEqual({
      loc: { file: PAGE, line: 10, column: 3 },
      position: 'inside-end',
    });
  });

  it('void tag selected (img) → after', () => {
    const sel = srcEl(PAGE, 4, 5, 'img');
    expect(resolveInsertTarget(sel, [sel], PAGE)).toEqual({
      loc: { file: PAGE, line: 4, column: 5 },
      position: 'after',
    });
  });

  it('another void tag (br) → after; unknown tag treated as container', () => {
    const br = srcEl(PAGE, 4, 5, 'br');
    expect(resolveInsertTarget(br, [br], PAGE)).toMatchObject({ position: 'after' });
    const section = srcEl(PAGE, 6, 1, 'section');
    expect(resolveInsertTarget(section, [section], PAGE)).toMatchObject({
      position: 'inside-end',
    });
  });

  it('instance-suffixed selection (#n) → component-instance error', () => {
    const sel = el({
      key: 'src/components/Hero.astro:5:1#1',
      tagName: 'div',
      sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
    });
    expect(resolveInsertTarget(sel, [sel], PAGE)).toEqual({
      error: 'component-instance',
    });
  });

  it('selection in a DIFFERENT file than pageFile is valid — targets the component file', () => {
    const sel = srcEl('src/components/Header.astro', 7, 2, 'nav');
    expect(resolveInsertTarget(sel, [sel], PAGE)).toEqual({
      loc: { file: 'src/components/Header.astro', line: 7, column: 2 },
      position: 'inside-end',
    });
  });

  it('no selection → last root-level pageFile element, inside-end when container', () => {
    const main = srcEl(PAGE, 8, 1, 'main');
    const child = srcEl(PAGE, 9, 3, 'div', { parentKey: main.key });
    const early = srcEl(PAGE, 5, 1, 'header');
    expect(resolveInsertTarget(null, [early, main, child], PAGE)).toEqual({
      loc: { file: PAGE, line: 8, column: 1 },
      position: 'inside-end',
    });
  });

  it('no selection → nested children never win over roots even when later by line', () => {
    const main = srcEl(PAGE, 8, 1, 'main');
    const deep = srcEl(PAGE, 20, 5, 'p', { parentKey: main.key });
    expect(resolveInsertTarget(null, [main, deep], PAGE)).toEqual({
      loc: { file: PAGE, line: 8, column: 1 },
      position: 'inside-end',
    });
  });

  it('no selection, last root is a heading/text leaf → after (never nest page content inside a heading)', () => {
    // Regression 2026-09-20 (MCP live run): add_page_content with no anchor
    // wrote <h1> INSIDE the page's last <h2> → h2 > h2 > h1 in index.astro.
    const h2 = srcEl(PAGE, 20, 5, 'h2');
    expect(resolveInsertTarget(null, [h2], PAGE)).toEqual({ loc: { file: PAGE, line: 20, column: 5 }, position: 'after' });
    const span = srcEl(PAGE, 21, 5, 'span');
    expect(resolveInsertTarget(null, [span], PAGE)).toMatchObject({ position: 'after' });
    const main = srcEl(PAGE, 22, 1, 'main');
    expect(resolveInsertTarget(null, [main], PAGE)).toMatchObject({ position: 'inside-end' });
  });
  it('no selection, last root is a section/footer/nav → after (a new section sits beside the last one, never inside it)', () => {
    // Regression 2026-09-20 (MCP live run): the page footer was appended INSIDE the last <section>.
    for (const tag of ['section', 'footer', 'header', 'nav', 'article', 'form']) {
      expect(resolveInsertTarget(null, [srcEl(PAGE, 30, 5, tag)], PAGE)).toMatchObject({ position: 'after' });
    }
  });
  it('no selection, last root is void → after', () => {
    const img = srcEl(PAGE, 12, 1, 'img');
    expect(resolveInsertTarget(null, [img], PAGE)).toEqual({
      loc: { file: PAGE, line: 12, column: 1 },
      position: 'after',
    });
  });

  it('no selection: element whose parent lives in another file counts as root', () => {
    const other = srcEl('src/layouts/Base.astro', 3, 1, 'body');
    const main = srcEl(PAGE, 8, 1, 'main', { parentKey: other.key });
    expect(resolveInsertTarget(null, [other, main], PAGE)).toEqual({
      loc: { file: PAGE, line: 8, column: 1 },
      position: 'inside-end',
    });
  });

  it('no selection: instance-suffixed copies are skipped in the fallback', () => {
    // fixture tag: a wrapper (main) — sectioning tags are appended AFTER since 2026-09-20
    const base = srcEl(PAGE, 8, 1, 'main');
    const copy = el({
      key: `${PAGE}:8:1#1`,
      tagName: 'main',
      sourceLocation: { file: PAGE, line: 8, column: 1 },
    });
    const res = resolveInsertTarget(null, [base, copy], PAGE);
    expect(res).toEqual({
      loc: { file: PAGE, line: 8, column: 1 },
      position: 'inside-end',
    });
  });

  it('selection without sourceLocation falls back to the no-selection heuristic', () => {
    const untracked = el({ key: 'drawn-1', tagName: 'div', hasSourceTracking: false });
    const main = srcEl(PAGE, 8, 1, 'main');
    expect(resolveInsertTarget(untracked, [untracked, main], PAGE)).toEqual({
      loc: { file: PAGE, line: 8, column: 1 },
      position: 'inside-end',
    });
  });

  // Fix 1 (task-148): a component-only page (layout + component tags, no
  // Astro.props spread) has NO scanned node keyed to the page file. That is
  // the shape of essentially every real Astro page — it must resolve to the
  // page-BODY anchor (resolved server-side from the file), never 'no-target'.
  it('component-only page (no scanned node for pageFile) → pageBody', () => {
    const other = srcEl('src/components/Header.astro', 2, 1, 'nav');
    expect(resolveInsertTarget(null, [other], PAGE)).toEqual({ pageBody: true });
  });

  it('empty scan (preview still booting) → pageBody', () => {
    expect(resolveInsertTarget(null, [], PAGE)).toEqual({ pageBody: true });
  });

  it('no page file at all → no-target (the ONLY remaining no-target case)', () => {
    expect(resolveInsertTarget(null, [], null)).toEqual({ error: 'no-target' });
    expect(resolveInsertTarget(null, [], '')).toEqual({ error: 'no-target' });
  });

  it('a selected element still wins over the page-body anchor', () => {
    const sel = srcEl('src/components/Header.astro', 7, 2, 'nav');
    expect(resolveInsertTarget(sel, [sel], PAGE)).toEqual({
      loc: { file: 'src/components/Header.astro', line: 7, column: 2 },
      position: 'inside-end',
    });
  });

  it('instance-suffixed selection is still refused, never routed to pageBody', () => {
    const sel = el({
      key: 'src/components/Hero.astro:5:1#1',
      tagName: 'div',
      sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
    });
    expect(resolveInsertTarget(sel, [], PAGE)).toEqual({ error: 'component-instance' });
  });
});

// task-149: ⌘K "add component" did nothing on any real page — every visible
// element belongs to a component, so the target was always cross-file and the
// write-scope guard refused it. The anchor is clamped back into the page file.
describe('resolvePageFileAnchor', () => {
  it('same-file selection is returned untouched', () => {
    const sel = srcEl(PAGE, 10, 3, 'div');
    expect(resolvePageFileAnchor(sel, [sel], PAGE)).toBe(sel);
  });

  it('cross-file selection → nearest ancestor that lives in the page file', () => {
    const wrapper = srcEl(PAGE, 12, 5, 'div');
    const inner = srcEl('src/components/Card.astro', 4, 1, 'p', { parentKey: wrapper.key });
    const leaf = srcEl('src/components/Card.astro', 6, 3, 'span', { parentKey: inner.key });
    expect(resolvePageFileAnchor(leaf, [wrapper, inner, leaf], PAGE)).toBe(wrapper);
  });

  it('no page-file ancestor (component-only page) → null, so the caller uses the page body', () => {
    const outer = srcEl('src/layouts/Main.astro', 20, 2, 'body');
    const sel = srcEl('src/components/Card.astro', 4, 1, 'p', { parentKey: outer.key });
    expect(resolvePageFileAnchor(sel, [outer, sel], PAGE)).toBeNull();
    expect(resolveInsertTarget(null, [outer, sel], PAGE)).toEqual({ pageBody: true });
  });

  it('an instance-suffixed ancestor is skipped (loop copies are not anchorable)', () => {
    const root = srcEl(PAGE, 2, 1, 'main');
    const copy = el({
      key: `${PAGE}:8:3#2`,
      tagName: 'li',
      sourceLocation: { file: PAGE, line: 8, column: 3 },
      parentKey: root.key,
    });
    const sel = srcEl('src/components/Card.astro', 4, 1, 'p', { parentKey: copy.key });
    expect(resolvePageFileAnchor(sel, [root, copy, sel], PAGE)).toBe(root);
  });

  it('a parentKey cycle terminates instead of hanging', () => {
    const a = srcEl('src/components/A.astro', 1, 1, 'div', { parentKey: 'src/components/B.astro:1:1' });
    const b = srcEl('src/components/B.astro', 1, 1, 'div', { parentKey: a.key });
    expect(resolvePageFileAnchor(a, [a, b], PAGE)).toBeNull();
  });

  it('null selection / null pageFile pass straight through', () => {
    const sel = srcEl(PAGE, 3, 1, 'div');
    expect(resolvePageFileAnchor(null, [], PAGE)).toBeNull();
    expect(resolvePageFileAnchor(sel, [sel], null)).toBe(sel);
  });
});

describe('predictSelectionKey', () => {
  it('returns the file:line: prefix', () => {
    expect(predictSelectionKey(PAGE, 12)).toBe(`${PAGE}:12:`);
  });
});

describe('matchPredictedKey', () => {
  const pred = predictSelectionKey(PAGE, 5);

  it('matches exact line with any column (prefix)', () => {
    expect(matchPredictedKey(pred, [`${PAGE}:4:1`, `${PAGE}:5:7`])).toBe(`${PAGE}:5:7`);
  });

  it('exact line beats +1', () => {
    expect(matchPredictedKey(pred, [`${PAGE}:6:1`, `${PAGE}:5:1`])).toBe(`${PAGE}:5:1`);
  });

  it('falls back to line+1 when exact missing', () => {
    expect(matchPredictedKey(pred, [`${PAGE}:6:1`, `${PAGE}:9:1`])).toBe(`${PAGE}:6:1`);
  });

  it('+1 beats -1', () => {
    expect(matchPredictedKey(pred, [`${PAGE}:4:1`, `${PAGE}:6:1`])).toBe(`${PAGE}:6:1`);
  });

  it('falls back to line-1 when exact and +1 missing', () => {
    expect(matchPredictedKey(pred, [`${PAGE}:4:2`])).toBe(`${PAGE}:4:2`);
  });

  it('never matches a different file, longer line numbers, or nothing', () => {
    expect(matchPredictedKey(pred, [`src/pages/about.astro:5:1`])).toBeNull();
    // line 51 must NOT satisfy the line-5 prefix
    expect(matchPredictedKey(pred, [`${PAGE}:51:1`])).toBeNull();
    expect(matchPredictedKey(pred, [])).toBeNull();
  });

  it('skips instance-suffixed keys in favor of the base key', () => {
    expect(matchPredictedKey(pred, [`${PAGE}:5:1#1`, `${PAGE}:5:1`])).toBe(`${PAGE}:5:1`);
    // only a suffixed key present → not a valid prediction target
    expect(matchPredictedKey(pred, [`${PAGE}:5:1#1`])).toBeNull();
  });

  // task-133 Task 5 carry-forward (b): component inserts must not fuzz to ±1 —
  // when the inserted component's own key never surfaces (no Astro.props
  // spread → no data-sq-source on its root), ±1 selects a shifted SIBLING.
  describe('exactLineOnly', () => {
    it('still matches the exact line', () => {
      expect(matchPredictedKey(pred, [`${PAGE}:5:7`], { exactLineOnly: true })).toBe(`${PAGE}:5:7`);
    });

    it('refuses line+1 and line-1', () => {
      expect(matchPredictedKey(pred, [`${PAGE}:6:1`], { exactLineOnly: true })).toBeNull();
      expect(matchPredictedKey(pred, [`${PAGE}:4:1`], { exactLineOnly: true })).toBeNull();
      expect(matchPredictedKey(pred, [`${PAGE}:4:1`, `${PAGE}:6:1`], { exactLineOnly: true })).toBeNull();
    });
  });
});

describe('buildLocalComponentInsert', () => {
  it('sibling-dir component from a top-level page', () => {
    expect(
      buildLocalComponentInsert(
        { name: 'Header', path: 'src/components/Header.astro' },
        'src/pages/index.astro'
      )
    ).toEqual({
      tagMarkup: '<Header />',
      importName: 'Header',
      importPath: '../components/Header.astro',
    });
  });

  it('nested page needs an extra ..', () => {
    expect(
      buildLocalComponentInsert(
        { name: 'Header', path: 'src/components/Header.astro' },
        'src/pages/blog/post.astro'
      ).importPath
    ).toBe('../../components/Header.astro');
  });

  it('same-dir component gets ./ prefix', () => {
    expect(
      buildLocalComponentInsert(
        { name: 'Widget', path: 'src/pages/Widget.astro' },
        'src/pages/index.astro'
      ).importPath
    ).toBe('./Widget.astro');
  });

  it('sanitizes messy names to PascalCase', () => {
    const r = buildLocalComponentInsert(
      { name: 'my cool-header', path: 'src/components/x.astro' },
      'src/pages/index.astro'
    );
    expect(r.importName).toBe('MyCoolHeader');
    expect(r.tagMarkup).toBe('<MyCoolHeader />');
  });

  it('strips leading digits, capitalizes the survivor', () => {
    expect(
      buildLocalComponentInsert(
        { name: '3d card', path: 'src/components/x.astro' },
        'src/pages/index.astro'
      ).importName
    ).toBe('DCard');
  });

  it('throws when no valid identifier survives sanitization', () => {
    expect(() =>
      buildLocalComponentInsert(
        { name: '###', path: 'src/components/x.astro' },
        'src/pages/index.astro'
      )
    ).toThrow();
    expect(() =>
      buildLocalComponentInsert(
        { name: '123', path: 'src/components/x.astro' },
        'src/pages/index.astro'
      )
    ).toThrow();
  });
});

describe('resolveInsertTarget — no-block-children tags (C5 local, 2026-08-26)', () => {
  // Disk-proven defect: a draw over a <p> spliced the new <div> INSIDE the
  // <p> tag. HTML auto-closes <p> before block content, so the browser hoists
  // the element out — the file holds invalid markup that renders somewhere
  // the user never drew. A <p> target must anchor AFTER, like a void tag.
  it('a <p> target → after, never inside-end', () => {
    const sel = srcEl(PAGE, 7, 2, 'p');
    expect(resolveInsertTarget(sel, [sel], PAGE)).toEqual({
      loc: { file: PAGE, line: 7, column: 2 },
      position: 'after',
    });
  });

  it('fallback anchor on a page whose last root is a <p> → after', () => {
    const p = srcEl(PAGE, 9, 1, 'p');
    expect(resolveInsertTarget(null, [p], PAGE)).toEqual({
      loc: { file: PAGE, line: 9, column: 1 },
      position: 'after',
    });
  });
});
