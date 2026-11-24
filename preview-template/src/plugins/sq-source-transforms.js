import { asciiAttributeName, openingTagAttributes, normalizeImageFillSource } from './sq-image-fill.js';
import { parseValueForm, parseMarkupForm, valueExpr, markupForm, hasMarkup, escapeAstroBraces, decodeInnerHtmlEntities } from './sq-prop-fallback.js';

// Inlined AST Updater functions

/**
 * Find the opening bracket '<' near the given position
 */
export function findOpeningBracket(lines, lineIndex, colIndex) {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }

  const line = lines[lineIndex];
  let actualCol = colIndex;

  // Scan backwards
  while (actualCol > 0 && line[actualCol] !== '<') {
    actualCol--;
  }

  // If not found, scan forwards
  if (line[actualCol] !== '<') {
    actualCol = colIndex;
    while (actualCol < line.length && line[actualCol] !== '<') {
      actualCol++;
    }
  }

  if (actualCol >= line.length || line[actualCol] !== '<') {
    // Multi-line opening tag: the recorded key can point at the line the tag
    // ENDS on (e.g. a class={...} attr spanning lines) with no '<' on that
    // line at all — walk back through previous lines for the nearest '<',
    // and accept it ONLY if that opening tag actually spans the requested
    // location (a bogus location on a text-only line must stay null).
    const content = lines.join('\n');
    const locOffset = calculateOffset(lines, lineIndex, colIndex);
    for (let li = lineIndex - 1; li >= 0; li--) {
      const prev = lines[li];
      for (let c = prev.length - 1; c >= 0; c--) {
        if (prev[c] !== '<') continue;
        const tag = extractOpeningTag(content, calculateOffset(lines, li, c));
        if (tag && calculateOffset(lines, li, c) + tag.tagContent.length >= locOffset) {
          return { line: li, col: c };
        }
        return null; // nearest tag ends before the location — bogus loc
      }
    }
    return null;
  }

  return { line: lineIndex, col: actualCol };
}

/**
 * Calculate byte offset from line and column
 */
export function calculateOffset(lines, lineIndex, colIndex) {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  offset += colIndex;
  return offset;
}

/**
 * Extract the opening tag content (from '<' to '>')
 */
export function extractOpeningTag(content, startOffset) {
  let pos = startOffset;
  let tagContent = '';
  let inString = false;
  let stringChar = '';
  let braceDepth = 0;

  while (pos < content.length) {
    const char = content[pos];
    tagContent += char;
    pos++;

    if (inString) {
      if (char === stringChar && content[pos - 2] !== '\\') {
        inString = false;
      }
    } else {
      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
      } else if (char === '>' && braceDepth === 0) {
        return { tagContent, endOffset: pos };
      }
    }
  }

  return null;
}

/**
 * THE ownership contract for a class source that is only PARTLY a literal
 * (task-166).
 *
 * A leading literal concatenated with a dynamic tail — `class={'lit' + v}`,
 * `class:list={['lit', v]}`, or a plain `class="lit"` sitting beside a
 * `class:list` directive (Astro compiles both into ONE attribute) — owns only
 * SOME of the tokens the element renders. The editor hands the writer the
 * element's WHOLE EFFECTIVE class list, so writing that list into the literal
 * duplicates or FUSES the dynamic part's tokens. Both failure modes were
 * measured on served bytes from astro dev 4.16.19:
 *
 *   class={'text-' + size}   size="lg", user adds font-bold
 *     wrote {'text-lg font-bold' + size}  ->  class="text-lg font-boldlg"
 *     font-bold destroyed, fontWeight back to 400 — under a SUCCESS toast,
 *     and push-verify passed because the needle is a substring of the garbage.
 *
 *   class:list={['px-4 py-2', variant]}   variant="flex gap-4"
 *     absorbed the variant into the literal; `flex gap-4` rendered twice, and
 *     REMOVING a variant-owned token "succeeded" and came back on reload.
 *
 * Two ground truths, neither of them the rendered list:
 *
 *   owned    the ORIGINAL LITERAL TEXT in the file, whitespace-split. When the
 *            literal has no trailing separator AND the baseline does not show
 *            its last fragment as a whole token, that fragment is not a token at
 *            all — it is a PREFIX that fuses with the tail's first token
 *            (`'text-' + size`). It is owned by neither side and is re-emitted
 *            verbatim, last, where the author put it.
 *   dynamic  baseClasses \ owned. `baseClasses` is what the element renders
 *            while the file and the doc agree; the caller refreshes it to the
 *            value it just wrote, which keeps it self-consistent write after
 *            write (the literal it wrote IS `newClasses \ dynamic`, so
 *            `newClasses \ that` is `dynamic` again).
 *
 * Then: only `newClasses \ dynamic` is written. A `newClasses` that DROPS a
 * dynamic token cannot be honoured by editing the literal — the token comes back
 * at render no matter what the literal says, and Tailwind decides the winner by
 * the order of the GENERATED CSS, not by the order of the class attribute, so
 * there is no token ordering that would rescue it either. That is refused with a
 * reason the DesignBar toasts, because a success that reverts on reload is the
 * worst of the three outcomes and is exactly what shipped.
 *
 * No `baseClasses` = no way to tell a user's addition from the dynamic part's
 * contribution. Refused as well; guessing is what produced both artefacts.
 *
 * @returns {{ tokens: string[], prefix: string }} tokens to write (escapable)
 *          and the raw prefix fragment to re-emit after them, or throws.
 */
export function classTokens(value) {
  return String(value == null ? '' : value).split(/\s+/).filter(Boolean);
}

export function resolvePartialLiteral(originalLiteral, target, baseClasses, mayFuse, what) {
  if (typeof baseClasses !== 'string') {
    // Named the internal registry and told the user to "reselect the element",
    // which never repopulated anything — selection does not seed the baseline,
    // the DOM scan does. Say what is true of THEIR element and offer the two
    // actions that actually work: a reload (which re-scans, and re-seeds) or
    // editing the source. The sentence travels: the DesignBar toasts it and
    // pushNotice appends it to the Push result, so it has to read as prose.
    throw new Error(
      what + ' builds this element\'s class list in code, so the editor cannot tell which of ' +
      'those classes your change would replace. Reload the preview so it can re-read the page, ' +
      'then make the change again — or edit the class list directly in the source file.'
    );
  }
  const fragments = classTokens(originalLiteral);
  const baseTokens = classTokens(baseClasses);
  // Is the literal's last fragment a PREFIX (half of a token the tail
  // completes) or a whole token? The BASELINE decides, not punctuation: it is a
  // prefix exactly when the element does not render it as a token of its own.
  // Guessing from the source alone got `class={'a b' + extra}` wrong whenever
  // `extra` is empty — `b` is a whole token there and moving it to the end
  // would have reordered a class list for no reason.
  const last = fragments.length > 0 ? fragments[fragments.length - 1] : '';
  const prefix = mayFuse && last && baseTokens.indexOf(last) === -1 ? (fragments.pop() ?? '') : '';
  const owned = fragments;
  const dynamic = baseTokens.filter((t) => owned.indexOf(t) === -1);
  const wanted = classTokens(target);
  const lost = dynamic.filter((t) => wanted.indexOf(t) === -1);
  if (lost.length > 0) {
    throw new Error(
      (lost.length === 1 ? lost[0] + ' is' : lost.join(', ') + ' are') +
      ' produced by a dynamic part of this element\'s class (' + what + '), not by the literal ' +
      'the editor can write — change it in the source file'
    );
  }
  return { tokens: wanted.filter((t) => dynamic.indexOf(t) === -1), prefix: prefix };
}

/**
 * Does the tail immediately after the `+` start with a literal whose first
 * character is whitespace? Then the author wrote the separator themselves
 * (`{'px-4' + ' ' + v}`) and the literal's last fragment is a whole token, not
 * a prefix.
 */
export function tailSuppliesSeparator(rest) {
  return /^\s*(['"`])\s/.test(rest);
}

/**
 * Replace or add class attribute in tag content.
 *
 * `baseClasses` — what the element renders while file and doc agree. Required
 * only for the PARTIAL shapes above; a literal that owns the whole attribute
 * (`class="…"` with no directive, `class={'lit'}`, `class:list="lit"`,
 * `class:list={['lit']}`) ignores it entirely.
 */
export function replaceOrAddClassAttribute(tagContent, filePath, newClasses, baseClasses) {
  const classLiteralRegex = /class(?:Name)?\s*=\s*(["'])([\s\S]*?)\1/;
  // class={'lit' + rest} — a leading string literal concatenated with a dynamic
  // tail (e.g. + customClass). Only the literal is edited, and only with the
  // tokens the literal owns (see resolvePartialLiteral).
  const classLeadingLiteralRegex = /((?:class|className)\s*=\s*\{\s*)(['"`])((?:\\.|(?!\2)[\s\S])*?)\2(\s*\+)/;
  // class={'lit'} / class={`lit`} — a pure literal in braces, safe to bake.
  const classBracedLiteralRegex = /(?:class|className)\s*=\s*\{\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\}/;
  const classExpressionRegex = /class(?:Name)?\s*=\s*\{/;
  // class:list — Astro's own directive. It compiles to the SAME class attribute,
  // so a `class` attr written BESIDE it does not replace it: Astro concatenates
  // the two and the original tokens survive, still able to win the cascade.
  // Measured on served bytes (astro dev 4.16.19): class:list={['px-4 py-2', v]}
  // plus a written class="px-12 py-2 flex gap-4" rendered
  // class="px-12 py-2 flex gap-4 px-4 py-2 flex gap-4" — the edit lost, under a
  // success reply. Edit the LEADING literal instead; Astro space-joins the
  // entries, so unlike the `+` form the literal's last fragment is always a
  // whole token (no prefix fusion). A leading entry that is not a plain literal
  // (object form, a dynamic first entry, an interpolated template, a
  // concatenation) is refused honestly — never written beside.
  // Group 5 is the delimiter: `]` means this literal is the SOLE entry and
  // therefore owns the whole attribute; `,` means there is a dynamic sibling.
  const classListArrayLiteralRegex = /(class:list\s*=\s*\{\s*\[\s*)(['"`])((?:\\.|(?!\2)[\s\S])*?)\2(\s*)([,\]])/;
  const classListBracedLiteralRegex = /(class:list\s*=\s*\{\s*)(['"`])((?:\\.|(?!\2)[\s\S])*?)\2(?=\s*\})/;
  const classListStringRegex = /(class:list\s*=\s*)(["'])([\s\S]*?)\2/;
  const classListRegex = /class:list\s*=/;

  const isJsxFile = /\.(jsx?|tsx?)$/.test(filePath);
  const useClassName = isJsxFile || tagContent.includes('className');
  const attrName = useClassName ? 'className' : 'class';

  // Rendered class lists can carry junk from `+ undefined` concatenations —
  // never bake those tokens back into source.
  const sanitizedClasses = classTokens(newClasses)
    .filter((t) => ['undefined', 'null', 'false', 'true'].indexOf(t) === -1)
    .join(' ');

  // Class tokens can carry quotes (bg-[url('/x.png')]) — writing them into a
  // same-quoted context unescaped produced a SYNTAX ERROR in the user's file.
  const attrQuote = (v) => (v.includes('"') ? "'" : '"');
  const escapeFor = (v, q) => v.split(q).join('\\' + q);
  // Tokens are escaped for the quoting context; the prefix fragment is copied
  // out of the file RAW and goes back raw, or its own escapes would be doubled.
  const composeLiteral = (part, quote) => {
    const body = part.tokens.map((t) => escapeFor(t, quote)).join(' ');
    if (!part.prefix) return body;
    return (body ? body + ' ' : '') + part.prefix;
  };

  const propFallback = propFallbackClass(tagContent, sanitizedClasses, t => replaceOrAddClassAttribute(t, filePath, newClasses, baseClasses));
  if (propFallback !== null) return propFallback;

  if (classLiteralRegex.test(tagContent)) {
    // A plain literal ALONGSIDE class:list is partial — Astro merges them.
    if (classListRegex.test(tagContent)) {
      const m = tagContent.match(classLiteralRegex);
      const part = resolvePartialLiteral(
        m[2], sanitizedClasses, baseClasses, false, 'class="…" beside class:list'
      );
      const q = attrQuote(sanitizedClasses);
      return tagContent.replace(classLiteralRegex, attrName + '=' + q + composeLiteral(part, q) + q);
    }
    const q = attrQuote(newClasses);
    return tagContent.replace(classLiteralRegex, `${attrName}=${q}${newClasses}${q}`);
  }

  const leadMatch = tagContent.match(classLeadingLiteralRegex);
  if (leadMatch && !(leadMatch[2] === '`' && leadMatch[3].includes('${'))) {
    // The `+` contributes NO separator, so the literal's own trailing space IS
    // the separator between it and the tail. Dropping it turned
    // class={'px-4 py-3 ' + variant} into class={'px-12 py-3' + variant} and
    // served class="px-12 py-3flex gap-4" — py-3 and flex destroyed as tokens,
    // in the user's real file. PRESERVED verbatim, never unconditionally
    // appended: class={'text-' + size} concatenates ONE token and a space there
    // would break it. Spaces/tabs only — a trailing newline can only come from
    // a line continuation, and re-emitting it raw is a syntax error.
    const trailingWs = /[ \t]*$/.exec(leadMatch[3])[0];
    const rest = tagContent.slice(leadMatch.index + leadMatch[0].length);
    const fuses = trailingWs === '' && !tailSuppliesSeparator(rest);
    const part = resolvePartialLiteral(
      leadMatch[3], sanitizedClasses, baseClasses, fuses, "class={'…' + …}"
    );
    return tagContent.replace(
      classLeadingLiteralRegex,
      (_m, pre, quote, _lit, plus) =>
        `${pre}${quote}${composeLiteral(part, quote)}${trailingWs}${quote}${plus}`
    );
  }

  const bracedMatch = tagContent.match(classBracedLiteralRegex);
  if (bracedMatch && !(bracedMatch[1] === '`' && bracedMatch[2].includes('${'))) {
    if (!sanitizedClasses.includes('"') || !sanitizedClasses.includes("'")) {
      const q = attrQuote(sanitizedClasses);
      return tagContent.replace(classBracedLiteralRegex, `${attrName}=${q}${sanitizedClasses}${q}`);
    }
    // both quote kinds present — keep the braced literal, escape its quote
    const q = bracedMatch[1];
    return tagContent.replace(classBracedLiteralRegex, `${attrName}={${q}${escapeFor(sanitizedClasses, q)}${q}}`);
  }

  if (classListRegex.test(tagContent)) {
    const arrayMatch = tagContent.match(classListArrayLiteralRegex);
    const listMatch = arrayMatch || tagContent.match(classListBracedLiteralRegex);
    if (listMatch && !(listMatch[2] === '`' && listMatch[3].includes('${'))) {
      // `]` = sole entry, so the literal owns the whole attribute. `,` = a
      // sibling entry contributes tokens the literal must not absorb.
      const solitary = !arrayMatch || arrayMatch[5] === ']';
      const write = solitary
        ? (quote) => escapeFor(sanitizedClasses, quote)
        : (quote) => composeLiteral(
            resolvePartialLiteral(listMatch[3], sanitizedClasses, baseClasses, false, 'class:list={[…]}'),
            quote,
          );
      // Separate replacers: the array regex captures the delimiter (group 5),
      // the braced one has no such group — sharing a callback made the
      // replacer's `offset` argument land in the output as a stray digit.
      if (arrayMatch) {
        return tagContent.replace(
          classListArrayLiteralRegex,
          (_m, pre, quote, _lit, gap, delim) => `${pre}${quote}${write(quote)}${quote}${gap}${delim}`
        );
      }
      return tagContent.replace(
        classListBracedLiteralRegex,
        (_m, pre, quote) => `${pre}${quote}${write(quote)}${quote}`
      );
    }
    const strMatch = tagContent.match(classListStringRegex);
    if (strMatch) {
      const q = attrQuote(sanitizedClasses);
      return tagContent.replace(classListStringRegex, (_m, pre) => `${pre}${q}${sanitizedClasses}${q}`);
    }
    // No editable leading literal. Adding a `class` attribute here does NOT
    // replace the directive — Astro concatenates both, the old tokens survive
    // and the edit is silently lost under a success reply. Refuse honestly.
    throw new Error(
      'class:list has no editable leading literal — edit it in the source file'
    );
  }

  if (classExpressionRegex.test(tagContent)) {
    // A dynamic expression with no editable literal (ternary, bare prop,
    // interpolated template). Baking the rendered classes would silently
    // sever the binding — refuse honestly; the editor surfaces this error.
    throw new Error(
      'class is a dynamic expression (class={…}) — edit it in the source file'
    );
  }

  {
    const tagNameMatch = tagContent.match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
    if (tagNameMatch) {
      const insertPos = tagNameMatch[0].length;
      return tagContent.slice(0, insertPos) + ` ${attrName}="${newClasses}"` + tagContent.slice(insertPos);
    } else {
      throw new Error('Could not parse element tag');
    }
  }
}

/**
 * Update class attribute at a specific location in file content
 */
export async function updateClassAttribute(content, filePath, location, newClasses, baseClasses) {
  const lines = content.split('\n');
  const lineIndex = location.line - 1;
  const colIndex = location.column - 1;

  // Find the '<' character
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  if (!bracket) {
    throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  }

  // Calculate offset and extract opening tag
  const tagStartOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagInfo = extractOpeningTag(content, tagStartOffset);

  if (!tagInfo) {
    throw new Error('Could not find end of opening tag');
  }

  const { tagContent, endOffset: tagEndOffset } = tagInfo;

  // Replace or add class attribute
  const newTagContent = replaceOrAddClassAttribute(tagContent, filePath, newClasses, baseClasses);

  return content.slice(0, tagStartOffset) + newTagContent + content.slice(tagEndOffset);
}


/**
 * task-140/141 media fill: swap an element's tag at a source location.
 * container -> img/video (resolve), img/video -> div (un-resolve, kind
 * 'container'), img/video -> img/video (src swap / kind change). Keeps every
 * original attribute except the media-owned ones. Throws (surfaced as a
 * failed write) on ineligible tags and on element children — the honest
 * server-side gate.
 */
const SWAP_CONTAINER_TAGS = ['div', 'section', 'article', 'figure', 'span'];
const SWAP_MEDIA_TAGS = ['img', 'video'];
const MEDIA_OWNED_ATTRS = new Set([
  'src', 'alt', 'autoplay', 'muted', 'loop', 'playsinline', 'controls', 'poster', 'data-sq-media',
]);

/** Rebuild an attr string dropping media-owned attrs (tokenizer, not regex-per-attr — attr VALUES may contain attr names). */
export function stripMediaOwnedAttrs(attrStr) {
  const re = /([a-zA-Z_:@][-a-zA-Z0-9_:.@]*)(\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?/g;
  let out = '';
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    if (!MEDIA_OWNED_ATTRS.has(m[1].toLowerCase())) out += ` ${m[0]}`;
  }
  return out;
}

// Map only the span the operation actually replaces. The root is retained;
// opening-tag-only edits retain descendants, full conversions remove them.
function observeElementReplacement(content, updated, start, end, onTransform) {
  if (!onTransform) return;
  const before = content.replace(/\r\n/g, '\n'), after = updated.replace(/\r\n/g, '\n');
  if (content === updated) {
    onTransform(content, updated, [{ beforeStart: 0, afterStart: 0, length: before.length }]);
    return;
  }
  const afterEnd = end + after.length - before.length;
  onTransform(content, updated, [
    { beforeStart: 0, afterStart: 0, length: start },
    { beforeStart: end, afterStart: afterEnd, length: before.length - end },
    { beforeStart: start, afterStart: start, length: 1 },
  ]);
}

export async function swapElementTag(content, location, kind, src, imageFill, onTransform) {
  if (kind === 'image-fill') {
    const updated = normalizeImageFillSource(content, location, imageFill);
    if (onTransform) {
      // Native img normalization and owned-container edits both splice only
      // the original opening tag; the img contributes no old descendants.
      const span = resolveElementSpan(content.replace(/\r\n/g, '\n'), location);
      observeElementReplacement(content, updated, span.start, span.openEnd, onTransform);
    }
    return updated;
  }
  if (kind !== 'image' && kind !== 'video' && kind !== 'container') {
    throw new Error(`media fill: unknown kind ${kind}`);
  }
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalized.split('\n');
  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  const tagStartOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagInfo = extractOpeningTag(normalized, tagStartOffset);
  if (!tagInfo) throw new Error('Could not find end of opening tag');
  const { tagContent, endOffset } = tagInfo;
  const nameMatch = tagContent.match(/^<([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!nameMatch) throw new Error('Could not parse element tag');
  const origTag = nameMatch[1];
  const lowerTag = origTag.toLowerCase();
  const isMediaTag = SWAP_MEDIA_TAGS.includes(lowerTag);
  if (!SWAP_CONTAINER_TAGS.includes(lowerTag) && !isMediaTag) {
    // astro:assets <Image>/<Picture> forward attrs onto their rendered <img>,
    // so the editor selects what LOOKS like an img while the source is a
    // component — name the real blocker.
    if (/^[A-Z]/.test(origTag)) {
      throw new Error(`media fill: <${origTag}> is an Astro component — the source is not a plain element; edit it in code`);
    }
    throw new Error(`media fill: <${origTag}> is not an eligible container`);
  }
  if (kind === 'container' && !isMediaTag) {
    // Idempotent delete: the desired end state (a container) already holds —
    // stale selections after a successful un-resolve must not error.
    observeElementReplacement(content, content, tagStartOffset, endOffset, onTransform);
    return content;
  }
  // Data-bound media: src={expr} comes from frontmatter/props — a file-level
  // swap would sever the binding. The right edit is the content, not the tag.
  if (isMediaTag && openingTagAttributes(tagContent).attributes.some(attr =>
    asciiAttributeName(attr.name) === 'src' && attr.valueStart !== null && tagContent[attr.valueStart] === '{')) {
    throw new Error(`media fill: <${origTag}> src is bound to data (src={…}) — edit the content/frontmatter instead`);
  }
  // Same-kind replacement owns src only; preserve alt, playback, loading,
  // dimensions and expression-valued unrelated attributes verbatim.
  if ((kind === 'image' && lowerTag === 'img') || (kind === 'video' && lowerTag === 'video')) {
    return updateImageAttribute(content, location, 'src', src, onTransform);
  }
  const attrs = stripMediaOwnedAttrs(tagContent.slice(nameMatch[0].length).replace(/\/?>$/, ''));
  const selfClosing = /\/>$/.test(tagContent);
  let endOfElement = endOffset;
  // img is a void tag: no closing tag to consume even without '/>'. video inner
  // content (no <source> children here) is discardable — skip the children guard.
  if (!selfClosing && lowerTag !== 'img') {
    const closeStart = findClosingTagStart(normalized, endOffset, origTag);
    if (closeStart === -1) throw new Error(`Could not find </${origTag}>`);
    const inner = normalized.slice(endOffset, closeStart);
    if (lowerTag !== 'video' && /<[a-zA-Z]/.test(inner)) {
      throw new Error('media fill: container has element children');
    }
    endOfElement = normalized.indexOf('>', closeStart) + 1;
  }
  const esc = (v) => String(v).replace(/"/g, '&quot;');
  let replacement;
  if (kind === 'container') {
    replacement = `<div${attrs}></div>`;
  } else if (kind === 'video') {
    replacement = `<video${attrs} src="${esc(src)}" autoplay muted loop playsinline></video>`;
  } else {
    replacement = `<img${attrs} src="${esc(src)}" alt="">`;
  }
  const result = normalized.slice(0, tagStartOffset) + replacement + normalized.slice(endOfElement);
  const updated = hasCRLF ? result.replace(/\n/g, '\r\n') : result;
  observeElementReplacement(content, updated, tagStartOffset, endOfElement, onTransform);
  return updated;
}

/** Exact changed line regions from the same write, for existing structural Undo. */
export async function swapElementTagWithUndo(content, location, kind, src, imageFill, onTransform) {
  const updated = await swapElementTag(content, location, kind, src, imageFill, onTransform);
  const before = content.match(/[^\n]*\n|[^\n]+$/g) || [];
  const after = updated.match(/[^\n]*\n|[^\n]+$/g) || [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start === before.length && start === after.length) return { updated, extra: { changed: false } };
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { updated, extra: {
    changed: true, replacedLine: start + 1,
    originalLineCount: oldEnd - start, replacedLineCount: newEnd - start,
    originalSegment: before.slice(start, oldEnd).join(''),
    replacementSegment: after.slice(start, newEnd).join(''),
  } };
}

// ── task-133: structural ops — insert/remove/move at keyed locations.
// String-splice on [start, end) spans resolved from data-sq-source locations;
// callers pass 1-based {line, column}. All three ops normalize CRLF in, restore
// CRLF out (swapElementTag pattern).

const STRUCTURAL_VOID_TAGS = ['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr'];

/**
 * Resolve a keyed element's full [start, end) span in \n-normalized content.
 * voidLike (self-closing syntax or a void tag) spans the opening tag only.
 */
export function resolveElementSpan(content, location) {
  const lines = content.split('\n');
  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  const start = calculateOffset(lines, bracket.line, bracket.col);
  const tagInfo = extractOpeningTag(content, start);
  if (!tagInfo) throw new Error('Could not find end of opening tag');
  const nameMatch = tagInfo.tagContent.match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!nameMatch) throw new Error('Could not parse element tag');
  const tag = nameMatch[1];
  const voidLike = /\/>$/.test(tagInfo.tagContent) || STRUCTURAL_VOID_TAGS.includes(tag.toLowerCase());
  let end = tagInfo.endOffset;
  let closeStart = null;
  if (!voidLike) {
    closeStart = findClosingTagStart(content, tagInfo.endOffset, tag);
    if (closeStart === -1) throw new Error(`Could not find </${tag}>`);
    end = content.indexOf('>', closeStart) + 1;
  }
  return { start, end, tag, voidLike, openEnd: tagInfo.endOffset, closeStart };
}

/**
 * An element that IS the whole value of a `{…}` expression — a guard
 * `{cond && <el/>}` (a card field's eye `{show.f && …}`) or a `.map()` body
 * `{items.map((item) => <el/>)}`, either one `(…)`-wrapped — is ONE unit for
 * sibling splices: before/after inserts, removal and moves take the whole
 * expression, or they leave invalid code (`{cond && }`, `{items.map((item) => )}`)
 * or land in the callback, once per item (audit #8/#10). One that shares its
 * expression (a ternary branch, a block-bodied callback) can't leave it alone:
 * refused. A child inside the element never widens; inside-end is unaffected.
 */
const EXPRESSION_OPEN = /\{(?:[^{}<]|\{[^{}<]*\})*$/; // an unclosed `{`, no markup after it
const EXPRESSION_CLOSE = /^(?:[^{}<]|\{[^{}<]*\})*\}/; // a `}` before any markup
export function widenToExpression(content, span) {
  const head = content.slice(templateStartOffset(content), span.start).match(EXPRESSION_OPEN);
  const tail = content.slice(span.end).match(EXPRESSION_CLOSE);
  if (!head && !tail) return span;
  if (head && tail && /(?:&&|=>)[\s(]*$/.test(head[0]) && /^[\s)]*\}$/.test(tail[0])) {
    return { ...span, start: span.start - head[0].length, end: span.end + tail[0].length };
  }
  throw new Error(`structural op: <${span.tag}> is one part of a {…} expression — edit this one in code`);
}

export function lineNumberAt(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

export function lineIndentAt(content, offset) {
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1;
  return content.slice(lineStart).match(/^[ \t]*/)[0];
}

/**
 * Per line of a block: does the line BEGIN inside an open <pre>, <textarea> or
 * whitespace-pre* element? Its leading whitespace is rendered text there, so
 * the dedent and the re-indent below leave it alone (task-269). Same primitives
 * as the splicer (extractOpeningTag / findClosingTagStart).
 */
function preformattedLines(lines) {
  const src = lines.join('\n');
  const spans = [];
  const openRe = /<!--[\s\S]*?-->|<([a-zA-Z][a-zA-Z0-9.:_-]*)/g;
  for (let m; (m = openRe.exec(src)); ) {
    if (!m[1]) continue; // a comment
    const open = extractOpeningTag(src, m.index);
    if (!open) break;
    openRe.lastIndex = open.endOffset;
    if (/\/>$/.test(open.tagContent)) continue;
    if (!/^(pre|textarea)$/i.test(m[1]) && !/\bwhitespace-pre/.test(open.tagContent)) continue;
    const close = findClosingTagStart(src, open.endOffset, m[1]);
    const end = close === -1 ? src.length : close;
    spans.push([open.endOffset, end]);
    openRe.lastIndex = end;
  }
  let start = 0;
  return lines.map((line) => {
    const inside = spans.some(([from, to]) => start >= from && start <= to);
    start += line.length + 1;
    return inside;
  });
}

/** Strip leading/trailing blank space and the common leading indent — the splice re-indents to the target. */
export function dedentBlockLines(markup) {
  const lines = markup.replace(/^\n+/, '').replace(/[ \t\n]+$/, '').split('\n');
  const fixed = preformattedLines(lines);
  let min = Infinity;
  lines.forEach((l, i) => {
    if (l.trim() && !fixed[i]) min = Math.min(min, l.match(/^[ \t]*/)[0].length);
  });
  if (!Number.isFinite(min)) min = 0;
  return lines.map((l, i) => (fixed[i] ? l : l.slice(min)));
}

/**
 * Splice a block at an offset so it lands on its own line(s); blank lines and
 * lines inside preformatted elements stay unindented. Returns { content, insertedLine } (1-based first landed line)
 * plus the exact region the splice REWROTE (live-smoke Critical: insert and
 * remove are asymmetric in the mid-line case — the splice can split an inline
 * closing tag onto its own line, and remove-at-insertedLine never rejoins it):
 * - replacedLine/replacedLineCount: 1-based start + extent of the region in
 *   the POST-splice content;
 * - originalSegment: the pre-splice bytes of that region ('' when the splice
 *   only inserted new lines). restoreRegionAtLocation(originalSegment) over
 *   the region is the byte-exact inverse for ALL branches.
 */
export function spliceBlockAt(content, offset, blockLines, indent, tailIndent = indent) {
  const fixed = preformattedLines(blockLines);
  const indented = blockLines.map((l, i) => (l.length && !fixed[i] ? indent + l : l)).join('\n');
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1;
  if (/^[ \t]*$/.test(content.slice(lineStart, offset))) {
    // splice point owns its line start — the block takes the line, target shifts down
    return {
      content: content.slice(0, lineStart) + indented + '\n' + content.slice(lineStart),
      insertedLine: lineNumberAt(content, lineStart),
      replacedLine: lineNumberAt(content, lineStart),
      replacedLineCount: blockLines.length,
      originalSegment: '',
    };
  }
  const nlIdx = content.indexOf('\n', offset);
  const restOfLine = nlIdx === -1 ? content.slice(offset) : content.slice(offset, nlIdx);
  if (/^[ \t]*$/.test(restOfLine)) {
    // splice point ends its line — the block takes the next line
    if (nlIdx === -1) {
      // EOF append: REWRITES the current last line (adds its '\n') + block
      return {
        content: content + '\n' + indented,
        insertedLine: lineNumberAt(content, content.length) + 1,
        replacedLine: lineNumberAt(content, lineStart),
        replacedLineCount: 1 + blockLines.length,
        originalSegment: content.slice(lineStart), // original last line, no trailing newline
      };
    }
    return {
      content: content.slice(0, nlIdx + 1) + indented + '\n' + content.slice(nlIdx + 1),
      insertedLine: lineNumberAt(content, nlIdx + 1),
      replacedLine: lineNumberAt(content, nlIdx + 1),
      replacedLineCount: blockLines.length,
      originalSegment: '',
    };
  }
  // mid-line (e.g. inline closing tag) — break the line on both sides; the
  // tail (a closing tag on inside-end) keeps the target's own indent. The
  // original line is SPLIT: head line + block + tail line = 2 + block lines.
  const lineEnd = nlIdx === -1 ? content.length : nlIdx + 1;
  return {
    content: content.slice(0, offset) + '\n' + indented + '\n' + tailIndent + content.slice(offset),
    insertedLine: lineNumberAt(content, offset) + 1,
    replacedLine: lineNumberAt(content, offset),
    replacedLineCount: 2 + blockLines.length,
    originalSegment: content.slice(lineStart, lineEnd),
  };
}

export function structuralSpliceOffset(span, position) {
  if (position === 'before') return span.start;
  if (position === 'after') return span.end;
  if (position === 'inside-end') return span.closeStart;
  throw new Error(`structural op: unknown position ${position}`);
}

export function assertInsideEndAllowed(span, position) {
  if (position === 'inside-end' && span.voidLike) {
    throw new Error(`Cannot insert inside <${span.tag}> — it cannot have children`);
  }
}

/**
 * Target-span guard: inside-end splices at closeStart and after splices at
 * span.end — both close-derived, so a fake close (comment/template literal)
 * would land the markup INSIDE the comment. before uses only span.start and
 * needs no guard. voidLike spans have no close dependency.
 */
export function assertTargetSpanSafe(content, span, position) {
  if (position === 'before' || span.voidLike) return;
  assertSpanBalanced(content.slice(span.start, span.end), span.tag);
}

/**
 * task-133 Task 9 review: number of TOP-LEVEL element roots in an inserted
 * markup block. The undo inverse of an insert must be `remove ×rootCount` at
 * the inserted line — a single remove would orphan every root after the first
 * (`<h2>A</h2><p>B</p>` → undo deletes only the h2, redo then duplicates).
 * Counted SERVER-SIDE with the same primitives the splicer trusts
 * (extractOpeningTag / findClosingTagStart) — no client-side parsing.
 *
 * Text-only segments and comments between roots are NOT counted: they are not
 * spans removeElementAtLocation can target, so they intentionally "belong" to
 * the preceding root for counting purposes (a loose top-level text line would
 * survive undo — accepted v0; AI markup is element-rooted in practice).
 * An unclosed non-void root consumes the rest of the block (children must not
 * be counted as roots). Never returns 0 — a block with no parseable element
 * still gets one remove.
 */
export function countTopLevelRoots(markup) {
  return Math.max(1, scanTopLevelElements(markup.replace(/\r\n/g, '\n')).length);
}

/**
 * THE top-level element walker (single source for countTopLevelRoots and the
 * page-body anchor below). Returns, in document order, every element root at
 * the top level of `src` from `from`: { start, end, openEnd, closeStart, tag,
 * voidLike, unclosed }. Uses only the primitives the splicer already trusts
 * (extractOpeningTag / findClosingTagStart) — never a second parser.
 * Comments and loose text are skipped; an unclosed non-void root consumes the
 * rest of the input (its children must not be counted as roots).
 */
export function scanTopLevelElements(src, from = 0) {
  const roots = [];
  let pos = from;
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      pos = end === -1 ? src.length : end + 3;
      continue;
    }
    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9.:_-]*)/.exec(src.slice(lt));
    if (!tagMatch) { pos = lt + 1; continue; } // '<' in text (e.g. "1 < 2")
    const info = extractOpeningTag(src, lt);
    if (!info) break; // unterminated opening tag — stop scanning
    const tag = tagMatch[1];
    const voidLike = /\/>$/.test(info.tagContent) || STRUCTURAL_VOID_TAGS.includes(tag.toLowerCase());
    if (voidLike) {
      roots.push({ start: lt, end: info.endOffset, openEnd: info.endOffset, closeStart: null, tag, voidLike: true, unclosed: false });
      pos = info.endOffset;
      continue;
    }
    const closeStart = findClosingTagStart(src, info.endOffset, tag);
    if (closeStart === -1) {
      roots.push({ start: lt, end: src.length, openEnd: info.endOffset, closeStart: null, tag, voidLike: false, unclosed: true });
      break; // unclosed root swallows the rest
    }
    const closeEnd = src.indexOf('>', closeStart);
    const end = closeEnd === -1 ? src.length : closeEnd + 1;
    roots.push({ start: lt, end, openEnd: info.endOffset, closeStart, tag, voidLike: false, unclosed: false });
    pos = end;
  }
  return roots;
}

/**
 * Offset where the TEMPLATE region starts: right after the closing `---`
 * frontmatter fence, or 0 when the file has no frontmatter.
 */
export function templateStartOffset(normalized) {
  const lines = normalized.split('\n');
  const fences = findFrontmatterFences(lines);
  if (!fences) return 0;
  let offset = 0;
  for (let i = 0; i <= fences.closeIdx; i++) offset += lines[i].length + 1;
  return Math.min(offset, normalized.length);
}

/**
 * Fix 1 (task-148): offset of the element an unanchored page-level append
 * should land INSIDE, resolved from the file itself. Returns null when there
 * is no such element (caller appends at the end of the template instead).
 *
 * Rule: exactly ONE top-level template element = the page's outermost element
 * → its start. `<html>` prefers its `<body>` child (appending inside <html>
 * after </body> is invalid HTML) — deepest of html > body. Zero elements, a
 * void/self-closing root, an unclosed root, or MULTIPLE top-level roots (no
 * single outermost element — e.g. `<Header /><main/><Footer />`, or a
 * top-level `{expr}` holding markup) → null.
 */
export function findPageBodyAnchor(normalized) {
  const roots = scanTopLevelElements(normalized, templateStartOffset(normalized));
  if (roots.length !== 1) return null;
  const root = roots[0];
  if (root.voidLike || root.unclosed) return null;
  if (root.tag.toLowerCase() === 'html') {
    const region = normalized.slice(root.openEnd, root.closeStart);
    const body = scanTopLevelElements(region).find(
      (child) => child.tag.toLowerCase() === 'body' && !child.voidLike && !child.unclosed
    );
    if (body) return root.openEnd + body.start;
  }
  return root.start;
}

/**
 * Fix 1 (task-148): append markup to a page FILE with no DOM anchor.
 *
 * Layout-based pages (the shape of essentially every real Astro page) have a
 * template body of nothing but component tags: no scanned node carries the
 * page file's key, so ⌘K / draw / AI adds had no insert target at all. The
 * anchor is resolved from the file (findPageBodyAnchor) and the actual splice
 * is delegated to insertMarkupAtLocation(…, 'inside-end') — indentation, CRLF,
 * the balance/void guards and the region-restore fields (replacedLine /
 * replacedLineCount / originalSegment, the byte-exact undo inverse) all come
 * from the one splicer. With no anchor element the markup is appended at the
 * end of the template region (= EOF; frontmatter is at the top), still through
 * spliceBlockAt so the same region fields are reported.
 *
 * Reply shape is IDENTICAL to insertMarkupAtLocation — existing undo push
 * sites work unchanged.
 */
/**
 * task-160 — REFUSE spliced markup that already carries a `data-sq-id` stamp.
 *
 * A stamp names ONE invocation. Splicing a copy of one in gives two invocations
 * the same id, and on the next open BOTH are poisoned back to the ordinal and
 * both lose their stored styling — strictly worse than a sliding ordinal, which
 * is the whole thing this feature removes. The client (`ViteStructuralWriter`,
 * `localComponentInsert`, the AI add path) already strips it; this is the
 * server-side backstop so a stale client cannot corrupt the user's project.
 *
 * Only a grammar-valid quoted `s<16 hex>` is refused: a hand-authored opt-out
 * (`data-sq-id={undefined}`) is legitimate and passes through.
 *
 * MOVE is deliberately NOT guarded — it relocates the file's own existing bytes
 * and the stamp riding along IS the feature (identity follows the element).
 */
export function assertNoStamp(markup) {
  if (typeof markup === 'string' && /\sdata-sq-id=(["'])s[0-9a-f]{16}\1/.test(markup)) {
    throw new Error(
      'insert: markup carries a data-sq-id stamp — a stamp names one invocation and ' +
        'cannot be duplicated. Strip it before inserting.',
    );
  }
}

export function appendToPageBody(content, markup) {
  if (typeof markup !== 'string' || markup.trim() === '') {
    throw new Error('append-page: no markup to append');
  }
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const anchor = findPageBodyAnchor(normalized);
  if (anchor !== null) {
    return insertMarkupAtLocation(
      content,
      { line: lineNumberAt(normalized, anchor), column: columnNumberAt(normalized, anchor) },
      markup,
      'inside-end'
    );
  }
  const blockLines = dedentBlockLines(markup.replace(/\r\n/g, '\n'));
  const out = spliceBlockAt(normalized, normalized.length, blockLines, '');
  return {
    content: hasCRLF ? out.content.replace(/\n/g, '\r\n') : out.content,
    insertedLine: out.insertedLine,
    rootCount: countTopLevelRoots(markup),
    replacedLine: out.replacedLine,
    replacedLineCount: out.replacedLineCount,
    originalSegment: hasCRLF ? out.originalSegment.replace(/\n/g, '\r\n') : out.originalSegment,
  };
}

/**
 * Insert markup relative to a keyed element. position: 'inside-end' (before the
 * closing tag, one level deeper) | 'before' | 'after' (target's indent).
 * rootCount: top-level roots in the inserted block (see countTopLevelRoots) —
 * the caller's undo inverse is remove ×rootCount at insertedLine.
 */
export function insertMarkupAtLocation(content, location, markup, position) {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const own = resolveElementSpan(normalized, location);
  assertInsideEndAllowed(own, position);
  assertTargetSpanSafe(normalized, own, position);
  const span = position === 'inside-end' ? own : widenToExpression(normalized, own);
  const offset = structuralSpliceOffset(span, position);
  const baseIndent = lineIndentAt(normalized, span.start);
  const indent = position === 'inside-end' ? baseIndent + '  ' : baseIndent;
  const blockLines = dedentBlockLines(markup.replace(/\r\n/g, '\n'));
  const out = spliceBlockAt(normalized, offset, blockLines, indent, baseIndent);
  return {
    content: hasCRLF ? out.content.replace(/\n/g, '\r\n') : out.content,
    insertedLine: out.insertedLine,
    rootCount: countTopLevelRoots(markup),
    // Live-smoke Critical: the byte-exact inverse is ONE region restore of
    // originalSegment over [replacedLine, replacedLine+replacedLineCount).
    replacedLine: out.replacedLine,
    replacedLineCount: out.replacedLineCount,
    originalSegment: hasCRLF ? out.originalSegment.replace(/\n/g, '\r\n') : out.originalSegment,
  };
}

/**
 * Guard for remove/move: a fake tag inside an HTML comment or a template
 * literal makes findClosingTagStart truncate (or overrun) the span, and
 * splicing a wrong span corrupts the user's file. Count real opens/closes for
 * the target tag with comment and backtick regions masked; unbalanced =
 * refuse honestly (surfaced as a failed write / toast).
 */
export function assertSpanBalanced(spanSource, tag) {
  let masked = '';
  let mode = null; // null | 'comment' | 'template' | 'string'
  let stringChar = '';
  let braceDepth = 0;
  for (let i = 0; i < spanSource.length; i++) {
    const ch = spanSource[i];
    if (mode === 'comment') {
      if (spanSource.startsWith('-->', i)) {
        masked += '   ';
        i += 2;
        mode = null;
      } else {
        masked += ' ';
      }
    } else if (mode === 'template') {
      masked += ' ';
      if (ch === '`') mode = null;
    } else if (mode === 'string') {
      masked += ' ';
      if (ch === stringChar && spanSource[i - 1] !== '\\') mode = null;
    } else if (spanSource.startsWith('<!--', i)) {
      masked += ' ';
      mode = 'comment';
    } else if (ch === '`') {
      masked += ' ';
      mode = 'template';
    } else if (braceDepth > 0 && (ch === "'" || ch === '"')) {
      // quoted strings are code ONLY inside {expr} regions — masking quotes
      // globally would false-throw on apostrophes in text (<p>don't</p>)
      masked += ' ';
      mode = 'string';
      stringChar = ch;
    } else {
      if (ch === '{') braceDepth++;
      else if (ch === '}' && braceDepth > 0) braceDepth--;
      masked += ch;
    }
  }
  const esc = escapeRegex(tag);
  const openRe = new RegExp(`<${esc}(?=[\\s/>])`, 'gi');
  let opens = 0;
  let m;
  while ((m = openRe.exec(masked)) !== null) {
    const info = extractOpeningTag(masked, m.index);
    if (info && !/\/>$/.test(info.tagContent)) opens++;
  }
  const closes = (masked.match(new RegExp(`</${esc}\\s*>`, 'gi')) || []).length;
  if (opens !== closes) {
    throw new Error(
      `structural op: <${tag}> span looks unbalanced (comment or template literal containing tags?) — edit this one in code`
    );
  }
}

// Re-indenting these would silently change user string bytes — splice verbatim.
const WHITESPACE_SENSITIVE_RE = /[`]|<pre[\s>/]|<textarea[\s>/]/i;

/**
 * Removal region for a resolved span: when only whitespace surrounds the span
 * on its start/end lines, swallow the leading indent and the trailing newline.
 */
export function computeRemovalRegion(content, span) {
  let { start, end } = span;
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  if (/^[ \t]*$/.test(content.slice(lineStart, start))) {
    const nlIdx = content.indexOf('\n', end);
    const restOfLine = nlIdx === -1 ? content.slice(end) : content.slice(end, nlIdx);
    if (/^[ \t]*$/.test(restOfLine)) {
      start = lineStart;
      end = nlIdx === -1 ? content.length : nlIdx + 1;
    }
  }
  return { start, end };
}

/** 1-based column of an offset within its line. */
export function columnNumberAt(content, offset) {
  return offset - (content.lastIndexOf('\n', offset - 1) + 1) + 1;
}

/**
 * task-133 DATA-LOSS guard (real incident, 2026-08-02): a user selected the
 * rendered `<Header />` / `<a>Back</a>` on a page and pressed Delete. The
 * scanned element's sourceLocation.file is the COMPONENT's file, so the
 * remove ran against `src/components/Header.astro` and took out its ROOT —
 * leaving a 7-line frontmatter-only file (and `Back.astro` at 0 bytes). The
 * site header vanished from EVERY page; the project had no git, no recovery.
 *
 * True when removing `span` would leave the file's template region with no
 * top-level element at all — i.e. the span IS the file's only top-level
 * element. Computed SERVER-SIDE from the file itself with the same walker the
 * page-body anchor uses (scanTopLevelElements over templateStartOffset), so a
 * stale or bypassed client cannot talk its way past it.
 *
 * Known limitation (same as findPageBodyAnchor): markup inside a top-level
 * `{expr}` is scanned as a root, so a component whose template is one element
 * plus a mapped expression under-reports as multi-root. That is an
 * UNDER-refusal (the guard never fires spuriously), accepted for v0.
 */
export function isSoleTemplateRoot(normalized, span) {
  const roots = scanTopLevelElements(normalized, templateStartOffset(normalized));
  return roots.length === 1 && roots[0].start === span.start;
}

/**
 * Refuse a remove/move that would gut the file, unless the CALLER explicitly
 * opted in. Default-deny: `allowRootRemoval` is set only when the client knows
 * the target file is the page the user is editing (localStructuralOps
 * classifies same-file vs cross-file) or when replaying our own undo/redo of a
 * write we made. A client that does not send the flag gets the safe answer.
 */
export function assertRootRemovalAllowed(normalized, span, location, allowRootRemoval) {
  if (allowRootRemoval === true) return;
  if (!isSoleTemplateRoot(normalized, span)) return;
  const file = (location && location.file) || 'this file';
  const name = String(file).split('/').pop().replace(/\.astro$/, '');
  throw new Error(
    `removing <${span.tag}> would leave ${file} with no template content — it is that file's only top-level element, so every page using it would break. ` +
    `To take it off THIS page, delete the <${name} /> tag on the page instead.`
  );
}

/**
 * Remove a keyed element. removedSource is BYTE-EXACT (incl. any swallowed
 * indentation + trailing newline) — undo re-inserts it verbatim via
 * restoreSourceAtLocation at {removedLine, removedColumn} (region.start).
 * options.allowRootRemoval: opt-in past the gut-the-file guard above.
 */
export function removeElementAtLocation(content, location, options = {}) {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const own = resolveElementSpan(normalized, location);
  assertRootRemovalAllowed(normalized, own, location, options.allowRootRemoval);
  if (!own.voidLike) assertSpanBalanced(normalized.slice(own.start, own.end), own.tag);
  const span = widenToExpression(normalized, own);
  const region = computeRemovalRegion(normalized, span);
  const removedSource = normalized.slice(region.start, region.end);
  const result = normalized.slice(0, region.start) + normalized.slice(region.end);
  return {
    content: hasCRLF ? result.replace(/\n/g, '\r\n') : result,
    removedSource: hasCRLF ? removedSource.replace(/\n/g, '\r\n') : removedSource,
    removedLine: lineNumberAt(normalized, span.start),
    removedColumn: columnNumberAt(normalized, region.start),
  };
}

/**
 * task-133 Task 8: verbatim inverse of removeElementAtLocation / moveElement.
 * Splices previously-removed source bytes back at the EXACT {line, column}
 * they were removed from (region.start) with NO re-indent —
 * insertMarkupAtLocation dedents + re-indents, which breaks byte-fidelity for
 * whitespace-sensitive content (<pre>, template literals) and needs an anchor
 * ELEMENT at the target (gone when the removed node was an only child).
 * Guards mirror remove: the text must be an element and (non-void tags)
 * self-balanced; the shared write bracket's assertWritablePath applies.
 */
export function restoreSourceAtLocation(content, location, text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('restore: no source text to restore');
  }
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const normText = text.replace(/\r\n/g, '\n');
  // A removed expression value comes back whole: `{cond && <el>…</el>}`, `{items.map((x) => <el>…</el>)}` (widenToExpression).
  const tagMatch = normText.match(/^[ \t\n]*(?:\{[^<]*)?<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) throw new Error('restore: text is not an element');
  const tag = tagMatch[1];
  // Self-closing roots pass trivially (opens counts exclude />); bare void
  // tags have no close by design — skip, same as remove's span.voidLike gate.
  if (!STRUCTURAL_VOID_TAGS.includes(tag.toLowerCase())) {
    assertSpanBalanced(normText, tag);
  }
  const lines = normalized.split('\n');
  const line = location.line;
  if (!Number.isInteger(line) || line < 1 || line > lines.length + 1) {
    throw new Error(`restore: line ${line} is out of range`);
  }
  // Strict column (review): a stale column must ERROR (fail → drop → toast
  // contract), never silently clamp — a clamped splice lands wrong bytes.
  const column = location.column ?? 1;
  const lineLen = line > lines.length ? 0 : lines[line - 1].length;
  if (!Number.isInteger(column) || column < 1 || column > lineLen + 1) {
    throw new Error(`restore: column ${column} is out of range`);
  }
  let offset;
  if (line > lines.length) {
    offset = normalized.length;
  } else {
    let lineStart = 0;
    for (let i = 0; i < line - 1; i++) lineStart += lines[i].length + 1;
    offset = lineStart + (column - 1);
  }
  const result = normalized.slice(0, offset) + normText + normalized.slice(offset);
  return {
    content: hasCRLF ? result.replace(/\n/g, '\r\n') : result,
    restoredLine: line,
  };
}

/**
 * Move a keyed element relative to another in ONE pass. Both spans resolve on
 * the ORIGINAL content; a target that STARTS inside the moved element's span
 * throws — a subtree cannot move into itself (or onto itself). An ANCESTOR
 * target (moved element inside the target, e.g. inside-end of its own parent)
 * is legal: the per-offset shift below handles it. Offsets past the removed
 * region shift left by its length.
 *
 * Both spans resolve in ONE file (the write bracket reads sourceLocation.file
 * only), so a cross-file drag is refused outright — resolving the target's
 * line inside the WRONG file would splice at an arbitrary offset and corrupt
 * it. options.allowRootRemoval: opt-in past the gut-the-file guard (same
 * default-deny rule as removeElementAtLocation — a move takes the element out
 * of its file just as destructively as a delete).
 */
export function moveElement(content, fromLocation, toLocation, position, options = {}) {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  if (fromLocation && toLocation && fromLocation.file && toLocation.file
      && fromLocation.file !== toLocation.file) {
    throw new Error(
      `structural op: cannot move across files (${fromLocation.file} → ${toLocation.file}) — both elements must live in the same file`
    );
  }
  const fromOwn = resolveElementSpan(normalized, fromLocation);
  // BEFORE the own-subtree check: when the moved element is the file's only
  // top-level element, "this would gut the component" is the truer message
  // (its only in-file targets ARE its own descendants).
  assertRootRemovalAllowed(normalized, fromOwn, fromLocation, options.allowRootRemoval);
  if (!fromOwn.voidLike) assertSpanBalanced(normalized.slice(fromOwn.start, fromOwn.end), fromOwn.tag);
  const fromSpan = widenToExpression(normalized, fromOwn);
  const toOwn = resolveElementSpan(normalized, toLocation);
  assertTargetSpanSafe(normalized, toOwn, position);
  const toSpan = position === 'inside-end' ? toOwn : widenToExpression(normalized, toOwn);
  if (toSpan.start >= fromSpan.start && toSpan.start < fromSpan.end) {
    throw new Error('Cannot move an element into its own subtree');
  }
  assertInsideEndAllowed(toSpan, position);
  structuralSpliceOffset(toSpan, position); // position validated before mutating
  const region = computeRemovalRegion(normalized, fromSpan);
  const removedSource = normalized.slice(region.start, region.end);
  const afterRemove = normalized.slice(0, region.start) + normalized.slice(region.end);
  const removedLen = region.end - region.start;
  const shift = (o) => (o == null ? null : o >= region.end ? o - removedLen : o);
  const adjusted = {
    start: shift(toSpan.start),
    end: shift(toSpan.end),
    closeStart: shift(toSpan.closeStart),
  };
  const offset = structuralSpliceOffset(adjusted, position);
  const baseIndent = lineIndentAt(afterRemove, adjusted.start);
  const indent = position === 'inside-end' ? baseIndent + '  ' : baseIndent;
  const sensitive = WHITESPACE_SENSITIVE_RE.test(removedSource);
  const blockLines = sensitive
    ? removedSource.replace(/\n$/, '').split('\n')
    : dedentBlockLines(removedSource);
  const out = spliceBlockAt(afterRemove, offset, blockLines, sensitive ? '' : indent, baseIndent);
  return {
    content: hasCRLF ? out.content.replace(/\n/g, '\r\n') : out.content,
    insertedLine: out.insertedLine,
    // task-133 Task 8: original bytes + location — undo restores these
    // verbatim (restoreSourceAtLocation) AFTER the region restore below.
    removedSource: hasCRLF ? removedSource.replace(/\n/g, '\r\n') : removedSource,
    removedLine: lineNumberAt(normalized, region.start),
    removedColumn: columnNumberAt(normalized, region.start),
    // Live-smoke Critical (same class as insert): a mid-line target splice
    // splits the target's line; the inverse is [restore-region (undoes the
    // splice, byte-exact vs the post-removal content), restore (removedSource
    // at removedLine:removedColumn)] — never remove-at-insertedLine.
    replacedLine: out.replacedLine,
    replacedLineCount: out.replacedLineCount,
    originalSegment: hasCRLF ? out.originalSegment.replace(/\n/g, '\r\n') : out.originalSegment,
  };
}

/**
 * Live-smoke Critical: byte-exact inverse of an insert/move SPLICE. Replaces
 * the post-splice line range [line, line+lineCount) with `segment` — the
 * pre-splice bytes of that region ('' = the splice only inserted new lines;
 * deleting the range restores the original). Unlike remove-at-insertedLine
 * this rejoins a mid-line-split target line. Strict range errors (fail →
 * drop → toast contract); assertWritablePath applies via the write bracket.
 * segment is an arbitrary original line fragment — no balance guard (it may
 * legitimately hold a lone closing tag).
 */
export function restoreRegionAtLocation(content, location, lineCount, segment) {
  if (typeof segment !== 'string') throw new Error('restore-region: no segment to restore');
  if (!Number.isInteger(lineCount) || lineCount < 1) {
    throw new Error(`restore-region: invalid lineCount ${lineCount}`);
  }
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const normSegment = segment.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const realLineCount = normalized.endsWith('\n') ? lines.length - 1 : lines.length;
  const line = location.line;
  if (!Number.isInteger(line) || line < 1 || line > realLineCount) {
    throw new Error(`restore-region: line ${line} is out of range`);
  }
  if (line + lineCount - 1 > realLineCount) {
    throw new Error(`restore-region: line range ${line}..${line + lineCount - 1} is out of range`);
  }
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  let end = start;
  for (let i = line - 1; i < line - 1 + lineCount; i++) end += lines[i].length + 1;
  if (end > normalized.length) end = normalized.length; // last line had no trailing newline
  const result = normalized.slice(0, start) + normSegment + normalized.slice(end);
  return {
    content: hasCRLF ? result.replace(/\n/g, '\r\n') : result,
    restoredLine: line,
  };
}

// ── task-133: frontmatter import management (component inserts need the
// import registered before the tag renders; remove is the undo inverse) ──

/**
 * Locate the frontmatter fence lines. Returns { openIdx, closeIdx } as line
 * indices into `lines`, or null when the file has no `---` frontmatter.
 */
export function findFrontmatterFences(lines) {
  if (lines.length === 0 || lines[0].trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { openIdx: 0, closeIdx: i };
  }
  return null;
}

/**
 * Add `import Name from 'path';` to the frontmatter, after the LAST existing
 * import (or right after the opening --- when there are none). Creates the
 * frontmatter block when the file has none. Duplicate (same name AND path)
 * returns the content unchanged — the byte-compare in performWrite skips the
 * write. Same name bound to a DIFFERENT path throws (silent shadowing would
 * render the wrong component).
 *
 * Known-minor tradeoffs (accepted, v0):
 * - mixed-EOL files normalize to uniform CRLF on write (cosmetic);
 * - a differently-SPELLED path to the same file (./x vs ../a/x) is treated as
 *   a collision and throws — safe direction, never silently duplicates.
 */
export class ImportBindingConflict extends Error {
  code = 'import-binding-conflict';
  outcome = 'no-write';
}
export function addImportToFrontmatter(content, name, importPath) {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  // name '' = a side-effect import (`import './x.css';`) — files-truth
  // variables CSS is linked into the layout this way (Phase 3.2).
  const importLine = name ? `import ${name} from '${importPath}';` : `import '${importPath}';`;
  const lines = normalized.split('\n');
  const fences = findFrontmatterFences(lines);
  if (!fences) {
    const out = `---\n${importLine}\n---\n` + normalized;
    return hasCRLF ? out.replace(/\n/g, '\r\n') : out;
  }
  const bindsName = new RegExp(`(?:^|[\\s{,])${escapeRegex(name)}(?:$|[\\s},])`);
  // P4c: a from-clause ANYWHERE on the start line = complete single-line
  // statement (trailing comments allowed). EOL-only anchoring made the forward
  // scan swallow the NEXT import as part of one statement, bypassing its
  // collision/duplicate checks. Forward-scan ONLY when the start line has no
  // from-clause at all; the multi-line terminator stays EOL-anchored.
  const FROM_ANYWHERE_RE = /\bfrom\s+(['"])[^'"]+\1/;
  const TERMINATOR_RE = /\bfrom\s+(['"])[^'"]+\1;?\s*$/;
  const SIDE_EFFECT_RE = /^\s*import\s+(['"])[^'"]+\1;?\s*$/;
  let lastImportIdx = fences.openIdx; // insert AFTER this line
  let inTemplate = false;
  for (let i = fences.openIdx + 1; i < fences.closeIdx; i++) {
    const line = lines[i];
    const ticks = (line.match(/`/g) || []).length;
    if (inTemplate) {
      // template-literal bytes are strings, not code — an import-looking line
      // in here must not become the insert anchor (would splice into the string)
      if (ticks % 2 === 1) inTemplate = false;
      continue;
    }
    if (!/^\s*import\b/.test(line)) {
      if (ticks % 2 === 1) inTemplate = true;
      continue;
    }
    if (SIDE_EFFECT_RE.test(line)) {
      if (!name && line.trim() === importLine) return content; // side-effect import already present
      lastImportIdx = i;
      continue;
    }
    if (FROM_ANYWHERE_RE.test(line)) {
      const m = line.match(/^\s*import\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2/);
      // A side-effect import creates no binding and cannot collide with one.
      if (name && m && bindsName.test(m[1])) {
        if (m[3] === importPath) return content; // duplicate — no-op
        throw new ImportBindingConflict(`import name ${name} already used (imports ${m[3]})`);
      }
      lastImportIdx = i;
      continue;
    }
    // Multi-line statements (import {\n  Foo,\n} from './lib';): consume
    // forward to the terminating from-line; splicing at the START line would
    // write a syntax error inside the destructuring braces.
    let end = i;
    while (end < fences.closeIdx && !TERMINATOR_RE.test(lines[end])) end++;
    if (end === fences.closeIdx) {
      // No terminator inside the frontmatter — refuse rather than guess an
      // anchor that could corrupt the statement (worst case throw, never corrupt).
      throw new Error(`frontmatter import at line ${i + 1} has no terminating from '…' clause — add the import in code`);
    }
    const statement = lines.slice(i, end + 1).join('\n');
    const m = statement.match(/^\s*import\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2/);
    if (name && m && bindsName.test(m[1])) {
      if (m[3] === importPath) return content; // duplicate — no-op
      throw new ImportBindingConflict(`import name ${name} already used (imports ${m[3]})`);
    }
    lastImportIdx = end;
    i = end; // statement body consumed
  }
  lines.splice(lastImportIdx + 1, 0, importLine);
  const out = lines.join('\n');
  return hasCRLF ? out.replace(/\n/g, '\r\n') : out;
}

/**
 * Remove the exact `import Name from '...';` frontmatter line (line-clean).
 * No-op (unchanged content) when absent — undo of an insert whose import
 * already existed must not remove it twice.
 *
 * Task 8 review: opts.removeFences — when the FORWARD op CREATED the
 * frontmatter (add reply lineDelta 3), undo must also collapse the then-empty
 * `---\n---` pair or the restore is not byte-exact and every deeper structural
 * entry goes +2 lines stale. Flag-driven ONLY (the caller knows the forward
 * created it) — never inferred from content: a pre-existing empty frontmatter
 * must survive, and a no-op remove never collapses.
 */
export function removeImportFromFrontmatter(content, name, opts = {}) {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalized.split('\n');
  const fences = findFrontmatterFences(lines);
  if (!fences) return content;
  const lineRe = new RegExp(`^\\s*import\\s+${escapeRegex(name)}\\s+from\\s+['"][^'"]+['"];?\\s*$`);
  const idx = lines.findIndex((line, i) => i > fences.openIdx && i < fences.closeIdx && lineRe.test(line));
  if (idx === -1) return content;
  lines.splice(idx, 1);
  if (opts.removeFences === true) {
    // Collapse only when the removal left the fence pair EMPTY and adjacent.
    const after = findFrontmatterFences(lines);
    if (after && after.closeIdx === after.openIdx + 1) {
      lines.splice(after.openIdx, 2);
    }
  }
  const out = lines.join('\n');
  return hasCRLF ? out.replace(/\n/g, '\r\n') : out;
}

/**
 * Default imports (`import Name from '...'`) that nothing else in the file
 * references — the leftovers a structural remove produces (delete the
 * `<Layout>` wrapper, the `import Layout` line stays). Frontmatter code
 * counts as a use, so a value imported for its side effects on props is kept.
 */
export function unusedDefaultImports(content) {
  if (typeof content !== 'string') return [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const fences = findFrontmatterFences(lines);
  if (!fences) return [];
  const out = [];
  for (let i = fences.openIdx + 1; i < fences.closeIdx; i++) {
    const m = lines[i].match(/^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?\s*$/);
    if (!m) continue;
    const rest = lines.filter((_, j) => j !== i).join('\n');
    if (!new RegExp(`(^|[^\\w$])${escapeRegex(m[1])}(?![\\w$])`).test(rest)) out.push({ name: m[1], importPath: m[2] });
  }
  return out;
}

// ── task-108: text/image helpers ported from app/src/vite-plugin/ast-updater.ts
// (canonical, test-covered implementations; types stripped — plugin stays plain JS)

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace exactly one top-level image attribute, retaining all surrounding bytes. */
export function replaceOrAddAttribute(tagContent, attribute, value) {
  const { insertPos, attributes } = openingTagAttributes(tagContent);
  const matches = attributes.filter(attr => asciiAttributeName(attr.name) === asciiAttributeName(attribute));
  if (matches.length > 1) throw new Error(`Ambiguous image attribute: ${attribute}`);
  const replacementValue = `"${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  const match = matches[0];
  // An <img> src/alt read from an override prop (app/src/utils/propOverrides.ts):
  // a master edit rewrites only the fallback literal.
  if (match && match.valueStart !== null && (attribute === 'src' || attribute === 'alt')) {
    const p = parseValueForm(tagContent.slice(match.valueStart, match.end));
    if (p && p.literal !== null) return tagContent.slice(0, match.valueStart) + `{${valueExpr(p.prop, JSON.stringify(String(value)))}}` + tagContent.slice(match.end);
  }
  if (match) {
    // Keep the actual spelling and separator; only the value is ours to replace.
    const valueStart = match.valueStart ?? match.end;
    return tagContent.slice(0, valueStart) + (match.valueStart === null ? '=' : '') + replacementValue + tagContent.slice(match.end);
  }
  return tagContent.slice(0, insertPos) + ` ${attribute}=${replacementValue}` + tagContent.slice(insertPos);
}

/**
 * Update an image attribute at a specific location (ast-updater.ts updateImageAttribute).
 */
export async function updateImageAttribute(content, location, attribute, value, onTransform) {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalized.split('\n');

  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) {
    throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  }
  const tagStartOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagInfo = extractOpeningTag(normalized, tagStartOffset);
  if (!tagInfo) {
    throw new Error('Could not find end of opening tag');
  }
  const { tagContent, endOffset } = tagInfo;

  const replacement = replaceOrAddAttribute(tagContent, attribute, value).replace(/\r\n/g, '\n');
  const result = normalized.slice(0, tagStartOffset) + replacement + normalized.slice(endOffset);
  const updated = hasCRLF ? result.replace(/\n/g, '\r\n') : result;
  observeElementReplacement(content, updated, tagStartOffset, endOffset, onTransform);
  return updated;
}

/**
 * Find the start of the matching closing tag (ast-updater.ts findClosingTagStart).
 */
export function findClosingTagStart(content, startPos, tagName) {
  let pos = startPos;
  let depth = 1;

  const escapedTagName = escapeRegex(tagName);
  const openPattern = new RegExp(`<${escapedTagName}(?:\\s|>|/)`, 'gi');
  const closePattern = new RegExp(`</${escapedTagName}\\s*>`, 'gi');

  while (pos < content.length && depth > 0) {
    openPattern.lastIndex = pos;
    closePattern.lastIndex = pos;

    const openMatch = openPattern.exec(content);
    const closeMatch = closePattern.exec(content);

    if (!closeMatch) {
      return -1;
    }

    if (openMatch && openMatch.index < closeMatch.index) {
      const afterOpen = content.slice(openMatch.index);
      const tagEnd = afterOpen.indexOf('>');
      if (tagEnd !== -1 && afterOpen[tagEnd - 1] !== '/') {
        depth++;
      }
      pos = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return closeMatch.index; // Return start of closing tag, not end
      }
      pos = closeMatch.index + closeMatch[0].length;
    }
  }

  return -1;
}

/**
 * Instance override props (app/src/utils/propOverrides.ts): the master value
 * is the FALLBACK — class={Astro.props.ulClass ?? "flex p-6"},
 * class:list={Astro.props.ulClass ?? ([…])}, <h2>{Astro.props.h2Text ?? "Works"}</h2>,
 * the markup form. A master edit rewrites only the fallback; the prop (a page's
 * override) is never touched. Null = not that shape.
 */
function propValueAttr(tagContent, names) {
  let attrs;
  try { attrs = openingTagAttributes(tagContent).attributes; } catch { return null; }
  for (const a of attrs) {
    if (a.valueStart === null || !names.includes(a.name)) continue;
    const p = parseValueForm(tagContent.slice(a.valueStart, a.end));
    if (p) return { a, p };
  }
  return null;
}
/** `recurse` = the caller's own class writer: a class:list fallback is edited
 *  exactly like a bare class:list (unwrap → write → re-wrap). */
export function propFallbackClass(tagContent, classes, recurse) {
  const hit = propValueAttr(tagContent, ['class', 'className', 'class:list']);
  if (!hit) return null;
  const { a, p } = hit;
  const splice = (fallback) => tagContent.slice(0, a.valueStart) + `{${valueExpr(p.prop, fallback)}}` + tagContent.slice(a.end);
  if (a.name !== 'class:list') return p.literal === null ? null : splice(JSON.stringify(classes));
  if (!recurse || p.fallback === undefined) return null;
  const list = p.fallback.replace(/^\(([\s\S]*)\)$/, '$1');
  // The class:list writer's whole result, with its list re-wrapped as the fallback.
  const out = recurse(tagContent.slice(0, a.valueStart) + `{${list}}` + tagContent.slice(a.end));
  const w = openingTagAttributes(out).attributes.find((x) => x.name === 'class:list');
  if (!w || w.valueStart === null) throw new Error('Could not rewrite the class list');
  return out.slice(0, w.valueStart) + `{${valueExpr(p.prop, `(${out.slice(w.valueStart + 1, w.end - 1).trim()})`)}}` + out.slice(w.end);
}
export function propFallbackText(inner, newText) {
  if (/^\s*\{/.test(newText)) return null;
  const lead = /^\s*/.exec(inner)[0], trail = /\s*$/.exec(inner)[0];
  const markup = parseMarkupForm(inner);
  // Markup fallback: newText is written as element content — braces as text.
  if (markup) return lead + markupForm(markup.prop, escapeAstroBraces(newText.trim())) + trail;
  const p = parseValueForm(inner);
  if (!p || p.literal === null) return null;
  // Inline markup pushed into a plain-text fallback switches it to the markup form.
  if (hasMarkup(newText)) return lead + markupForm(p.prop, escapeAstroBraces(newText.trim())) + trail;
  // newText is HTML element content; a string literal holds its characters.
  return lead + `{${valueExpr(p.prop, JSON.stringify(decodeInnerHtmlEntities(newText).trim()))}}` + trail;
}

/**
 * Replace the text content between opening and closing tags (ast-updater.ts updateTextContent).
 */
export async function updateTextContent(content, location, newText) {
  const hasCRLF = content.includes('\r\n');
  const normalizedContent = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalizedContent.split('\n');

  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) {
    throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  }

  const startOffset = calculateOffset(lines, bracket.line, bracket.col);

  const tagMatch = normalizedContent.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) {
    throw new Error('Could not parse element tag');
  }
  const tagName = tagMatch[1];

  const openingTag = extractOpeningTag(normalizedContent, startOffset);
  if (!openingTag) {
    throw new Error('Could not find end of opening tag');
  }

  if (openingTag.tagContent.endsWith('/>')) {
    throw new Error('Cannot set text content on self-closing element');
  }

  const closingTagStart = findClosingTagStart(normalizedContent, openingTag.endOffset, tagName);
  if (closingTagStart === -1) {
    throw new Error(`Could not find closing tag for ${tagName}`);
  }

  // `{…}` in the element's content is an Astro expression (a prop, a
  // collection field). The canvas showed its RENDERED value — in the component
  // view a stub — and writing that literal over the expression severs the
  // binding for every page (measured 2026-09-10: `{work.data.description}`
  // became "Sample description text for this placeholder entry."). Refuse
  // honestly; the editor surfaces this error.
  const propText = propFallbackText(normalizedContent.slice(openingTag.endOffset, closingTagStart), newText);
  if (propText !== null) newText = propText;
  else if (normalizedContent.slice(openingTag.endOffset, closingTagStart).includes('{')) {
    throw new Error('text is a dynamic expression ({…}) — edit it in the Source tab');
  } else newText = escapeAstroBraces(newText); // typed `{x}` is text, never code

  let result = normalizedContent.slice(0, openingTag.endOffset) + newText + normalizedContent.slice(closingTagStart);
  if (hasCRLF) {
    result = result.replace(/\n/g, '\r\n');
  }
  return result;
}
