// gap-61 (2026-08-12 parity sweep): local-mode font persistence is FILES —
// bytes in the user's public/fonts/, @font-face marker-merged into
// public/sq-fonts.css, and a <link> injected before </head> in src/**.astro.
// Before these functions/endpoints existed, a font pick lived only in Dexie +
// the disposable session doc: the class writer put font-["Family"] into the
// user's real file while the font itself died on reopen and never reached
// their own astro build.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { writeLocalFontFile, mergeLocalFontCss, ensureLocalFontsLink } from '../../project-fs';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse } from './mockServer';

let base: string;
let userDir: string;

const LAYOUT =
  '---\n---\n<html><head><meta charset="utf-8"><title>x</title></head><body><slot /></body></html>\n';
const FRAGMENT_PAGE = '---\n---\n<main>no head here</main>\n';

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'sq-local-fonts-'));
  userDir = path.join(base, 'their-site');
  mkdirSync(path.join(userDir, 'src', 'layouts'), { recursive: true });
  mkdirSync(path.join(userDir, 'src', 'pages'), { recursive: true });
  writeFileSync(path.join(userDir, 'src', 'layouts', 'Base.astro'), LAYOUT);
  writeFileSync(path.join(userDir, 'src', 'pages', 'index.astro'), FRAGMENT_PAGE);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('writeLocalFontFile', () => {
  it('writes the bytes into public/fonts and returns the served src', () => {
    const r = writeLocalFontFile(userDir, 'Open Sans-400.woff2', Buffer.from('WOFF2'));
    expect(r.src).toBe('/fonts/Open_Sans-400.woff2');
    expect(readFileSync(path.join(userDir, 'public', 'fonts', 'Open_Sans-400.woff2'), 'utf8')).toBe('WOFF2');
  });

  it('re-posting identical bytes reuses the file instead of minting -1 dupes', () => {
    const a = writeLocalFontFile(userDir, 'Inter-400.woff2', Buffer.from('SAME'));
    const b = writeLocalFontFile(userDir, 'Inter-400.woff2', Buffer.from('SAME'));
    expect(b.src).toBe(a.src);
    expect(readdirSync(path.join(userDir, 'public', 'fonts'))).toHaveLength(1);
  });

  it('different bytes under the same name get a suffixed file (never overwrite)', () => {
    writeLocalFontFile(userDir, 'Inter-400.woff2', Buffer.from('OLD'));
    const b = writeLocalFontFile(userDir, 'Inter-400.woff2', Buffer.from('NEW'));
    expect(b.src).toBe('/fonts/Inter-400-1.woff2');
    expect(readFileSync(path.join(userDir, 'public', 'fonts', 'Inter-400.woff2'), 'utf8')).toBe('OLD');
  });

  it('refuses non-font extensions', () => {
    expect(() => writeLocalFontFile(userDir, 'evil.astro', Buffer.from('x'))).toThrow(/not a font file/);
  });
});

describe('mergeLocalFontCss', () => {
  const cssPath = () => path.join(userDir, 'public', 'sq-fonts.css');

  it('creates sq-fonts.css with a marker block', async () => {
    await mergeLocalFontCss(userDir, 'Open Sans', "@font-face{font-family:'Open Sans';}");
    const out = readFileSync(cssPath(), 'utf8');
    expect(out).toContain('/* sq-font:Open Sans start */');
    expect(out).toContain("@font-face{font-family:'Open Sans';}");
    expect(out).toContain('/* sq-font:Open Sans end */');
  });

  it('re-merging the same family replaces its block wholesale (no duplication)', async () => {
    await mergeLocalFontCss(userDir, 'Brand', '@font-face{font-weight:400;}');
    await mergeLocalFontCss(userDir, 'Brand', '@font-face{font-weight:100 900;}');
    const out = readFileSync(cssPath(), 'utf8');
    expect(out).not.toContain('font-weight:400');
    expect(out).toContain('font-weight:100 900');
    expect(out.match(/sq-font:Brand start/g)).toHaveLength(1);
  });

  it('a second family appends without touching the first', async () => {
    await mergeLocalFontCss(userDir, 'Alpha', '@font-face{/*a*/}');
    await mergeLocalFontCss(userDir, 'Beta', '@font-face{/*b*/}');
    const out = readFileSync(cssPath(), 'utf8');
    expect(out).toContain('@font-face{/*a*/}');
    expect(out).toContain('@font-face{/*b*/}');
  });

  it('never destroys user bytes outside the markers', async () => {
    mkdirSync(path.join(userDir, 'public'), { recursive: true });
    writeFileSync(cssPath(), '/* my own rules */\nbody{color:red}\n');
    await mergeLocalFontCss(userDir, 'Alpha', '@font-face{/*a*/}');
    const out = readFileSync(cssPath(), 'utf8');
    expect(out).toContain('body{color:red}');
    expect(out).toContain('@font-face{/*a*/}');
  });

  // Finding 9: the header invites hand-editing, so a user-mangled end marker
  // must never cause the orphaned start to pair with a LATER block's end and
  // silently swallow every user byte between them.
  it('an orphaned start marker (user deleted the end marker) never eats user CSS on later re-merges', async () => {
    await mergeLocalFontCss(userDir, 'Brand', '@font-face{/*v1*/}');
    const mangled = readFileSync(cssPath(), 'utf8').replace(/\/\* sq-font:Brand end \*\/\n?/, '');
    writeFileSync(cssPath(), `${mangled}\n.user-rule{color:red}\n`);

    await mergeLocalFontCss(userDir, 'Brand', '@font-face{/*v2*/}'); // pair broken → appends fresh
    await mergeLocalFontCss(userDir, 'Brand', '@font-face{/*v3*/}'); // must replace ONLY the v2 block

    const out = readFileSync(cssPath(), 'utf8');
    expect(out).toContain('.user-rule{color:red}');
    expect(out).toContain('@font-face{/*v3*/}');
    expect(out).not.toContain('@font-face{/*v2*/}');
  });

  it('a lone end marker (start deleted) treats the block as absent and deletes nothing', async () => {
    await mergeLocalFontCss(userDir, 'Brand', '@font-face{/*v1*/}');
    const mangled = readFileSync(cssPath(), 'utf8').replace(/\/\* sq-font:Brand start \*\/\n?/, '');
    writeFileSync(cssPath(), `${mangled}\n.user-rule{color:red}\n`);
    await mergeLocalFontCss(userDir, 'Brand', '@font-face{/*v2*/}');
    const out = readFileSync(cssPath(), 'utf8');
    expect(out).toContain('.user-rule{color:red}');
    expect(out).toContain('@font-face{/*v2*/}');
  });

  // Finding 10: sanitizing punctuation to '_' collapsed distinct families onto
  // one marker id — the second family's merge silently overwrote the first's
  // @font-face block.
  it('two families whose sanitized ids collide keep separate blocks (no silent overwrite)', async () => {
    await mergeLocalFontCss(userDir, 'Foo!Bar', '@font-face{/*bang*/}');
    await mergeLocalFontCss(userDir, 'Foo?Bar', '@font-face{/*quest*/}');
    const out = readFileSync(cssPath(), 'utf8');
    expect(out).toContain('@font-face{/*bang*/}');
    expect(out).toContain('@font-face{/*quest*/}');
    // and each still replaces ITS OWN block on re-merge
    await mergeLocalFontCss(userDir, 'Foo!Bar', '@font-face{/*bang2*/}');
    const again = readFileSync(cssPath(), 'utf8');
    expect(again).not.toContain('@font-face{/*bang*/}');
    expect(again).toContain('@font-face{/*bang2*/}');
    expect(again).toContain('@font-face{/*quest*/}');
  });
});

describe('ensureLocalFontsLink', () => {
  it('injects one marked <link> before </head> and is idempotent', async () => {
    const first = await ensureLocalFontsLink(userDir);
    expect(first.linked).toBe(true);
    expect(first.updatedFiles).toEqual(['src/layouts/Base.astro']);
    const layout = readFileSync(path.join(userDir, 'src', 'layouts', 'Base.astro'), 'utf8');
    expect(layout).toContain('<link rel="stylesheet" href="/sq-fonts.css" data-sq-fonts>');
    expect(layout.indexOf('data-sq-fonts')).toBeLessThan(layout.indexOf('</head>'));

    const second = await ensureLocalFontsLink(userDir);
    expect(second).toEqual({ linked: true, updatedFiles: [] });
    const again = readFileSync(path.join(userDir, 'src', 'layouts', 'Base.astro'), 'utf8');
    expect(again.match(/sq-fonts\.css/g)).toHaveLength(1);
  });

  it('leaves head-less files alone and reports linked:false when no head exists anywhere', async () => {
    rmSync(path.join(userDir, 'src', 'layouts'), { recursive: true });
    const r = await ensureLocalFontsLink(userDir);
    expect(r).toEqual({ linked: false, updatedFiles: [] });
    expect(readFileSync(path.join(userDir, 'src', 'pages', 'index.astro'), 'utf8')).toBe(FRAGMENT_PAGE);
  });

  // Finding 8: the anchor used to be the FIRST textual </head> match anywhere
  // in the file — a `</head>` inside frontmatter or a head-less template got a
  // <link> spliced into it, corrupting the user's file.
  it('never splices into a </head> that only appears inside frontmatter', async () => {
    const docsComponent =
      '---\nconst sample = "<head></head>";\n---\n<pre>{sample}</pre>\n';
    const file = path.join(userDir, 'src', 'pages', 'docs.astro');
    writeFileSync(file, docsComponent);
    await ensureLocalFontsLink(userDir);
    expect(readFileSync(file, 'utf8')).toBe(docsComponent);
  });

  it('skips a template-body </head> with no <head opener before it', async () => {
    const literal = '---\n---\n<main>closing tag looks like </head> here</main>\n';
    const file = path.join(userDir, 'src', 'pages', 'literal.astro');
    writeFileSync(file, literal);
    await ensureLocalFontsLink(userDir);
    expect(readFileSync(file, 'utf8')).toBe(literal);
  });

  it('a frontmatter </head> does not steal the anchor from the real document head', async () => {
    const layout =
      '---\n// example markup: "</head>"\n---\n<html><head><title>t</title></head><body><slot /></body></html>\n';
    const file = path.join(userDir, 'src', 'layouts', 'Tricky.astro');
    writeFileSync(file, layout);
    await ensureLocalFontsLink(userDir);
    const out = readFileSync(file, 'utf8');
    expect(out.match(/data-sq-fonts/g)).toHaveLength(1);
    // link must sit inside the REAL head, i.e. after <head> and before its </head>
    const linkAt = out.indexOf('data-sq-fonts');
    expect(linkAt).toBeGreaterThan(out.indexOf('<head>'));
    expect(linkAt).toBeLessThan(out.lastIndexOf('</head>'));
    // frontmatter untouched
    expect(out).toContain('// example markup: "</head>"');
    expect(out.indexOf('data-sq-fonts')).toBeGreaterThan(out.indexOf('\n---\n<html>'));
  });
});

describe('endpoints', () => {
  it('POST /__sq/local/font-file writes bytes and returns the src', async () => {
    const server = configureMockServer(base);
    const handler = findRouteHandler(server, '/__sq/local/font-file');
    const req = Readable.from([Buffer.from('BYTES')]) as unknown as IncomingMessage;
    req.method = 'POST';
    req.url = `/?path=${encodeURIComponent(userDir)}&name=Brand.woff2`;
    const captured = makeCapturedResponse();
    await handler(req, captured.res, () => {});
    await captured.done;
    expect(captured.status() ?? 200).toBe(200);
    expect(captured.json()).toEqual({ src: '/fonts/Brand.woff2' });
    expect(readFileSync(path.join(userDir, 'public', 'fonts', 'Brand.woff2'), 'utf8')).toBe('BYTES');
  });

  it('POST /__sq/local/font-css merges the css AND wires the <link>', async () => {
    const server = configureMockServer(base);
    const handler = findRouteHandler(server, '/__sq/local/font-css');
    const captured = makeCapturedResponse();
    await handler(
      makeJsonRequest('POST', { path: userDir, family: 'Brand', css: '@font-face{/*x*/}' }),
      captured.res, () => {},
    );
    await captured.done;
    expect(captured.status() ?? 200).toBe(200);
    expect(captured.json()).toMatchObject({ file: 'public/sq-fonts.css', linked: true, updatedFiles: ['src/layouts/Base.astro'] });
    expect(existsSync(path.join(userDir, 'public', 'sq-fonts.css'))).toBe(true);
  });

  it('400s an unknown folder and a missing family/css', async () => {
    const server = configureMockServer(base);
    const handler = findRouteHandler(server, '/__sq/local/font-css');
    const bad = makeCapturedResponse();
    await handler(makeJsonRequest('POST', { path: path.join(base, 'nope'), family: 'A', css: 'x' }), bad.res, () => {});
    await bad.done;
    expect(bad.status()).toBe(400);
    const noCss = makeCapturedResponse();
    await handler(makeJsonRequest('POST', { path: userDir, family: 'A', css: '' }), noCss.res, () => {});
    await noCss.done;
    expect(noCss.status()).toBe(400);
  });
});
