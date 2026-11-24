// task-133: structural AST ops (insert/remove/move at keyed locations).
// Imports THE plugin implementation (single source, parity law).
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import {
  resolveElementSpan,
  insertMarkupAtLocation,
  removeElementAtLocation,
  restoreSourceAtLocation,
  restoreRegionAtLocation,
  moveElement,
  addImportToFrontmatter,
  removeImportFromFrontmatter,
  appendToPageBody,
} from '../../../../preview-template/src/plugins/sq-source-plugin.js';
import { unusedDefaultImports } from '../../../../preview-template/src/plugins/sq-source-transforms.js';

const FILE = `---
const x = 1;
---
<section class="page">
  <h1>Title</h1>
  <div class="hero">
    <p>First</p>
    <p>Second</p>
  </div>
  <aside class="box">
    <p>Box</p>
  </aside>
  <img class="logo" src="/a.png" />
  <img class="plain" src="/b.png">
  <Header client:load />
  <footer>End</footer>
</section>
`;
// line map (1-based): 4 <section>, 5 <h1>, 6 <div>, 7 <p>First, 8 <p>Second,
// 9 </div>, 10 <aside>, 11 <p>Box, 12 </aside>, 13 img/>, 14 img, 15 <Header>,
// 16 <footer>, 17 </section>

const loc = (line: number, column: number) => ({ file: 'x.astro', line, column });

describe('resolveElementSpan', () => {
  it('resolves a full open..close span', () => {
    const span = resolveElementSpan(FILE, loc(5, 3));
    expect(FILE.slice(span.start, span.end)).toBe('<h1>Title</h1>');
    expect(span.tag).toBe('h1');
    expect(span.voidLike).toBe(false);
  });

  it('marks self-closing and void tags voidLike (span = opening tag only)', () => {
    const selfClosing = resolveElementSpan(FILE, loc(13, 3));
    expect(FILE.slice(selfClosing.start, selfClosing.end)).toBe('<img class="logo" src="/a.png" />');
    expect(selfClosing.voidLike).toBe(true);
    const voidTag = resolveElementSpan(FILE, loc(14, 3));
    expect(FILE.slice(voidTag.start, voidTag.end)).toBe('<img class="plain" src="/b.png">');
    expect(voidTag.voidLike).toBe(true);
  });

  it('throws on an unresolvable location', () => {
    expect(() => resolveElementSpan(FILE, loc(100, 1))).toThrow(/Could not find opening tag/);
  });
});

describe('insertMarkupAtLocation', () => {
  it('inside-end lands before the closing tag, indented one level deeper', () => {
    const out = insertMarkupAtLocation(FILE, loc(6, 3), '<p>Third</p>', 'inside-end');
    expect(out.content).toContain('    <p>Second</p>\n    <p>Third</p>\n  </div>');
    expect(out.insertedLine).toBe(9);
  });

  it('before lands on the target line, target pushed down', () => {
    const out = insertMarkupAtLocation(FILE, loc(5, 3), '<p>Intro</p>', 'before');
    expect(out.content).toContain('<section class="page">\n  <p>Intro</p>\n  <h1>Title</h1>');
    expect(out.insertedLine).toBe(5);
  });

  it('after lands on the next line, same indent', () => {
    const out = insertMarkupAtLocation(FILE, loc(5, 3), '<p>Intro</p>', 'after');
    expect(out.content).toContain('  <h1>Title</h1>\n  <p>Intro</p>\n  <div class="hero">');
    expect(out.insertedLine).toBe(6);
  });

  it('multi-line markup keeps relative indentation', () => {
    const out = insertMarkupAtLocation(FILE, loc(6, 3), '<ul>\n  <li>a</li>\n</ul>', 'inside-end');
    expect(out.content).toContain('    <ul>\n      <li>a</li>\n    </ul>\n  </div>');
    expect(out.insertedLine).toBe(9);
  });

  it('inside-end throws on self-closing and void targets; before/after still work', () => {
    expect(() => insertMarkupAtLocation(FILE, loc(13, 3), '<p>x</p>', 'inside-end')).toThrow(/Cannot insert inside <img>/);
    expect(() => insertMarkupAtLocation(FILE, loc(14, 3), '<p>x</p>', 'inside-end')).toThrow(/Cannot insert inside <img>/);
    const before = insertMarkupAtLocation(FILE, loc(13, 3), '<p>x</p>', 'before');
    expect(before.content).toContain('  <p>x</p>\n  <img class="logo" src="/a.png" />');
    expect(before.insertedLine).toBe(13);
    const after = insertMarkupAtLocation(FILE, loc(14, 3), '<p>x</p>', 'after');
    expect(after.content).toContain('  <img class="plain" src="/b.png">\n  <p>x</p>\n  <Header client:load />');
    expect(after.insertedLine).toBe(15);
  });

  // task-133 Task 9 review: undo of a multi-root insert needs remove ×rootCount
  // — a single remove orphans every root after the first and redo duplicates.
  it('reports rootCount 1 for a single root (pin: existing callers unchanged)', () => {
    const out = insertMarkupAtLocation(FILE, loc(6, 3), '<p>Third</p>', 'inside-end');
    expect(out.rootCount).toBe(1);
    const multi = insertMarkupAtLocation(FILE, loc(6, 3), '<ul>\n  <li>a</li>\n</ul>', 'inside-end');
    expect(multi.rootCount).toBe(1); // nested elements are NOT roots
  });

  it('counts top-level roots: 2 on one line, 3 across lines, void/self-closing included', () => {
    expect(insertMarkupAtLocation(FILE, loc(6, 3), '<h2>A</h2><p>B</p>', 'inside-end').rootCount).toBe(2);
    expect(insertMarkupAtLocation(FILE, loc(6, 3), '<h2>A</h2>\n<img src="/x.png" />\n<p>B</p>', 'inside-end').rootCount).toBe(3);
  });

  it('text-only and comment segments between roots are NOT counted as roots', () => {
    expect(insertMarkupAtLocation(FILE, loc(6, 3), '<h2>A</h2>\nplain text\n<p>B</p>', 'inside-end').rootCount).toBe(2);
    expect(insertMarkupAtLocation(FILE, loc(6, 3), '<h2>A</h2>\n<!-- note -->\n<p>B</p>', 'inside-end').rootCount).toBe(2);
  });

  it('roundtrip: multi-root insert → remove ×rootCount at insertedLine → byte-identical', () => {
    for (const markup of ['<h2>A</h2><p>B</p>', '<h2>A</h2>\n<p>B</p>', '<h2>A</h2>\n<div>\n  <p>x</p>\n</div>\n<p>B</p>']) {
      const ins = insertMarkupAtLocation(FILE, loc(6, 3), markup, 'inside-end');
      let content = ins.content;
      for (let i = 0; i < ins.rootCount; i++) {
        content = removeElementAtLocation(content, loc(ins.insertedLine, 1)).content;
      }
      expect(content).toBe(FILE);
    }
  });

  // task-133 LIVE SMOKE (Critical): insert and remove are ASYMMETRIC in the
  // mid-line-break case — the splice splits a single-line target's inline
  // closing tag onto its own line (+2 lines), but remove-at-insertedLine takes
  // only the inserted element's line (−1) and never rejoins the split. The
  // insert result now reports the exact rewritten region
  // {replacedLine, replacedLineCount, originalSegment} so the inverse is ONE
  // byte-exact region restore.
  describe('insert region fields (mid-line splice undo asymmetry)', () => {
    it('own-line insert: region = the inserted lines, empty originalSegment', () => {
      const out = insertMarkupAtLocation(FILE, loc(5, 3), '<p>Intro</p>', 'before');
      expect(out.replacedLine).toBe(5);
      expect(out.replacedLineCount).toBe(1);
      expect(out.originalSegment).toBe('');
    });

    it('end-of-line insert (after): region = the inserted lines, empty originalSegment', () => {
      const out = insertMarkupAtLocation(FILE, loc(5, 3), '<p>Intro</p>', 'after');
      expect(out.replacedLine).toBe(6);
      expect(out.replacedLineCount).toBe(1);
      expect(out.originalSegment).toBe('');
    });

    it('mid-line insert (inline closing tag): region covers the SPLIT line, segment = original line bytes', () => {
      // <footer>End</footer> on line 16 — inside-end splits it into 3 lines
      const out = insertMarkupAtLocation(FILE, loc(16, 3), '<p>x</p>', 'inside-end');
      expect(out.replacedLine).toBe(16);
      expect(out.replacedLineCount).toBe(3);
      expect(out.originalSegment).toBe('  <footer>End</footer>\n');
    });

    it('EOF-append insert: region includes the rewritten last line, segment = its original bytes', () => {
      const src = '<section>\n  <p>a</p>\n</section>'; // NO trailing newline
      const out = insertMarkupAtLocation(src, loc(1, 1), '<p>b</p>', 'after');
      expect(out.replacedLine).toBe(3);
      expect(out.replacedLineCount).toBe(2);
      expect(out.originalSegment).toBe('</section>');
    });

    it('multi-line block mid-line: count = 2 + block lines', () => {
      const out = insertMarkupAtLocation(FILE, loc(16, 3), '<ul>\n  <li>a</li>\n</ul>', 'inside-end');
      expect(out.replacedLineCount).toBe(5);
      expect(out.originalSegment).toBe('  <footer>End</footer>\n');
    });
  });

  describe('restoreRegionAtLocation (insert inverse)', () => {
    const insRoundtrip = (src: string, l: number, c: number, markup: string, position: 'before' | 'after' | 'inside-end') => {
      const ins = insertMarkupAtLocation(src, loc(l, c), markup, position);
      const back = restoreRegionAtLocation(
        ins.content,
        loc(ins.replacedLine, 1),
        ins.replacedLineCount,
        ins.originalSegment,
      );
      return back.content;
    };

    it('own-line insert restore-region is byte-exact', () => {
      expect(insRoundtrip(FILE, 5, 3, '<p>Intro</p>', 'before')).toBe(FILE);
      expect(insRoundtrip(FILE, 5, 3, '<p>Intro</p>', 'after')).toBe(FILE);
    });

    it('mid-line insert restore-region is byte-exact (rejoins the split line)', () => {
      expect(insRoundtrip(FILE, 16, 3, '<p>x</p>', 'inside-end')).toBe(FILE);
    });

    it('multi-root insert restore-region is byte-exact in ONE op', () => {
      expect(insRoundtrip(FILE, 6, 3, '<h2>A</h2>\n<p>B</p>', 'inside-end')).toBe(FILE);
      expect(insRoundtrip(FILE, 16, 3, '<h2>A</h2><p>B</p>', 'inside-end')).toBe(FILE);
    });

    it('EOF-append insert restore-region is byte-exact (no trailing-newline residue)', () => {
      const src = '<section>\n  <p>a</p>\n</section>';
      expect(insRoundtrip(src, 1, 1, '<p>b</p>', 'after')).toBe(src);
    });

    it('CRLF insert restore-region is byte-exact', () => {
      const crlf = FILE.replace(/\n/g, '\r\n');
      expect(insRoundtrip(crlf, 16, 3, '<p>x</p>', 'inside-end')).toBe(crlf);
    });

    it('EXACT smoke sequence: two mid-line inserts, undo newest-first, byte-identical each step', () => {
      // about.astro fixture: single-line <h1> and <p>
      const about = '---\n---\n<section>\n  <h1>About</h1>\n  <p>Second page of the fixture.</p>\n</section>\n';
      // (1) ⌘K insert Card inside-end of the <p> (line 5) — mid-line, +2
      const step1 = insertMarkupAtLocation(about, loc(5, 3), '<Card />', 'inside-end');
      // (2) draw rect inside-end of the <h1> (line 4) — same class, +2
      const step2 = insertMarkupAtLocation(step1.content, loc(4, 3), '<div class="rect"></div>', 'inside-end');
      // (3) ⌘Z draw: ONE region restore → byte-identical to post-step-1
      const undo2 = restoreRegionAtLocation(
        step2.content, loc(step2.replacedLine, 1), step2.replacedLineCount, step2.originalSegment,
      );
      expect(undo2.content).toBe(step1.content);
      // (4) ⌘Z insert: byte-identical to the baseline — the OLD inverse
      // (remove at insertedLine) resolved the whole <p> here and deleted it.
      const undo1 = restoreRegionAtLocation(
        undo2.content, loc(step1.replacedLine, 1), step1.replacedLineCount, step1.originalSegment,
      );
      expect(undo1.content).toBe(about);
    });

    it('strict errors: line/lineCount out of range, non-string segment', () => {
      expect(() => restoreRegionAtLocation(FILE, loc(999, 1), 1, 'x')).toThrow(/out of range/);
      expect(() => restoreRegionAtLocation(FILE, loc(16, 1), 99, 'x')).toThrow(/out of range/);
      expect(() => restoreRegionAtLocation(FILE, loc(0, 1), 1, 'x')).toThrow(/out of range/);
      expect(() => restoreRegionAtLocation(FILE, loc(16, 1), 0, 'x')).toThrow(/lineCount/);
      expect(() => restoreRegionAtLocation(FILE, loc(16, 1), 1, undefined as never)).toThrow(/segment/);
    });
  });

  it('works when the target is a capitalized component tag', () => {
    const out = insertMarkupAtLocation(FILE, loc(15, 3), '<p>x</p>', 'before');
    expect(out.content).toContain('  <p>x</p>\n  <Header client:load />');
    expect(out.insertedLine).toBe(15);
    expect(() => insertMarkupAtLocation(FILE, loc(15, 3), '<p>x</p>', 'inside-end')).toThrow(/Cannot insert inside <Header>/);
  });

  it('inside-end with an inline closing tag breaks the line cleanly', () => {
    const out = insertMarkupAtLocation(FILE, loc(16, 3), '<p>x</p>', 'inside-end');
    expect(out.content).toContain('  <footer>End\n    <p>x</p>\n  </footer>');
    expect(out.insertedLine).toBe(17);
  });

  it('CRLF content round-trips', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    const out = insertMarkupAtLocation(crlf, loc(6, 3), '<p>Third</p>', 'inside-end');
    expect(out.content).toContain('    <p>Third</p>\r\n  </div>');
    expect(/[^\r]\n/.test(out.content)).toBe(false); // no bare \n
    expect(out.insertedLine).toBe(9);
  });

  it('throws on an unresolvable location and an unknown position', () => {
    expect(() => insertMarkupAtLocation(FILE, loc(100, 1), '<p>x</p>', 'before')).toThrow(/Could not find opening tag/);
    expect(() => insertMarkupAtLocation(FILE, loc(5, 3), '<p>x</p>', 'inside-start' as never)).toThrow(/unknown position/);
  });
});

describe('removeElementAtLocation', () => {
  it('removes the full span incl. closing tag; removedSource byte-exact with swallowed indent+newline', () => {
    const out = removeElementAtLocation(FILE, loc(6, 3));
    expect(out.removedSource).toBe('  <div class="hero">\n    <p>First</p>\n    <p>Second</p>\n  </div>\n');
    expect(out.content).toBe(FILE.replace('  <div class="hero">\n    <p>First</p>\n    <p>Second</p>\n  </div>\n', ''));
    expect(out.removedLine).toBe(6);
  });

  it('removes a void element (open tag only)', () => {
    const out = removeElementAtLocation(FILE, loc(14, 3));
    expect(out.removedSource).toBe('  <img class="plain" src="/b.png">\n');
    expect(out.content).toContain('  <img class="logo" src="/a.png" />\n  <Header client:load />');
    expect(out.removedLine).toBe(14);
  });

  it('keeps nested same-tag children balanced', () => {
    const src = '<section>\n  <div class="outer">\n    <div class="inner">x</div>\n  </div>\n</section>\n';
    const out = removeElementAtLocation(src, loc(2, 3));
    expect(out.content).toBe('<section>\n</section>\n');
    expect(out.removedSource).toBe('  <div class="outer">\n    <div class="inner">x</div>\n  </div>\n');
    expect(out.removedLine).toBe(2);
  });

  it('removing an only child leaves the parent tags intact', () => {
    const src = '<div class="wrap">\n  <p>only</p>\n</div>\n';
    const out = removeElementAtLocation(src, loc(2, 3));
    expect(out.content).toBe('<div class="wrap">\n</div>\n');
    expect(out.removedSource).toBe('  <p>only</p>\n');
  });

  it('does not swallow the line when the element shares it', () => {
    const src = '<div>\n  <span>a</span><span>b</span>\n</div>\n';
    const out = removeElementAtLocation(src, loc(2, 3));
    expect(out.content).toBe('<div>\n  <span>b</span>\n</div>\n');
    expect(out.removedSource).toBe('<span>a</span>');
    expect(out.removedLine).toBe(2);
  });

  it('CRLF content round-trips (content and removedSource)', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    const out = removeElementAtLocation(crlf, loc(6, 3));
    expect(out.removedSource).toBe('  <div class="hero">\r\n    <p>First</p>\r\n    <p>Second</p>\r\n  </div>\r\n');
    expect(/[^\r]\n/.test(out.content)).toBe(false);
  });

  it('throws on an unresolvable location', () => {
    expect(() => removeElementAtLocation(FILE, loc(100, 1))).toThrow(/Could not find opening tag/);
  });

  // task-133 Task 8: undo needs the exact restore point, not just the line —
  // a mid-line removal (element sharing its line) must restore at its column.
  it('returns removedColumn 1 for a swallowed-line removal', () => {
    const out = removeElementAtLocation(FILE, loc(6, 3));
    expect(out.removedColumn).toBe(1);
  });

  it('returns the real column for a mid-line removal', () => {
    const src = '<div>\n  <span>a</span><span>b</span>\n</div>\n';
    const out = removeElementAtLocation(src, loc(2, 3));
    expect(out.removedLine).toBe(2);
    expect(out.removedColumn).toBe(3);
  });
});

// task-133 Task 8: verbatim inverse of remove — splices removedSource back at
// the exact {line, column} with NO re-indent (insertMarkupAtLocation re-indents,
// which breaks byte-fidelity for whitespace-sensitive content).
describe('restoreSourceAtLocation', () => {
  const roundtrip = (src: string, l: number, c: number) => {
    const rem = removeElementAtLocation(src, loc(l, c));
    const back = restoreSourceAtLocation(
      rem.content,
      loc(rem.removedLine, rem.removedColumn),
      rem.removedSource,
    );
    return back.content;
  };

  it('remove → restore is byte-identical (block element)', () => {
    expect(roundtrip(FILE, 6, 3)).toBe(FILE);
  });

  it('remove → restore is byte-identical (void element)', () => {
    expect(roundtrip(FILE, 14, 3)).toBe(FILE);
  });

  it('remove → restore is byte-identical (only child)', () => {
    const src = '<div class="wrap">\n  <p>only</p>\n</div>\n';
    expect(roundtrip(src, 2, 3)).toBe(src);
  });

  it('remove → restore is byte-identical (last element in file)', () => {
    const src = '<section>\n  <p>a</p>\n</section>\n<footer>End</footer>\n';
    expect(roundtrip(src, 4, 1)).toBe(src);
  });

  it('remove → restore is byte-identical (mid-line element, restores at column)', () => {
    const src = '<div>\n  <span>a</span><span>b</span>\n</div>\n';
    expect(roundtrip(src, 2, 3)).toBe(src);
  });

  it('remove → restore is byte-identical for whitespace-sensitive content (<pre>)', () => {
    const src = '<section>\n  <p>a</p>\n  <pre>\nline1\n      line2\n</pre>\n</section>\n';
    expect(roundtrip(src, 3, 3)).toBe(src);
  });

  it('CRLF remove → restore round-trips byte-identically', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    expect(roundtrip(crlf, 6, 3)).toBe(crlf);
  });

  it('returns restoredLine = the requested line', () => {
    const rem = removeElementAtLocation(FILE, loc(6, 3));
    const back = restoreSourceAtLocation(rem.content, loc(rem.removedLine, rem.removedColumn), rem.removedSource);
    expect(back.restoredLine).toBe(6);
  });

  it('throws on empty text', () => {
    expect(() => restoreSourceAtLocation(FILE, loc(5, 1), '')).toThrow(/no source text/);
  });

  it('throws on text that is not an element', () => {
    expect(() => restoreSourceAtLocation(FILE, loc(5, 1), 'plain words\n')).toThrow(/not an element/);
  });

  it('throws on unbalanced element text (same guard as remove)', () => {
    expect(() => restoreSourceAtLocation(FILE, loc(5, 1), '<div>\n  <p>x</p>\n')).toThrow(/unbalanced/);
  });

  it('accepts void-tag text with no closing tag', () => {
    const out = restoreSourceAtLocation(FILE, loc(5, 1), '  <img src="/c.png">\n');
    expect(out.content).toContain('  <img src="/c.png">\n  <h1>Title</h1>');
  });

  it('throws when the line is out of range', () => {
    expect(() => restoreSourceAtLocation(FILE, loc(999, 1), '<p>x</p>\n')).toThrow(/out of range/);
  });

  // review: a stale column must ERROR (fail → drop → toast contract), never
  // silently clamp to a nearby offset — a clamped splice lands wrong bytes.
  it('throws when the column is out of range', () => {
    expect(() => restoreSourceAtLocation(FILE, loc(5, 999), '<p>x</p>\n')).toThrow(/out of range/);
    expect(() => restoreSourceAtLocation(FILE, loc(5, 0), '<p>x</p>\n')).toThrow(/out of range/);
  });
});

describe('moveElement', () => {
  it('moves up within a parent (before an earlier sibling)', () => {
    const out = moveElement(FILE, loc(8, 5), loc(7, 5), 'before');
    expect(out.content).toContain('  <div class="hero">\n    <p>Second</p>\n    <p>First</p>\n  </div>');
    expect(out.insertedLine).toBe(7);
  });

  it('moves down within a parent (after a later sibling)', () => {
    const out = moveElement(FILE, loc(7, 5), loc(8, 5), 'after');
    expect(out.content).toContain('  <div class="hero">\n    <p>Second</p>\n    <p>First</p>\n  </div>');
    expect(out.insertedLine).toBe(8);
  });

  it('moves down across many lines (footer stays balanced, offsets shifted)', () => {
    const out = moveElement(FILE, loc(5, 3), loc(16, 3), 'after');
    expect(out.content).toContain('  <footer>End</footer>\n  <h1>Title</h1>\n</section>');
    expect(out.content.indexOf('<h1>')).toBe(out.content.lastIndexOf('<h1>'));
    expect(out.insertedLine).toBe(16); // h1 line removed above, footer now on 15
  });

  it('moves cross-parent into another element (inside-end, re-indented)', () => {
    const out = moveElement(FILE, loc(7, 5), loc(10, 3), 'inside-end');
    expect(out.content).toContain('  <aside class="box">\n    <p>Box</p>\n    <p>First</p>\n  </aside>');
    expect(out.content).toContain('  <div class="hero">\n    <p>Second</p>\n  </div>');
    expect(out.insertedLine).toBe(11);
  });

  it('throws when moving into its own descendant (overlapping spans)', () => {
    expect(() => moveElement(FILE, loc(6, 3), loc(7, 5), 'inside-end')).toThrow(/own/);
    expect(() => moveElement(FILE, loc(6, 3), loc(6, 3), 'before')).toThrow(/own/);
  });

  it('throws on inside-end of a void target and on an unresolvable location', () => {
    expect(() => moveElement(FILE, loc(5, 3), loc(13, 3), 'inside-end')).toThrow(/Cannot insert inside <img>/);
    expect(() => moveElement(FILE, loc(100, 1), loc(5, 3), 'before')).toThrow(/Could not find opening tag/);
  });

  it('CRLF content round-trips', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    const out = moveElement(crlf, loc(7, 5), loc(8, 5), 'after');
    expect(out.content).toContain('    <p>Second</p>\r\n    <p>First</p>\r\n  </div>');
    expect(/[^\r]\n/.test(out.content)).toBe(false);
  });

  it('moves a child to inside-end of its own parent (reorder to last)', () => {
    const out = moveElement(FILE, loc(7, 5), loc(6, 3), 'inside-end');
    expect(out.content).toContain('  <div class="hero">\n    <p>Second</p>\n    <p>First</p>\n  </div>');
    expect(out.insertedLine).toBe(8);
  });

  // task-133 Task 8: the move result must carry the ORIGINAL bytes + location
  // so undo can remove the block from its new spot and restore it verbatim.
  it('returns removedSource/removedLine/removedColumn of the original region', () => {
    const out = moveElement(FILE, loc(7, 5), loc(8, 5), 'after');
    expect(out.removedSource).toBe('    <p>First</p>\n');
    expect(out.removedLine).toBe(7);
    expect(out.removedColumn).toBe(1);
  });

  it('CRLF move returns a CRLF removedSource', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    const out = moveElement(crlf, loc(7, 5), loc(8, 5), 'after');
    expect(out.removedSource).toBe('    <p>First</p>\r\n');
  });

  // Inverse replay contract: remove-at-insertedLine + restore-at-original
  // reproduces the pre-move file byte-for-byte.
  const moveRoundtrip = (src: string, from: [number, number], to: [number, number], position: 'before' | 'after' | 'inside-end') => {
    const moved = moveElement(src, loc(...from), loc(...to), position);
    const rem = removeElementAtLocation(moved.content, loc(moved.insertedLine, 1));
    const back = restoreSourceAtLocation(
      rem.content,
      loc(moved.removedLine, moved.removedColumn),
      moved.removedSource,
    );
    return back.content;
  };

  it('undo roundtrip: sibling reorder (down) restores the original bytes', () => {
    expect(moveRoundtrip(FILE, [7, 5], [8, 5], 'after')).toBe(FILE);
  });

  it('undo roundtrip: sibling reorder (up) restores the original bytes', () => {
    expect(moveRoundtrip(FILE, [8, 5], [7, 5], 'before')).toBe(FILE);
  });

  it('undo roundtrip: cross-parent inside-end restores the original bytes', () => {
    expect(moveRoundtrip(FILE, [7, 5], [10, 3], 'inside-end')).toBe(FILE);
  });

  it('undo roundtrip: whitespace-sensitive <pre> restores the original bytes', () => {
    const src = '<section>\n  <p>a</p>\n  <pre>\nline1\n      line2\n</pre>\n</section>\n';
    expect(moveRoundtrip(src, [3, 3], [2, 3], 'before')).toBe(src);
  });

  // LIVE SMOKE class applies to MOVE too: a move into a single-line target
  // splits that target's line (mid-line splice) and the old inverse
  // [remove-at-insertedLine, restore] never rejoined it. Move results now
  // carry the same region fields; the inverse is [restore-region, restore].
  it('returns region fields; mid-line move target: region covers the split line', () => {
    const moved = moveElement(FILE, loc(7, 5), loc(16, 3), 'inside-end');
    expect(moved.replacedLine).toBe(15); // footer shifted up 1 by the removal
    expect(moved.replacedLineCount).toBe(3);
    expect(moved.originalSegment).toBe('  <footer>End</footer>\n');
  });

  const moveRegionRoundtrip = (src: string, from: [number, number], to: [number, number], position: 'before' | 'after' | 'inside-end') => {
    const moved = moveElement(src, loc(...from), loc(...to), position);
    const step1 = restoreRegionAtLocation(
      moved.content, loc(moved.replacedLine, 1), moved.replacedLineCount, moved.originalSegment,
    );
    const step2 = restoreSourceAtLocation(
      step1.content, loc(moved.removedLine, moved.removedColumn), moved.removedSource,
    );
    return step2.content;
  };

  it('undo roundtrip via region-restore: mid-line target (single-line footer) is byte-exact', () => {
    expect(moveRegionRoundtrip(FILE, [7, 5], [16, 3], 'inside-end')).toBe(FILE);
  });

  it('undo roundtrip via region-restore: own-line cases stay byte-exact', () => {
    expect(moveRegionRoundtrip(FILE, [7, 5], [8, 5], 'after')).toBe(FILE);
    expect(moveRegionRoundtrip(FILE, [8, 5], [7, 5], 'before')).toBe(FILE);
    expect(moveRegionRoundtrip(FILE, [7, 5], [10, 3], 'inside-end')).toBe(FILE);
  });
});

describe('balance guard — comments/template literals faking tags', () => {
  const COMMENT_FAKE_CLOSE = '<section>\n  <div class="trap">\n    <p>real</p>\n    <!-- </div> -->\n  </div>\n</section>\n';
  const TEMPLATE_FAKE_CLOSE = '<section>\n  <div class="trap">{`text </div> more`}</div>\n</section>\n';
  const COMMENT_FAKE_OPEN = '<section>\n  <div class="trap">\n    <!-- <div> -->\n    <p>real</p>\n  </div>\n</section>\n';
  const EXPR_LT = "<section>\n  <div class=\"ok\">\n    <p>{count < 3 ? 'a' : 'b'}</p>\n  </div>\n</section>\n";

  it('remove throws when a comment contains a fake closing tag (span would truncate)', () => {
    expect(() => removeElementAtLocation(COMMENT_FAKE_CLOSE, loc(2, 3))).toThrow(/unbalanced/);
  });

  it('remove throws when a template literal contains a fake closing tag', () => {
    expect(() => removeElementAtLocation(TEMPLATE_FAKE_CLOSE, loc(2, 3))).toThrow(/unbalanced/);
  });

  it('move throws on the comment fake-close trap (before any splice)', () => {
    expect(() => moveElement(COMMENT_FAKE_CLOSE, loc(2, 3), loc(1, 1), 'inside-end')).toThrow(/unbalanced/);
  });

  it('pin: a comment containing a fake OPENING tag stays safe (resolution throws, no corruption)', () => {
    expect(() => removeElementAtLocation(COMMENT_FAKE_OPEN, loc(2, 3))).toThrow(/Could not find <\/div>/);
  });

  it('pin: a `<` inside an expression body does not trip resolution or the guard', () => {
    const out = removeElementAtLocation(EXPR_LT, loc(2, 3));
    expect(out.content).toBe('<section>\n</section>\n');
    expect(out.removedSource).toContain("{count < 3 ? 'a' : 'b'}");
  });

  // Target-span guard: a truncated close poisons inside-end (splices INTO the
  // comment) and after (span.end sits inside the comment). before only uses
  // span.start and stays safe.
  it('insert inside-end into a fake-close target throws instead of splicing into the comment', () => {
    expect(() => insertMarkupAtLocation(COMMENT_FAKE_CLOSE, loc(2, 3), '<p>x</p>', 'inside-end')).toThrow(/unbalanced/);
    expect(() => insertMarkupAtLocation(TEMPLATE_FAKE_CLOSE, loc(2, 3), '<p>x</p>', 'inside-end')).toThrow(/unbalanced/);
  });

  it('insert after a fake-close target throws (span.end is close-derived too)', () => {
    expect(() => insertMarkupAtLocation(COMMENT_FAKE_CLOSE, loc(2, 3), '<p>x</p>', 'after')).toThrow(/unbalanced/);
  });

  it('insert before a fake-close target still works (start-only, no close dependency)', () => {
    const out = insertMarkupAtLocation(COMMENT_FAKE_CLOSE, loc(2, 3), '<p>x</p>', 'before');
    expect(out.content).toContain('<section>\n  <p>x</p>\n  <div class="trap">');
    expect(out.insertedLine).toBe(2);
  });

  it('move to inside-end of a fake-close target throws', () => {
    const src = '<section>\n  <p>mover</p>\n  <div class="trap">\n    <p>real</p>\n    <!-- </div> -->\n  </div>\n</section>\n';
    expect(() => moveElement(src, loc(2, 3), loc(3, 3), 'inside-end')).toThrow(/unbalanced/);
  });

  it('remove throws when a quoted </div> hides inside an {expr} body (would truncate AND fake-balance)', () => {
    const src = "<section>\n  <div class=\"trap\">{cond ? '</div>' : ''}</div>\n</section>\n";
    expect(() => removeElementAtLocation(src, loc(2, 3))).toThrow(/unbalanced/);
  });

  it("pin: an apostrophe in plain text (<p>don't</p>) does not trip the guard", () => {
    const src = "<section>\n  <p>don't</p>\n</section>\n";
    const out = removeElementAtLocation(src, loc(2, 3));
    expect(out.content).toBe('<section>\n</section>\n');
    expect(out.removedSource).toBe("  <p>don't</p>\n");
  });
});

describe('verbatim move — whitespace-sensitive content', () => {
  it('moving an element containing a multi-line template literal keeps its bytes verbatim', () => {
    const src = '<section>\n  <div class="a">\n    <p>x</p>\n  </div>\n  <div class="code">{`keep\n      these\n  bytes`}</div>\n</section>\n';
    const out = moveElement(src, loc(5, 3), loc(2, 3), 'inside-end');
    expect(out.content).toContain('{`keep\n      these\n  bytes`}');
    expect(out.content.indexOf('class="code"')).toBeGreaterThan(out.content.indexOf('<p>x</p>'));
    expect(out.insertedLine).toBe(4);
  });

  it('moving a <pre> splices verbatim (no re-indent)', () => {
    const src = '<section>\n  <p>a</p>\n  <pre>\nline1\n      line2\n</pre>\n</section>\n';
    const out = moveElement(src, loc(3, 3), loc(2, 3), 'before');
    expect(out.content).toContain('<pre>\nline1\n      line2\n</pre>');
    expect(out.content.indexOf('<pre>')).toBeLessThan(out.content.indexOf('<p>a</p>'));
  });
});

// task-133 Task 2: import management for component inserts (⌘K user components)
describe('addImportToFrontmatter', () => {
  it('appends after the LAST existing import in the frontmatter', () => {
    const src = "---\nimport A from './A.astro';\nconst x = 1;\nimport B from './B.astro';\nconst y = 2;\n---\n<div>x</div>\n";
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe(
      "---\nimport A from './A.astro';\nconst x = 1;\nimport B from './B.astro';\nimport Card from '../components/Card.astro';\nconst y = 2;\n---\n<div>x</div>\n"
    );
  });

  it('frontmatter with no imports — inserts right after the opening ---', () => {
    const src = '---\nconst x = 1;\n---\n<div>x</div>\n';
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe("---\nimport Card from '../components/Card.astro';\nconst x = 1;\n---\n<div>x</div>\n");
  });

  it('no frontmatter — creates one at the top', () => {
    const src = '<div>x</div>\n';
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe("---\nimport Card from '../components/Card.astro';\n---\n<div>x</div>\n");
  });

  it('duplicate (same name AND path) returns the content UNCHANGED (byte-compare no-op)', () => {
    const src = "---\nimport Card from '../components/Card.astro';\n---\n<div>x</div>\n";
    expect(addImportToFrontmatter(src, 'Card', '../components/Card.astro')).toBe(src);
  });

  it('name collision (same name, different path) throws', () => {
    const src = "---\nimport Card from './other/Card.astro';\n---\n<div>x</div>\n";
    expect(() => addImportToFrontmatter(src, 'Card', '../components/Card.astro'))
      .toThrow(/import name Card already used/);
  });

  // review fix 1: multi-line import statements — splicing at the START line
  // landed the new import INSIDE the destructuring braces (syntax error
  // written to the user's real file), and the single-line regex bypassed
  // collision detection for names bound in multi-line clauses.
  it('multi-line import: insert lands AFTER the whole statement (syntactically valid)', () => {
    const src = "---\nimport {\n  Foo,\n  Bar,\n} from './lib';\nconst x = 1;\n---\n<div>x</div>\n";
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe(
      "---\nimport {\n  Foo,\n  Bar,\n} from './lib';\nimport Card from '../components/Card.astro';\nconst x = 1;\n---\n<div>x</div>\n"
    );
  });

  it('collision with a name bound in a multi-line clause throws', () => {
    const src = "---\nimport {\n  Card,\n  Other,\n} from './other';\n---\n<div>x</div>\n";
    expect(() => addImportToFrontmatter(src, 'Card', '../components/Card.astro'))
      .toThrow(/import name Card already used/);
  });

  it('duplicate via a multi-line clause (same name AND path) is a no-op', () => {
    const src = "---\nimport {\n  Card,\n} from '../components/Card.astro';\n---\n<div>x</div>\n";
    expect(addImportToFrontmatter(src, 'Card', '../components/Card.astro')).toBe(src);
  });

  it('a template literal containing an import-looking line does not shift the insert point', () => {
    const src = "---\nimport A from './A.astro';\nconst tpl = `\nimport Fake from './fake';\n`;\n---\n<div>x</div>\n";
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe(
      "---\nimport A from './A.astro';\nimport Card from '../components/Card.astro';\nconst tpl = `\nimport Fake from './fake';\n`;\n---\n<div>x</div>\n"
    );
  });

  // review fix P4c: an import line with a trailing comment fails EOL-anchored
  // termination — the forward scan swallowed the NEXT import as part of ONE
  // statement, bypassing collision/duplicate checks for its name.
  it('P4c: collision with a name on the import AFTER a trailing-comment import throws', () => {
    const src = "---\nimport A from './A.astro'; // needed\nimport B from './B.astro';\n---\n<div>x</div>\n";
    expect(() => addImportToFrontmatter(src, 'B', '../other/B.astro'))
      .toThrow(/import name B already used/);
  });

  it('P4c: duplicate-same-path after a trailing-comment import is a no-op', () => {
    const src = "---\nimport A from './A.astro'; // needed\nimport B from './B.astro';\n---\n<div>x</div>\n";
    expect(addImportToFrontmatter(src, 'B', './B.astro')).toBe(src);
  });

  it('P4: a trailing-comment LAST import anchors correctly (insert after it, no throw)', () => {
    const src = "---\nimport A from './A.astro'; // needed\n---\n<div>x</div>\n";
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe(
      "---\nimport A from './A.astro'; // needed\nimport Card from '../components/Card.astro';\n---\n<div>x</div>\n"
    );
  });

  it('CRLF file gets a CRLF import line and stays CRLF throughout', () => {
    const src = "---\r\nimport A from './A.astro';\r\n---\r\n<div>x</div>\r\n";
    const out = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(out).toBe(
      "---\r\nimport A from './A.astro';\r\nimport Card from '../components/Card.astro';\r\n---\r\n<div>x</div>\r\n"
    );
  });

  // task-133 Task 8 review (HIGH): the import add shifts every BODY line down,
  // so an insert issued next at the scan-time line resolves the WRONG element.
  // The sq:write-import reply carries lineDelta = added lines; the insert
  // caller must offset its target line by it. Pin the two delta values.
  describe('import lineDelta (first-insert misplacement regression)', () => {
    const delta = (before: string, after: string) =>
      after.split('\n').length - before.split('\n').length;

    it('pin: adding to an EXISTING frontmatter adds exactly 1 line', () => {
      const src = '---\nconst x = 1;\n---\n<div>x</div>\n';
      expect(delta(src, addImportToFrontmatter(src, 'Card', '../c/Card.astro'))).toBe(1);
    });

    it('pin: CREATING the frontmatter adds exactly 3 lines', () => {
      const src = '<div>x</div>\n';
      expect(delta(src, addImportToFrontmatter(src, 'Card', '../c/Card.astro'))).toBe(3);
    });

    it('pin: duplicate import (no-op) adds 0 lines', () => {
      const src = "---\nimport Card from '../c/Card.astro';\n---\n<div>x</div>\n";
      expect(delta(src, addImportToFrontmatter(src, 'Card', '../c/Card.astro'))).toBe(0);
    });

    it('probe: stale line targets the WRONG parent after import-add; delta-adjusted line targets the right one', () => {
      const src = '---\nconst x = 1;\n---\n<section>\n  <h1>Title</h1>\n  <div class="hero">\n    <p>a</p>\n  </div>\n</section>\n';
      // scan-time loc of <div class="hero"> = line 6
      const withImport = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
      const d = delta(src, withImport);
      expect(d).toBe(1);
      // stale line 6 now holds <h1> — the tag lands INSIDE the heading
      const stale = insertMarkupAtLocation(withImport, loc(6, 3), '<Card />', 'inside-end');
      expect(stale.content).toContain('Title\n    <Card />');
      expect(stale.content).not.toContain('<Card />\n  </div>');
      // delta-adjusted line 7 resolves the intended div
      const fixed = insertMarkupAtLocation(withImport, loc(6 + d, 3), '<Card />', 'inside-end');
      expect(fixed.content).toContain('    <p>a</p>\n    <Card />\n  </div>');
    });

    it('probe: created-frontmatter (+3) — adjusted line resolves the intended element', () => {
      const src = '<section>\n  <div class="hero">\n    <p>a</p>\n  </div>\n</section>\n';
      const withImport = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
      const d = delta(src, withImport);
      expect(d).toBe(3);
      const fixed = insertMarkupAtLocation(withImport, loc(2 + d, 3), '<Card />', 'inside-end');
      expect(fixed.content).toContain('    <p>a</p>\n    <Card />\n  </div>');
    });
  });
});

describe('removeImportFromFrontmatter', () => {
  it('removes the exact import line for the name (line-clean)', () => {
    const src = "---\nimport A from './A.astro';\nimport Card from '../components/Card.astro';\n---\n<div>x</div>\n";
    expect(removeImportFromFrontmatter(src, 'Card')).toBe("---\nimport A from './A.astro';\n---\n<div>x</div>\n");
  });

  it('no-op when the import is absent', () => {
    const src = "---\nimport A from './A.astro';\n---\n<div>x</div>\n";
    expect(removeImportFromFrontmatter(src, 'Card')).toBe(src);
    expect(removeImportFromFrontmatter('<div>x</div>\n', 'Card')).toBe('<div>x</div>\n');
  });

  it('CRLF file stays CRLF after removal', () => {
    const src = "---\r\nimport A from './A.astro';\r\nimport Card from '../c/Card.astro';\r\n---\r\n<div>x</div>\r\n";
    expect(removeImportFromFrontmatter(src, 'Card')).toBe("---\r\nimport A from './A.astro';\r\n---\r\n<div>x</div>\r\n");
  });

  // task-133 Task 8 review: undo of a frontmatter-CREATING insert must remove
  // the fences too — `---\n---` residue is not byte-exact and leaves every
  // deeper structural entry +2 lines stale (stale lines silently resolve
  // wrong elements). Collapse is FLAG-driven only (the caller knows the
  // forward op created the frontmatter) — never inferred from content.
  describe('removeFences (created-frontmatter collapse)', () => {
    it('flagged: removing the only import collapses the then-empty fence pair', () => {
      const src = "---\nimport Card from '../c/Card.astro';\n---\n<div>x</div>\n";
      expect(removeImportFromFrontmatter(src, 'Card', { removeFences: true })).toBe('<div>x</div>\n');
    });

    it('roundtrip: create-frontmatter add → flagged remove restores the original bytes', () => {
      const src = '<section>\n  <div class="hero">x</div>\n</section>\n';
      const added = addImportToFrontmatter(src, 'Card', '../c/Card.astro');
      expect(removeImportFromFrontmatter(added, 'Card', { removeFences: true })).toBe(src);
    });

    it('pin: UNflagged remove keeps the empty fence pair (existing behavior)', () => {
      const src = "---\nimport Card from '../c/Card.astro';\n---\n<div>x</div>\n";
      expect(removeImportFromFrontmatter(src, 'Card')).toBe('---\n---\n<div>x</div>\n');
    });

    it('pin: a PRE-EXISTING empty frontmatter survives a flagged no-op remove', () => {
      const src = '---\n---\n<div>x</div>\n';
      expect(removeImportFromFrontmatter(src, 'Card', { removeFences: true })).toBe(src);
    });

    it('flagged but other frontmatter content remains: no collapse', () => {
      const src = "---\nimport Card from '../c/Card.astro';\nconst x = 1;\n---\n<div>x</div>\n";
      expect(removeImportFromFrontmatter(src, 'Card', { removeFences: true }))
        .toBe('---\nconst x = 1;\n---\n<div>x</div>\n');
    });

    it('flagged CRLF collapse stays CRLF', () => {
      const src = "---\r\nimport Card from '../c/Card.astro';\r\n---\r\n<div>x</div>\r\n";
      expect(removeImportFromFrontmatter(src, 'Card', { removeFences: true })).toBe('<div>x</div>\r\n');
    });
  });
});

// ── Fix 1 (task-148): page-body anchor — inserts on component-only pages ──
// Real-world shape: a layout-based page whose template body is ONLY component
// tags. No scanned DOM node carries a `src/pages/*.astro` key, so there is no
// DOM anchor to insert against; the anchor is resolved server-side from the
// file itself (outermost template element → inside-end, html>body preferred).
describe('appendToPageBody', () => {
  // Verbatim shape of the user's real project (tabs included).
  const LAYOUT_PAGE = [
    '---',
    "import Layout from '../layouts/Layout.astro';",
    "import Main from '../components/Main.astro';",
    '---',
    '<Layout title="Oleg Mayhopar | Works">',
    '\t<Main>',
    '\t\t<FeaturedWorkList works={featuredPosts}></FeaturedWorkList>',
    '\t\t<WorkList works={works}></WorkList>',
    '\t</Main>',
    '</Layout>',
    '',
  ].join('\n');

  it('component-only layout page → last child of the outermost element', () => {
    const res = appendToPageBody(LAYOUT_PAGE, '<section>New</section>');
    expect(res.content).toBe([
      '---',
      "import Layout from '../layouts/Layout.astro';",
      "import Main from '../components/Main.astro';",
      '---',
      '<Layout title="Oleg Mayhopar | Works">',
      '\t<Main>',
      '\t\t<FeaturedWorkList works={featuredPosts}></FeaturedWorkList>',
      '\t\t<WorkList works={works}></WorkList>',
      '\t</Main>',
      '  <section>New</section>',
      '</Layout>',
      '',
    ].join('\n'));
    // 1-based line of the landed markup (</Layout> was line 10, pushed down)
    expect(res.insertedLine).toBe(10);
    expect(res.rootCount).toBe(1);
  });

  it('reply carries the region-restore fields (same shape as sq:write-insert)', () => {
    const res = appendToPageBody(LAYOUT_PAGE, '<section>New</section>');
    expect(res.replacedLine).toBe(10);
    expect(res.replacedLineCount).toBe(1);
    expect(res.originalSegment).toBe('');
    // byte-exact roundtrip through the SAME inverse the insert path uses
    const back = restoreRegionAtLocation(
      res.content,
      loc(res.replacedLine, 1),
      res.replacedLineCount,
      res.originalSegment
    );
    expect(back.content).toBe(LAYOUT_PAGE);
  });

  it('<html><head><body> page → inside </body>, never after it', () => {
    const src = [
      '---',
      '---',
      '<html lang="en">',
      '  <head>',
      '    <title>About</title>',
      '  </head>',
      '  <body>',
      '    <h1>About</h1>',
      '  </body>',
      '</html>',
      '',
    ].join('\n');
    const res = appendToPageBody(src, '<p>Added</p>');
    expect(res.content).toBe([
      '---',
      '---',
      '<html lang="en">',
      '  <head>',
      '    <title>About</title>',
      '  </head>',
      '  <body>',
      '    <h1>About</h1>',
      '    <p>Added</p>',
      '  </body>',
      '</html>',
      '',
    ].join('\n'));
    expect(res.insertedLine).toBe(9);
  });

  it('frontmatter-less page → still anchors on the outermost element', () => {
    const src = '<Layout>\n  <Hero />\n</Layout>\n';
    const res = appendToPageBody(src, '<footer>F</footer>');
    expect(res.content).toBe('<Layout>\n  <Hero />\n  <footer>F</footer>\n</Layout>\n');
    expect(res.insertedLine).toBe(3);
  });

  it('template with no element at all → appended at the end of the template', () => {
    const src = '---\nconst x = 1;\n---\n';
    const res = appendToPageBody(src, '<section>New</section>');
    expect(res.content).toBe('---\nconst x = 1;\n---\n<section>New</section>\n');
    expect(res.insertedLine).toBe(4);
    // byte-exact inverse
    const back = restoreRegionAtLocation(
      res.content, loc(res.replacedLine, 1), res.replacedLineCount, res.originalSegment
    );
    expect(back.content).toBe(src);
  });

  it('no trailing newline: element anchor still restores byte-exactly', () => {
    const src = '---\n---\n<Layout>\n</Layout>';
    const res = appendToPageBody(src, '<p>x</p>');
    expect(res.content).toBe('---\n---\n<Layout>\n  <p>x</p>\n</Layout>');
    const back = restoreRegionAtLocation(
      res.content, loc(res.replacedLine, 1), res.replacedLineCount, res.originalSegment
    );
    expect(back.content).toBe(src);
  });

  it('EOF append with no trailing newline rewrites the last line; restore is byte-exact', () => {
    const src = '---\nconst x = 1;\n---';
    const res = appendToPageBody(src, '<p>x</p>');
    expect(res.content).toBe('---\nconst x = 1;\n---\n<p>x</p>');
    expect(res.originalSegment).toBe('---');
    const back = restoreRegionAtLocation(
      res.content, loc(res.replacedLine, 1), res.replacedLineCount, res.originalSegment
    );
    expect(back.content).toBe(src);
  });

  it('self-closing outermost element → append at the end of the template (no inside-end)', () => {
    const src = '---\n---\n<Layout title="x" />\n';
    const res = appendToPageBody(src, '<p>x</p>');
    expect(res.content).toBe('---\n---\n<Layout title="x" />\n<p>x</p>\n');
    expect(res.insertedLine).toBe(4);
  });

  it('MULTIPLE top-level roots → no single outermost element, append at the end', () => {
    const src = '---\n---\n<Header />\n<main>\n  <p>a</p>\n</main>\n';
    const res = appendToPageBody(src, '<footer>F</footer>');
    expect(res.content).toBe('---\n---\n<Header />\n<main>\n  <p>a</p>\n</main>\n<footer>F</footer>\n');
    expect(res.insertedLine).toBe(7);
  });

  it('CRLF file stays CRLF', () => {
    const src = '---\r\n---\r\n<Layout>\r\n\t<Main />\r\n</Layout>\r\n';
    const res = appendToPageBody(src, '<p>x</p>');
    expect(res.content).toBe('---\r\n---\r\n<Layout>\r\n\t<Main />\r\n  <p>x</p>\r\n</Layout>\r\n');
    expect(res.originalSegment).toBe('');
    const back = restoreRegionAtLocation(
      res.content, loc(res.replacedLine, 1), res.replacedLineCount, res.originalSegment
    );
    expect(back.content).toBe(src);
  });

  it('multi-root markup reports rootCount (undo parity with insert)', () => {
    const res = appendToPageBody('<Layout>\n</Layout>\n', '<h2>A</h2>\n<p>B</p>');
    expect(res.rootCount).toBe(2);
    expect(res.content).toBe('<Layout>\n  <h2>A</h2>\n  <p>B</p>\n</Layout>\n');
  });

  it('HTML comments before the root do not become the anchor', () => {
    const src = '---\n---\n<!-- hi -->\n<Layout>\n</Layout>\n';
    const res = appendToPageBody(src, '<p>x</p>');
    expect(res.content).toBe('---\n---\n<!-- hi -->\n<Layout>\n  <p>x</p>\n</Layout>\n');
  });

  it('refuses empty markup (file untouched)', () => {
    expect(() => appendToPageBody('<Layout>\n</Layout>\n', '   ')).toThrow(/markup/);
  });

  it('a `---` INSIDE the template is not mistaken for a frontmatter fence', () => {
    const src = '<Layout>\n---\n</Layout>\n';
    const res = appendToPageBody(src, '<p>x</p>');
    expect(res.content).toBe('<Layout>\n---\n  <p>x</p>\n</Layout>\n');
  });
});

/**
 * DATA-LOSS guard (real incident 2026-08-02, un-versioned user project).
 *
 * The user was on a page, clicked the rendered header / "Back" link on the
 * canvas and pressed Delete. A scanned element's sourceLocation.file is the
 * COMPONENT's file, so the remove ran against src/components/*.astro and took
 * out its ROOT element:
 *   Back.astro   (single <a> root, no frontmatter) -> 0 bytes
 *   Header.astro (frontmatter + one <header> root) -> 7 lines, frontmatter only
 * The header disappeared from every page. No git, no session undo (reloaded).
 *
 * The guard is SERVER-SIDE and default-deny: removing a file's ONLY top-level
 * element throws unless the caller explicitly passes allowRootRemoval.
 */
describe('gut-the-component guard (removeElementAtLocation)', () => {
  // Byte-for-byte shapes of the two files the incident destroyed.
  const BACK = '<a href="/" class="back">&larr; Back</a>\n';
  const HEADER = '---\nconst { title } = Astro.props;\n---\n<header class="site">\n  <h1>{title}</h1>\n</header>\n';
  const cloc = (line: number, column: number) => ({ file: 'src/components/Back.astro', line, column });

  it('REPRO: deleting the rendered <a> of Back.astro refuses and leaves the file byte-identical', () => {
    let content = BACK;
    expect(() => {
      content = removeElementAtLocation(BACK, cloc(1, 1)).content;
    }).toThrow(/only top-level element/);
    expect(content).toBe(BACK); // never emptied
  });

  it('names the file and points at the usage instead', () => {
    expect(() => removeElementAtLocation(BACK, cloc(1, 1)))
      .toThrow(/src\/components\/Back\.astro/);
    expect(() => removeElementAtLocation(BACK, cloc(1, 1)))
      .toThrow(/<Back \/>/);
  });

  it('REPRO: deleting Header.astro\'s <header> refuses — no frontmatter-only remainder', () => {
    expect(() => removeElementAtLocation(HEADER, { file: 'src/components/Header.astro', line: 4, column: 1 }))
      .toThrow(/only top-level element/);
  });

  it('allows it with the explicit opt-in (same-file page delete / undo replay)', () => {
    expect(removeElementAtLocation(BACK, cloc(1, 1), { allowRootRemoval: true }).content).toBe('');
    const out = removeElementAtLocation(
      HEADER, { file: 'src/components/Header.astro', line: 4, column: 1 }, { allowRootRemoval: true },
    );
    expect(out.content).toBe('---\nconst { title } = Astro.props;\n---\n');
  });

  it('does NOT fire for one of several top-level elements', () => {
    const multi = '<Header />\n<main>x</main>\n<Footer />\n';
    const out = removeElementAtLocation(multi, cloc(2, 1));
    expect(out.content).toBe('<Header />\n<Footer />\n');
  });

  it('does NOT fire for a nested child inside the component', () => {
    const out = removeElementAtLocation(HEADER, { file: 'src/components/Header.astro', line: 5, column: 3 });
    expect(out.content).toBe('---\nconst { title } = Astro.props;\n---\n<header class="site">\n</header>\n');
  });

  it('does NOT fire for a child of the page fixture (regression pin: normal deletes unchanged)', () => {
    expect(() => removeElementAtLocation(FILE, loc(6, 3))).not.toThrow();
    expect(() => removeElementAtLocation(FILE, loc(14, 3))).not.toThrow();
  });

  it('fires for the page fixture\'s own <section> root without the opt-in', () => {
    expect(() => removeElementAtLocation(FILE, loc(4, 1))).toThrow(/only top-level element/);
    expect(removeElementAtLocation(FILE, loc(4, 1), { allowRootRemoval: true }).content)
      .toBe('---\nconst x = 1;\n---\n');
  });

  it('CRLF files are guarded the same way', () => {
    expect(() => removeElementAtLocation(HEADER.replace(/\n/g, '\r\n'), { file: 'H.astro', line: 4, column: 1 }))
      .toThrow(/only top-level element/);
  });
});

describe('gut-the-component guard + cross-file refusal (moveElement)', () => {
  const HEADER = '---\nconst { title } = Astro.props;\n---\n<header class="site">\n  <h1>{title}</h1>\n</header>\n';

  it('refuses a move that would take a component\'s only top-level element out', () => {
    expect(() => moveElement(HEADER, { file: 'H.astro', line: 4, column: 1 }, { file: 'H.astro', line: 5, column: 3 }, 'after'))
      .toThrow(/only top-level element/);
  });

  it('with the opt-in it falls through to the existing own-subtree refusal', () => {
    expect(() => moveElement(
      HEADER, { file: 'H.astro', line: 4, column: 1 }, { file: 'H.astro', line: 5, column: 3 }, 'after',
      { allowRootRemoval: true },
    )).toThrow(/own/);
  });

  it('refuses a cross-file move outright (the plugin only ever reads ONE file)', () => {
    expect(() => moveElement(
      FILE,
      { file: 'src/components/Header.astro', line: 4, column: 1 },
      { file: 'src/pages/index.astro', line: 5, column: 3 },
      'before',
    )).toThrow(/cannot move across files/);
  });

  it('same-file moves are unchanged (regression pin)', () => {
    const out = moveElement(FILE, loc(8, 5), loc(7, 5), 'before');
    expect(out.content).toContain('    <p>Second</p>\n    <p>First</p>');
  });
});

describe('addImportToFrontmatter — side-effect import (files-truth variables CSS)', () => {
  it.each([
    "import { ViewTransitions } from 'astro:transitions';",
    "import {\n  ViewTransitions,\n} from 'astro:transitions';",
  ])('adds CSS beside a named import without claiming an empty-name collision: %s', (existingImport) => {
    const source = `---\n${existingImport}\nimport '../fonts.css';\n---\n<html><ViewTransitions /><slot /></html>\n`;
    const expected = `---\n${existingImport}\nimport '../fonts.css';\nimport '../styles/sq-variables.css';\n---\n<html><ViewTransitions /><slot /></html>\n`;

    const updated = addImportToFrontmatter(source, '', '../styles/sq-variables.css');

    expect(updated).toBe(expected);
    expect(addImportToFrontmatter(updated, '', '../styles/sq-variables.css')).toBe(updated);
  });

  it("name '' emits `import 'path';` and is idempotent", async () => {
    const { addImportToFrontmatter } = await import('../../../../preview-template/src/plugins/sq-source-plugin.js');
    const once = addImportToFrontmatter('---\nconst a = 1;\n---\n<h1/>', '', '../styles/sq-variables.css');
    expect(once).toBe("---\nimport '../styles/sq-variables.css';\nconst a = 1;\n---\n<h1/>");
    expect(addImportToFrontmatter(once, '', '../styles/sq-variables.css')).toBe(once);
  });
});

it('reports proven import binding conflict before producing any changed source', () => {
  const source = "---\nimport Card from './Original.astro';\n---\n<Card />";
  let failure: unknown;
  try { addImportToFrontmatter(source, 'Card', './Other.astro'); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: 'import-binding-conflict', outcome: 'no-write' });
});

describe('unusedDefaultImports — the leftovers a structural remove produces', () => {
  it('lists default imports nothing references; keeps used ones and non-default imports', () => {
    const src = "---\nimport Layout from '../layouts/Layout.astro';\nimport Card from '../components/Card.astro';\nimport { getCollection } from 'astro:content';\nconst posts = await getCollection('blog');\n---\n<Card />\n";
    expect(unusedDefaultImports(src)).toEqual([{ name: 'Layout', importPath: '../layouts/Layout.astro' }]);
  });
  it('a frontmatter-code use counts as a use; no frontmatter → nothing', () => {
    expect(unusedDefaultImports("---\nimport helper from './h';\nconst y = helper();\n---\n<div/>\n")).toEqual([]);
    expect(unusedDefaultImports('<div>x</div>\n')).toEqual([]);
  });
  it('does not confuse a prefix match (Layout vs LayoutCard) with a use', () => {
    const src = "---\nimport Layout from '../layouts/Layout.astro';\nimport LayoutCard from '../components/LayoutCard.astro';\n---\n<LayoutCard />\n";
    expect(unusedDefaultImports(src)).toEqual([{ name: 'Layout', importPath: '../layouts/Layout.astro' }]);
  });
});

// Owner 2026-10-09 (live repro): a field element guarded by its eye —
// `{show.f && <p>…</p>}` — is ONE unit for sibling splices. ⌘D / paste landed
// the copy INSIDE the braces (`{show.f && <p/>\n<p/>\n}` — invalid Astro).
describe('guarded element `{cond && <el>}` is one unit', () => {
  const CARD = `---
const show = { description: true };
---
<div class="p-4">
  <h3>{post.data.title}</h3>
  {show.description && <p class="d">{post.data.description}</p>}
  <time>{post.data.date}</time>
</div>
`;
  const P = { file: 'c.astro', line: 6, column: 24 };

  it('insert after / before lands outside the braces', () => {
    const after = insertMarkupAtLocation(CARD, P, '<p class="d">copy</p>', 'after').content;
    expect(after).toContain('  {show.description && <p class="d">{post.data.description}</p>}\n  <p class="d">copy</p>\n  <time>');
    const before = insertMarkupAtLocation(CARD, P, '<hr />', 'before').content;
    expect(before).toContain('  <hr />\n  {show.description && <p');
  });

  it('remove takes the whole guard (no empty `{cond && }` left)', () => {
    const r = removeElementAtLocation(CARD, P);
    expect(r.content).toBe(CARD.replace('  {show.description && <p class="d">{post.data.description}</p>}\n', ''));
    expect(restoreSourceAtLocation(r.content, { file: 'c.astro', line: r.removedLine, column: r.removedColumn }, r.removedSource).content).toBe(CARD);
  });

  it('move carries the guard with the element; a guarded target splices outside it', () => {
    const down = moveElement(CARD, P, { file: 'c.astro', line: 7, column: 3 }, 'after').content;
    expect(down).toContain('  <time>{post.data.date}</time>\n  {show.description && <p class="d">{post.data.description}</p>}\n');
    const up = moveElement(CARD, { file: 'c.astro', line: 7, column: 3 }, P, 'after').content;
    expect(up).toContain('{show.description && <p class="d">{post.data.description}</p>}\n  <time>');
  });

  it('a child INSIDE a guarded element is not widened', () => {
    const src = CARD.replace('<p class="d">{post.data.description}</p>', '<div><span>a</span></div>');
    const out = insertMarkupAtLocation(src, { file: 'c.astro', line: 6, column: 29 }, '<b>x</b>', 'after').content;
    expect(out).toContain('<span>a</span>\n');
    expect(out).toContain('<b>x</b>');
    expect(out.indexOf('<b>x</b>')).toBeLessThan(out.indexOf('</div>}'));
  });
});

// Audit #8/#10: the same unit rule for `.map()` bodies and `(…)`-wrapped
// guards. Delete on the first card wrote `{items.map((item) => )}` and the page
// stopped building; a drop or paste next to the list landed INSIDE the
// callback, repeated once per item. A ternary branch can't leave alone.
describe('an element that is the whole value of a {…} expression is one unit', () => {
  const SRC = `---
// a stray { in frontmatter
const items = ['One', 'Two'];
const rows = [{ id: 1 }];
---
<main>
  {items.map((item) => <div class="card">{item}</div>)}
  <ul>
    {rows.map(({ id }) => (
      <li class="row">{id}</li>
    ))}
  </ul>
  {big ? <h1 id="a">Big</h1> : <h2 id="b">Small</h2>}
  {big && (
    <p id="guarded">Shown</p>
  )}
  <a id="cta" href="/more">See all</a>
</main>
`;
  const at = (line: number, column: number) => ({ file: 'x.astro', line, column });
  const MAIN = at(6, 1), CARD = at(7, 24), ROW = at(10, 7), BIG = at(13, 10), SMALL = at(13, 32), GUARDED = at(15, 5), CTA = at(17, 3);

  it('remove takes the whole expression and restores byte-exact', () => {
    for (const [target, whole] of [
      [CARD, '  {items.map((item) => <div class="card">{item}</div>)}\n'],
      [ROW, '    {rows.map(({ id }) => (\n      <li class="row">{id}</li>\n    ))}\n'],
      [GUARDED, '  {big && (\n    <p id="guarded">Shown</p>\n  )}\n'],
    ] as const) {
      const r = removeElementAtLocation(SRC, target);
      expect(r.content).toBe(SRC.replace(whole, ''));
      expect(restoreSourceAtLocation(r.content, at(r.removedLine, r.removedColumn), r.removedSource).content).toBe(SRC);
    }
  });

  it('a drop or paste next to a loop body lands outside the callback', () => {
    expect(insertMarkupAtLocation(SRC, CARD, '<p>Pasted</p>', 'after').content)
      .toContain('{item}</div>)}\n  <p>Pasted</p>\n  <ul>');
    expect(moveElement(SRC, CTA, CARD, 'before').content).toContain('<main>\n  <a id="cta" href="/more">See all</a>\n  {items.map(');
    expect(moveElement(SRC, CTA, ROW, 'after').content).toContain('    ))}\n    <a id="cta" href="/more">See all</a>\n  </ul>');
    expect(moveElement(SRC, CARD, CTA, 'after').content).toContain('See all</a>\n  {items.map((item) => <div class="card">{item}</div>)}\n</main>');
  });

  it('a ternary branch or a block-bodied callback is refused, never half-removed', () => {
    for (const target of [BIG, SMALL]) {
      expect(() => removeElementAtLocation(SRC, target)).toThrow(/expression/);
      expect(() => moveElement(SRC, target, CTA, 'after')).toThrow(/expression/);
      expect(() => insertMarkupAtLocation(SRC, target, '<p>x</p>', 'before')).toThrow(/expression/);
    }
    const block = SRC.replace('(item) => <div class="card">{item}</div>)}', '(item) => { return <div class="card">{item}</div>; })}');
    expect(() => removeElementAtLocation(block, at(7, 33))).toThrow(/expression/);
  });

  it('plain markup next to braces is untouched (a stray `{` in frontmatter, a sibling of the list)', () => {
    expect(removeElementAtLocation(SRC, MAIN, { allowRootRemoval: true }).content).toBe(SRC.slice(0, SRC.indexOf('<main>')));
    expect(insertMarkupAtLocation(SRC, at(8, 3), '<hr />', 'before').content).toContain('{item}</div>)}\n  <hr />\n  <ul>');
  });
});

// task-269: the insert dedents the block and indents every line to the
// insertion point — also the lines INSIDE a <pre>, where leading spaces are
// rendered text. A code mock came out shifted from its second line.
describe('insert keeps preformatted text byte-exact (task-269)', () => {
  const MARKUP = [
    "<div class='p-4'>",
    "<pre class='m-0'>line one",
    '  indented two',
    '    indented four</pre>',
    '<textarea>first',
    ' second</textarea>',
    ...['whitespace-pre', 'whitespace-pre-wrap', 'whitespace-pre-line'].map(c => `<p class="${c}">a\n  b\n</p>`),
    '<p>plain</p>',
    '</div>',
  ].join('\n');
  const PAGE = '---\n---\n<html>\n  <body>\n    <main></main>\n  </body>\n</html>\n';
  /** The text inside every preformatted element, in document order. */
  const preformatted = (src: string) => [...src.matchAll(/<(pre|textarea)[^>]*>([\s\S]*?)<\/\1>|<p class="whitespace-pre[^"]*">([\s\S]*?)<\/p>/g)].map(m => m[2] ?? m[3]);

  it.each([
    ['appendToPageBody (under <body>)', () => appendToPageBody(PAGE, MARKUP), PAGE, '    '],
    ['insertMarkupAtLocation (one level up)', () => insertMarkupAtLocation(FILE, loc(4, 1), MARKUP, 'inside-end'), FILE, '  '],
  ] as const)('%s', (_name, insert, original, indent) => {
    const out = insert();
    expect(preformatted(MARKUP)).toHaveLength(5);
    expect(preformatted(out.content)).toEqual(preformatted(MARKUP));
    // lines outside those elements still move to the insertion point
    expect(out.content).toContain(`\n${indent}<div class='p-4'>\n${indent}<pre class='m-0'>line one\n`);
    expect(out.content).toContain(`\n${indent}<p>plain</p>\n${indent}</div>\n`);
    expect(restoreRegionAtLocation(out.content, loc(out.replacedLine, 1), out.replacedLineCount, out.originalSegment).content).toBe(original);
  });

  it('the block dedent ignores preformatted lines and never eats their spaces', () => {
    const out = insertMarkupAtLocation(FILE, loc(4, 1), '    <div>\n      <pre>a\n b</pre>\n    </div>', 'inside-end');
    expect(out.content).toContain('\n  <div>\n    <pre>a\n b</pre>\n  </div>\n');
  });
});
