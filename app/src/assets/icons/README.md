# Editor icons

Import named components from `@/assets/icons`. SVG files are the source of truth;
keep existing export names and aliases when changing artwork.

- All artwork uses a 16 × 16 viewBox and `currentColor`; stroked icons use rounded joins and caps.
- **Every icon file holds two drawings of the same art**: `<g class="sq-g16">` on the 16px grid (1 unit = 1px) and
  `<g class="sq-g24" transform="scale(.8)">` on a 20px grid (the 20×20 artwork area of a 24px box; the .8 scale makes
  1 unit = 1px again). `theme.css` shows the one that matches the rendered size (24 unless the icon renders at 16).
- **Strokes are 1px** (`stroke-width="1"` on the root, `stroke-width: 1px` in `theme.css`), drawn BALANCED first and crisp
  second. The contract test `icons.test.tsx` enforces it:
  - **Half-pixel lattice.** Straight strokes and rect/fill edges sit on multiples of .5 (not k+.5): at 2x a 1px stroke
    there covers whole device pixels, AND the lattice contains the icon centre (8 in the 16 drawing, 10 in the 20 drawing).
    A k+.5 lattice cannot hold a symmetric icon (a 1px line on 8.5 is off-centre: it made a + with 6px/5px arms and a sun
    with 2px/1px rays). Ties snap TOWARD the centre, so mirror-symmetric art stays mirror-symmetric. At 1x a stroke on an
    integer blurs over two pixels: that is the price of balance; the owner's display is 2x.
  - **Balance is tested**: plus, minus, close, sun, T, chevrons, arrows, the diamond... must have a mirror image for every
    straight segment, and circles sit on the centre. Check any new icon the same way: render it and the original, flip
    both, compare (`flipLR/flipUD/rot90`) — the original's symmetry must survive.
  - **Rectilinear strokes** (only horizontal/vertical segments, rects) use `stroke-linecap="square"` +
    `stroke-linejoin="miter"` with every vertex on the lattice: line ends and corners cover whole pixels (a round cap leaves a
    dim end pixel on every stroke, a round join chips every right-angle corner). Stroked `<rect>`s use miter joins and no
    `rx <= .5`. A dot is a zero-length square-cap stroke.
  - **45° diagonals** have `x-y` / `x+y` a multiple of .5, so parallel diagonals anti-alias identically (otherwise one edge of
    a pencil looks bold and the other soft). Apexes follow the straight stroke they touch and stay on the lattice.
  - **Everything else keeps its drawn geometry**: other-angle lines, curves, arcs and circles are never snapped; a straight
    stroke they touch drags them along rigidly (quarter-arc corners stay circular).
  - **Size by optical weight, not by grid**: the chevrons are 10px wide (12 in the 20 drawing) — at 7px they read as specks
    next to 11–12px glyphs (owner 2026-11-04). `link`/`layer-link` is the chain-link metaphor: two open capsules facing
    each other with a bar through the gap, 12×6 (14×7), centred on the icon centre.
  - Absolute path commands only.
- Exactly two box sizes: **16×16px** for layers, the design bar and compact
  controls; **24×24px** for regular icons, with a centered **20×20px** artwork
  area (2px padding on every side). 12px icons are obsolete. Use square width/height
  pairs; icon slots declare their size explicitly. Do not add other icon sizes
  (no drawing is snapped for them).
- Position matters too: the icon box must land on a whole CSS pixel (centre carriers with even slack).
  Inspect at native size on both 1× and 2× displays.
- No IDs, clip paths, filters, text glyphs, external images, or fixed colors.
  Assets must be safe to repeat many times in one document.

## Metaphors

- Text alignment uses horizontal text lines. Object alignment retains axes/bars.
- Plain container = four corners. Flex keeps four corners and 3×8px children,
  with exactly 1px border clearance at 16px. Integer-aligned filled geometry
  gives both children identical bounds and the hollow child a 1px border;
  the filled child marks the start, including reverse flow. Grid uses four
  cells with the starting row/column filled. Frame = crossing boundary lines.
- Typography spacing measures the gap between horizontal/vertical rules; no
  cramped letter is nested inside a measurement glyph.
- Component = four filled diamonds; instance = one open diamond; slot = open
  boundary with an insertion mark.
- Padding = marks inside the element boundary; margin = marks outside it.
- Gap = separated items; axis variants show the space between two items.
  Preserve the supplied `YxGapIcon` metaphor: two vertical endpoints and two
  horizontal endpoints, joined by gap marks. Its original icon button stays
  beside the fields; do not replace it with a chain or a labeled checkbox.
- Fill = arrows outward toward boundaries; hug = arrows inward toward content;
  fixed width = a bounded element between fixed guides.
- Scale = a small box growing along a diagonal arrow into the corners of a larger frame.
- Visibility uses an eye; hidden uses a slash; invisible uses a dashed outline.
- Destructive actions share a trash can, regardless of their legacy export name.

Keep action labels/tooltips: an icon does not replace an accessible action name.
Brand marks and SVGs that render user artwork are outside this editor set.

## Review

Run `node scripts/preview-icons.mjs` from `app`, then open `/icon-review.html`
on the Vite server. The generated, ignored page shows every asset in light and
dark contexts at all supported sizes using the actual `theme.css` rules.

Run `npx vitest run src/assets/icons/__tests__/icons.test.tsx` for SVG parsing,
repeat-instance safety, and React export compatibility. These checks protect
the integration contract; the review sheet is necessary for visual judgment.
