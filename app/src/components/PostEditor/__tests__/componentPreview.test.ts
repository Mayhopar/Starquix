/**
 * Preview extractor — runs against a REAL SqPostView render saved from the
 * running fixture instance (fixtures/sq-post-view-timepad.html).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractComponentHtml, pairPreviewsToChips, type ComponentChunk } from '../componentPreview';
import { componentBodyLines } from '../tiptap/schema';
import { parsePostBody } from '@/postmodel/postModel';

const html = readFileSync(join(__dirname, 'fixtures', 'sq-post-view-timepad.html'), 'utf8');
const ORIGIN = 'http://localhost:55996';

const htmlOf = (chunks: ComponentChunk[]) => chunks.map(c => c.html);

describe('extractComponentHtml', () => {
  it('collects the component wrappers in doc order', () => {
    const chunks = extractComponentHtml(html, ORIGIN);
    expect(chunks).toHaveLength(3);
    // Timepad body order: SingleImage, DoubleImage, CreditWrapper
    expect(chunks[0].html).toContain('hero.png');
    expect(chunks[1].html).toContain('grid-1.png');
    expect(chunks[2].html).toContain('Oleg Mayhopar');
  });

  it('carries the body line each block starts on — the join key', () => {
    expect(extractComponentHtml(html, ORIGIN).map(c => c.bodyLine)).toEqual([10, 16, 20]);
  });

  it('absolutizes root-relative asset URLs against the instance origin', () => {
    const chunks = extractComponentHtml(html, ORIGIN);
    for (const chunk of htmlOf(chunks)) {
      expect(chunk).not.toMatch(/src="\/(?!\/)/); // no root-relative src left
    }
    expect(chunks[0].html).toContain(`src="${ORIGIN}/`);
  });

  it('returns [] for a render with no components', () => {
    expect(extractComponentHtml('<html><body><p>hi</p></body></html>', ORIGIN)).toEqual([]);
  });

  /**
   * The extractor's half of the contract with `mediaResolver.retargetMedia`.
   *
   * Byte mode re-points these elements at blob: URLs built from file bytes at
   * PAINT time (for an origin the editor page cannot load as a subresource) —
   * which needs the model-space path, not the absolutized URL. Keeping the path
   * here also survives an origin that changed between this fetch and that paint
   * (an instance restart).
   */
  it('keeps the model-space path beside every URL it rewrites', () => {
    const chunks = extractComponentHtml(
      '<html><body><div data-sq-block="component" data-sq-body-line="1">' +
        '<video src="/uploads/c.mp4" poster="/uploads/c.png"></video>' +
        '<img src="/uploads/p.png" srcset="/uploads/p.png 1x, /uploads/p2.png 2x">' +
        '<img src="https://cdn.test/a.png">' +
        '</div></body></html>',
      ORIGIN,
    );
    const dom = new DOMParser().parseFromString(chunks[0].html, 'text/html');
    const video = dom.querySelector('video')!;
    expect(video.getAttribute('data-sq-media-path')).toBe('/uploads/c.mp4');
    expect(video.getAttribute('data-sq-poster-path')).toBe('/uploads/c.png');
    const img = dom.querySelector('img[srcset]')!;
    expect(img.getAttribute('data-sq-media-path')).toBe('/uploads/p.png');
    expect(img.getAttribute('data-sq-media-srcset')).toBe('/uploads/p.png 1x, /uploads/p2.png 2x');
    // An already-absolute source was never rewritten, so it gets no stamp.
    expect(dom.querySelector('img[src^="https://cdn"]')!.hasAttribute('data-sq-media-path')).toBe(
      false,
    );
  });
});

/**
 * Owner, 2026-08-11: "upload a photo in the content tab, nothing happens".
 * Root cause link 1 — sq-source-plugin stamps a component invocation TWICE:
 * as a wrapper <div data-sq-block="component"> AND as JSX attributes on the
 * invocation itself, which reach the DOM only when the component spreads rest
 * props onto its root (Media.astro does; DoubleImage.astro does not). A
 * spreading component therefore yielded TWO entries for ONE chip, so every
 * chip after it read the wrong preview and the tail read undefined — and an
 * undefined preview makes the editor draw empty upload tiles over a component
 * that rendered fine. Only OUTERMOST stamped elements are components.
 */
describe('extractComponentHtml — one entry per top-level block', () => {
  const wrap = (body: string) => `<html><body>${body}</body></html>`;

  it('yields ONE entry for a rest-spreading component (wrapper + stamped own root)', () => {
    const chunks = extractComponentHtml(
      wrap(`
        <div data-sq-block="component" data-sq-body-line="16">
          <div class="sq-media" data-sq-unit="media" data-sq-block="component" data-sq-body-line="16">
            <img src="/uploads/photo.png">
          </div>
        </div>`),
      ORIGIN,
    );
    expect(chunks).toHaveLength(1);
    // The WRAPPER outerHTML — the inner render must still be included.
    expect(chunks[0].html).toContain('data-sq-unit="media"');
    expect(chunks[0].html).toContain(`src="${ORIGIN}/uploads/photo.png"`);
  });

  it('keeps the chunk order when a spreader is FIRST', () => {
    const chunks = extractComponentHtml(
      wrap(`
        <div data-sq-block="component" data-sq-body-line="10">
          <div data-sq-unit="media" data-sq-block="component" data-sq-body-line="10"><img src="/a.png"></div>
        </div>
        <div data-sq-block="component" data-sq-body-line="14"><img src="/b.png"></div>
        <div data-sq-block="component" data-sq-body-line="16"><img src="/c.png"></div>`),
      ORIGIN,
    );
    expect(chunks).toHaveLength(3);
    expect(chunks[0].html).toContain('/a.png');
    expect(chunks[1].html).toContain('/b.png');
    expect(chunks[2].html).toContain('/c.png');
  });

  it('does not add an entry for a component nested inside another component markup', () => {
    const chunks = extractComponentHtml(
      wrap(`
        <div data-sq-block="component" data-sq-body-line="10">
          <section>
            <div data-sq-block="component" data-sq-body-line="10"><img src="/inner.png"></div>
          </section>
        </div>`),
      ORIGIN,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].html).toContain('/inner.png');
  });

  it('a Media INSIDE a layout (Stack slot) is its own chunk at its own line (2026-09-30: "5 of 5 couldn\'t be matched")', () => {
    const chunks = extractComponentHtml(
      wrap(`
        <div data-sq-block="component" data-sq-body-line="10">
          <div data-sq-stack="row" data-sq-block="component" data-sq-body-line="10">
            <div data-sq-block="component" data-sq-body-line="11"><h3>Morning light</h3></div>
            <div data-sq-block="component" data-sq-body-line="22">
              <div class="sq-media" data-sq-unit="media" data-sq-block="component" data-sq-body-line="24"><img src="/road.jpg"></div><style>.sq-media{display:grid}</style>
            </div>
          </div>
        </div>`),
      ORIGIN,
    );
    expect(chunks.map(c => c.bodyLine)).toEqual([10, 11, 22, 24]);

    expect(pairPreviewsToChips(chunks, [24])).toEqual({ html: [expect.stringContaining(`${ORIGIN}/road.jpg`)], mismatch: null });
  });

  it('leaves a non-spreading component wrapper unchanged (one entry)', () => {
    const chunks = extractComponentHtml(
      wrap('<div data-sq-block="component" data-sq-body-line="14"><img src="/grid-1.png"></div>'),
      ORIGIN,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].html).toContain(`src="${ORIGIN}/grid-1.png"`);
  });
});

/**
 * REGRESSION (2026-08-12 review, C3): the index desync was NOT closed by
 * de-duplicating the wrappers.
 *
 * sq-source-plugin's wrapper loop has no uppercase filter — every top-level
 * `mdxJsxFlowElement` gets a `data-sq-block="component"` wrapper, including a
 * raw `<div class="note">`. postModel classifies that same block as a
 * PASSTHROUGH, not as an astroComponent chip (only /^[A-Z]/ names and the
 * col-span unwrap become chips). So `chunks.length` legitimately exceeds the
 * chip count, and every chip after the raw block read its neighbour's HTML.
 *
 * `pairPreviewsToChips` is keyed on `data-sq-body-line`, which both sides
 * already carry, so counting is no longer part of the answer.
 */
describe('pairPreviewsToChips — the body line is the key, not the ordinal', () => {
  /** What the shipped code did: previews[i] for chip i. */
  const byOrdinal = (chunks: ComponentChunk[], chipLines: number[]) =>
    chipLines.map((_, i) => chunks[i]?.html);

  const chunks: ComponentChunk[] = [
    { bodyLine: 3, html: '<div>raw html block, not a chip</div>' },
    { bodyLine: 5, html: '<figure>FIRST COMPONENT</figure>' },
    { bodyLine: 7, html: '<figure>SECOND COMPONENT</figure>' },
  ];
  const chipLines = [5, 7];

  it('the ORDINAL pairing hands each chip its neighbour’s HTML', () => {
    expect(byOrdinal(chunks, chipLines)).toEqual([
      '<div>raw html block, not a chip</div>', // the raw <div>, drawn as chip 1
      '<figure>FIRST COMPONENT</figure>', // shifted by one
    ]);
  });

  it('the body-line pairing gives each chip its own HTML and drops the raw block', () => {
    const paired = pairPreviewsToChips(chunks, chipLines);
    expect(paired.html).toEqual([
      '<figure>FIRST COMPONENT</figure>',
      '<figure>SECOND COMPONENT</figure>',
    ]);
    // A chunk matching no chip is normal (that raw <div>) — not a problem.
    expect(paired.mismatch).toBeNull();
  });

  it('a chip with no matching chunk falls back ALONE — neighbours keep theirs', () => {
    const paired = pairPreviewsToChips(
      [{ bodyLine: 5, html: 'A' }, { bodyLine: 9, html: 'C' }],
      [5, 7, 9],
    );
    expect(paired.html).toEqual(['A', undefined, 'C']);
    // Reported for the ladder AND readable by the user who sees it.
    expect(paired.mismatch).toMatch(/1 of 3 block\(s\)/);
    expect(paired.mismatch).toMatch(/out of date/);
  });

  it('never paints one chunk onto two chips', () => {
    const paired = pairPreviewsToChips([{ bodyLine: 5, html: 'A' }], [5, 5]);
    expect(paired.html).toEqual(['A', undefined]);
  });

  it('drops an unstamped chunk rather than guessing a chip for it', () => {
    const paired = pairPreviewsToChips(
      [{ bodyLine: null, html: 'no stamp' }, { bodyLine: 5, html: 'A' }],
      [5],
    );
    expect(paired.html).toEqual(['A']);
  });

  it('reports nothing to pair when the post has no components', () => {
    expect(pairPreviewsToChips([{ bodyLine: 3, html: 'x' }], [])).toEqual({
      html: [],
      mismatch: null,
    });
  });
});

/**
 * The two halves of the key, measured against the SAME real post: the body
 * lines the editor computes from its own model must equal the lines the Astro
 * plugin stamped into the render. Both sides here are real — the fixture HTML
 * came off the running instance, and the body is copied verbatim out of
 * fixtures/local-astro-project/src/content/works/Timepad-Redesign.mdx.
 */
describe('editor body lines == plugin body lines (the real Timepad post)', () => {
  const TIMEPAD_BODY = [
    "import { Image } from 'astro:assets';",
    "import SingleImage from '../../components/SingleImage.astro';",
    "import DoubleImage from '../../components/DoubleImage.astro';",
    "import SingleVideo from '../../components/SingleVideo.astro';",
    "import ImageVideo from '../../components/ImageVideo.astro';",
    "import DoubleVideo from '../../components/DoubleVideo.astro';",
    "import Credit from '../../components/Credit.astro';",
    "import CreditWrapper from '../../components/CreditWrapper.astro';",
    '',
    '<SingleImage src="./images/timepad/hero.png" alt="Afisha home, 2022" />',
    '',
    'Timepad ran the largest independent ticketing platform in the region, and the',
    'discovery surface had been bolted on to a seller tool. We rebuilt the afisha as',
    'its own product: a feed people open on a Friday, not a search box they endure.',
    '',
    '<DoubleImage src1="./images/timepad/grid-1.png" src2="./images/timepad/grid-2.png" caption="Field trip notes." />',
    '',
    '## What shipped',
    '',
    '<CreditWrapper title="Team">',
    '  <Credit role="Design Director" name="Oleg Mayhopar" />',
    '  <Credit role="Product Design" name="Jane Doe" />',
    '</CreditWrapper>',
    'dk',
    '```js',
    "import SingleImage from '../../components/SingleImage.astro';",
    '<SingleImage src="./images/misc/blank.png" alt="not a real invocation" />',
    '```',
    '',
    '{/* <SingleVideo src="./images/timepad/teaser.mp4" poster="./images/misc/blank.png" /> */}',
    '',
    'Two years later the feed is still the default entry point, which is the only',
    'metric that ever mattered here.',
    '',
  ].join('\n');

  it('agrees line for line, so every chip finds its own render', () => {
    const lines = componentBodyLines(parsePostBody(TIMEPAD_BODY));
    expect(lines).toEqual([10, 16, 20]);
    const chunks = extractComponentHtml(html, ORIGIN);
    const paired = pairPreviewsToChips(chunks, lines);
    expect(paired.mismatch).toBeNull();
    expect(paired.html[0]).toContain('hero.png');
    expect(paired.html[1]).toContain('grid-1.png');
    expect(paired.html[2]).toContain('Oleg Mayhopar');
  });

  it('does not count the <SingleImage/> inside the fenced code block', () => {
    expect(componentBodyLines(parsePostBody(TIMEPAD_BODY))).toHaveLength(3);
  });
});

// Owner, 2026-08-10: a two-image Media rendered STACKED — Astro hoists the
// component's scoped <style> out of the wrapper, so the extracted HTML lost
// its row layout. Scoped CSS must travel with the previews; global imported
// CSS (tailwind base) must NOT (it would restyle the editor).
import { extractComponentCss } from '../componentPreview';

describe('extractComponentCss', () => {
  const page = `<html><head>
    <style data-vite-dev-id="/x/tailwind/base.css">*{margin:0}</style>
    <style>.sq-media[data-astro-cid-abc]{display:grid;grid-template-columns:repeat(2,1fr)}</style>
    <style>.unscoped{color:red}</style>
  </head><body></body></html>`;

  it('keeps astro-cid-scoped styles, drops imported and unscoped ones', () => {
    const css = extractComponentCss(page);
    expect(css).toContain('grid-template-columns');
    expect(css).not.toContain('margin:0');
    expect(css).not.toContain('.unscoped');
  });
});

describe('fetchComponentPreviews — component CSS', () => {
  it('a nested component\'s inline <style> (its next sibling) is collected once, not lost (row of three stacked, 2026-09-30)', async () => {
    const { fetchComponentPreviews } = await import('../componentPreview');
    const html = `<html><body>
      <div data-sq-block="component" data-sq-body-line="10"><div data-sq-stack="row">
        <div class="sq-media" data-sq-block="component" data-sq-body-line="24"></div><style>.sq-media{display:grid}</style>
        <div class="sq-media" data-sq-block="component" data-sq-body-line="30"></div><style>.sq-media{display:grid}</style>
      </div></div></body></html>`;
    const r = await fetchComponentPreviews('https://o', 'blog', 'a', async () => html);
    expect(r?.css).toBe('.sq-media{display:grid}');
  });
});

// Security (audit 2026-10-18): a chip's HTML is assigned to innerHTML in the
// EDITOR document (tiptap/schema.ts astroComponent view), which holds
// window.sqDesktop and every project. Imported templates render through here.
describe('extractComponentHtml — active content', () => {
  it('strips script/iframe/object/embed, on* handlers and javascript: URLs', () => {
    const page = `<html><body><div data-sq-block="component" data-sq-body-line="4">
      <img src="x" onerror="alert(1)"><script>alert(2)</script>
      <iframe srcdoc="&lt;script&gt;alert(3)&lt;/script&gt;"></iframe><object data="x"></object><embed src="x">
      <a href="javascript:alert(4)">a</a><a href=" java&#9;script:alert(5)">b</a>
      <svg onload="alert(6)"><a xlink:href="javascript:alert(7)"><text>t</text></a></svg>
      <p class="kept">kept</p></div></body></html>`;
    const [chunk] = extractComponentHtml(page, ORIGIN);
    expect(chunk.html).not.toMatch(/onerror|onload|<script|<iframe|<object|<embed|javascript:/i);
    expect(chunk.html).toContain('<p class="kept">kept</p>');
    expect(chunk.html).toContain('<img src="x">');
  });
});
