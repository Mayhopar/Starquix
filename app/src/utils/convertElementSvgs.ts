/**
 * Generation-time svg → pen-shape conversion. AI-created page elements are
 * born WITHOUT static inline svgs: every convertible svg in the element's
 * markup becomes a real drawn pen element (node editing, tight bbox) right
 * after ADD_ELEMENT. Complements the select-time auto-convert
 * (useAutoConvertSvgSelection), which covers pre-existing docs and pasted
 * markup.
 *
 * No takeSnapshot here — the caller owns the undo step, so the conversions
 * fold into the same ⌘Z as the content insertion itself.
 */
import type * as Y from 'yjs';
import type { EditorCommand } from '@/store/types';
import { selectResolvedStaticMarkup } from '@/store/selectors';
import { findElementBySelectorInMarkup } from '@/utils/markupQuery';
import { svgToPenShape, type SvgConversion } from '@/utils/svgToPenPath';
import { buildPenMarkup, roundPath } from '@/components/Canvas/penGeometry';
import { generateDrawnKey } from '@/utils/generateId';
import { applyCommand } from '@/store/commands';
import { acceptDocumentMutation, type MutationSnapshot } from '@/store/documentMutation';

export interface PlannedSvgConversion {
  selector: string;
  parentKey: string | null;
  insertIndex: number;
  conv: SvgConversion;
}

/**
 * Pure: find one svg by selector in resolved markup and plan its conversion.
 * Null when the svg is missing or unconvertible (multi-shape, arcs).
 * Lookup goes through markupQuery's parse cache — repeated calls against the
 * same markup (the per-element loop below) parse once.
 */
export function planSvgConversion(
  markup: string,
  selector: string,
  renderedRect?: { width: number; height: number } | null,
): PlannedSvgConversion | null {
  const svg = findElementBySelectorInMarkup(markup, selector);
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return null;
  const conv = svgToPenShape(svg.outerHTML, renderedRect?.width, renderedRect?.height);
  if (!conv) return null;
  const parentEl = svg.parentElement;
  return {
    selector,
    parentKey: parentEl?.getAttribute('data-key') || null,
    insertIndex: parentEl ? Math.max(0, Array.from(parentEl.children).indexOf(svg)) : 0,
    conv,
  };
}

/** Build the ADD_DRAWN_ELEMENT payload for a planned conversion. */
export function drawnElementForConversion(plan: PlannedSvgConversion, pageId: string) {
  const path = roundPath(plan.conv.path);
  return {
    key: generateDrawnKey(),
    tag: 'div',
    classes: `w-[${plan.conv.w}px] h-[${plan.conv.h}px] ${plan.conv.styleClasses}`,
    textContent: '',
    parentKey: plan.parentKey,
    insertIndex: plan.insertIndex,
    pageId,
    staticMarkup: buildPenMarkup(path, plan.conv.w, plan.conv.h),
    penPath: JSON.stringify(path),
  };
}

/** THE delete-svg + add-shape dispatch pair — single owner of the ordering. */
export async function dispatchSvgConversion(
  doc: Y.Doc,
  instanceId: string,
  plan: PlannedSvgConversion,
  pageId: string,
  snapshot?: MutationSnapshot,
): Promise<ReturnType<typeof drawnElementForConversion>> {
  const drawn = drawnElementForConversion(plan, pageId);
  await acceptDocumentMutation(doc, staged => {
    if (!applyCommand(staged, { type: 'DELETE_INSTANCE_CHILD', instanceId, selector: plan.selector })
      || !applyCommand(staged, { type: 'ADD_DRAWN_ELEMENT', element: drawn })) throw new Error('SVG conversion refused');
  }, snapshot);
  return drawn;
}

/**
 * Convert every convertible svg in an element's resolved markup into drawn
 * pen shapes. Selectors stay stable across deletions (deletedSelectors is an
 * overlay — the raw markup keeps its svg count, so svg-N never shifts).
 * Returns the number of svgs converted; unconvertible ones stay inline.
 */
export async function convertElementSvgs(
  doc: Y.Doc,
  elementId: string,
  pageId: string,
  snapshot?: MutationSnapshot,
): Promise<number> {
  const markup = selectResolvedStaticMarkup(doc, elementId);
  if (!markup) return 0;
  const commands = planElementSvgCommands(markup, elementId, pageId);
  if (commands.length) await acceptDocumentMutation(doc, staged => {
    for (const command of commands) if (!applyCommand(staged, command)) throw new Error('SVG conversion refused');
  }, snapshot);
  return commands.length / 2;
}

/** Plan before acceptance so generated shape IDs are immutable within a gesture. */
export function planElementSvgCommands(markup: string, elementId: string, pageId: string): EditorCommand[] {
  // svg-N selectors are positional over ALL svg occurrences (same counting as
  // the bridge stamper), so the occurrence count enumerates them directly.
  const svgCount = (markup.match(/<svg\b/gi) || []).length;

  const commands: EditorCommand[] = [];
  for (let i = 0; i < svgCount; i++) {
    const plan = planSvgConversion(markup, `svg-${i}`);
    if (!plan) continue;
    commands.push({ type: 'DELETE_INSTANCE_CHILD', instanceId: elementId, selector: plan.selector },
      { type: 'ADD_DRAWN_ELEMENT', element: drawnElementForConversion(plan, pageId) });
  }
  return commands;
}
