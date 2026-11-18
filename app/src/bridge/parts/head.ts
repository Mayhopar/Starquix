/**
 * IFrameBridge Part: IIFE-head constants
 *
 * Top-level constants declared in the bridge IIFE head, shared by many
 * prototype methods (scanning, markup serialization, text editing,
 * mutation filtering). Copied verbatim from bridge.js during the
 * single-source migration.
 */

export const BRIDGE_HEAD_CONSTANTS = `
  var LINK_SCAN_DELAY_MS = 150;    // Delay before scanning after link creation
  var LINK_SELECT_DELAY_MS = 100;  // Delay before selecting link after scan

  // Tag sets for element classification
  // Root <svg> is scannable/keyable (a shape IS content — it gets a Layers
  // row like <img>); svg INTERNALS (path/circle/g/...) stay skipped so icons
  // don't explode into layer rows.
  // br/wbr: a line break is part of its text, never a row or a keyed child box
  // (sq-tagging never tags them either). Keying one made a <p> with a <br>
  // look like a container, so it drilled instead of text-editing (2026-09-14).
  var SKIP_TAGS = ['br', 'wbr', 'script', 'style', 'noscript', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan', 'g', 'defs', 'clippath', 'mask', 'use', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'stop', 'astro-dev-toolbar', 'html', 'head', 'meta', 'title', 'link', 'base'];
  var MARKUP_SKIP_TAGS = ['script', 'style', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan', 'g', 'defs', 'clippath', 'mask', 'use', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'stop', 'marker'];
  var INLINE_TEXT_TAGS = ['a', 'span', 'em', 'strong', 'b', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup', 'code', 'abbr', 'cite', 'q', 'time'];
  var BLOCK_ELEMENT_SELECTOR = 'div, p, button, input, form, section, article, nav, header, footer, main, aside, ul, ol, li, table, tr, td, th, h1, h2, h3, h4, h5, h6';
  var SIGNIFICANT_MUTATION_TAGS = ['div', 'section', 'main', 'article', 'nav', 'header', 'footer', 'aside', 'form', 'table', 'ul', 'ol'];

  // task-149: the placement segment of a local-mode element key —
  // \`src/components/Card.astro:4:1~q<16 hex>\` with an optional \`#N\` repeat
  // suffix. Anchored at the end and hex-strict so a source path that happens to
  // contain '~' cannot false-positive. Capture group 1 = the placement itself.
  // task-159: \`q\` = the structural id, \`p\` = the legacy coordinate id kept
  // readable for the migration window. Both must match here — a key stored
  // before the upgrade is still a placement key.
  var PLACEMENT_KEY_PATTERN = /~([pqs][0-9a-f]{16})(?:#\\d+)?$/;
`;
