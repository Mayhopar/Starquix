/**
 * Unified instance-override sync — THE single `observeDeep` on the `elements`
 * Yjs map (classes + text + images, path-scoped, shared undo-restore refs).
 * Extracted verbatim from ClassStoreContext (godfile decomposition Phase C3).
 *
 * BINDING CONSTRAINT (task-014a): this must remain ONE observer. Never split
 * it back into per-domain observers, and never add a second observeDeep on
 * `elements`. The four prev-state refs move TOGETHER with the observer —
 * splitting them breaks undo-restore detection.
 */
import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { getOriginalClassesFromMarkup } from '@/utils/markupQuery';
import { getOriginalTextFromMarkup, getOriginalAttributeOrWarn } from '@/utils/staticMarkup';
import { baseMarkup, resolveOverrideClasses } from '@/store/masters';
import { rootSelectorForMarkup } from '@/store/constants';
import { forEachSourceImageAttrsEntry } from '@/store/sourceOverrideEntries';

export function useInstanceOverrideSync(doc: Y.Doc, bumpInstanceCounter: () => void): void {
  // Previous-state refs for detecting cleared overrides during undo
  const prevOverriddenSelectorsRef = useRef<Map<string, Set<string>>>(new Map());
  const prevTextOverridesRef = useRef<Map<string, Set<string>>>(new Map());
  const prevImageOverridesRef = useRef<Map<string, Map<string, Map<string, string>>>>(new Map());
  const prevRootImageAttrsRef = useRef<Map<string, Map<string, string>>>(new Map());

  const bumpRef = useRef(bumpInstanceCounter);
  bumpRef.current = bumpInstanceCounter;

  // Unified observer for all instance overrides (classes, text, images).
  // A single observeDeep on elements handles all three, reducing overhead
  // from 3 deep observers to 1. Path-scoped: each YEvent's path[0] is the
  // elementId, so we only re-process elements that actually changed in the
  // transaction. Full sweep only on `sq:iframe-ready` (DOM rebuild).
  useEffect(() => {
    const elements = doc.getMap('elements');

    const runSync = (targetIds: Set<string> | null, deletedIds: Set<string> | null) => {
      // Force re-render so useElementClasses re-computes from Yjs
      bumpRef.current();

      // Current-state maps, compared against prev refs to detect cleared overrides
      const currentClassSelectors = new Map<string, Set<string>>();
      const currentTextSelectors = new Map<string, Set<string>>();
      const currentImageOverrides = new Map<string, Map<string, Map<string, string>>>();
      const currentRootImageAttrs = new Map<string, Map<string, string>>();

      elements.forEach((yEl, elementId) => {
        if (targetIds && !targetIds.has(elementId)) return;
        const element = yEl as Y.Map<unknown>;
        const staticMarkup = element.get('staticMarkup') as string | undefined;
        if (!staticMarkup) return;

        // Class base = the masters overlay (overlay wins), NOT the raw
        // staticMarkup — the latter is the stale WC-scanned source. Must match
        // getClassesFromYjs / applyAllOverrides so the iframe and the panel
        // agree (task-082). Text/image overrides still key off staticMarkup.
        // Lazily memoized: this full sweep visits EVERY element, but most have
        // no class state — only resolve (and parse/re-stamp the master) when a
        // class override or restore actually needs it. baseMarkup never returns
        // undefined, so the `=== undefined` guard memoizes even an empty ''.
        let classBaseCache: string | undefined;
        const classBaseMarkup = (): string =>
          classBaseCache !== undefined ? classBaseCache : (classBaseCache = baseMarkup(doc, element));

        // --- Sync class overrides ---
        const classOverrides = element.get('classOverrides') as Y.Map<unknown> | undefined;
        const classSelectors = new Set<string>();
        currentClassSelectors.set(elementId, classSelectors);

        if (classOverrides) {
          classOverrides.forEach((selectorOverride, selector) => {
            classSelectors.add(selector);
            const instanceKey = `${elementId}:${selector}`;
            const originalClasses = getOriginalClassesFromMarkup(classBaseMarkup(), selector);
            const override = selectorOverride as Y.Map<Y.Array<string>>;
            const overrideArray = override.get('base') as Y.Array<string> | undefined;
            // The override entry EXISTS here, so it is authoritative: it
            // replaces the base, and an empty array means cleared-all → ''
            // (task-082). Shared decision with getClassesFromYjs.
            const resolvedClasses = resolveOverrideClasses(originalClasses, overrideArray?.toArray() || []);
            window.postMessage({
              type: 'SYNC_CLASSES_TO_IFRAME',
              payload: { key: instanceKey, classes: resolvedClasses }
            }, '*');
          });
        }

        // Restore original classes for selectors cleared by undo (no override
        // now → fall back to the overlay base, not the stale staticMarkup).
        const prevClassSelectors = prevOverriddenSelectorsRef.current.get(elementId);
        if (prevClassSelectors) {
          for (const prevSelector of prevClassSelectors) {
            if (!classSelectors.has(prevSelector)) {
              const instanceKey = `${elementId}:${prevSelector}`;
              const originalClasses = getOriginalClassesFromMarkup(classBaseMarkup(), prevSelector);
              window.postMessage({
                type: 'SYNC_CLASSES_TO_IFRAME',
                payload: { key: instanceKey, classes: originalClasses }
              }, '*');
            }
          }
        }

        // --- Sync text overrides ---
        const textOverrides = element.get('textOverrides') as Y.Map<string> | undefined;
        const textSelectors = new Set<string>();
        currentTextSelectors.set(elementId, textSelectors);

        if (textOverrides) {
          textOverrides.forEach((textContent, selector) => {
            textSelectors.add(selector);
            window.postMessage({
              type: 'SYNC_TEXT_TO_IFRAME',
              payload: { key: `${elementId}:${selector}`, textContent }
            }, '*');
          });
        }

        // Restore original text for selectors cleared by undo
        const prevTextSelectors = prevTextOverridesRef.current.get(elementId);
        if (prevTextSelectors) {
          for (const prevSelector of prevTextSelectors) {
            if (!textSelectors.has(prevSelector)) {
              const originalText = getOriginalTextFromMarkup(staticMarkup, prevSelector);
              window.postMessage({
                type: 'SYNC_TEXT_TO_IFRAME',
                payload: { key: `${elementId}:${prevSelector}`, textContent: originalText }
              }, '*');
            }
          }
        }

        // --- Sync instance-root imageAttributes ---
        const imageAttributes = element.get('imageAttributes') as Y.Map<unknown> | undefined;
        if (imageAttributes && imageAttributes.size > 0) {
          const rootAttrMap = new Map<string, string>();
          currentRootImageAttrs.set(elementId, rootAttrMap);
          imageAttributes.forEach((value, attrKey) => {
            if (typeof value === 'string') {
              rootAttrMap.set(attrKey, value);
              window.postMessage({
                type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
                payload: { key: elementId, attribute: attrKey, value }
              }, '*');
            }
          });
        }

        // --- Sync instance-child imageOverrides ---
        const imageOverridesMap = element.get('imageOverrides') as Y.Map<Y.Map<unknown>> | undefined;
        const imgSelectorsForInstance = new Map<string, Map<string, string>>();

        if (imageOverridesMap) {
          currentImageOverrides.set(elementId, imgSelectorsForInstance);
          imageOverridesMap.forEach((selectorAttrs, selector) => {
            const attrs = selectorAttrs as Y.Map<unknown>;
            const attrMap = new Map<string, string>();
            attrs.forEach((value, attrKey) => {
              if (typeof value === 'string') {
                attrMap.set(attrKey, value);
                window.postMessage({
                  type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
                  payload: { key: `${elementId}:${selector}`, attribute: attrKey, value }
                }, '*');
              }
            });
            if (attrMap.size > 0) imgSelectorsForInstance.set(selector, attrMap);
          });
        }

        // Restore original image attrs for removed overrides (undo)
        const prevImgSelectors = prevImageOverridesRef.current.get(elementId);
        if (prevImgSelectors) {
          for (const [prevSelector, prevAttrs] of prevImgSelectors) {
            const currentAttrs = imgSelectorsForInstance.get(prevSelector);
            for (const prevAttrKey of prevAttrs.keys()) {
              if (!currentAttrs?.has(prevAttrKey)) {
                const original = getOriginalAttributeOrWarn(staticMarkup, prevSelector, prevAttrKey, `${elementId}:${prevSelector}`);
                if (original !== null) {
                  window.postMessage({
                    type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
                    payload: { key: `${elementId}:${prevSelector}`, attribute: prevAttrKey, value: original }
                  }, '*');
                }
              }
            }
          }
        }

        // Restore original root image attrs if imageAttributes was removed (undo)
        const prevRootAttrs = prevRootImageAttrsRef.current.get(elementId);
        if (prevRootAttrs && !currentRootImageAttrs.has(elementId)) {
          const rootSelector = rootSelectorForMarkup(staticMarkup) ?? 'img-0';
          for (const prevAttrKey of prevRootAttrs.keys()) {
            const original = getOriginalAttributeOrWarn(staticMarkup, rootSelector, prevAttrKey, elementId);
            if (original !== null) {
              window.postMessage({
                type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
                payload: { key: elementId, attribute: prevAttrKey, value: original }
              }, '*');
            }
          }
        }
      });

      // --- Sync source element image attributes ---
      // Source-tracked elements (local mode) store image overrides in a separate
      // Yjs map (sourceImageAttributes), not on the element's imageAttributes/imageOverrides.
      // After HMR resets the DOM, these need to be re-applied via bridge messages.
      // Only re-emit on full sweep — path-scoped fires don't change this map.
      if (targetIds === null) {
        forEachSourceImageAttrsEntry(doc, ({ key, attributes }) => {
          for (const [attribute, value] of Object.entries(attributes)) {
            window.postMessage({ type: 'SYNC_IMAGE_ATTR_TO_IFRAME', payload: { key, attribute, value } }, '*');
          }
        });
      }

      // Update previous state for next comparison
      if (targetIds === null) {
        prevOverriddenSelectorsRef.current = currentClassSelectors;
        prevTextOverridesRef.current = currentTextSelectors;
        prevImageOverridesRef.current = currentImageOverrides;
        prevRootImageAttrsRef.current = currentRootImageAttrs;
      } else {
        for (const id of targetIds) {
          const c = currentClassSelectors.get(id);
          if (c) prevOverriddenSelectorsRef.current.set(id, c);
          else prevOverriddenSelectorsRef.current.delete(id);

          const t = currentTextSelectors.get(id);
          if (t) prevTextOverridesRef.current.set(id, t);
          else prevTextOverridesRef.current.delete(id);

          const i = currentImageOverrides.get(id);
          if (i) prevImageOverridesRef.current.set(id, i);
          else prevImageOverridesRef.current.delete(id);

          const r = currentRootImageAttrs.get(id);
          if (r) prevRootImageAttrsRef.current.set(id, r);
          else prevRootImageAttrsRef.current.delete(id);
        }
        if (deletedIds) {
          for (const id of deletedIds) {
            prevOverriddenSelectorsRef.current.delete(id);
            prevTextOverridesRef.current.delete(id);
            prevImageOverridesRef.current.delete(id);
            prevRootImageAttrsRef.current.delete(id);
          }
        }
      }
    };

    // task-120 (5.3): only override-relevant mutations bump the instance
    // counter / run the sync. Yjs element writes that can't change resolved
    // overrides (position fields, pageId, …) used to bump every consumer.
    // Exactly the keys runSync reads (grep this file) — keep in sync.
    const OVERRIDE_KEYS = new Set([
      'classOverrides', 'textOverrides', 'imageOverrides', 'imageAttributes',
    ]);
    const RELEVANT_CHANGE_KEYS = new Set([...OVERRIDE_KEYS, 'staticMarkup']);

    const onElementsEvents = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const targetIds = new Set<string>();
      const deletedIds = new Set<string>();
      let needsFullSweep = false;
      let relevant = false;
      for (const ev of events) {
        if (ev.path.length === 0) {
          // Mutation on the elements map itself (add/delete an element)
          ev.changes.keys.forEach((change, key) => {
            if (change.action === 'delete') {
              deletedIds.add(key);
              relevant = true; // prev-state refs must be cleaned
            } else {
              targetIds.add(key);
              // An added element only matters when it CARRIES overrides
              // (undo/redo restore, duplication) — seed prev refs for it.
              const el = elements.get(key) as Y.Map<unknown> | undefined;
              if (el) {
                for (const k of OVERRIDE_KEYS) {
                  if (el.get(k) !== undefined) { relevant = true; break; }
                }
              }
            }
          });
        } else {
          const id = ev.path[0];
          if (typeof id === 'string') {
            targetIds.add(id);
            if (ev.path.length >= 2) {
              if (RELEVANT_CHANGE_KEYS.has(String(ev.path[1]))) relevant = true;
            } else {
              ev.changes.keys.forEach((_change, k) => {
                if (RELEVANT_CHANGE_KEYS.has(k)) relevant = true;
              });
            }
          } else { needsFullSweep = true; break; }
        }
      }
      if (needsFullSweep) runSync(null, null);
      else if (relevant && (targetIds.size > 0 || deletedIds.size > 0)) runSync(targetIds, deletedIds);
    };

    const onIframeReady = () => runSync(null, null);

    elements.observeDeep(onElementsEvents);
    window.addEventListener('sq:iframe-ready', onIframeReady);

    return () => {
      elements.unobserveDeep(onElementsEvents);
      window.removeEventListener('sq:iframe-ready', onIframeReady);
    };
  }, [doc]);
}
