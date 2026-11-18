// The instance's source transforms, pinned directly. These pins used to run
// through the dev-server socket write handlers (retired 2026-10-18, see
// instance-write-path-retired.test.ts); the transforms themselves stay — the
// durable path (structuralTransform.ts, sourceAttributeAcceptance.ts, …) and
// the text validator share them.
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import {
  updateClassAttribute, updateTextContent, updateImageAttribute, insertMarkupAtLocation,
  removeElementAtLocation, moveElement, addImportToFrontmatter, removeImportFromFrontmatter,
// @ts-expect-error plain-JS preview-template plugin, no types
} from '../../../../preview-template/src/plugins/sq-source-plugin.js';

const FILE = 'src/Test.astro';
const at = (line: number, column: number) => ({ file: FILE, line, column });

describe('instance write transforms', () => {
  it('text: replaces the element text', async () => {
    expect(await updateTextContent('<div>\n  <h1 class="t">Old</h1>\n</div>\n', at(2, 3), 'New')).toContain('>New<');
  });

  it('text over an Astro expression is refused (binding never severed)', async () => {
    await expect(updateTextContent('<div>\n  <p class="d">{work.data.description}</p>\n</div>\n', at(2, 3), 'Sample'))
      .rejects.toThrow(/dynamic expression/);
  });

  it('image: sets the attribute', async () => {
    expect(await updateImageAttribute('<img src="/a.png" class="i" />\n', at(1, 1), 'src', '/b.png')).toContain('src="/b.png"');
  });

  it('no-op class, text and image writes return the source unchanged', async () => {
    const src = '<div class="a b">x</div>\n<img src="/a.png" alt="x" />\n<p class="p">Hello</p>\n';
    expect(await updateClassAttribute(src, FILE, at(1, 1), 'a b')).toBe(src);
    expect(await updateImageAttribute(src, at(2, 1), 'src', '/a.png')).toBe(src);
    expect(await updateTextContent(src, at(3, 1), 'Hello')).toBe(src);
  });

  // task-142: the tagged key points at the line a multi-line opening tag ENDS on.
  it('class write succeeds when the key points at the END line of a multi-line tag', async () => {
    const src = "<div class={'doubleImage \\\nmt-7 \\\nmx-auto'\n+ ' ' + customClass}>\n  <p>x</p>\n</div>\n";
    const out = await updateClassAttribute(src, FILE, at(4, 21), 'doubleImage mt-7 mx-auto bg-red-300', 'doubleImage mt-7 mx-auto');
    expect(out).toContain("'doubleImage mt-7 mx-auto bg-red-300'");
    expect(out).toContain("+ ' ' + customClass}");
  });

  it("class={'lit' + tail} edits only the leading literal and filters junk tokens", async () => {
    const out = await updateClassAttribute("<div class={'a b' + extra}>x</div>\n", FILE, at(1, 1), 'a b c undefined', 'a b');
    expect(out).toContain("class={'a b c' + extra}");
    expect(out).not.toContain('undefined');
  });

  it('a dynamic class expression with no editable literal is refused (never bakes)', async () => {
    await expect(updateClassAttribute("<div class={cond ? 'a' : 'b'}>x</div>\n", FILE, at(1, 1), 'a c'))
      .rejects.toThrow(/dynamic expression/);
  });

  it("quotes in tokens are escaped when writing into a same-quoted literal (bg-[url('/x')] incident)", async () => {
    const out = await updateClassAttribute("<div class={'a' + extra}>x</div>\n", FILE, at(1, 1), "a bg-[url('/uploads/x.png')] bg-cover", 'a');
    expect(out).toContain("bg-[url(\\'/uploads/x.png\\')]");
    expect(out).toContain('+ extra}');
  });

  it('a plain class attr switches quote style when tokens contain the delimiter', async () => {
    expect(await updateClassAttribute('<div class="a">x</div>\n', FILE, at(1, 1), 'a bg-[url("/uploads/x.png")]'))
      .toContain("class='a bg-[url(\"/uploads/x.png\")]'");
  });

  it("class={'pure literal'} bakes to a plain quoted attribute", async () => {
    expect(await updateClassAttribute("<div class={'a b'}>x</div>\n", FILE, at(1, 1), 'a b c')).toContain('class="a b c"');
  });

  it('insert writes the markup and reports insertedLine', () => {
    const r = insertMarkupAtLocation('<div class="hero">\n  <p>a</p>\n</div>\n', at(1, 1), '<p>new</p>', 'inside-end');
    expect(r.content).toBe('<div class="hero">\n  <p>a</p>\n  <p>new</p>\n</div>\n');
    expect(r.insertedLine).toBe(3);
  });

  it('remove reports removedSource + removedLine', () => {
    const r = removeElementAtLocation('<div class="hero">\n  <p>gone</p>\n  <p>stays</p>\n</div>\n', at(2, 3), {});
    expect(r).toMatchObject({ content: '<div class="hero">\n  <p>stays</p>\n</div>\n', removedSource: '  <p>gone</p>\n', removedLine: 2 });
  });

  it('move relocates the element and reports insertedLine', () => {
    const r = moveElement('<div class="hero">\n  <p>a</p>\n  <p>b</p>\n</div>\n', at(3, 3), at(2, 3), 'before', {});
    expect(r).toMatchObject({ content: '<div class="hero">\n  <p>b</p>\n  <p>a</p>\n</div>\n', insertedLine: 2 });
  });

  it('a proven import binding conflict throws a no-write conflict', () => {
    let thrown: { code?: string; outcome?: string } | undefined;
    try { addImportToFrontmatter("---\nimport Card from './Original.astro';\n---\n<Card />", 'Card', './Other.astro'); }
    catch (error) { thrown = error as typeof thrown; }
    expect(thrown).toMatchObject({ code: 'import-binding-conflict', outcome: 'no-write' });
  });

  it('import add, then remove, round-trips; duplicate add and absent remove are no-ops', () => {
    const src = '---\nconst x = 1;\n---\n<div>x</div>\n';
    const added = addImportToFrontmatter(src, 'Card', '../components/Card.astro');
    expect(added).toBe("---\nimport Card from '../components/Card.astro';\nconst x = 1;\n---\n<div>x</div>\n");
    expect(removeImportFromFrontmatter(added, 'Card', { removeFences: false })).toBe(src);
    expect(addImportToFrontmatter(added, 'Card', '../components/Card.astro')).toBe(added);
    expect(removeImportFromFrontmatter(added, 'Ghost', { removeFences: false })).toBe(added);
  });

  it('a structural op on a missing tag throws', () => {
    expect(() => removeElementAtLocation('<div class="hero">\n  <p>a</p>\n</div>\n', at(50, 1), {})).toThrow(/Could not find opening tag/);
  });

  // DATA-LOSS guard (2026-08-02): default-deny emptying a file's template.
  it('remove refuses to gut a component; allowRootRemoval:true is honoured', () => {
    const component = '---\nconst { title } = Astro.props;\n---\n<header class="site">\n  <h1>{title}</h1>\n</header>\n';
    expect(() => removeElementAtLocation(component, at(4, 1), {})).toThrow(/only top-level element/);
    expect(removeElementAtLocation('---\nconst x = 1;\n---\n<main>only</main>\n', at(4, 1), { allowRootRemoval: true }).content)
      .toBe('---\nconst x = 1;\n---\n');
  });

  it('move refuses a cross-file target', () => {
    expect(() => moveElement('<div class="hero">\n  <p>a</p>\n  <p>b</p>\n</div>\n', at(3, 3),
      { file: 'src/pages/index.astro', line: 2, column: 3 }, 'before', {})).toThrow(/cannot move across files/);
  });
});
