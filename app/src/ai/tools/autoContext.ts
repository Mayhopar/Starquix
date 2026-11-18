// src/ai/tools/autoContext.ts
// Builds a minimal auto-injected context block for the AI from current app state.

import type { ScannedElement } from '@/context/SelectionContext';
import type * as Y from 'yjs';
import {
  selectCurrentPageId,
  selectCurrentBreakpoint,
  selectPage,
  selectAllPages,
  selectPageDrawnElements,
  selectIsPostPage,
  selectHomePageId,
} from '@/store/selectors';
import { pageRoute } from '@/store/pageRoute';
import { selectVariableCollections } from '@/store/variableSelectors';
import { selectProjectFonts } from '@/store/fontSelectors';
import { selectContentCollections } from '@/store/collectionSelectors';
import { readBlogSlotBinding } from '@/core/collections/yjsAccessors';
import { BLOG_SLOT_COMPONENT_TYPE, DEFAULT_BLOG_SETTINGS } from '@/core/collections/types';
import type { BlogSlotSettings } from '@/core/collections/types';

export interface AutoContext {
  activePage: { id: string; name: string } | null;
  selectedElement: { key: string } | null;
  breakpoint: string;
  /** Every page with its exact internal href (null for dynamic post pages). */
  pages: Array<{ id: string; name: string; href: string | null; isPost: boolean }>;
  /** Font families the project has (picked or uploaded in the Design panel). */
  fonts: string[];
}

/**
 * Build auto-context from current app state.
 * Injected into the system prompt so the AI knows which page/element is active.
 */
export function buildAutoContext(doc: Y.Doc, selectedKey: string | null): AutoContext {
  const pageId = selectCurrentPageId(doc);
  const page = pageId ? selectPage(doc, pageId) : null;
  const breakpoint = selectCurrentBreakpoint(doc);
  const allPages = selectAllPages(doc);

  return {
    activePage: page ? { id: page.id, name: page.name } : null,
    selectedElement: selectedKey ? { key: selectedKey } : null,
    breakpoint,
    fonts: Object.keys(selectProjectFonts(doc)).sort(),
    pages: (() => {
      const homeId = selectHomePageId(doc);
      return allPages.map(p => {
        const isPost = selectIsPostPage(doc, p.id);
        return { id: p.id, name: p.name, href: isPost ? null : pageRoute({ ...p, isHome: p.id === homeId }), isPost };
      });
    })(),
  };
}

/**
 * Format auto-context as a string block appended to the system prompt.
 */
export function formatAutoContext(ctx: AutoContext): string {
  const lines: string[] = ['## Current Editor State'];

  if (ctx.activePage) {
    lines.push(`- Active Page: ${ctx.activePage.name} (id: ${ctx.activePage.id})`);
  }
  if (ctx.selectedElement) {
    lines.push(`- Selected Element: ${ctx.selectedElement.key}`);
  }
  lines.push(`- Breakpoint: ${ctx.breakpoint}`);
  if (ctx.fonts.length > 0) lines.push(`- Project fonts (class font-["Family_Name"], spaces as underscores): ${ctx.fonts.join(', ')}`);
  if (ctx.pages.length > 0) {
    lines.push('- Pages (use these exact hrefs for every internal link — never invent slugs):');
    for (const p of ctx.pages) {
      lines.push(p.isPost
        ? `  - ${p.name} — dynamic post detail page, no static href; never nav-link it, link the page holding its blog listing instead [id: ${p.id}]`
        : `  - ${p.name} → ${p.href} [id: ${p.id}]`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a compact design variables block for the system prompt.
 * Lists every variable name, ID, type, and default-mode value so the AI
 * can reference them in Tailwind classes (bg-[var(--name)]) and tool calls.
 * text- and border- colours get the typed form: a bare var() there is ambiguous
 * with a size / a width (task-262, task-263).
 */
export function buildVariablesContext(doc: Y.Doc): string {
  const collections = selectVariableCollections(doc);
  if (collections.length === 0) return '';

  const lines: string[] = ['## Design Variables', 'Use variable IDs with update_variable_value. Reference in Tailwind as bg-[var(--name)], text-[color:var(--name)], border-[color:var(--name)].', ''];

  for (const col of collections) {
    const defaultMode = col.modes.find(m => m.isDefault) ?? col.modes[0];
    lines.push(`Collection: "${col.name}" [${col.id}]`);
    lines.push(`  Modes: ${col.modes.map(m => `${m.name}${m.isDefault ? ' (default)' : ''} [${m.id}]`).join(', ')}`);

    for (const v of col.variables) {
      const defaultVal = defaultMode ? v.values[defaultMode.id] : undefined;
      let valStr = '';
      if (defaultVal) {
        valStr = defaultVal.type === 'color'
          ? defaultVal.hex + (defaultVal.opacity < 100 ? ` opacity:${defaultVal.opacity}%` : '')
          : defaultVal.type === 'number'
            ? `${defaultVal.value}${defaultVal.unit}`
            : defaultVal.value;
      }
      lines.push(`  --${v.name} [${v.id}]  ${v.type}  ${valStr}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Build blog/collection context for the system prompt.
 * Pre-loads collection list, blog slots on the current page, and post pages so
 * the agent already knows the document's blog schema before the first message.
 * Returns an empty string when the project has no blog content.
 */
export function buildBlogContext(doc: Y.Doc, currentPageId: string | null): string {
  const collections = selectContentCollections(doc);
  const allPages = selectAllPages(doc);
  const postPages = allPages.filter(p => selectIsPostPage(doc, p.id));

  // Blog slots on the current page
  const slots: Array<{
    slotKey: string;
    collectionName: string | null;
    settings: BlogSlotSettings;
  }> = [];

  if (currentPageId) {
    // Legacy drawn BlogSlots (pre-task-028 shape) live in `selectPageDrawnElements`.
    const drawn = selectPageDrawnElements(doc, currentPageId);
    for (const el of drawn) {
      if (el.slotType !== 'blog') continue;
      const binding = readBlogSlotBinding(doc, el.key);
      const col = binding ? collections.find(c => c.id === binding.collectionId) : null;
      slots.push({
        slotKey: el.key,
        collectionName: col?.name ?? null,
        settings: binding?.settings ?? DEFAULT_BLOG_SETTINGS,
      });
    }
    // Regular-instance BlogSlots (post-task-028) live in the main `elements`
    // map with `componentType=BlogSlot` and `isDrawn=false`. The binding key
    // is the element id in both models, so no key translation is needed.
    const elementsMap = doc.getMap('elements');
    elementsMap.forEach((value, id) => {
      const yEl = value as Y.Map<unknown>;
      if (yEl.get('isDrawn')) return; // drawn path handled above
      if (yEl.get('pageId') !== currentPageId) return;
      if (yEl.get('componentType') !== BLOG_SLOT_COMPONENT_TYPE) return;
      const binding = readBlogSlotBinding(doc, id);
      const col = binding ? collections.find(c => c.id === binding.collectionId) : null;
      slots.push({
        slotKey: id,
        collectionName: col?.name ?? null,
        settings: binding?.settings ?? DEFAULT_BLOG_SETTINGS,
      });
    });
  }

  if (collections.length === 0 && slots.length === 0 && postPages.length === 0) return '';

  const lines: string[] = [
    '## Blog & Collections',
    'Use blog tools (read_collections, read_blog_slots, etc.) to inspect and modify blog content.',
    '',
  ];

  if (collections.length > 0) {
    lines.push('### Content Collections');
    for (const col of collections) {
      const fieldNames = col.fields.map(f => `${f.name}(${f.type})`).join(', ');
      lines.push(`- "${col.name}" [id: ${col.id}]  fields: ${fieldNames}`);
    }
    lines.push('');
  }

  if (slots.length > 0) {
    lines.push('### Blog Slots on Current Page');
    for (const slot of slots) {
      const colLabel = slot.collectionName
        ? `collection: "${slot.collectionName}"`
        : 'no collection bound';
      lines.push(
        `- slotKey: ${slot.slotKey}  ${colLabel}  layout: ${slot.settings.layout}  postsPerPage: ${slot.settings.postsPerPage}`,
      );
    }
    lines.push('');
  }

  if (postPages.length > 0) {
    lines.push('### Post Page Templates');
    for (const p of postPages) {
      lines.push(`- "${p.name}" [id: ${p.id}]`);
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Build a compact HTML-like page structure block from scanned elements.
 * Preserves data-key attributes so the AI can use them directly in tool calls.
 * Returns an empty string if no elements are available.
 */
export function buildPageStructureContext(elements: ScannedElement[]): string {
  if (elements.length === 0) return '';

  // Build parent → children map
  const childrenOf = new Map<string | null, ScannedElement[]>();
  for (const el of elements) {
    const parent = el.parentKey ?? null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(el);
  }

  const lines: string[] = [
    '## Page Structure',
    'Use the data-key values below when calling update_element_by_key.',
    '',
  ];

  let totalLines = 0;
  const MAX_LINES = 60;
  const MAX_DEPTH = 5;

  function renderNode(parentKey: string | null, depth: number) {
    if (totalLines >= MAX_LINES || depth > MAX_DEPTH) return;
    const children = childrenOf.get(parentKey) ?? [];
    for (const el of children) {
      const indent = '  '.repeat(depth);
      const classAttr = el.classes ? ` class="${el.classes}"` : '';
      const hasChildren = (childrenOf.get(el.key) ?? []).length > 0;
      const text = el.textContent;

      if (!hasChildren && text) {
        // Leaf with text: inline for readability
        lines.push(`${indent}<${el.tagName} data-key="${el.key}"${classAttr}>${text}</${el.tagName}>`);
      } else {
        lines.push(`${indent}<${el.tagName} data-key="${el.key}"${classAttr}>`);
        if (text) lines.push(`${indent}  ${text}`);
        renderNode(el.key, depth + 1);
        lines.push(`${indent}</${el.tagName}>`);
      }
      totalLines++;
    }
  }

  renderNode(null, 0);

  if (totalLines >= MAX_LINES) {
    lines.push('<!-- ... truncated -->');
  }

  return lines.join('\n');
}
