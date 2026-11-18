import { describe, it, expect } from 'vitest';
import { moveElement } from '../ast-updater';
import type { SourceLocation } from '../../bridge/types';

const FILE = 'src/components/Test.astro';
const loc = (line: number, column: number): SourceLocation => ({ file: FILE, line, column });

describe('moveElement', () => {
  it('moves a <p> from div.a into section.b (parent AFTER element)', async () => {
    // <div class="a"> is before <section class="b"> in the file.
    const content = [
      '---',
      'const x = 1;',
      '---',
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
      '<section class="b">',
      '  <span>existing</span>',
      '</section>',
    ].join('\n');

    // element = <p> at line 5 col 3; new parent = <section class="b"> at line 7 col 1.
    const result = await moveElement(content, loc(5, 3), loc(7, 1));
    expect(result).not.toBeNull();
    const out = result!;

    // <p> no longer inside the div
    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<p>hello</p>');

    // <p> now inside the section, as a child (before </section>)
    const sectionStart = out.indexOf('<section class="b">');
    const sectionEnd = out.indexOf('</section>');
    const sectionBlock = out.slice(sectionStart, sectionEnd);
    expect(sectionBlock).toContain('<p>hello</p>');
    expect(sectionBlock).toContain('<span>existing</span>');
    // last child: <p> appears after <span> (insertChildBeforeClosingTag = last child)
    expect(sectionBlock.indexOf('<p>hello</p>')).toBeGreaterThan(sectionBlock.indexOf('<span>existing</span>'));
  });

  it('moves an element when the new parent is BEFORE the element (offset adjustment path)', async () => {
    // <section class="b"> is FIRST; <p> lives in div.a which is LAST.
    const content = [
      '---',
      '---',
      '<section class="b">',
      '  <span>existing</span>',
      '</section>',
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
    ].join('\n');

    // element <p> at line 7 col 3; new parent <section> at line 3 col 1.
    const result = await moveElement(content, loc(7, 3), loc(3, 1));
    expect(result).not.toBeNull();
    const out = result!;

    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<p>hello</p>');

    const sectionStart = out.indexOf('<section class="b">');
    const sectionEnd = out.indexOf('</section>');
    const sectionBlock = out.slice(sectionStart, sectionEnd);
    expect(sectionBlock).toContain('<p>hello</p>');
    expect(sectionBlock).toContain('<span>existing</span>');
  });

  it('moves an element WITH children — the whole subtree moves intact', async () => {
    const content = [
      '<div class="a">',
      '  <ul class="list">',
      '    <li>one</li>',
      '    <li>two</li>',
      '  </ul>',
      '</div>',
      '<section class="b"></section>',
    ].join('\n');

    // element <ul> at line 2 col 3; new parent <section> at line 7 col 1.
    const result = await moveElement(content, loc(2, 3), loc(7, 1));
    expect(result).not.toBeNull();
    const out = result!;

    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<ul');

    const sectionStart = out.indexOf('<section class="b">');
    const sectionBlock = out.slice(sectionStart);
    expect(sectionBlock).toContain('<ul class="list">');
    expect(sectionBlock).toContain('<li>one</li>');
    expect(sectionBlock).toContain('<li>two</li>');
  });

  it('moves a self-closing element (<img />) intact', async () => {
    const content = [
      '<div class="a">',
      '  <img src="/x.png" alt="x" />',
      '</div>',
      '<section class="b"></section>',
    ].join('\n');

    // element <img> at line 2 col 3; new parent <section> at line 4 col 1.
    const result = await moveElement(content, loc(2, 3), loc(4, 1));
    expect(result).not.toBeNull();
    const out = result!;

    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<img');

    const sectionBlock = out.slice(out.indexOf('<section class="b">'));
    expect(sectionBlock).toContain('<img src="/x.png" alt="x" />');
  });

  it('moves to ROOT (newParentLoc=null) — appended before the file last closing tag', async () => {
    const content = [
      '<main>',
      '  <div class="a">',
      '    <p>hello</p>',
      '  </div>',
      '</main>',
    ].join('\n');

    // element <p> at line 3 col 5; move to root.
    const result = await moveElement(content, loc(3, 5), null);
    expect(result).not.toBeNull();
    const out = result!;

    // <p> removed from the div
    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<p>hello</p>');

    // <p> appended before the final </main> (the file's last closing tag)
    const mainClose = out.lastIndexOf('</main>');
    expect(out.slice(0, mainClose)).toContain('<p>hello</p>');
    // and it is the LAST thing before </main>
    expect(out.indexOf('<p>hello</p>')).toBeLessThan(mainClose);
  });

  it('moves to ROOT — lands before the LAST top-level closing tag, not inside an unrelated earlier block', async () => {
    // Two top-level siblings. Element <span> is inside the FIRST div; root-append
    // targets the file's LAST closing tag (</section>), so the span ends up at the
    // very end of the file's top level (inside the last block per drawnReconcile rule).
    const content = [
      '<div class="a">',
      '  <span>z</span>',
      '</div>',
      '<section class="b">',
      '  <p>keep</p>',
      '</section>',
    ].join('\n');
    const result = await moveElement(content, loc(2, 3), null);
    expect(result).not.toBeNull();
    const out = result!;
    // removed from div.a
    const divBlock = out.slice(out.indexOf('<div class="a">'), out.indexOf('</div>'));
    expect(divBlock).not.toContain('<span>z</span>');
    // appended before the file's LAST closing tag (</section>)
    const lastClose = out.lastIndexOf('</section>');
    expect(out.slice(0, lastClose)).toContain('<span>z</span>');
    expect(out).toContain('<p>keep</p>');
  });

  it('is idempotent: element already inside the target parent → content returned UNCHANGED', async () => {
    const content = [
      '<section class="b">',
      '  <p>hello</p>',
      '</section>',
    ].join('\n');

    // element <p> at line 2 col 3 is already inside <section> at line 1 col 1.
    const result = await moveElement(content, loc(2, 3), loc(1, 1));
    expect(result).toBe(content);
  });

  it('returns null on a bad elementLoc (no tag there) and leaves the caller free to keep original', async () => {
    const content = [
      '<div class="a">',
      '  text only no tag here',
      '</div>',
      '<section class="b"></section>',
    ].join('\n');

    // line 2 col 3 points at "text", findOpeningBracket forward-scan would hit nothing on that line
    const result = await moveElement(content, loc(2, 3), loc(4, 1));
    expect(result).toBeNull();
  });

  it('returns null when the new parent is self-closing / non-nestable', async () => {
    const content = [
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
      '<img class="b" src="/x.png" />',
    ].join('\n');

    // element <p> at line 2 col 3; new parent <img/> at line 4 col 1 (self-closing).
    const result = await moveElement(content, loc(2, 3), loc(4, 1));
    expect(result).toBeNull();
  });

  it('preserves CRLF line endings (CRLF in → CRLF out)', async () => {
    const content = [
      '<div class="a">',
      '  <p>hello</p>',
      '</div>',
      '<section class="b"></section>',
    ].join('\r\n');

    // element <p> at line 2 col 3; new parent <section> at line 4 col 1.
    const result = await moveElement(content, loc(2, 3), loc(4, 1));
    expect(result).not.toBeNull();
    const out = result!;
    expect(out).toContain('\r\n');
    expect(out).not.toMatch(/[^\r]\n/); // every \n is preceded by \r
    const sectionBlock = out.slice(out.indexOf('<section class="b">'));
    expect(sectionBlock).toContain('<p>hello</p>');
  });
});
