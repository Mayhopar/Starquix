/**
 * Pure core of /__sq/write-back-component: applies override categories to
 * .astro file content and reports exactly what was applied vs skipped.
 * Extracted from the middleware so the "write actually landed" contract is
 * unit-testable without a Vite server. See
 * docs/archive/plans/2026-06-10-save-feedback-design.md §4.1.
 *
 * Selectors name nodes in the captured source baseline and move through
 * operation maps; orderOverrides leniency and categorized skips remain.
 */
import {
  updateClassAttribute, updateTextContent, updateImageAttribute,
  updateLinkAttribute, updateAttribute, reorderElements, deleteElements,
  extractClassAtPosition, astroBodyIsEmpty, insertChildBeforeClosingTag,
  moveElement,
  type SourceLocation,
} from './ast-updater';
import { mergeClasses } from '../core/classes/merge';
import { mapKeysToPositions, topLevelBodySelectors, type SourcePosition } from './key-to-position';
import { stripDrawnElements } from '../utils/stripDrawnElements';
import { createSourceIdentityMap, spliceSourceSpans, projectCoordinate, type SourceTransformObserver } from './source-transform-identity';
import type { SourceIdentityMap } from '../services/durableEdits/types';

export interface WriteBackOverrides {
  classOverrides?: Record<string, string>;
  textOverrides?: Record<string, string>;
  imageOverrides?: Record<string, Record<string, string>>;
  linkOverrides?: Record<string, Record<string, string>>;
  attributeOverrides?: Record<string, Record<string, string>>;
  orderOverrides?: string[];
  // A PAGE-tree reorder of layout chrome can't name file selectors (its slot
  // renders as a div, a component as its root tag) — it sends the new order as
  // a permutation of the pre-drag rows, plus those rows' RENDERED selectors
  // (`orderRendered`, index-aligned). Resolved here, where the real AST lives:
  // rendered rows pair to the body's top-level scannable tags by exact
  // selector first (order-independent, so docs whose visual order diverged
  // from the file still map right), leftovers by position; the permutation
  // then becomes orderOverrides. Explicit orderOverrides win; invalid →
  // skipped.reorder.
  orderPermutation?: number[];
  orderRendered?: string[];
  deletedSelectors?: string[];
  // Drawn reconcile: source is a MIRROR of the editor's live drawn set. When
  // present (even as []), every previously-baked `data-sq-drawn` element is
  // stripped, then this set is re-inserted — so add AND delete both modify
  // source (delete = absent from the set). `undefined` leaves drawn untouched.
  drawnReconcile?: Array<{ markup: string; parentSelector?: string }>;
  // Cross-parent reparent. Each entry moves the element at `selector` to be a
  // child of `newParentSelector` (or to the file's top level when null).
  // Resolved positionally and applied LAST (after orderOverrides) — a move
  // changes document positions, so every other category must resolve first
  // (ledger D10). Unresolved element or parent selector → recorded in
  // report.skipped.reparent, never silently dropped (ledger D6/D7).
  reparentOverrides?: Array<{ selector: string; newParentSelector: string | null }>;
}

export interface WriteBackReport {
  applied: {
    classes: number; text: number; images: number; links: number;
    attributes: number; deletes: number; reordered: number; drawn: number;
    reparented: number;
  };
  skipped: {
    classes: string[]; text: string[]; images: string[]; links: string[];
    attributes: string[]; deletes: string[]; reorder: string[]; drawn: string[];
    reparent: string[];
  };
}

export type WriteBackApplyResult =
  | { ok: true; content: string; report: WriteBackReport; changed: boolean; identityMaps: SourceIdentityMap[] }
  | { ok: false; refusedSelectors: string[] };

export function emptyReport(): WriteBackReport {
  return {
    applied: { classes: 0, text: 0, images: 0, links: 0, attributes: 0, deletes: 0, reordered: 0, drawn: 0, reparented: 0 },
    skipped: { classes: [], text: [], images: [], links: [], attributes: [], deletes: [], reorder: [], drawn: [], reparent: [] },
  };
}

export async function applyWriteBackOverrides(
  original: string,
  filePath: string,
  overrides: WriteBackOverrides,
  selectorProjection?: { source: string; maps: SourceIdentityMap[] },
): Promise<WriteBackApplyResult> {
  let content = original;
  const report = emptyReport();
  const identityMaps: SourceIdentityMap[] = [];
  const onTransform: SourceTransformObserver = (before, after, spans) => {
    identityMaps.push(createSourceIdentityMap(before, after, spans));
  };
  // A batch names its original source nodes. Earlier markup or deletion must
  // not change which sibling a later positional selector refers to.
  const positions = new Map<string, SourcePosition | null>();
  const resolveSelectors = async (selectors: string[]) => {
    const missing = selectors.filter(selector => !positions.has(selector));
    const found = await mapKeysToPositions(selectorProjection?.source ?? original, missing);
    missing.forEach((selector, index) => positions.set(selector, found[index]));
    return selectors.map(selector => {
      const pos = positions.get(selector) ?? null;
      const mapped = pos ? projectCoordinate({ file: filePath, ...pos }, [...selectorProjection?.maps ?? [], ...identityMaps]) : null;
      return mapped ? { line: mapped.line, column: mapped.column } : null;
    });
  };
  const resolveSelector = async (selector: string) => (await resolveSelectors([selector]))[0];

  for (const [selector, classes] of Object.entries(overrides.classOverrides || {})) {
    const pos = await resolveSelector(selector);
    if (pos) {
      const loc = { file: filePath, ...pos };
      const existing = extractClassAtPosition(content, loc);
      content = await updateClassAttribute(content, filePath, loc, mergeClasses(existing, classes), undefined, onTransform);
      report.applied.classes++;
    } else {
      console.warn('[SQ-LAYOUT] write-back: class selector not found in source', { selector });
      report.skipped.classes.push(selector);
    }
  }

  for (const [selector, text] of Object.entries(overrides.textOverrides || {})) {
    const pos = await resolveSelector(selector);
    if (pos) {
      content = await updateTextContent(content, filePath, { file: filePath, ...pos }, text, onTransform);
      report.applied.text++;
    } else {
      console.warn('[SQ-LAYOUT] write-back: text selector not found in source', { selector });
      report.skipped.text.push(selector);
    }
  }

  for (const [selector, attrs] of Object.entries(overrides.imageOverrides || {})) {
    const pos = await resolveSelector(selector);
    if (pos) {
      for (const [attr, value] of Object.entries(attrs)) {
        content = await updateImageAttribute(content, filePath, { file: filePath, ...pos }, attr as 'src' | 'alt' | 'loading', value, onTransform);
      }
      report.applied.images++;
    } else {
      console.warn('[SQ-LAYOUT] write-back: image selector not found in source', { selector });
      report.skipped.images.push(selector);
    }
  }

  for (const [selector, attrs] of Object.entries(overrides.linkOverrides || {})) {
    const pos = await resolveSelector(selector);
    if (pos) {
      for (const [attr, value] of Object.entries(attrs)) {
        content = await updateLinkAttribute(content, filePath, { file: filePath, ...pos }, attr as 'href' | 'target' | 'aria-label', value, onTransform);
      }
      report.applied.links++;
    } else {
      console.warn('[SQ-LAYOUT] write-back: link selector not found in source', { selector });
      report.skipped.links.push(selector);
    }
  }

  // Generic attribute overrides (e.g. slot `name`). An empty value removes
  // the attribute (slot name cleared -> default slot). Used by the
  // layout-editor slot-name editor.
  for (const [selector, attrs] of Object.entries(overrides.attributeOverrides || {})) {
    const pos = await resolveSelector(selector);
    if (pos) {
      for (const [attr, value] of Object.entries(attrs)) {
        content = await updateAttribute(content, filePath, { file: filePath, ...pos }, attr, value, onTransform);
      }
      report.applied.attributes++;
    } else {
      console.warn('[SQ-LAYOUT] write-back: attribute selector not found in source', { selector });
      report.skipped.attributes.push(selector);
    }
  }

  // Deletions are applied after class/text/image/link overrides (which
  // reference elements by selector position) but before reorder.
  if (overrides.deletedSelectors?.length) {
    const positions = await resolveSelectors(overrides.deletedSelectors);
    const locations: SourceLocation[] = [];
    positions.forEach((p, i) => {
      if (p) { locations.push({ file: filePath, ...p }); report.applied.deletes++; }
      else report.skipped.deletes.push(overrides.deletedSelectors![i]);
    });
    if (locations.length > 0) {
      const candidate = await deleteElements(content, locations, onTransform);
      if (astroBodyIsEmpty(candidate)) {
        return { ok: false, refusedSelectors: overrides.deletedSelectors };
      }
      content = candidate;
    }
  }

  // Drawn reconcile (component-editor mirror). When present, the source's drawn
  // region is brought into sync with the editor's live drawn set: every
  // previously-baked `data-sq-drawn` element is stripped first, then the current
  // set is re-inserted. This makes add AND delete both modify source — a deleted
  // box is simply absent from the set, so the strip removes it and nothing
  // re-adds it. A top-level entry (no parentSelector) appends before the file's
  // last closing tag; a section-nested entry inserts before its parent selector's
  // closing tag. An unresolved parentSelector is recorded as skipped — never
  // silently dropped (task-078 Problem B). Idempotent: same set in → same bytes
  // out, so the FS-compare mirror is a no-op when nothing changed (no needless
  // reload). A present-but-empty array strips all and inserts none.
  if (overrides.drawnReconcile) {
    content = stripDrawnElements(content, (before, after, start, end) => onTransform(before, after,
      spliceSourceSpans(before.replace(/\r\n/g, '\n').length,
        before.slice(0, start).replace(/\r\n/g, '\n').length,
        before.slice(0, end).replace(/\r\n/g, '\n').length, 0)));
    const lastCloseRe = /<\/[a-zA-Z][^>]*>\s*$/;
    for (const insert of overrides.drawnReconcile) {
      const trimmed = insert.markup.trim();
      if (insert.parentSelector) {
        const pos = await resolveSelector(insert.parentSelector);
        if (!pos) { report.skipped.drawn.push(insert.parentSelector); continue; }
        const next = await insertChildBeforeClosingTag(content, { file: filePath, ...pos }, trimmed, onTransform);
        if (next == null) { report.skipped.drawn.push(insert.parentSelector); continue; }
        content = next;
        report.applied.drawn++;
      } else {
        // Full-document layouts: the last closing tag is </html> — inserting
        // there strands the element AFTER </body>. Anchor at </body> instead
        // so baked layout chrome is real body markup (proven 2026-08-26).
        const bodyClose = content.match(/<\/body\s*>/i);
        const m = bodyClose ?? content.match(lastCloseRe);
        const before = content;
        const insertOffset = m && m.index !== undefined ? m.index : content.length;
        content = m && m.index !== undefined
          ? content.slice(0, m.index) + '  ' + trimmed + '\n' + content.slice(m.index)
          : content + '\n' + trimmed + '\n';
        onTransform(before, content, spliceSourceSpans(before.replace(/\r\n/g, '\n').length,
          before.slice(0, insertOffset).replace(/\r\n/g, '\n').length,
          before.slice(0, insertOffset).replace(/\r\n/g, '\n').length,
          content.replace(/\r\n/g, '\n').length - before.replace(/\r\n/g, '\n').length));
        report.applied.drawn++;
      }
    }
  }

  if (overrides.orderPermutation?.length && !overrides.orderOverrides?.length) {
    const perm = overrides.orderPermutation;
    const selectors = await topLevelBodySelectors(selectorProjection?.source ?? original);
    const valid = selectors !== null && selectors.length === perm.length
      && new Set(perm).size === perm.length
      && perm.every((i) => Number.isInteger(i) && i >= 0 && i < selectors.length)
      && (!overrides.orderRendered || overrides.orderRendered.length === perm.length);
    if (valid) {
      // Pair pre-drag rendered rows to file tags: exact selector matches first
      // (a rendered header-0 IS the file's header-0 wherever either sits), the
      // leftovers — slot-as-div, components whose root tag differs from their
      // name — by position among themselves.
      let visualToFile = perm.map((_, i) => i);
      if (overrides.orderRendered) {
        const taken = new Array<boolean>(selectors!.length).fill(false);
        visualToFile = overrides.orderRendered.map((r) => {
          const idx = selectors!.findIndex((s, i) => !taken[i] && s === r);
          if (idx >= 0) taken[idx] = true;
          return idx;
        });
        let next = 0;
        visualToFile = visualToFile.map((idx) => {
          if (idx >= 0) return idx;
          while (taken[next]) next++;
          taken[next] = true;
          return next;
        });
      }
      overrides = { ...overrides, orderOverrides: perm.map((i) => selectors![visualToFile[i]]) };
    } else {
      console.warn('[SQ-LAYOUT] write-back: order permutation does not match the file — skipped', { perm, selectors });
      report.skipped.reorder.push(`permutation:${perm.join(',')}`);
    }
  }

  // Lenient reorder — see task-024. All categories resolve the same baseline
  // identities, even after preceding categories shift document positions.
  if (overrides.orderOverrides?.length) {
    const positions = await resolveSelectors(overrides.orderOverrides);
    const resolved: SourceLocation[] = [];
    positions.forEach((p, i) => {
      if (p) resolved.push({ file: filePath, ...p });
      else report.skipped.reorder.push(overrides.orderOverrides![i]);
    });
    if (report.skipped.reorder.length > 0) {
      console.warn('[SQ-LAYOUT] write-back: order selectors not found in source — skipped', { unresolved: report.skipped.reorder });
    }
    if (resolved.length > 0) {
      content = await reorderElements(content, resolved, resolved.map((_, i) => i), onTransform);
      report.applied.reordered = resolved.length;
    }
  }

  // Cross-parent reparent — MUST be the LAST positional op (ledger D10). A move
  // re-inserts what it removes, so it never empties the body (no astroBodyIsEmpty
  // refusal path). Process entries one at a time, projecting the original
  // selector through each preceding operation because positions shift.
  if (overrides.reparentOverrides?.length) {
    for (const { selector, newParentSelector } of overrides.reparentOverrides) {
      const pos = await resolveSelector(selector);
      if (!pos) { report.skipped.reparent.push(selector); continue; }

      let parentLoc: SourceLocation | null = null;
      if (newParentSelector !== null) {
        const parentPos = await resolveSelector(newParentSelector);
        if (!parentPos) { report.skipped.reparent.push(selector); continue; }
        parentLoc = { file: filePath, ...parentPos };
      }

      const next = await moveElement(content, { file: filePath, ...pos }, parentLoc, onTransform);
      if (next == null) { report.skipped.reparent.push(selector); continue; }
      content = next;
      report.applied.reparented++;
    }
  }

  return { ok: true, content, report, changed: content !== original, identityMaps };
}
