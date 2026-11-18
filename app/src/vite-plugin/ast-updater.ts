/**
 * AST Updater for Class Attribute Updates
 *
 * Provides text-based class attribute updates for all file types.
 */

import type { SourceLocation } from '../bridge/types';
import { escapeRegex } from '../utils/regex';
import { spliceSourceSpans, type SourceTransformObserver, type PreservedSourceSpan } from './source-transform-identity';
import { asciiAttributeName, openingTagAttributes } from '../../../preview-template/src/plugins/sq-image-fill.js';
// @ts-expect-error shared browser-safe tokenized source transform
import { replaceOrAddAttribute as replaceQuotedAttribute, propFallbackClass, propFallbackText, resolveElementSpan } from '../../../preview-template/src/plugins/sq-source-transforms.js';
import { escapeAstroBraces } from '../../../preview-template/src/plugins/sq-prop-fallback.js';
export type { SourceLocation };

/**
 * Update class attribute at a specific location in file content.
 */
export async function updateClassAttribute(
  content: string,
  filePath: string,
  location: SourceLocation,
  newClasses: string,
  /**
   * What the element renders while file and doc agree (`owned ∪ dynamic`).
   * Required only for PARTIAL class sources — see replaceOrAddClassAttribute.
   */
  baseClasses?: string,
  onTransform?: SourceTransformObserver,
): Promise<string> {
  return updateClassTextBased(content, filePath, location, newClasses, baseClasses, onTransform);
}

function updateClassTextBased(
  content: string,
  filePath: string,
  location: SourceLocation,
  newClasses: string,
  baseClasses?: string,
  onTransform?: SourceTransformObserver,
): string {
  // Normalize CRLF to LF before processing, then restore at the end if needed
  const hasCRLF = content.includes('\r\n');
  const normalizedContent = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalizedContent.split('\n');
  const lineIndex = location.line - 1;
  const colIndex = location.column - 1;

  // Find the '<' character
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  if (!bracket) {
    throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  }

  // Calculate offset and extract opening tag (using normalized content)
  const tagStartOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagInfo = extractOpeningTag(normalizedContent, tagStartOffset);

  if (!tagInfo) {
    throw new Error('Could not find end of opening tag');
  }

  const { tagContent, endOffset: tagEndOffset } = tagInfo;

  // Replace or add class attribute
  const newTagContent = replaceOrAddClassAttribute(tagContent, filePath, newClasses, baseClasses).replace(/\r\n/g, '\n');

  let result = normalizedContent.slice(0, tagStartOffset) + newTagContent + normalizedContent.slice(tagEndOffset);

  // Restore CRLF if original had it
  if (hasCRLF) {
    result = result.replace(/\n/g, '\r\n');
  }

  onTransform?.(content, result, [
    ...spliceSourceSpans(normalizedContent.length, tagStartOffset, tagEndOffset, newTagContent.length),
    { beforeStart: tagStartOffset, afterStart: tagStartOffset, length: 1 },
  ]);

  return result;
}

function findOpeningBracket(
  lines: string[],
  lineIndex: number,
  colIndex: number
): { line: number; col: number } | null {
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
 * Calculate byte offset from line/column position.
 * Assumes content has been normalized to LF line endings.
 */
function calculateOffset(lines: string[], lineIndex: number, colIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    offset += lines[i].length + 1; // +1 for LF
  }
  offset += colIndex;
  return offset;
}

export function extractOpeningTag(
  content: string,
  startOffset: number
): { tagContent: string; endOffset: number } | null {
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
function classTokens(value: string | null | undefined): string[] {
  return String(value == null ? '' : value).split(/\s+/).filter(Boolean);
}

function resolvePartialLiteral(
  originalLiteral: string,
  target: string,
  baseClasses: string | undefined,
  mayFuse: boolean,
  what: string,
): { tokens: string[]; prefix: string } {
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
function tailSuppliesSeparator(rest: string): boolean {
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
function replaceOrAddClassAttribute(
  tagContent: string,
  filePath: string,
  newClasses: string,
  baseClasses?: string,
): string {
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
  const attrQuote = (v: string) => (v.includes('"') ? "'" : '"');
  const escapeFor = (v: string, q: string) => v.split(q).join('\\' + q);
  // Tokens are escaped for the quoting context; the prefix fragment is copied
  // out of the file RAW and goes back raw, or its own escapes would be doubled.
  const composeLiteral = (part: { tokens: string[]; prefix: string }, quote: string) => {
    const body = part.tokens.map((t) => escapeFor(t, quote)).join(' ');
    if (!part.prefix) return body;
    return (body ? body + ' ' : '') + part.prefix;
  };

  // Instance override prop (utils/propOverrides.ts): only the fallback literal is the master's.
  const propFallback = propFallbackClass(tagContent, sanitizedClasses, (t: string) => replaceOrAddClassAttribute(t, filePath, newClasses, baseClasses));
  if (propFallback !== null) return propFallback;

  if (classLiteralRegex.test(tagContent)) {
    // A plain literal ALONGSIDE class:list is partial — Astro merges them.
    if (classListRegex.test(tagContent)) {
      const m = tagContent.match(classLiteralRegex)!;
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
    const trailingWs = (/[ \t]*$/.exec(leadMatch[3]) ?? [''])[0];
    const rest = tagContent.slice((leadMatch.index ?? 0) + leadMatch[0].length);
    const fuses = trailingWs === '' && !tailSuppliesSeparator(rest);
    const part = resolvePartialLiteral(
      leadMatch[3], sanitizedClasses, baseClasses, fuses, "class={'…' + …}"
    );
    return tagContent.replace(
      classLeadingLiteralRegex,
      (_m: string, pre: string, quote: string, _lit: string, plus: string) =>
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
        ? (quote: string) => escapeFor(sanitizedClasses, quote)
        : (quote: string) => composeLiteral(
            resolvePartialLiteral(listMatch[3], sanitizedClasses, baseClasses, false, 'class:list={[…]}'),
            quote,
          );
      // Separate replacers: the array regex captures the delimiter (group 5),
      // the braced one has no such group — sharing a callback made the
      // replacer's `offset` argument land in the output as a stray digit.
      if (arrayMatch) {
        return tagContent.replace(
          classListArrayLiteralRegex,
          (_m: string, pre: string, quote: string, _lit: string, gap: string, delim: string) => `${pre}${quote}${write(quote)}${quote}${gap}${delim}`
        );
      }
      return tagContent.replace(
        classListBracedLiteralRegex,
        (_m: string, pre: string, quote: string) => `${pre}${quote}${write(quote)}${quote}`
      );
    }
    const strMatch = tagContent.match(classListStringRegex);
    if (strMatch) {
      const q = attrQuote(sanitizedClasses);
      return tagContent.replace(classListStringRegex, (_m: string, pre: string) => `${pre}${q}${sanitizedClasses}${q}`);
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
 * Extract the existing class attribute value at a specific location.
 * Returns empty string if no class attribute found.
 */
export function extractClassAtPosition(
  content: string,
  location: SourceLocation
): string {
  const hasCRLF = content.includes('\r\n');
  const normalizedContent = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalizedContent.split('\n');
  const lineIndex = location.line - 1;
  const colIndex = location.column - 1;

  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  if (!bracket) return '';

  const tagStartOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagInfo = extractOpeningTag(normalizedContent, tagStartOffset);
  if (!tagInfo) return '';

  const classRegex = /class(?:Name)?\s*=\s*(["'])([\s\S]*?)\1/;
  const match = classRegex.exec(tagInfo.tagContent);
  return match ? match[2] : '';
}

/**
 * Locate the opening tag at `location`, run `transformTag` on its raw text, and
 * splice the result back into the file — normalizing/restoring CRLF around the
 * edit. Shared spine of all the targeted attribute writers (image, link, slot
 * name) so the locate+splice logic lives in exactly one place.
 */
async function withTagEdit(
  content: string,
  location: SourceLocation,
  transformTag: (tagContent: string) => string,
  onTransform?: SourceTransformObserver,
): Promise<string> {
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

  const newTag = transformTag(tagContent).replace(/\r\n/g, '\n');
  const normalizedResult = normalized.slice(0, tagStartOffset) + newTag + normalized.slice(endOffset);
  const result = hasCRLF ? normalizedResult.replace(/\n/g, '\r\n') : normalizedResult;
  onTransform?.(content, result, [...spliceSourceSpans(normalized.length, tagStartOffset, endOffset, newTag.length),
    { beforeStart: tagStartOffset, afterStart: tagStartOffset, length: 1 }]);
  return result;
}

/**
 * Update an image attribute (src, alt, loading) at a specific location.
 */
export async function updateImageAttribute(
  content: string,
  filePath: string,
  location: SourceLocation,
  attribute: 'src' | 'alt' | 'loading' | 'autoplay' | 'loop' | 'muted' | 'controls' | 'data-sq-media',
  value: string,
  onTransform?: SourceTransformObserver,
): Promise<string> {
  return withTagEdit(content, location, (tag) => replaceOrAddAttribute(tag, attribute, value), onTransform);
}

/**
 * task-240 (BlogCard field binding): set `attribute={expression}` — an Astro
 * EXPRESSION, never a quoted string. Replaces a quoted or expression value in
 * place, else adds the attribute right after the tag name.
 */
export async function updateAttributeExpression(
  content: string,
  location: SourceLocation,
  attribute: string,
  expression: string,
): Promise<string> {
  return withTagEdit(content, location, (tag) => setAttributeRendered(tag, attribute, `={${expression}}`));
}

/**
 * Replace or add a quoted attribute in an opening-tag string, preserving
 * surrounding whitespace. Shared by the image and link writers. (Slot-name
 * editing needs removal + tidy spacing — see setOrRemoveAttribute, which
 * intentionally differs.)
 */
function replaceOrAddAttribute(tagContent: string, attribute: string, value: string): string {
  return replaceQuotedAttribute(tagContent, attribute, value);
}

function exactAttribute(tagContent: string, attribute: string) {
  const parsed = openingTagAttributes(tagContent);
  const matches = parsed.attributes.filter(attr => asciiAttributeName(attr.name) === asciiAttributeName(attribute));
  if (matches.length > 1) throw new Error(`Ambiguous source attribute: ${attribute}`);
  return { insertPos: parsed.insertPos, match: matches[0] };
}

/**
 * `attribute` + `rendered` (`="value"` or `={expr}`) replaces an existing
 * `attr="…"` / `attr='…'` / `attr={…}` in place, else lands right after the tag name.
 */
function setAttributeRendered(tagContent: string, attribute: string, rendered: string): string {
  const { insertPos, match } = exactAttribute(tagContent, attribute);
  const next = `${attribute}${rendered}`;
  if (match) return tagContent.slice(0, match.start) + next + tagContent.slice(match.end);
  return tagContent.slice(0, insertPos) + ` ${next}` + tagContent.slice(insertPos);
}

/**
 * Set OR remove a generic attribute on the element at a location. Works for ANY
 * attribute name and supports removal: an empty/whitespace `value` deletes the
 * attribute entirely (e.g. clearing a slot name → `<slot name="x" />` becomes
 * `<slot />`, the default slot).
 *
 * Used by the layout-editor slot-name write-back. Targeted edit only — never
 * rewrites the rest of the tag/file, so arbitrary imported .astro layouts keep
 * their frontmatter, imports, and hand-authored markup.
 */
export async function updateAttribute(
  content: string,
  filePath: string,
  location: SourceLocation,
  attribute: string,
  value: string,
  onTransform?: SourceTransformObserver,
): Promise<string> {
  return withTagEdit(content, location, (tag) => setOrRemoveAttribute(tag, attribute, value), onTransform);
}

/**
 * Set, replace, or remove a single attribute in an opening-tag string.
 * Empty/whitespace value ⇒ remove (consuming the preceding space too, so the
 * tag stays tidy). Handles `attr="…"`, `attr='…'`, and JSX `attr={…}` forms.
 */
function setOrRemoveAttribute(tagContent: string, attribute: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed) return replaceOrAddAttribute(tagContent, attribute, trimmed);
  const { match } = exactAttribute(tagContent, attribute);
  if (!match) return tagContent;
  let start = match.start;
  while (start > 0 && /\s/.test(tagContent[start - 1])) start--;
  return tagContent.slice(0, start) + tagContent.slice(match.end);
}

/**
 * Update text content of an element at a specific location.
 * Replaces content between opening and closing tags.
 * `asSource`: `newText` is Astro source the caller built (a field binding's
 * `{expr}`, an override prop's form) and is written verbatim; otherwise it is
 * user text, whose braces are written as entities.
 */
export async function updateTextContent(
  content: string,
  filePath: string,
  location: SourceLocation,
  newText: string,
  onTransform?: SourceTransformObserver,
  asSource = false,
): Promise<string> {
  // Normalize CRLF to LF before processing
  const hasCRLF = content.includes('\r\n');
  const normalizedContent = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalizedContent.split('\n');
  const lineIndex = location.line - 1;
  const colIndex = location.column - 1;

  // Find the opening bracket
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  if (!bracket) {
    throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  }

  const startOffset = calculateOffset(lines, bracket.line, bracket.col);

  // Extract tag name
  const tagMatch = normalizedContent.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) {
    throw new Error('Could not parse element tag');
  }
  const tagName = tagMatch[1];

  // Get opening tag end
  const openingTag = extractOpeningTag(normalizedContent, startOffset);
  if (!openingTag) {
    throw new Error('Could not find end of opening tag');
  }

  // Self-closing tags can't have text content
  if (openingTag.tagContent.endsWith('/>')) {
    throw new Error('Cannot set text content on self-closing element');
  }

  // Find closing tag start position
  const closingTagStart = findClosingTagStart(normalizedContent, openingTag.endOffset, tagName);
  if (closingTagStart === -1) {
    throw new Error(`Could not find closing tag for ${tagName}`);
  }

  // Replace content between tags (an override prop's fallback: only its literal)
  const normalizedText = (asSource ? newText
    : propFallbackText(normalizedContent.slice(openingTag.endOffset, closingTagStart), newText) ?? escapeAstroBraces(newText)).replace(/\r\n/g, '\n');
  let result = normalizedContent.slice(0, openingTag.endOffset) + normalizedText + normalizedContent.slice(closingTagStart);
  const spans = spliceSourceSpans(normalizedContent.length, openingTag.endOffset, closingTagStart, normalizedText.length);

  // Restore CRLF if original had it
  if (hasCRLF) {
    result = result.replace(/\n/g, '\r\n');
  }

  onTransform?.(content, result, spans);
  return result;
}

/**
 * Insert `markup` as the LAST child of the element at `location` (immediately
 * before its closing tag). Returns the new content, or null if the element /
 * its closing tag can't be resolved. task-078 (nested drawn inserts).
 */
export async function insertChildBeforeClosingTag(
  content: string,
  location: SourceLocation,
  markup: string,
  onTransform?: SourceTransformObserver,
): Promise<string | null> {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalized.split('\n');
  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) return null;
  const startOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagMatch = normalized.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) return null;
  const tagName = tagMatch[1];
  const openingTag = extractOpeningTag(normalized, startOffset);
  if (!openingTag || openingTag.tagContent.endsWith('/>')) return null; // self-closing can't nest
  const closingTagStart = findClosingTagStart(normalized, openingTag.endOffset, tagName);
  if (closingTagStart === -1) return null;
  const normalizedMarkup = markup.replace(/\r\n/g, '\n').trim();
  const normalizedResult =
    normalized.slice(0, closingTagStart) + '  ' + normalizedMarkup + '\n' + normalized.slice(closingTagStart);
  const result = hasCRLF ? normalizedResult.replace(/\n/g, '\r\n') : normalizedResult;
  onTransform?.(content, result, spliceSourceSpans(normalized.length, closingTagStart, closingTagStart, normalizedMarkup.length + 3));
  return result;
}

/**
 * Resolve the offset of the insertion point (the start of the closing tag) for
 * the element at `location`, reusing the SAME internals as
 * insertChildBeforeClosingTag. Content must already be normalized to LF.
 * Returns null if the element can't be resolved or is self-closing (can't nest).
 * task-078 (moveElement single-pass splice).
 */
function findChildInsertionOffset(
  content: string,
  location: SourceLocation,
): number | null {
  const lines = content.split('\n');
  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) return null;
  const startOffset = calculateOffset(lines, bracket.line, bracket.col);
  const tagMatch = content.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) return null;
  const tagName = tagMatch[1];
  const openingTag = extractOpeningTag(content, startOffset);
  if (!openingTag || openingTag.tagContent.endsWith('/>')) return null; // self-closing can't nest
  const closingTagStart = findClosingTagStart(content, openingTag.endOffset, tagName);
  return closingTagStart === -1 ? null : closingTagStart;
}

/**
 * Move the element at `elementLoc` to become the LAST child of the element at
 * `newParentLoc` (or to the file's top level when `newParentLoc` is null), within
 * the SAME content string. Returns the new content, or null on ANY failure so the
 * caller keeps the original (atomicity — ledger F3).
 *
 * Single-pass offset splice (ledger D2-D5, D12-D13): resolve BOTH the element's
 * range and the destination insertion offset against the ORIGINAL content, then
 * build the result in one pass — removing the element range and inserting its
 * text at the destination, adjusting the destination offset when it sits after
 * the removed range. Avoids the line-shift bugs of re-resolving a selector in
 * post-delete content.
 */
export async function moveElement(
  content: string,
  elementLoc: SourceLocation,
  newParentLoc: SourceLocation | null,
  onTransform?: SourceTransformObserver,
): Promise<string | null> {
  const hasCRLF = content.includes('\r\n');
  const normalized = hasCRLF ? content.replace(/\r\n/g, '\n') : content;

  // (1) Resolve the element's full subtree range + extracted text.
  const elementRange = findElementRange(normalized, elementLoc);
  if (!elementRange) return null;
  const markup = normalized.slice(elementRange.start, elementRange.end).trim();
  if (!markup) return null;

  // (2) Resolve the destination insertion offset (closing-tag start, or top-level).
  let insertOffset: number;
  if (newParentLoc) {
    const parentRange = findElementRange(normalized, newParentLoc);
    if (!parentRange) return null;

    // Idempotent no-op (ledger D13): element already lies INSIDE the new parent.
    if (elementRange.start >= parentRange.start && elementRange.end <= parentRange.end) {
      return content; // unchanged — preserves original CRLF too
    }
    // Cycle/defensive (ledger F3): parent inside the element being moved.
    if (parentRange.start >= elementRange.start && parentRange.end <= elementRange.end) {
      return content;
    }

    const closeStart = findChildInsertionOffset(normalized, newParentLoc);
    if (closeStart === null) return null; // self-closing / unresolved parent
    insertOffset = closeStart;
  } else {
    // ROOT move — append before the file's last closing tag (mirror drawnReconcile
    // top-level branch in write-back-apply.ts). Append-at-end when no closing tag.
    const m = normalized.match(/<\/[a-zA-Z][^>]*>\s*$/);
    insertOffset = m && m.index !== undefined ? m.index : normalized.length;
  }

  // Defensive: insertion point must not fall inside the element's own range.
  if (insertOffset > elementRange.start && insertOffset < elementRange.end) {
    return content;
  }

  // (3) Single-pass splice: remove the element range, insert markup at the
  // destination. If the destination offset is AFTER the removed range, shift it
  // left by the removed length so it still points at the right place.
  const removedLen = elementRange.end - elementRange.start;
  const withoutElement = normalized.slice(0, elementRange.start) + normalized.slice(elementRange.end);
  let adjustedInsert = insertOffset;
  if (insertOffset >= elementRange.end) {
    adjustedInsert = insertOffset - removedLen;
  } else if (insertOffset <= elementRange.start) {
    adjustedInsert = insertOffset;
  }

  const insertion = '  ' + markup + '\n';
  let result =
    withoutElement.slice(0, adjustedInsert) + insertion + withoutElement.slice(adjustedInsert);

  if (hasCRLF) result = result.replace(/\n/g, '\r\n');
  const removedSpans = spliceSourceSpans(normalized.length, elementRange.start, elementRange.end, 0);
  const spans: PreservedSourceSpan[] = [];
  for (const span of removedSpans) {
    const split = Math.max(0, Math.min(span.length, adjustedInsert - span.afterStart));
    if (split) spans.push({ ...span, length: split });
    if (split < span.length) spans.push({ beforeStart: span.beforeStart + split,
      afterStart: span.afterStart + split + insertion.length, length: span.length - split });
  }
  const trimStart = normalized.slice(elementRange.start, elementRange.end).length - normalized.slice(elementRange.start, elementRange.end).trimStart().length;
  spans.push({ beforeStart: elementRange.start + trimStart, afterStart: adjustedInsert + 2, length: markup.length });
  onTransform?.(content, result, spans);
  return result;
}

/**
 * Find the start position of a closing tag (the '<' character).
 */
function findClosingTagStart(content: string, startPos: number, tagName: string): number {
  let pos = startPos;
  let depth = 1;

  // Escape tagName for safe regex usage
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
        return closeMatch.index;  // Return start of closing tag, not end
      }
      pos = closeMatch.index + closeMatch[0].length;
    }
  }

  return -1;
}

/**
 * Update a link attribute (href, target, aria-label) at a specific location.
 */
export async function updateLinkAttribute(
  content: string,
  filePath: string,
  location: SourceLocation,
  attribute: 'href' | 'target' | 'aria-label',
  value: string,
  onTransform?: SourceTransformObserver,
): Promise<string> {
  return withTagEdit(content, location, (tag) => replaceOrAddAttribute(tag, attribute, value), onTransform);
}

/**
 * Reorder elements in file content based on source locations and new order.
 * This handles moving HTML elements to new positions in an Astro file.
 */
export async function reorderElements(
  content: string,
  locations: SourceLocation[],
  newOrder: number[],
  onTransform?: SourceTransformObserver,
): Promise<string> {
  // Normalize CRLF to LF before processing
  const hasCRLF = content.includes('\r\n');
  const normalizedContent = hasCRLF ? content.replace(/\r\n/g, '\n') : content;

  // Extract element ranges from the file
  const elementRanges = locations.map((loc, index) => {
    const range = findElementRange(normalizedContent, loc);
    return { index, loc, range };
  });

  // Sort by original position (line, then column)
  elementRanges.sort((a, b) => {
    if (a.loc.line !== b.loc.line) return a.loc.line - b.loc.line;
    return a.loc.column - b.loc.column;
  });

  // Verify all ranges were found
  for (const er of elementRanges) {
    if (!er.range) {
      throw new Error(`Could not find element at ${er.loc.line}:${er.loc.column}`);
    }
  }
  if (newOrder.length !== elementRanges.length || new Set(newOrder).size !== newOrder.length
    || elementRanges.some((er, i) => i > 0 && er.range!.start < elementRanges[i - 1].range!.end)) {
    throw new Error('Reorder requires distinct non-overlapping elements');
  }

  // Extract the text for each element
  const elementTexts = elementRanges.map(er => normalizedContent.slice(er.range!.start, er.range!.end));

  // Create the reordered texts based on newOrder
  // newOrder[i] = j means: position i in new order should have the element originally at position j
  const reorderedTexts = newOrder.map(originalIndex => {
    // Find which element in our sorted list had this original index
    const er = elementRanges.find(e => e.index === originalIndex);
    if (!er) {
      throw new Error(`Invalid reorder: original index ${originalIndex} not found`);
    }
    // Get its text
    return normalizedContent.slice(er.range!.start, er.range!.end);
  });

  // Replace elements from end to start (to preserve offsets)
  let result = normalizedContent;
  for (let i = elementRanges.length - 1; i >= 0; i--) {
    const range = elementRanges[i].range!;
    result = result.slice(0, range.start) + reorderedTexts[i] + result.slice(range.end);
  }

  // Restore CRLF if original had it
  if (hasCRLF) {
    result = result.replace(/\n/g, '\r\n');
  }

  const spans: PreservedSourceSpan[] = [];
  let oldOffset = 0, newOffset = 0;
  for (const [i, er] of elementRanges.entries()) {
    const unchanged = er.range!.start - oldOffset;
    spans.push({ beforeStart: oldOffset, afterStart: newOffset, length: unchanged });
    newOffset += unchanged;
    const moved = elementRanges.find(entry => entry.index === newOrder[i])!.range!;
    spans.push({ beforeStart: moved.start, afterStart: newOffset, length: moved.end - moved.start });
    newOffset += moved.end - moved.start;
    oldOffset = er.range!.end;
  }
  spans.push({ beforeStart: oldOffset, afterStart: newOffset, length: normalizedContent.length - oldOffset });
  onTransform?.(content, result, spans);

  return result;
}

/**
 * Find the full range (start offset to end offset) of an element in file content.
 * Content should already be normalized to LF.
 */
function findElementRange(
  content: string,
  location: SourceLocation
): { start: number; end: number } | null {
  const lines = content.split('\n');
  const lineIndex = location.line - 1;
  const colIndex = location.column - 1;

  // Find the opening bracket
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  if (!bracket) {
    return null;
  }

  // Calculate start offset
  const startOffset = calculateOffset(lines, bracket.line, bracket.col);

  // Extract the tag name
  const tagMatch = content.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) {
    return null;
  }
  const tagName = tagMatch[1];

  // Check if self-closing
  const openingTag = extractOpeningTag(content, startOffset);
  if (!openingTag) {
    return null;
  }

  if (openingTag.tagContent.endsWith('/>')) {
    // Self-closing element
    return { start: startOffset, end: openingTag.endOffset };
  }

  // Find the matching closing tag
  const endOffset = findClosingTag(content, openingTag.endOffset, tagName);
  if (endOffset === -1) {
    // No closing tag found - might be a self-closing component
    return { start: startOffset, end: openingTag.endOffset };
  }

  return { start: startOffset, end: endOffset };
}

/**
 * Find the closing tag for an element, handling nesting.
 */
function findClosingTag(content: string, startPos: number, tagName: string): number {
  let pos = startPos;
  let depth = 1;

  // Escape tagName for safe regex usage
  const escapedTagName = escapeRegex(tagName);
  const openPattern = new RegExp(`<${escapedTagName}(?:\\s|>|/)`, 'gi');
  const closePattern = new RegExp(`</${escapedTagName}\\s*>`, 'gi');

  while (pos < content.length && depth > 0) {
    openPattern.lastIndex = pos;
    closePattern.lastIndex = pos;

    const openMatch = openPattern.exec(content);
    const closeMatch = closePattern.exec(content);

    // No more closing tags
    if (!closeMatch) {
      return -1;
    }

    // If there's an opening tag before the closing tag, increase depth
    if (openMatch && openMatch.index < closeMatch.index) {
      // Check if it's self-closing
      const afterOpen = content.slice(openMatch.index);
      const tagEnd = afterOpen.indexOf('>');
      if (tagEnd !== -1 && afterOpen[tagEnd - 1] !== '/') {
        depth++;
      }
      pos = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return closeMatch.index + closeMatch[0].length;
      }
      pos = closeMatch.index + closeMatch[0].length;
    }
  }

  return -1;
}

/**
 * Delete elements at specific source locations from file content.
 * Removes the full element (opening tag through closing tag) for each location.
 * Locations are processed from end to start to preserve earlier offsets.
 */
export async function deleteElements(
  content: string,
  locations: SourceLocation[],
  onTransform?: SourceTransformObserver,
): Promise<string> {
  if (locations.length === 0) return content;

  // Normalize CRLF to LF before processing
  const hasCRLF = content.includes('\r\n');
  const normalizedContent = hasCRLF ? content.replace(/\r\n/g, '\n') : content;

  // Find ranges for all elements
  const ranges: Array<{ start: number; end: number }> = [];
  for (const loc of locations) {
    const range = findElementRange(normalizedContent, loc);
    if (range) {
      ranges.push(range);
    }
  }

  if (ranges.length === 0) return content;

  // Sort ranges by start position descending so we can splice from end to start
  const outerRanges = ranges.filter((range, index) => !ranges.some((other, otherIndex) => otherIndex !== index
    && other.start <= range.start && other.end >= range.end
    && (other.start < range.start || other.end > range.end || otherIndex < index)));
  outerRanges.sort((a, b) => b.start - a.start);

  let result = normalizedContent;
  for (const range of outerRanges) {
    // Also remove trailing whitespace/newline after the element
    let endPos = range.end;
    while (endPos < result.length && (result[endPos] === ' ' || result[endPos] === '\t')) {
      endPos++;
    }
    if (endPos < result.length && result[endPos] === '\n') {
      endPos++; // consume the newline too
    }

    // Also remove leading whitespace on the same line (if only whitespace before element)
    let startPos = range.start;
    let lineStart = startPos;
    while (lineStart > 0 && result[lineStart - 1] !== '\n') {
      lineStart--;
    }
    const prefix = result.slice(lineStart, startPos);
    if (/^\s*$/.test(prefix)) {
      startPos = lineStart;
    }

    const before = result;
    result = result.slice(0, startPos) + result.slice(endPos);
    onTransform?.(hasCRLF ? before.replace(/\n/g, '\r\n') : before,
      hasCRLF ? result.replace(/\n/g, '\r\n') : result, spliceSourceSpans(before.length, startPos, endPos, 0));
  }

  // Restore CRLF if original had it
  if (hasCRLF) {
    result = result.replace(/\n/g, '\r\n');
  }

  return result;
}

/**
 * Result from extracting element source code.
 */
export interface ElementSourceResult {
  source: string;
  startLine: number;
  endLine: number;
  /** Offsets of `source` in the LF-normalized content. */
  startOffset: number;
  endOffset: number;
}

/**
 * Extract the full source code of an element at a specific location.
 * Returns the element's markup including all children.
 */
export function getElementSource(
  content: string,
  location: SourceLocation
): ElementSourceResult {
  // Normalize CRLF to LF before processing
  const normalizedContent = content.includes('\r\n') ? content.replace(/\r\n/g, '\n') : content;
  const lines = normalizedContent.split('\n');
  const lineIndex = location.line - 1;
  const colIndex = location.column - 1;

  // Find the opening bracket
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  if (!bracket) {
    throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  }

  // Calculate start offset
  const startOffset = calculateOffset(lines, bracket.line, bracket.col);

  // Extract the tag name
  const tagMatch = normalizedContent.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/);
  if (!tagMatch) {
    throw new Error('Could not parse element tag');
  }
  const tagName = tagMatch[1];

  // Get opening tag info
  const openingTag = extractOpeningTag(normalizedContent, startOffset);
  if (!openingTag) {
    throw new Error('Could not find end of opening tag');
  }

  let endOffset: number;

  if (openingTag.tagContent.endsWith('/>')) {
    // Self-closing element
    endOffset = openingTag.endOffset;
  } else {
    // Find the matching closing tag
    endOffset = findClosingTag(normalizedContent, openingTag.endOffset, tagName);
    if (endOffset === -1) {
      throw new Error(`Could not find closing tag for ${tagName}`);
    }
  }

  // Extract source and calculate line numbers
  const source = normalizedContent.slice(startOffset, endOffset);
  const startLine = bracket.line + 1; // Convert to 1-indexed
  const endLine = normalizedContent.slice(0, endOffset).split('\n').length;

  return { source, startLine, endLine, startOffset, endOffset };
}

/**
 * Replace element source at specific line range with new content.
 * Preserves the leading whitespace of the original first line.
 */
export function updateElementSource(
  content: string,
  startLine: number,
  endLine: number,
  newSource: string
): string {
  const lines = content.split('\n');

  // Get the leading whitespace from the original line
  const originalLine = lines[startLine - 1];
  const leadingWhitespace = originalLine.match(/^(\s*)/)?.[1] || '';

  // Indent the new source to match
  const newSourceLines = newSource.split('\n');
  const indentedNewSource = newSourceLines.map((line, index) => {
    if (index === 0) {
      // First line gets the original leading whitespace
      return leadingWhitespace + line.trimStart();
    }
    return line;
  }).join('\n');

  // Replace the lines
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);

  return [...before, indentedNewSource, ...after].join('\n');
}

/**
 * Returns true if the Astro file's body (everything after the closing `---`
 * of frontmatter, or the whole file if no frontmatter) is whitespace-only
 * or contains nothing but HTML comments. Used by the write-back endpoint as
 * a defense-in-depth guard against deletes that would empty a component.
 */
export function astroBodyIsEmpty(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n');
  // Locate the closing `---` of frontmatter (either immediately after the
  // opening line, or on a later line preceded by a newline).
  const fmOpen = normalized.match(/^---\s*\n/);
  let body = normalized;
  if (fmOpen) {
    const afterOpen = normalized.slice(fmOpen[0].length);
    const closeRe = /(^|\n)---\s*(\n|$)/;
    const closeMatch = afterOpen.match(closeRe);
    if (closeMatch && closeMatch.index !== undefined) {
      body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
    }
  }
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  return stripped.length === 0;
}

/** The opening tag at a location, read-only (same tag finder as the writers). */
export function readOpeningTag(content: string, location: SourceLocation): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const bracket = findOpeningBracket(lines, location.line - 1, location.column - 1);
  if (!bracket) throw new Error(`Could not find opening tag at ${location.line}:${location.column}`);
  const tag = extractOpeningTag(normalized, calculateOffset(lines, bracket.line, bracket.col));
  if (!tag) throw new Error('Could not find end of opening tag');
  return tag.tagContent;
}

/** The text between the element's opening and closing tags, read-only. */
export function readElementContent(content: string, location: SourceLocation): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const span = resolveElementSpan(normalized, location);
  if (span.voidLike || span.closeStart === null) throw new Error('Element has no content');
  return normalized.slice(span.openEnd, span.closeStart);
}
