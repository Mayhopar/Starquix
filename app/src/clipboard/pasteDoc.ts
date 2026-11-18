// Doc-runtime paste (WC + server): materialize the envelope's dependencies
// (assets, masters), re-key everything, then ONE PASTE_ELEMENTS dispatch.
// The command is dumb — every decision happens here, before dispatch.
import * as Y from 'yjs';
import type { EditorCommand, ElementData } from '@/store/types';
import { emptyClassData } from '@/store/types';
import { selectRootElementIds } from '@/store/selectors';
import { rootInsertIndex } from '@/store/pageTemplateInsert';
import { stripSqIds } from '@/store/selectorRemap';
import { MASTERS_MAP, selectMasterMarkup } from '@/store/masters';
import { generateId } from '@/utils/generateId';
import { UNBOUND_COLLECTION_ID } from '@/core/collections/types';
import { uploadAssetBlob } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { base64ToBytes, type ClipboardEnvelope, type PlainElement } from './envelope';

export interface PasteDocDeps {
  doc: Y.Doc;
  pageId: string;
  targetProjectId: string;
  selectedElementId: string | null;
  dispatch: import('@/store/durableDispatch').EditorDispatch;
  takeSnapshot: () => void;
  toast?: (msg: string) => void;
  uploadAsset?: typeof uploadAssetBlob;       // injectable for tests
  transferAsset?: typeof transferAssetToIframe;
}

type PasteEntry = Extract<EditorCommand, { type: 'PASTE_ELEMENTS' }>['elements'][number];

/** Deep-rewrite `sq-asset:<old>` → `sq-asset:<new>` in every string of a JSON-ish value. */
function rewriteRefs<T>(value: T, refMap: Map<string, string>): T {
  if (refMap.size === 0) return value;
  const rewriteStr = (s: string) => {
    let out = s;
    for (const [oldId, newId] of refMap) out = out.split(`sq-asset:${oldId}`).join(`sq-asset:${newId}`);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return rewriteStr(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** `library/Hero.astro` → `library/Hero2.astro` (first free suffix — generateComponentName semantics). */
function suffixAstroSource(astroSource: string, taken: (s: string) => boolean): { source: string; name: string } {
  const m = /^(.*\/)?([^/]+)\.astro$/.exec(astroSource);
  const dir = m?.[1] ?? '';
  const base = m?.[2] ?? astroSource;
  let i = 2;
  while (taken(`${dir}${base}${i}.astro`)) i++;
  return { source: `${dir}${base}${i}.astro`, name: `${base}${i}` };
}

export async function pasteEnvelopeIntoDoc(env: ClipboardEnvelope, deps: PasteDocDeps): Promise<boolean> {
  const { doc, pageId, targetProjectId } = deps;
  const uploadAsset = deps.uploadAsset ?? uploadAssetBlob;
  const transferAsset = deps.transferAsset ?? transferAssetToIframe;
  const crossProject = env.sourceProjectId !== targetProjectId;

  // 1. Assets: upload embedded bytes into the target project, build old→new ref map.
  const refMap = new Map<string, string>();
  let oversized = 0;
  if (crossProject) {
    for (const asset of env.assets) {
      if (asset.base64 === null) { oversized++; continue; }
      try {
        const bytes = base64ToBytes(asset.base64);
        const file = new File([bytes], asset.name, { type: asset.mime });
        const { assetId } = await uploadAsset(targetProjectId, file);
        await transferAsset(assetId, new Blob([bytes], { type: asset.mime }));
        refMap.set(asset.assetId, assetId);
      } catch {
        oversized++; // treat a failed upload like an uncarried ref
      }
    }
  }

  // 2. Masters: reuse identical, pass missing, suffix collisions.
  const mastersMap = doc.getMap(MASTERS_MAP);
  const commandMasters: Array<{ astroSource: string; markup: string }> = [];
  const sourceRemap = new Map<string, { astroSource: string; componentType: string }>();
  const pendingSources = new Set<string>();
  for (const master of env.masters) {
    const markup = rewriteRefs(master.markup, refMap);
    const existing = selectMasterMarkup(doc, master.astroSource);
    if (existing !== undefined) {
      if (stripSqIds(existing) === stripSqIds(markup)) continue; // identical → reuse target entry
      // Collision: same key, different content → new suffixed identity.
      const taken = (s: string) => mastersMap.has(s) || pendingSources.has(s);
      const { source, name } = suffixAstroSource(master.astroSource, taken);
      pendingSources.add(source);
      sourceRemap.set(master.astroSource, { astroSource: source, componentType: name });
      commandMasters.push({ astroSource: source, markup });
      // Best-effort .astro file save — the masters overlay is what renders.
      void fetch('/__sq/save-component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, astroContent: stripSqIds(markup) }),
      }).catch(() => {});
      continue;
    }
    pendingSources.add(master.astroSource);
    commandMasters.push({ astroSource: master.astroSource, markup });
  }

  // 3. Elements: re-key, remap parents/bindings, rewrite refs.
  const entries: PasteEntry[] = [];
  let bindingReset = false;
  const toElementData = (plain: PlainElement, id: string, parentId: string | null, index: number): ElementData => {
    const remapped = plain.astroSource ? sourceRemap.get(plain.astroSource) : undefined;
    return rewriteRefs({
      id, pageId, parentId, index,
      type: plain.type as ElementData['type'],
      componentType: remapped?.componentType ?? plain.componentType,
      astroSource: remapped?.astroSource ?? plain.astroSource,
      instanceType: plain.instanceType as ElementData['instanceType'],
      staticMarkup: plain.staticMarkup,
      textContent: plain.textContent,
      slotName: plain.slotName,
      attributes: plain.attributes,
      classes: plain.classes as unknown as ElementData['classes'],
    }, refMap);
  };

  for (const root of env.roots) {
    if (root.doc?.kind === 'subtree') {
      const idMap = new Map<string, string>();
      for (const el of root.doc.elements) idMap.set(el.id, generateId());
      root.doc.elements.forEach((el, i) => {
        const newId = idMap.get(el.id)!;
        const isRoot = i === 0;
        const newParent = isRoot ? null : (el.parentId ? idMap.get(el.parentId) ?? null : null);
        entries.push({
          element: toElementData(el, newId, newParent, el.index),
          extraFields: rewriteRefs(el.extraFields, refMap),
          classOverrides: rewriteRefs(el.classOverrides, refMap),
          unifiedOverrides: rewriteRefs(el.unifiedOverrides, refMap),
        });
      });
      continue;
    }
    if (root.doc?.kind === 'instance') {
      const el = root.doc.element;
      const newId = generateId();
      let blogSlot: PasteEntry['blogSlot'] = null;
      if (root.doc.blogSlot) {
        const bindings: Record<string, string> = {};
        for (const [k, v] of Object.entries(root.doc.blogSlot.bindings)) {
          bindings[k.startsWith(`${el.id}:`) ? `${newId}:${k.slice(el.id.length + 1)}` : k] = v;
        }
        const collectionId = crossProject ? UNBOUND_COLLECTION_ID : root.doc.blogSlot.collectionId;
        if (crossProject && root.doc.blogSlot.collectionId !== UNBOUND_COLLECTION_ID) bindingReset = true;
        blogSlot = { collectionId, settings: root.doc.blogSlot.settings, bindings };
      }
      entries.push({
        element: toElementData(el, newId, null, el.index),
        extraFields: rewriteRefs(el.extraFields, refMap),
        classOverrides: rewriteRefs(el.classOverrides, refMap),
        unifiedOverrides: rewriteRefs(el.unifiedOverrides, refMap),
        blogSlot,
      });
      continue;
    }
    // html-only root: frozen markup element (baseMarkup falls back to staticMarkup
    // when the masters lookup misses — masters.ts).
    if (!root.html) continue;
    entries.push({
      element: {
        id: generateId(), pageId, parentId: null, index: 0,
        type: 'component', componentType: 'Pasted', instanceType: 'local',
        staticMarkup: rewriteRefs(root.html, refMap),
        classes: emptyClassData(),
      },
    });
  }

  if (entries.length === 0) return false;

  // 4. Placement: ⌘K policy — after the selected root, else append.
  const index = rootInsertIndex(selectRootElementIds(doc, pageId), deps.selectedElementId);

  deps.takeSnapshot();
  const ok = await deps.dispatch({ type: 'PASTE_ELEMENTS', pageId, index, masters: commandMasters, elements: entries });

  if (bindingReset) deps.toast?.('Collection binding reset');
  if (oversized > 0) deps.toast?.(`${oversized} asset${oversized === 1 ? '' : 's'} too large to carry — refs kept`);
  return ok !== false;
}
