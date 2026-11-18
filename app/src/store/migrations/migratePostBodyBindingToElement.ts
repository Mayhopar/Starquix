import * as Y from 'yjs';
import { createElementYMap } from '../commands';
import { emptyClassData } from '../types';
import { findCollectionContentElement } from '../selectors';
import { escapeRegex } from '@/utils/regex';
import { contentSlotMarkup, CONTENT_SLOT_PLACEHOLDER } from '@/utils/createPostPage';

/** One-time, idempotent: converts the legacy postPageBindings 'body' entry into
 *  a real collection-content slot element (the never-shipped "Phase 2" of
 *  template-generator.ts). The host's old body div becomes a <slot name="content">
 *  placeholder; the new child element renders as <div data-sq-slot> so the blog
 *  content area gets the layout-slot treatment. */
export function migratePostBodyBindingToElement(doc: Y.Doc): void {
  const elements = doc.getMap('elements');
  const postPageBindings = doc.getMap('postPageBindings');

  doc.transact(() => {
    postPageBindings.forEach((value, bindingPageId) => {
      const yBinding = value as Y.Map<unknown>;
      const bindings = yBinding.get('bindings') as Y.Map<unknown> | undefined;
      if (!bindings) return;

      const bodyKeys: string[] = [];
      bindings.forEach((field, key) => { if (field === 'body') bodyKeys.push(key); });
      if (bodyKeys.length === 0) return;

      // Double-guard: already migrated (or created via the new createPostPage).
      let hasContentEl = findCollectionContentElement(doc, bindingPageId) !== null;

      for (const key of bodyKeys) {
        // Note: the delete happens per-branch below (not up front) — when the
        // body div has nested content we must KEEP the binding so a future,
        // smarter migration can retry; everywhere else the legacy entry is
        // dead — the body target now derives from the element
        // (selectCollectionContentBodyKey).
        if (hasContentEl) { bindings.delete(key); continue; }

        const sep = key.indexOf(':');
        if (sep === -1) { bindings.delete(key); continue; }
        const hostId = key.slice(0, sep);
        const host = elements.get(hostId) as Y.Map<unknown> | undefined;
        if (!host) { bindings.delete(key); continue; }

        const markup = (host.get('staticMarkup') as string) || '';
        const re = new RegExp(`<([a-z][a-z0-9]*)\\b([^>]*\\bdata-key="${escapeRegex(key)}"[^>]*)>[\\s\\S]*?<\\/\\1>`, 'i');
        const m = markup.match(re);
        if (!m) { bindings.delete(key); continue; }

        // The lazy close above stops at the FIRST </tag>, so a body div with a
        // nested same-name tag (user-edited markup via MARKUP_CHANGED) would
        // match a truncated span and the replace would corrupt the host —
        // orphaned content + stray close tag, silently, at doc load,
        // irreversibly. Handling that needs a real parser; until then skip the
        // one-shot write entirely and keep the binding so a retry stays possible.
        const nested = new RegExp(`<${m[1]}\\b`, 'i').test(m[0].slice(1));
        if (nested) continue;

        bindings.delete(key);

        const cls = m[2].match(/\bclass="([^"]*)"/)?.[1];
        host.set('staticMarkup', markup.replace(re, CONTENT_SLOT_PLACEHOLDER));

        // The content element belongs to the page the HOST carries; the
        // bindings map key is the fallback for malformed legacy docs.
        const pageId = (host.get('pageId') as string | undefined) ?? bindingPageId;
        const contentElId = `${hostId}-content`;
        const contentEl = createElementYMap({
          id: contentElId,
          pageId,
          parentId: hostId,
          index: 0,
          type: 'slot',
          bindingType: 'collection-content',
          slotName: 'content',
          classes: emptyClassData(),
          staticMarkup: contentSlotMarkup(cls),
        });
        elements.set(contentElId, contentEl);
        hasContentEl = true;
      }
    });
  }, 'migration');
}
