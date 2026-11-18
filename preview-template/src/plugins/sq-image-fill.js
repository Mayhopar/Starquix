/** Browser-safe, fail-closed source preflight and atomic image Fill transform. */
// HTML attribute identity folds ASCII capitals only; source spelling stays intact.
export function asciiAttributeName(name) {
  return name.replace(/[A-Z]/g, char => char.toLowerCase());
}

/** Attribute spans in one opening tag. Values are opaque; never search inside them. */
export function openingTagAttributes(tagContent) {
  const tagName = tagContent.match(/^<[a-zA-Z][a-zA-Z0-9.:-]*/);
  if (!tagName) throw new Error('Could not parse element tag');
  let pos = tagName[0].length;
  const fail = () => { throw new Error('Could not safely parse image attributes; edit this element in code'); };
  const quoted = (quote, expression) => {
    pos++;
    while (pos < tagContent.length) {
      const ch = tagContent[pos++];
      if (expression && ch === '\\') pos++;
      else if (ch === quote) return;
      else if (expression && quote === '`' && ch === '$' && tagContent[pos] === '{') braced();
    }
    fail();
  };
  const braced = () => {
    pos++;
    while (pos < tagContent.length) {
      const ch = tagContent[pos];
      if (ch === '}') { pos++; return; }
      if (ch === '{') braced();
      else if (ch === '"' || ch === "'" || ch === '`') quoted(ch, true);
      else if (tagContent.startsWith('/*', pos)) {
        const end = tagContent.indexOf('*/', pos + 2);
        if (end < 0) fail();
        pos = end + 2;
      } else if (tagContent.startsWith('//', pos)) {
        const end = tagContent.indexOf('\n', pos + 2);
        if (end < 0) fail();
        pos = end + 1;
      } else if (ch === '/') {
        // A regex can contain braces/quotes that are not expression boundaries.
        // Avoid guessing JS lexical context (including division) in this source edit.
        fail();
      } else pos++;
    }
    fail();
  };
  const attributes = [];
  const spreads = [];
  while (pos < tagContent.length) {
    while (/\s/.test(tagContent[pos] || '')) pos++;
    if (tagContent[pos] === '>' || tagContent.startsWith('/>', pos)) break;
    if (tagContent[pos] === '{') { const start = pos; braced(); spreads.push({ start, end: pos }); continue; }
    const start = pos;
    const name = /^[^\s=/>{}"']+/.exec(tagContent.slice(pos))?.[0];
    if (!name) fail();
    pos += name.length;
    const nameEnd = pos;
    while (/\s/.test(tagContent[pos] || '')) pos++;
    let valueStart = null;
    if (tagContent[pos] === '=') {
      pos++;
      while (/\s/.test(tagContent[pos] || '')) pos++;
      valueStart = pos;
      const ch = tagContent[pos];
      if (ch === '"' || ch === "'") quoted(ch, false);
      else if (ch === '{') braced();
      else {
        while (pos < tagContent.length && !/[\s>]/.test(tagContent[pos]) && !tagContent.startsWith('/>', pos)) pos++;
        if (pos === valueStart) fail();
      }
    } else pos = nameEnd;
    attributes.push({ name, start, end: pos, valueStart });
  }
  if (tagContent[pos] !== '>' && !tagContent.startsWith('/>', pos)) fail();
  const endOffset = pos + (tagContent.startsWith('/>', pos) ? 2 : 1);
  return { insertPos: tagName[0].length, attributes, spreads, endOffset };
}

const fail = (reason) => { throw new Error(`Image Fill: ${reason}`); };
const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const decodeAttribute = (value) => value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);?/gi, (whole, entity) => {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  if (Object.hasOwn(named, entity)) return named[entity];
  if (entity[0] === '#') {
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) return String.fromCodePoint(point);
  }
  return fail('This attribute uses an unsupported character reference. Edit it in source.');
});

/** Refuse URL data which would alter the Tailwind token/CSS string or be transient. */
export function imageFillUrlToken(src) {
  // Tailwind scans the authored class while Astro decodes HTML entities.
  // Escaping '&' here makes the generated selector/URL disagree with the DOM.
  if (typeof src === 'string' && src.includes('&')) fail('This image URL cannot be preserved as a Fill. Edit it in source.');
  if (typeof src !== 'string' || !src || /[\s\x00-\x1f\x7f'"`()\[\]{}\\<>]/.test(src) || src.includes('_')) {
    return fail('Use an image URL without spaces or unsupported characters.');
  }
  // Tailwind converts underscores in arbitrary values to spaces. Refuse instead
  // of writing a URL with different bytes; a subsequent encoder may support it.
  if (/^(?:blob|data|javascript|vbscript|file|sq-asset):/i.test(src) || /^\/\//.test(src)) return fail('Use a persistent project or HTTPS image URL.');
  // img resolves relative references against the document; CSS uses its
  // stylesheet. Without a proven route/base owner only absolute URLs agree.
  if (!src.startsWith('/') && !/^https?:\/\//i.test(src)) return fail('Use a root-relative or full HTTP(S) image URL.');
  return `bg-[url('${src}')]`;
}

const FITS = { cover: 'bg-cover', contain: 'bg-contain', fill: 'bg-[length:100%_100%]', none: 'bg-auto' };
const POSITIONS = new Set(['center', 'top', 'bottom', 'left', 'right', 'left-top', 'left-bottom', 'right-top', 'right-bottom']);
const SCOPE = /^(?:(?:sm|md|lg|xl|2xl):)?(?:dark:|light:)?(?:hover:|focus:|active:|focus-visible:|disabled:)?$/;
const COLOR = /^bg-(?:transparent|white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|\[#[\da-fA-F]{3,8}\])(?:\/\d{1,3})?$/;
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
/** Any run of variant prefixes (`md:`, `dark:`, `hover:` …) before a class. */
const VARIANTS = '(?:(?:sm|md|lg|xl|2xl|dark|light|hover|focus|active|focus-visible|disabled):)*';
/** A background image-fill token (url / fit / position / repeat), any variant prefix. */
const BG_FILL_TOKEN = new RegExp(`^${VARIANTS}bg-(?:\\[url\\(|cover$|contain$|auto$|\\[length:|center$|top$|bottom$|left(?:-top|-bottom)?$|right(?:-top|-bottom)?$|repeat(?:-x|-y)?$|no-repeat$)`);
/** A gradient token (direction or stop), any variant prefix. */
const GRADIENT_TOKEN = new RegExp(`^${VARIANTS}(?:bg-gradient-|from-|via-|to-)`);
const SCOPED = new RegExp(`^(${VARIANTS})(.*)$`);
const BG_FIT_TO_OBJECT = { 'bg-cover': 'cover', 'bg-contain': 'contain', 'bg-[length:100%_100%]': 'fill', 'bg-auto': 'none' };
/** The rendered box as Tailwind: `aspect-[w/h]` (reduced) for the height, `w-[Wpx]` for the width. */
export function boxClasses(box, { width, height }) {
  const out = [];
  if (!box || !(box.width > 0) || !(box.height > 0)) return out;
  const w = Math.round(box.width), h = Math.round(box.height);
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const g = gcd(w, h);
  if (!width) out.push(`w-[${w}px]`);
  if (!height) out.push(`aspect-[${w / g}/${h / g}]`);
  return out;
}

/** Exact opening tag and ancestor facts; reading a void img never needs </img>. */
export function readImageFillSource(content, location) {
  if (!Number.isInteger(location?.line) || !Number.isInteger(location?.column) || location.line < 1 || location.column < 1) fail('The image source location is unavailable.');
  const lines = content.split('\n');
  if (location.line > lines.length) fail('The image source location changed.');
  const offset = lines.slice(0, location.line - 1).reduce((n, line) => n + line.length + 1, 0) + location.column - 1;
  if (content[offset] !== '<') fail('The image source location changed.');
  let scan;
  try { scan = openingTagAttributes(content.slice(offset)); } catch { fail('The image attributes cannot be edited safely.'); }
  const expectedTag = content.slice(offset, offset + scan.endOffset);
  // Walk actual tags, skipping quoted/expression attribute contents and raw text.
  // Outside-tag expressions are not statically knowable source ancestry.
  const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  let pos = frontmatter?.[0].length ?? 0;
  const ancestors = [];
  while (pos < offset) {
    if (content.startsWith('<!--', pos)) {
      const end = content.indexOf('-->', pos + 4);
      if (end < 0 || end >= offset) fail('The image is inside unsupported source.');
      pos = end + 3; continue;
    }
    if (content[pos] === '{') fail('A generated image must be edited through its data or source.');
    if (content[pos] !== '<') { pos++; continue; }
    const close = /^<\/([a-zA-Z][\w.:-]*)\s*>/.exec(content.slice(pos));
    if (close) {
      if (ancestors.pop()?.toLowerCase() !== close[1].toLowerCase()) fail('The image source ancestry is ambiguous.');
      pos += close[0].length; continue;
    }
    const name = /^<([a-zA-Z][\w.:-]*)/.exec(content.slice(pos));
    if (!name) { pos++; continue; }
    let open;
    try { open = openingTagAttributes(content.slice(pos)); } catch { fail('The image source ancestry is unsupported.'); }
    const tag = name[1].toLowerCase();
    const end = pos + open.endOffset;
    if (end > offset) fail('The image source location changed.');
    if (tag === 'script' || tag === 'style') {
      const closing = new RegExp(`</${tag}\\s*>`, 'ig'); closing.lastIndex = end;
      const found = closing.exec(content);
      if (!found || found.index >= offset) fail('This image source is unsupported.');
      pos = closing.lastIndex; continue;
    }
    if (!VOID.has(tag) && content.slice(pos, end).slice(-2) !== '/>') ancestors.push(name[1]);
    pos = end;
  }
  if (ancestors.some(tag => ['picture', 'p', 'button', 'select', 'table', 'tr', 'svg', 'math'].includes(tag.toLowerCase()))) fail('This image container cannot be changed safely. Edit it in source.');
  return { expectedTag, offset, endOffset: offset + scan.endOffset, ancestors };
}

/** Source is the authority: no rendered pixels or effective classes are baked. */
export function inspectImageFillTag(tag) {
  if (!/^<img(?:\s|\/?>)/.test(tag)) fail('Select a literal image to edit its Fill.');
  let parsed;
  try { parsed = openingTagAttributes(tag); } catch { fail('The image attributes cannot be edited safely.'); }
  if (parsed.spreads.length) fail('This image receives generated attributes. Edit its source.');
  const attrs = new Map();
  for (const attr of parsed.attributes) {
    const name = asciiAttributeName(attr.name);
    if (attrs.has(name)) fail('This image has duplicate attributes. Edit its source.');
    attrs.set(name, attr);
  }
  const literal = (name, fallback) => {
    const attr = attrs.get(name);
    if (!attr) return fallback;
    const quote = tag[attr.valueStart];
    if (attr.valueStart === null || (quote !== '"' && quote !== "'")) fail(`The image ${name} must be a literal value.`);
    return decodeAttribute(tag.slice(attr.valueStart + 1, attr.end - 1));
  };
  for (const name of attrs.keys()) {
    // Figma model (2026-09-19): image-only delivery hints (srcset/sizes/loading/
    // decoding/fetchpriority/width/height) are DROPPED by a conversion, never a
    // refusal. Only properties a container cannot carry still refuse.
    if (['style', 'class:list', 'aria-hidden', 'aria-labelledby', 'usemap', 'ismap'].includes(name) || /^on|^set:|^client:/.test(name)) fail('This image has source properties that Fill cannot preserve.');
  }
  // The src is validated only where it becomes a background token (a kept
  // image on conversion); inspecting an <img> must accept any literal src —
  // owner 2026-09-20: an uploaded `/uploads/my_photo.png` refused AFTER the
  // container→img write had landed, leaving the panel on the wrong kind.
  const src = literal('src', '');
  const classes = literal('class', '');
  const description = literal('aria-label', literal('alt', ''));
  const role = literal('role', '');
  if (role && role !== 'img') fail('This image has an authored role that Fill cannot preserve.');
  const tokens = classes.trim().split(/\s+/).filter(Boolean);
  const retained = [], fitting = new Map(), position = new Map();
  let width = false, height = false;
  for (const token of tokens) {
    const match = /^((?:(?:sm|md|lg|xl|2xl|dark|light|hover|focus|active|focus-visible|disabled):)*)(.*)$/.exec(token);
    const [, scope, base] = match;
    // A prefix the bounded parser did not consume must never masquerade as
    // an unrelated class: its object/layout rules would stop applying on div.
    if (!SCOPE.test(scope) || base.includes(':') || base.includes('!')) fail('This image uses an unsupported style variant.');
    if (base.startsWith('object-')) {
      const property = base.slice(7);
      if (Object.hasOwn(FITS, property)) {
        if (fitting.has(scope)) fail('The image fit is ambiguous.');
        fitting.set(scope, property);
      } else if (POSITIONS.has(property)) {
        if (position.has(scope)) fail('The image position is ambiguous.');
        position.set(scope, property);
      } else fail('This image uses a custom fitting mode. Edit it in source.');
      continue;
    }
    // A container has no intrinsic size: remember whether the author sized
    // the box (w-*/h-*/size-*/aspect-*); `h-auto`/`w-auto` mean "intrinsic"
    // and are dropped — the conversion re-states the rendered box instead.
    if (!scope && /^(?:w|h)-auto$/.test(base)) continue;
    if (!scope && /^(?:w-|size-)/.test(base)) width = true;
    if (!scope && /^(?:h-|size-|aspect-)/.test(base)) height = true;
    // Old background fill tokens (a previous conversion, or authored) are
    // replaced by this Fill, never a refusal.
    if (BG_FILL_TOKEN.test(base) || /^(?:from|via|to)-/.test(base) || /^bg-gradient-/.test(base)) continue;
    retained.push(token);
  }
  return { parsed, attrs, src, classes, description, retained, fitting, position, width, height, fit: fitting.get('') ?? 'fill', imagePosition: position.get('') ?? 'center' };
}

/** Source-owned accessible naming on containers created by this adapter only. */
export function inspectImageFillContainerTag(tag) {
  if (!/^<div(?:\s|>)/.test(tag)) fail('This image Fill is not a supported container.');
  const parsed = openingTagAttributes(tag);
  if (parsed.spreads.length) fail('This image Fill has generated attributes.');
  const attrs = new Map();
  for (const attr of parsed.attributes) {
    const name = asciiAttributeName(attr.name);
    if (attrs.has(name)) fail('This image Fill has duplicate attributes.');
    attrs.set(name, attr);
  }
  const literal = (name, fallback = '') => {
    const attr = attrs.get(name);
    if (!attr) return fallback;
    if (attr.valueStart === null || !['"', "'"].includes(tag[attr.valueStart])) fail('This image Fill has generated properties.');
    return decodeAttribute(tag.slice(attr.valueStart + 1, attr.end - 1));
  };
  if (literal('data-sq-image-fill') !== 'true' || attrs.has('style') || attrs.has('aria-labelledby') || attrs.has('aria-hidden')) fail('This container has no editable image description.');
  const role = literal('role');
  if (role && role !== 'img') fail('This container has an authored role.');
  const classes = literal('class');
  const src = classes.match(/(?:^|\s)bg-\[url\('([^']+)'\)\](?:\s|$)/)?.[1] ?? '';
  if (src) imageFillUrlToken(src);
  return { parsed, attrs, classes, src, description: literal('aria-label') };
}

function updateContainerImageFill(content, read, change) {
  const state = inspectImageFillContainerTag(read.expectedTag);
  if (!/^\s*<\/div\s*>/.test(content.slice(read.endOffset))) fail('This image Fill contains content. Edit it in source.');
  if (change?.variant || !['description', 'remove', 'gradient', 'replace'].includes(change?.type)) fail('This container image change is unsupported.');
  if (change.type === 'replace') return revertContainerToImage(content, read, state, change);
  let description = change.type === 'description' ? change.value : '';
  if (typeof description !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(description)) fail('Use a valid image description.');
  let classes = state.classes;
  if (change.type !== 'description') {
    classes = classes.split(/\s+/).filter(token => !BG_FILL_TOKEN.test(token)).join(' ');
    if (change.type === 'gradient') {
      validateGradient(change.value);
      classes = classes.split(/\s+/).filter(token => !GRADIENT_TOKEN.test(token)).join(' ');
      classes = (classes + ' ' + change.value).trim();
    }
  }
  let tag = read.expectedTag;
  for (const attr of [...state.parsed.attributes].reverse()) {
    if (['role', 'aria-label', ...(change.type === 'description' ? [] : ['class'])].includes(asciiAttributeName(attr.name))) tag = tag.slice(0, attr.start) + tag.slice(attr.end);
  }
  tag = tag.replace(/\s*>$/, '');
  if (change.type !== 'description') tag += ` class="${escapeAttribute(classes)}"`;
  if (description.trim()) tag += ` role="img" aria-label="${escapeAttribute(description)}"`;
  return content.slice(0, read.offset) + tag + '>' + content.slice(read.endOffset);
}

/** Vice versa (Figma model 2026-09-19): a container this adapter owns, given
 *  an image, becomes an <img> again — box classes kept, bg fit/position mapped
 *  back to object-*, its accessible name back to alt. */
function revertContainerToImage(content, read, state, change) {
  if (typeof change.src !== 'string' || !change.src || /[\s\x00-\x1f"'<>]/.test(change.src)) fail('Use a valid image URL.');
  // Fill kinds are exclusive: the image replaces the colour and the gradient;
  // a bg fit / position maps back to object-*; one pass over the tokens.
  const classes = [];
  let fitMapped = false;
  for (const token of state.classes.split(/\s+/).filter(Boolean)) {
    const [, scope, base] = SCOPED.exec(token);
    if (Object.hasOwn(BG_FIT_TO_OBJECT, base)) { classes.push(`${scope}object-${BG_FIT_TO_OBJECT[base]}`); if (!scope) fitMapped = true; continue; }
    if (base.startsWith('bg-') && POSITIONS.has(base.slice(3))) { classes.push(`${scope}object-${base.slice(3)}`); continue; }
    if (BG_FILL_TOKEN.test(token) || GRADIENT_TOKEN.test(token) || COLOR.test(base)) continue;
    classes.push(token);
  }
  if (!fitMapped) classes.push('object-cover');
  let tag = read.expectedTag;
  for (const attr of [...state.parsed.attributes].reverse()) {
    if (['data-sq-image-fill', 'role', 'aria-label', 'class'].includes(asciiAttributeName(attr.name))) tag = tag.slice(0, attr.start) + tag.slice(attr.end);
  }
  tag = tag.replace(/^<div/, '<img').replace(/\s*>$/, '');
  tag += ` src="${escapeAttribute(change.src)}" alt="${escapeAttribute(state.description)}" class="${escapeAttribute(classes.join(' '))}">`;
  return content.slice(0, read.offset) + tag + content.slice(read.endOffset).replace(/^\s*<\/div\s*>/, '');
}

function validateGradient(value) {
  if (typeof value !== 'string' || !/^bg-gradient-to-(?:t|tr|r|br|b|bl|l|tl)(?: (?:from|via|to)-(?:white|black|transparent|[a-z]+-\d{2,3}|\[#[\da-fA-F]{3,8}\])){2,3}$/.test(value)) fail('This image gradient is unsupported.');
}

export function normalizeImageFillSource(content, location, request) {
  const read = readImageFillSource(content, location);
  if (typeof request?.expectedTag !== 'string' || request.expectedTag !== read.expectedTag) fail('The image source changed. Select it again.');
  if (/^<div(?:\s|>)/.test(read.expectedTag)) return updateContainerImageFill(content, read, request.change);
  const state = inspectImageFillTag(read.expectedTag);
  const change = request.change;
  if (!change || !['replace', 'fit', 'position', 'description', 'remove', 'color', 'gradient'].includes(change.type)) fail('This image Fill change is unsupported.');
  const scope = change.variant ?? '';
  if (typeof scope !== 'string' || !SCOPE.test(scope)) fail('This image Fill style variant is unsupported.');
  if (scope && ['replace', 'remove', 'description', 'gradient'].includes(change.type)) fail('Edit this image property in the base style.');
  let src = state.src, description = state.description;
  const classes = [...state.retained, ...boxClasses(request.box, state)];
  if (!state.height && !request.box) fail('Set an explicit width and height before editing this image Fill.');
  if (request.preserveMaxWidth === true && !classes.some(token => /^max-w-/.test(token))) classes.push('max-w-full');
  const fitting = new Map(state.fitting), position = new Map(state.position);
  if (!fitting.has('')) fitting.set('', 'fill');
  if (!position.has('')) position.set('', 'center');
  if (change.type === 'replace') { imageFillUrlToken(change.src); src = change.src; }
  if (change.type === 'fit') {
    if (!Object.hasOwn(FITS, change.value)) fail('This image fit is unsupported.');
    fitting.set(scope, change.value);
  }
  if (change.type === 'position') {
    if (!POSITIONS.has(change.value)) fail('Choose a supported image position.');
    position.set(scope, change.value);
  }
  if (change.type === 'description') {
    if (typeof change.value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(change.value)) fail('Use a valid image description.');
    description = change.value;
  }
  if (change.type === 'color') {
    if (!COLOR.test(change.value)) fail('This image background color is unsupported.');
    for (let i = classes.length - 1; i >= 0; i--) if (classes[i].startsWith(scope) && COLOR.test(classes[i].slice(scope.length))) classes.splice(i, 1);
    classes.push(scope + change.value);
  }
  // Fill kinds are exclusive (Figma): a colour or a gradient REPLACES the image.
  const remove = change.type === 'remove' || change.type === 'gradient' || change.type === 'color';
  if (!remove) {
    classes.push(imageFillUrlToken(src));
    for (const [variant, value] of fitting) classes.push(variant + FITS[value]);
    for (const [variant, value] of position) classes.push(variant + 'bg-' + value);
    classes.push('bg-no-repeat');
  } else description = '';
  if (change.type === 'gradient') {
    validateGradient(change.value);
    classes.push(...change.value.split(' '));
  }
  // Splice owned attribute spans only. Unrelated expressions/spelling/separators
  // survive byte-for-byte; they are never reconstructed from rendered values.
  let replacement = read.expectedTag;
  for (const attr of [...state.parsed.attributes].reverse()) {
    const name = asciiAttributeName(attr.name);
    if (['src', 'alt', 'width', 'height', 'srcset', 'sizes', 'loading', 'decoding', 'fetchpriority', 'role', 'aria-label', 'class', 'data-sq-image-fill'].includes(name)) {
      replacement = replacement.slice(0, attr.start) + replacement.slice(attr.end);
    }
  }
  replacement = replacement.replace(/^<img/, '<div').replace(/\s*\/?>$/, '');
  replacement += ` data-sq-image-fill="true" class="${escapeAttribute(classes.join(' '))}"`;
  if (description.trim()) replacement += ` role="img" aria-label="${escapeAttribute(description)}"`;
  replacement += '></div>';
  return content.slice(0, read.offset) + replacement + content.slice(read.endOffset);
}
