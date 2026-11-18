// Selection → clipboard envelope. Per-kind capture:
//   drawn root    → doc subtree (parents-first) + rendered html
//   instance root → doc element + master markup + optional blogSlot + html
//   anything else → html only (source keys, instance children, …)
// Guarded (skipped, never aborts the rest): wrapper, layout chrome, content slots.
import * as Y from 'yjs';
import type { ScannedElement } from '@/context/SelectionContext';
import { classifyKey, isWrapperKey } from '@/store/keyKind';
import { isDrawnKey } from '@/store/types';
import { isLayoutChromeKey } from '@/utils/layoutChromeKeys';
import { isContentSlotKey } from '@/hooks/keyboardShortcutsHelpers';
import { pruneDescendants } from '@/store/multiSelect';
import { selectProjectId } from '@/store/selectors';
import { selectMasterMarkup } from '@/store/masters';
import { isLocalProjectId } from '@/utils/localMode';
import { readBlogSlotBinding } from '@/core/collections/yjsAccessors';
import { cleanCopiedHtml } from './cleanCopiedHtml';
import { collectAssetRefs, collectAssets } from './collectAssets';
import { fetchElementCopyHtml } from './fetchElementCopyHtml';
import {
  CLIPBOARD_VERSION,
  type ClipboardEnvelope, type CopiedMaster, type CopiedRoot,
  type PlainBlogSlot, type PlainElement,
} from './envelope';

export interface CaptureDeps {
  doc: Y.Doc;
  scannedByKey: Map<string, ScannedElement>;
  fetchHtml?: (key: string) => Promise<string | null>;
  toast?: (msg: string) => void;
}

const PLAIN_SCALAR_KEYS = new Set([
  'id', 'pageId', 'parentId', 'index', 'type',
  'componentType', 'astroSource', 'instanceType',
  'staticMarkup', 'textContent', 'slotName', 'attributes',
]);

/** Y.Map element → PlainElement (known scalars split out, rest into extraFields). */
function toPlainElement(yEl: Y.Map<unknown>): PlainElement {
  const json = yEl.toJSON() as Record<string, unknown>;
  const plain = {
    classes: (json.classes ?? {}) as Record<string, string[]>,
  } as PlainElement & Record<string, unknown>;
  const extraFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json)) {
    if (k === 'classes') continue;
    if (k === 'classOverrides') { plain.classOverrides = v as Record<string, unknown>; continue; }
    if (k === 'unifiedOverrides') { plain.unifiedOverrides = v as Record<string, unknown>; continue; }
    if (PLAIN_SCALAR_KEYS.has(k)) { plain[k] = v; continue; }
    extraFields[k] = v;
  }
  if (Object.keys(extraFields).length > 0) plain.extraFields = extraFields;
  return plain as PlainElement;
}

/** Root + descendants (by parentId), parents-first. */
function collectSubtree(doc: Y.Doc, rootId: string): PlainElement[] {
  const elements = doc.getMap('elements');
  const byParent = new Map<string, string[]>();
  elements.forEach((yEl, id) => {
    const parentId = (yEl as Y.Map<unknown>).get('parentId') as string | null;
    if (parentId) {
      const list = byParent.get(parentId) ?? [];
      list.push(id);
      byParent.set(parentId, list);
    }
  });
  const out: PlainElement[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    const yEl = elements.get(id) as Y.Map<unknown> | undefined;
    if (!yEl) continue;
    out.push(toPlainElement(yEl));
    const kids = byParent.get(id) ?? [];
    kids.sort((a, b) => {
      const ia = ((elements.get(a) as Y.Map<unknown>)?.get('index') as number) ?? 0;
      const ib = ((elements.get(b) as Y.Map<unknown>)?.get('index') as number) ?? 0;
      return ia - ib;
    });
    queue.push(...kids);
  }
  return out;
}

/** Every string an element carries that could reference an sq-asset. */
function elementStrings(el: PlainElement): string[] {
  const out: string[] = [];
  if (el.staticMarkup) out.push(el.staticMarkup);
  for (const tokens of Object.values(el.classes)) {
    if (Array.isArray(tokens)) out.push(...tokens);
  }
  if (el.attributes) out.push(...Object.values(el.attributes));
  const pushStringsDeep = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(pushStringsDeep);
    else if (v && typeof v === 'object') Object.values(v).forEach(pushStringsDeep);
  };
  if (el.extraFields) pushStringsDeep(el.extraFields);
  if (el.classOverrides) pushStringsDeep(el.classOverrides);
  if (el.unifiedOverrides) pushStringsDeep(el.unifiedOverrides);
  return out;
}

export async function captureSelection(
  entries: Array<{ key: string; elementId: string | null }>,
  deps: CaptureDeps,
): Promise<ClipboardEnvelope | null> {
  const { doc, scannedByKey } = deps;
  const fetchHtml = deps.fetchHtml ?? fetchElementCopyHtml;

  const getParent = (k: string) => scannedByKey.get(k)?.parentKey ?? undefined;
  const pruned = pruneDescendants(entries, getParent);

  const roots: CopiedRoot[] = [];
  const masters: CopiedMaster[] = [];
  const mastersSeen = new Set<string>();
  const assetStrings: string[] = [];
  let skipped = 0;

  for (const entry of pruned) {
    const { key, elementId } = entry;
    if (isWrapperKey(key) || isLayoutChromeKey(key) || isContentSlotKey(doc, key)) {
      skipped++;
      continue;
    }

    const rawHtml = await fetchHtml(key);
    const html = rawHtml ? cleanCopiedHtml(rawHtml) : '';
    const elements = doc.getMap('elements');
    const yEl = elementId ? (elements.get(elementId) as Y.Map<unknown> | undefined) : undefined;
    const kind = classifyKey(key);
    const tagName = scannedByKey.get(key)?.tagName;

    if (elementId && yEl && isDrawnKey(elementId)) {
      const subtree = collectSubtree(doc, elementId);
      roots.push({
        label: (subtree[0]?.componentType ?? tagName ?? subtree[0]?.extraFields?.tag as string | undefined) ?? 'Element',
        html,
        doc: { kind: 'subtree', elements: subtree },
      });
      subtree.forEach((el) => assetStrings.push(...elementStrings(el)));
      if (html) assetStrings.push(html);
      continue;
    }

    if (elementId && yEl && kind?.kind === 'instance-root') {
      const element = toPlainElement(yEl);
      const astroSource = element.astroSource;
      if (astroSource && !mastersSeen.has(astroSource)) {
        const markup = selectMasterMarkup(doc, astroSource) ?? element.staticMarkup;
        if (markup) {
          mastersSeen.add(astroSource);
          masters.push({ astroSource, markup, componentType: element.componentType ?? 'Component' });
          assetStrings.push(markup);
        }
      }
      const blogSlot = readBlogSlotBinding(doc, elementId) as PlainBlogSlot | null;
      roots.push({
        label: element.componentType ?? tagName ?? 'Element',
        html,
        doc: { kind: 'instance', element, blogSlot },
      });
      assetStrings.push(...elementStrings(element));
      if (html) assetStrings.push(html);
      continue;
    }

    // Source / instance-child / anything else scanned: html-only.
    if (!html) { skipped++; continue; }
    roots.push({ label: tagName ?? 'Element', html });
    assetStrings.push(html);
  }

  if (roots.length === 0) return null;

  const sourceProjectId = selectProjectId(doc) ?? '';
  // Local projects have no sq-asset tier — srcs are plain /uploads/ paths inside html.
  const assets = isLocalProjectId(sourceProjectId)
    ? []
    : await collectAssets(collectAssetRefs(assetStrings));

  if (skipped > 0) deps.toast?.(`${skipped} element${skipped === 1 ? '' : 's'} can't be copied`);

  return { v: CLIPBOARD_VERSION, sourceProjectId, roots, masters, assets };
}
