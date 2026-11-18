import type * as Y from 'yjs';
import { parseKey } from '@/store/types';
import {
  forEachEditedSourceClassEntry, forEachSourceImageAttrsEntry,
  forEachSourceLinkAttrsEntry,
} from '@/store/sourceOverrideEntries';
import { forEachSourceTextEntry } from '@/store/sourceTextEntries';
import { readsOverrideProp, type OverrideKind } from '@/utils/propOverrides';
import { extractOpeningTag } from '@/vite-plugin/ast-updater';

export const INSTANCE_OVERLAY_EXPORT_MESSAGE = 'Unpushed component instance edits that cannot be saved into the files would be missing from the exported or published site. Push the changes to source or reset them before trying again. Pushing updates the shared component.';

export class InstanceOverlayExportError extends Error {
  constructor() { super(INSTANCE_OVERLAY_EXPORT_MESSAGE); this.name = 'InstanceOverlayExportError'; }
}

const utf8 = new TextEncoder();
/** Is `line:column` (1-based; the canvas keys elements by it) on an element? One starts there (the column as characters
 *  OR UTF-8 bytes: non-ASCII text earlier on the line), or a multi-line opening tag spans it — a key can point at the line
 *  such a tag ENDS on (ast-updater findOpeningBracket, minus its fuzzy same-line scan). */
function onElement(source: string, line: number, column: number): boolean {
  const content = source.replace(/\r\n/g, '\n'); const lines = content.split('\n');
  const text = lines[line - 1];
  if (text === undefined) return false;
  if (text[column - 1] === '<' || utf8.encode(text)[column - 1] === 0x3c) return true;
  const at = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, column - 1);
  const lt = content.lastIndexOf('<', at);
  const tag = lt < 0 ? null : extractOpeningTag(content, lt);
  return !!tag && lt + tag.tagContent.length >= at;
}

/**
 * Files-truth artifacts carry only what is in the files. An instance edit
 * written as a page prop (utils/propOverrides.ts) IS in the files — its
 * element reads the override prop. Refuse only placement edits whose element
 * does not (shapes a prop cannot express: a `.map` copy, text with
 * expressions, a dynamic img src, link attributes). Same edited-entry
 * iterators as persistence and preview; never writes the shared master.
 */
export function assertNoUnpushedInstanceOverlays(doc: Y.Doc, files: ReadonlyMap<string, string>): void {
  const shipped = (key: string, kinds: readonly (OverrideKind | null)[]) => {
    const parsed = parseKey(key);
    if (parsed?.type !== 'source' || !parsed.placement) return true;
    const source = files.get(parsed.file);
    // An edit keyed to where no element starts any more (the file moved on: lines removed above it) applies to nothing
    // on the canvas and cannot be selected to Push/Reset — shipping without it is what the user sees (owner run 2026-10-16).
    if (source && !onElement(source, parsed.line, parsed.col)) return true;
    const loc = { file: parsed.file, line: parsed.line, column: parsed.col };
    return !!source && kinds.every(kind => {
      if (!kind) return false;
      try { return readsOverrideProp(source, loc, kind); } catch { return false; }
    });
  };
  const check = (key: string, kinds: readonly (OverrideKind | null)[]) => { if (!shipped(key, kinds)) throw new InstanceOverlayExportError(); };
  forEachEditedSourceClassEntry(doc, ({ key }) => check(key, ['class']));
  forEachSourceTextEntry(doc, ({ key }) => check(key, ['text']));
  forEachSourceImageAttrsEntry(doc, ({ key, attributes }) =>
    check(key, Object.keys(attributes).map(a => (a === 'src' || a === 'alt' ? a : null))));
  forEachSourceLinkAttrsEntry(doc, ({ key, attributes, markup }) =>
    check(key, [...(Object.keys(attributes).length ? [null] : []), ...(markup !== undefined ? ['text' as const] : [])]));
}
