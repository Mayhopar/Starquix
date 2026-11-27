// src/ai/tools/commandTools.ts
// Auto-generates AI SDK tool() definitions from the command registry.
// Each tool wraps: takeSnapshot() → dispatch(command) → return result.

import { tool, zodSchema, type ToolSet, type Tool, type Schema } from 'ai';
import { z } from 'zod';
import type * as Y from 'yjs';
import { commandRegistry, type RegisteredCommandType, type CommandCategory, type ToolAvailability, type CommandRegistryEntry } from './commandRegistry';
import type { EditorCommand, ElementData, ClassData, ElementType, Breakpoint } from '@/store/types';
import { parseKey, BREAKPOINTS } from '@/store/types';
import type { VariableValue } from '@/core/variables/types';
import type { ScannedElement } from '@/context/SelectionContext';
import {
  selectPage,
  selectCurrentPageId,
  selectCurrentBreakpoint,
  selectPageRootElements,
  selectResolvedStaticMarkup,
  buildClassString,
  selectPageDrawnElements,
  selectPostPageBinding,
  selectProjectId,
  selectProjectName,
  selectPageLayout,
} from '@/store/selectors';
import { applyCommand, addKeysToMarkup } from '@/store/commands';
import { acceptEditorCommands } from '@/store/commandGesture';
import { acceptDocumentMutation } from '@/store/documentMutation';
import { acceptFolderManifest } from '@/services/durableEdits/featureAcceptance';
import { computeCompleteness } from '@/store/seo/seoCompleteness';
import { hydrateSeoData, type SeoPageData } from '@/store/seo/types';
import { isWrapperKey } from '@/store/keyKind';
import { setHomePageAndPersist } from '@/store/homePage';
import { db, renameProject } from '@/db';
import { listProjectFilePaths, projectFileId } from '@/db/projectFiles';
import { selectVariableCollections, selectVariableCollection } from '@/store/variableSelectors';
import { createDefaultCollection } from '@/core/variables/types';
import { selectContentCollections } from '@/store/collectionSelectors';
import { readBlogSlotBinding } from '@/core/collections/yjsAccessors';
import { contentOps } from '@/core/collections/content-ops';
import { ensureSqComponent } from '@/components/PostEditor/ensureComponent';
import { DEFAULT_FIELDS, BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';
import type { ContentCollection, CollectionField } from '@/core/collections/types';
import { resetInstanceToOriginal, makeComponentFromDrawn, createComponentFromMarkup, pushInstanceToSource } from '@/store/instanceLifecycle';
import {
  folderManifestUrls,
  parseManifest,
  materializeTree,
  resolveFolderTree,
  componentItemId,
  newFolderId,
  type FolderManifest,
} from '@/store/folderManifest';
import { planFolderMove } from '@/store/planFolderMove';
import { buildAddCommand } from '@/store/addCommandFactory';
import { planElementSvgCommands } from '@/utils/convertElementSvgs';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import type { ScannedLayout } from '@/hooks/useLayoutLibrary';
import { generateId, generateDrawnKey } from '@/utils/generateId';
import { deployToVercel } from '@/export';
import { getToken } from '@/utils/deployTokens';
import { searchStockImages } from '@/services/stockImages';
import { resolveImageGen, generateImage, type ImageOrientation } from '@/ai/imageGen';
import { loadAIConfig } from '@/ai/AIContext';
import { uploadAssetBlob } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { isLocalProjectId, findLocalProjectEntry } from '@/utils/localMode';
import { bindPlacedBlogSlot, LOCAL_BLOG_HANDLERS, LOCAL_HIDDEN_BLOG_TOOLS } from './localBlogTools';
import { LOCAL_HIDDEN_SOURCE_TOOLS, LOCAL_SOURCE_HANDLERS } from './localSourceTools';
import { LOCAL_SEO_HANDLERS } from './localSeoTools';

/** Files-truth owners of tools whose registry executors are doc-only (localBlogTools / localSourceTools). */
const LOCAL_HANDLERS = { ...LOCAL_BLOG_HANDLERS, ...LOCAL_SOURCE_HANDLERS, ...LOCAL_SEO_HANDLERS };
/** Local write tools that never read the canvas (select_page waits on its own). */
const PAGE_INDEPENDENT_LOCAL_WRITES = new Set<string>(['edit_file', 'write_file', 'select_page', 'set_breakpoint', 'update_page_seo']);
const LOCAL_HIDDEN_TOOLS = new Set([...LOCAL_HIDDEN_BLOG_TOOLS, ...LOCAL_HIDDEN_SOURCE_TOOLS]);
import { rewriteLocalFile } from '@/utils/localElementSource';
import { stampPostCards } from '@/utils/blogBinding';
import { awaitProjectFiles, awaitJournaledFiles } from '@/services/durableEdits/sourceMaterialization';
import { downloadFilesTruthZip, projectFilesAsArtifacts } from '@/export/filesTruthZip';
import { fail, findScannedByKey, isLocalCtx, requireCurrentLocalPage } from './localToolUtils';
import { getLocalComponentViewFile, requestLocalComponentView, requestPageView } from '@/services/localComponentView';
import { readSourceState } from '@/services/durableEdits/commandReceipts';
import { writesSourceClasses } from '@/services/durableEdits/classCommands';
import { createLocalDocPage, deleteLocalDocPage, followLocalPageFiles } from '@/store/localPages';
import { uploadLocalAssetFile } from '@/utils/imageUpload';
// task-133 Task 9: local (files-truth) structural writes — REUSE the ⌘K/draw
// modules (parity law: one real code path, no parallel logic).
import { resolveInsertTarget, type InsertTargetResult } from '@/utils/localStructural';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { insertLocalComponent } from '@/components/Editor/localComponentInsert';
import type { ThemeComponentTemplate } from '@/components/ComponentPickerModal/ComponentPickerModal';
import { insertLocalDrawnElement } from '@/components/Canvas/localDrawInsert';
import {
  acquireStructuralWrite,
  releaseStructuralWrite,
  deleteLocalElement,
  moveLocalElement,
  planLocalReparentInsert,
  isSourceKeyedElementKey,
  NO_LOCAL_MOVE_ANCHOR,
} from '@/components/Editor/localStructuralOps';
import { resolveLocalUsageTarget } from '@/utils/localUsageTarget';
import {
  isLocalPageInSync,
  whenLocalPageInSync,
  LOCAL_PAGE_NOT_LOADED_REASON,
  markLocalScanStaleAfterWrite,
  renameLocalDocPage,
  LOCAL_HOME_IS_INDEX,
  waitForLocalScan,
} from '@/utils/localPageSync';
import { serializeDrawnPayload } from '@/store/serializeDrawnTree';
import { insertRegionInverseOp, type PushStructuralUndo } from '@/store/structuralUndo';
import type { useUndoContext } from '@/context/UndoContext';

// ============================================================================
// Types
// ============================================================================

export interface ToolExecutionContext {
  doc: Y.Doc;
  dispatch: import('@/store/durableDispatch').EditorDispatch;
  takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot'];
  claimSnapshot?: ReturnType<typeof useUndoContext>['claimSnapshot'];
  /** Selected element key */
  selectedElementKey: string | null;
  /** All elements currently visible in the canvas (from ELEMENTS_SCANNED).
   *  LIVE getter — reads the current scan at call time, so tools see the fresh
   *  page after a mid-run select_page/add_page switch. */
  getScannedElements: () => ScannedElement[];
  /** Runtime-mode flags used to filter mode-unavailable tools out of generation */
  availability: ToolAvailability;
  /** Full component library ([...builtIn, ...userProject]) for instance tools */
  componentLibrary: ScannedComponent[];
  /** Available page layouts (from useLayoutLibrary) for layout tools */
  layoutLibrary: ScannedLayout[];
  /** task-133 Task 9 (local runtime): project-relative file backing the page
   *  the canvas is showing — THE structural write target. LIVE getter (the AI
   *  can select_page mid-run). Returns null off the local runtime or when the
   *  page has no backing file yet. */
  getCurrentPageFile: () => string | null;
  /** task-133 Task 9 (local runtime): UndoContext's pushStructuralUndo — local
   *  structural AI writes record inverse-replay undo on the SAME stack as the
   *  user's Cmd+Z. Unused off the local runtime. */
  pushStructuralUndo: PushStructuralUndo;
  /** Undo/redo stack access — same stack as the user's Cmd+Z */
  history: {
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** True once any mutating tool ran in the current AI batch */
    hasMutatedThisBatch: () => boolean;
  };
}

export interface ToolCallResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  /** True when the call did not run (held by the confirm gate, or an image generation stopped). */
  cancelled?: boolean;
  /** Confirm gate (chat + MCP): refused because `confirm:true` was missing — ask the user, retry WITH it after a yes. */
  needsConfirmation?: boolean;
}

/** Log entry for a single tool execution */
export interface ToolCallLogEntry {
  tool: string;
  params: Record<string, unknown>;
  result: ToolCallResult;
  timestamp: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * AI models often flatten nested objects in tool call params.
 * Re-nest them to match what the command handlers expect.
 */
function normalizeParams(
  commandType: RegisteredCommandType,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const NESTED_COMMANDS: Record<string, { wrapper: string; keep: string[] }> = {
    add_page: { wrapper: 'page', keep: [] },
  };

  const spec = NESTED_COMMANDS[commandType];
  if (!spec) return params;

  // Already nested correctly
  if (params[spec.wrapper] && typeof params[spec.wrapper] === 'object') return params;

  // Re-nest: keep specified top-level fields, wrap rest into nested object
  const nested: Record<string, unknown> = {};
  const top: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (spec.keep.includes(key)) {
      top[key] = value;
    } else {
      nested[key] = value;
    }
  }

  return { ...top, [spec.wrapper]: nested };
}

/** Truncate markup to avoid flooding the AI context */
function truncateMarkup(markup: string, maxLen = 2000): string {
  if (markup.length <= maxLen) return markup;
  return markup.slice(0, maxLen) + '\n<!-- ... truncated -->';
}

const INVALID_SOURCE_KEYS = new Set(['undefined', 'null', '', 'unknown']);

// ============================================================================
// Read Query Execution (no dispatch, returns data directly)
// ============================================================================

const VERIFY_TIMEOUT_MS = 3000;
const VERIFY_TIMEOUT_MESSAGE = 'verify_layout timeout — canvas frame not responding';

/**
 * Asks the canvas frame that is on `breakpoint` to verify `keys`: an async
 * round-trip (sq:ai-verify-layout → ViewportFrame → VERIFY_LAYOUT →
 * LAYOUT_VERIFIED → sq:ai-verify-layout-result).
 */
function askFrame(keys: string[], breakpoint: string): Promise<Record<string, unknown>> {
  const requestId = `verify-${generateId()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('sq:ai-verify-layout-result', onResult);
      resolve({ success: false, message: VERIFY_TIMEOUT_MESSAGE });
    }, VERIFY_TIMEOUT_MS);
    function onResult(e: Event) {
      const detail = (e as CustomEvent).detail as { requestId: string; findings: unknown[] };
      if (detail.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('sq:ai-verify-layout-result', onResult);
      resolve({ success: true, breakpoint, findings: detail.findings });
    }
    window.addEventListener('sq:ai-verify-layout-result', onResult);
    window.dispatchEvent(new CustomEvent('sq:ai-verify-layout', { detail: { requestId, keys, breakpoint } }));
  });
}

/** True once the canvas frame says it is on `breakpoint` (ViewportFrame says so when it binds). */
function frameAt(breakpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (there: boolean) => {
      clearTimeout(timer);
      window.removeEventListener('sq:ai-verify-ready', onReady);
      resolve(there);
    };
    const onReady = (e: Event) => { if ((e as CustomEvent).detail.breakpoint === breakpoint) settle(true); };
    const timer = setTimeout(() => settle(false), VERIFY_TIMEOUT_MS);
    window.addEventListener('sq:ai-verify-ready', onReady);
  });
}

async function executeVerifyLayout(
  ctx: ToolExecutionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const keys = params.keys as string[];
  const home = selectCurrentBreakpoint(ctx.doc);
  const breakpoint = (params.breakpoint as Breakpoint) || home;
  if (breakpoint === home) return askFrame(keys, breakpoint);
  // The canvas mounts ONE frame, at the editor's breakpoint. Another width is
  // checked by moving the canvas there and back: whatever the check returns,
  // the user ends on the width they were on (task-266).
  const there = frameAt(breakpoint); // listening before the switch
  applyCommand(ctx.doc, { type: 'SET_BREAKPOINT', breakpoint });
  try {
    return (await there) ? await askFrame(keys, breakpoint) : { success: false, message: VERIFY_TIMEOUT_MESSAGE };
  } finally {
    applyCommand(ctx.doc, { type: 'SET_BREAKPOINT', breakpoint: home });
  }
}

/** list_files / read_file: the project's files (the Dexie rows — files are
 *  truth). Accepted edits land first, so a read right after a write sees it. */
async function executeFileRead(doc: Y.Doc, commandType: RegisteredCommandType, params: Record<string, unknown>) {
  const projectId = selectProjectId(doc) ?? '';
  await awaitJournaledFiles(projectId, { agent: true });
  if (commandType === 'list_files') {
    const prefix = params.prefix as string | undefined;
    return { files: (await listProjectFilePaths(projectId)).filter(file => !prefix || file.startsWith(prefix)).sort() };
  }
  const path = params.path as string;
  const row = await db.projectFiles.get(projectFileId(projectId, path));
  if (!row) return { success: false, message: `No file at ${path}` };
  if (!row.isText) return { success: false, message: `${path} is binary` };
  return { path, content: new TextDecoder().decode(row.content) };
}

function executeReadQuery(
  doc: Y.Doc,
  commandType: RegisteredCommandType,
  params: Record<string, unknown>,
  scannedElements: ScannedElement[],
) {
  if (commandType === 'read_source_elements') {
    // Primary: use scannedElements (populated from ELEMENTS_SCANNED as soon as the iframe renders).
    // This includes every visible element, not just ones the user has clicked.
    if (scannedElements.length > 0) {
      // Hard cap — this result is resent on every agent step; 150 entries ≈ 5-10K tokens.
      const MAX_ELEMENTS = 150;
      const capped = scannedElements.slice(0, MAX_ELEMENTS);
      const elements = capped.map(el => ({
        sourceKey: el.key,
        classes: el.classes,
        tagName: el.tagName,
        file: el.sourceLocation?.file,
      }));
      const truncated = scannedElements.length > MAX_ELEMENTS;
      return {
        elements,
        count: scannedElements.length,
        ...(truncated && {
          truncated: true,
          message: `Showing first ${MAX_ELEMENTS} of ${scannedElements.length} elements. Use read_element_html with a sourceKey to inspect a specific subtree.`,
        }),
      };
    }

    // Fallback: sourceClasses Yjs map (only contains clicked elements).
    const sourceClasses = doc.getMap('sourceClasses') as Y.Map<Y.Map<unknown>>;
    const elements: Array<{ sourceKey: string; classes: string; tagName?: string; file?: string }> = [];
    sourceClasses.forEach((yEntry, sourceKey) => {
      const classes = (yEntry.get('classes') as string) || '';
      const sourceLocation = yEntry.get('sourceLocation') as Y.Map<unknown> | undefined;
      const file = sourceLocation ? (sourceLocation.get('file') as string) : undefined;
      elements.push({ sourceKey, classes, file });
    });
    return { elements, count: elements.length };
  }

  if (commandType === 'read_page_content') {
    const { pageId } = params as { pageId: string };
    const page = selectPage(doc, pageId);
    if (!page) return { error: `Page "${pageId}" not found` };
    const rootElements = selectPageRootElements(doc, pageId);
    return {
      page: { id: page.id, name: page.name },
      elements: rootElements.map((el: ElementData) => ({
        id: el.id,
        type: el.type,
        componentType: el.componentType,
        tag: el.tag,
        classes: buildClassString(el.classes),
        index: el.index,
        parentId: el.parentId,
        hasStaticMarkup: !!el.staticMarkup,
        staticMarkup: el.staticMarkup
          ? truncateMarkup(selectResolvedStaticMarkup(doc, el.id) || el.staticMarkup)
          : undefined,
      })),
    };
  }

  if (commandType === 'read_page_seo') {
    const { pageId } = params as { pageId: string };
    const page = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
    if (!page) return { error: `Page "${pageId}" not found` };
    const seoMap = page.get('seo') as Y.Map<unknown> | undefined;
    const { seo, explicitKeys } = hydrateSeoData(seoMap?.toJSON() as Partial<SeoPageData> | undefined);
    const completeness = computeCompleteness(seo, explicitKeys);
    return {
      seo,
      completeness: {
        score: completeness.score,
        maxScore: completeness.maxScore,
        percentage: Math.round(completeness.percentage),
        unfilled: completeness.unfilled,
      },
    };
  }

  if (commandType === 'read_component_content') {
    const { elementId } = params as { elementId: string };
    const markup = selectResolvedStaticMarkup(doc, elementId);
    if (!markup) return { error: `Element "${elementId}" not found or has no markup` };
    return { elementId, markup };
  }

  if (commandType === 'read_variables') {
    const { collectionId } = params as { collectionId?: string };
    const collections = collectionId
      ? [selectVariableCollection(doc, collectionId)].filter(Boolean)
      : selectVariableCollections(doc);

    if (collections.length === 0) {
      return collectionId
        ? { error: `Collection "${collectionId}" not found` }
        : { collections: [], message: 'No variable collections found' };
    }

    return {
      collections: collections.map(col => ({
        id: col!.id,
        name: col!.name,
        modes: col!.modes.map(m => ({ id: m.id, name: m.name, isDefault: m.isDefault })),
        variables: col!.variables.map(v => ({
          id: v.id,
          name: `--${v.name}`,
          type: v.type,
          values: Object.fromEntries(
            Object.entries(v.values).map(([modeId, val]) => [
              modeId,
              val.type === 'color'
                ? `${val.hex}${val.opacity < 100 ? ` (opacity: ${val.opacity}%)` : ''}`
                : val.type === 'number'
                  ? `${val.value}${val.unit}`
                  : val.value,
            ])
          ),
        })),
      })),
    };
  }

  if (commandType === 'read_element_html') {
    const { sourceKey, maxDepth = 8 } = params as { sourceKey?: string; maxDepth?: number };

    if (scannedElements.length === 0) {
      return { error: 'No elements scanned yet. The page may still be loading.' };
    }

    // Build parent → children map
    const childrenOf = new Map<string | null, ScannedElement[]>();
    for (const el of scannedElements) {
      const parent = el.parentKey ?? null;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(el);
    }

    const lines: string[] = [];
    let totalLines = 0;
    const MAX_LINES = 200;

    function renderChildren(parentKey: string | null, depth: number) {
      if (totalLines >= MAX_LINES || depth > maxDepth) return;
      const children = childrenOf.get(parentKey) ?? [];
      for (const el of children) {
        const indent = '  '.repeat(depth);
        const classAttr = el.classes ? ` class="${el.classes}"` : '';
        const keyAttr = ` data-key="${el.key}"`;
        const text = el.textContent;
        const hasChildren = (childrenOf.get(el.key) ?? []).length > 0;

        if (!hasChildren && text) {
          lines.push(`${indent}<${el.tagName}${keyAttr}${classAttr}>${text}</${el.tagName}>`);
        } else {
          lines.push(`${indent}<${el.tagName}${keyAttr}${classAttr}>`);
          if (text) lines.push(`${indent}  ${text}`);
          renderChildren(el.key, depth + 1);
          lines.push(`${indent}</${el.tagName}>`);
        }
        totalLines++;
        if (totalLines >= MAX_LINES) { lines.push('<!-- ... truncated -->'); break; }
      }
    }

    if (sourceKey) {
      const rootEl = scannedElements.find(e => e.key === sourceKey || e.sourceKey === sourceKey);
      if (!rootEl) {
        if (doc.getMap('pages').has(sourceKey)) {
          return { error: `"${sourceKey}" is a page ID, not an element key. Call select_page pageId="${sourceKey}" to switch the editor to it (live reads then work), or read_page_content pageId="${sourceKey}" for a structural read without switching.` };
        }
        return { error: `Element with sourceKey "${sourceKey}" not found. Call read_source_elements to list available keys.` };
      }

      const classAttr = rootEl.classes ? ` class="${rootEl.classes}"` : '';
      const hasChildren = (childrenOf.get(rootEl.key) ?? []).length > 0;
      const text = rootEl.textContent;

      if (!hasChildren && text) {
        lines.push(`<${rootEl.tagName} data-key="${rootEl.key}"${classAttr}>${text}</${rootEl.tagName}>`);
      } else {
        lines.push(`<${rootEl.tagName} data-key="${rootEl.key}"${classAttr}>`);
        if (text) lines.push(`  ${text}`);
        renderChildren(rootEl.key, 1);
        lines.push(`</${rootEl.tagName}>`);
      }
    } else {
      renderChildren(null, 0);
    }

    if (lines.length === 0) {
      return { error: sourceKey ? `No children found for "${sourceKey}"` : 'No elements found on page' };
    }

    return { html: lines.join('\n'), truncated: totalLines >= MAX_LINES };
  }

  return { error: `Unknown read query: ${commandType}` };
}

// ============================================================================
// Command Execution
// ============================================================================

const SELECT_PAGE_SCAN_TIMEOUT_MS = 5000;
/** Resolves true when getScanned() returns a NEW array identity (SelectionContext
 *  replaces the ref array on every accepted scan), false on timeout.
 *  ponytail: 150ms poll, no bridge round-trip — an event channel if this misbehaves.
 *  Known ceiling: old page empty AND new page empty → scans shallow-equal → ref
 *  identity never changes → timeout fires. Harmless: timeout ≠ failure (scan-pending). */
function awaitScanChange(
  getScanned: () => ScannedElement[],
  before: ScannedElement[],
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (getScanned() !== before) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}


/**
 * task-133 Task 9: add_page_content for the LOCAL (files-truth) runtime.
 * A doc-only ADD_ELEMENT renders NOTHING in a local iframe (no doc-RENDER) —
 * the old path reported success on an unchanged canvas ("false success").
 * Here the markup is written into the REAL page file through the same write
 * channel as the ⌘K/draw flows; success is returned ONLY on a resolved write.
 *
 * Placement (gap 13): beforeId/afterId ARE honored — they name SCANNED keys
 * (the addresses the model reads via read_source_elements in local mode) and
 * resolve to a before/after writeInsert anchor, with the same usage re-target
 * (`<Card />` tag in the page file) as delete/move. parentId/index are
 * doc-element ids/indexes — meaningless for the real file — and stay ignored
 * (page-anchor fallback: inside-end of the page's last root).
 */
async function executeLocalAddPageContent(
  ctx: ToolExecutionContext,
  p: { pageId: string; type: string; tag?: string; textContent?: string; classes?: string; markup?: string; beforeId?: string; afterId?: string; placementIgnored?: boolean },
): Promise<ToolCallResult> {
  const refusal = requireCurrentLocalPage(ctx, 'add_page_content', p.pageId);
  if (refusal) return refusal;
  const pageFile = ctx.getCurrentPageFile();
  if (!pageFile) {
    return { success: false, message: 'add_page_content failed: this page has no source file (a page with no file in src/pages) — select a page that has one.' };
  }

  // Markup to write. RAW markup is NOT brace-escaped: the AI may intentionally
  // write Astro `{expressions}` — escaping would break them, and the plugin's
  // brace-balance guard already protects against malformed spans. textContent
  // (type "text") IS brace-escaped via serializeDrawnPayload — it is user
  // prose, not code, and a stray `{` in .astro text position opens an
  // expression (serializeDrawnTree constraint).
  let markup: string;
  if (p.type === 'text') {
    markup = serializeDrawnPayload({ tag: p.tag ?? 'p', classes: p.classes ?? '', textContent: p.textContent ?? '' });
  } else {
    if (!p.markup?.trim()) {
      return { success: false, message: 'add_page_content failed: local projects need staticMarkup for frames — send the COMPLETE section markup.' };
    }
    markup = p.markup;
  }

  // Wrong-file-write guard (live-smoke Critical): the scan may still describe
  // the page the model just left — resolving a target from it writes the
  // WRONG real file. The write-tool wrapper already waited for the page; this
  // is the invariant, never a doc-only "success".
  if (!isLocalPageInSync()) {
    return { success: false, message: `add_page_content failed: ${LOCAL_PAGE_NOT_LOADED_REASON}` };
  }
  // Gap 13: beforeId/afterId anchor — a scanned key resolved to a real-file
  // before/after target. Unresolvable anchors fail HONESTLY (WC-path parity:
  // an unknown anchor is refused there too), never silently appended.
  const anchorId = p.beforeId ?? p.afterId;
  let target: InsertTargetResult;
  if (anchorId !== undefined) {
    const scannedList = ctx.getScannedElements();
    const anchorEl = scannedList.find(e => e.key === anchorId || e.sourceKey === anchorId);
    if (!anchorEl) {
      return { success: false, message: `add_page_content failed: anchor "${anchorId}" is not on the current page. Call read_source_elements to list keys, or omit beforeId/afterId to append at the end.` };
    }
    // `#n` loop copies / instance copies are not addressable write targets
    // (same rule as moveLocalElement) — anchoring to one would target the
    // template line and lie about where the content lands.
    if (/#\d+$/.test(anchorEl.key)) {
      return { success: false, message: `add_page_content failed: anchor "${anchorId}" is a loop/instance copy — anchor to the unsuffixed element instead.` };
    }
    // Same-file anchor targets itself; a component-rendered anchor re-targets
    // to the `<Component />` usage tag in the page file (task-148 item 7 —
    // THE rule lives in resolveLocalUsageTarget, not here). No target = the
    // write would rewrite a shared component: refuse.
    const loc = anchorEl.sourceLocation?.file === pageFile
      ? anchorEl.sourceLocation
      : resolveLocalUsageTarget(anchorEl.key, new Map(scannedList.map(e => [e.key, e])), pageFile);
    if (!loc) {
      return { success: false, message: `add_page_content failed: anchor "${anchorId}" lives inside a shared component${anchorEl.sourceLocation ? ` (${anchorEl.sourceLocation.file})` : ''} — anchor to a page-level element from read_source_elements, or omit beforeId/afterId to append at the end.` };
    }
    target = { loc, position: p.beforeId !== undefined ? 'before' : 'after' };
  } else {
    target = resolveInsertTarget(null, ctx.getScannedElements(), pageFile);
  }
  if ('error' in target) {
    return { success: false, message: "add_page_content failed: the page isn't scanned yet — wait for the preview to load, then retry." };
  }
  // const rebind: `target` is a `let` (anchor vs fallback path), and TS only
  // alias-narrows conditions stored FROM a const — narrow through this name.
  const resolved = target;
  // Fix 1 (task-148): component-only pages surface no node keyed to the page
  // file — the anchor is resolved server-side from the file itself.
  const pageBody = 'pageBody' in resolved;
  await acquireStructuralWrite(); // its turn behind any write in flight — never "retry"
  try {
    let res: Awaited<ReturnType<typeof viteStructuralWriter.writeInsert>>;
    try {
      res = pageBody
        ? await viteStructuralWriter.writeAppendPage(pageFile, markup)
        : await viteStructuralWriter.writeInsert(resolved.loc, markup, resolved.position);
    } catch (err) {
      return { success: false, message: `add_page_content failed: ${err instanceof Error ? err.message : 'the file was not changed'}` };
    }
    if (!res || !res.success) {
      return { success: false, message: 'add_page_content failed: the file was not changed' };
    }
    // Findings 11/18: this insert shifted every line below it — fence further
    // AI structural ops until ELEMENTS_SCANNED re-vouches the page.
    markLocalScanStaleAfterWrite();
    // Same inverse-replay record as the draw flow — one undo stack for AI +
    // user. Live-smoke Critical: the inverse is ONE byte-exact region restore
    // of the splice — it covers multi-root markup naturally AND rejoins a
    // mid-line-split target line (remove ×rootCount never did). rootCount
    // stays in replies; the remove ×rootCount inverse remains ONLY as the
    // legacy-reply fallback (region fields absent).
    const regionInverse = insertRegionInverseOp(res);
    const rootCount = res.rootCount ?? 1;
    ctx.pushStructuralUndo({
      structuralOp: {
        sourceFiles: res.sourceFiles,
        forward: [
          'pageBody' in resolved
            ? { kind: 'append-page' as const, pageFile, markup }
            : { kind: 'insert' as const, loc: resolved.loc, markup, position: resolved.position },
        ],
        inverse: regionInverse
          ? [regionInverse]
          : Array.from({ length: rootCount }, () => ({
              kind: 'remove' as const,
              loc: { file: res.file, line: res.insertedLine, column: 1 },
              // inverse of OUR OWN insert — allowed past the gut-the-file guard
              allowRootRemoval: true,
            })),
      },
    });
    return {
      success: true,
      message: `Content written to ${res.file} (line ${res.insertedLine}) — the canvas rescans automatically.${p.placementIgnored ? ' Note: parentId/index placement params are ignored in local mode — content was appended at the end of the page; use beforeId/afterId with a scanned key to position content.' : ''}`,
      data: { file: res.file, insertedLine: res.insertedLine },
    };
  } finally {
    releaseStructuralWrite();
  }
}

async function executeCommand(
  ctx: ToolExecutionContext,
  commandType: RegisteredCommandType,
  params: Record<string, unknown>,
): Promise<ToolCallResult> {
  console.group(`[AI:exec] ${commandType}`);
  console.log('params:', params);

  try {
    // Undo/redo share the user's stack and never take a batch snapshot.
    if (commandType === 'undo' || commandType === 'redo') {
      const h = ctx.history;
      if (h.hasMutatedThisBatch()) {
        console.groupEnd();
        return { success: false, message: 'I already made changes in this request — finish this batch, then ask again, or press Cmd+Z to undo everything I just did.' };
      }
      const can = commandType === 'undo' ? h.canUndo() : h.canRedo();
      if (!can) {
        console.groupEnd();
        return { success: false, message: `Nothing to ${commandType}.` };
      }
      (commandType === 'undo' ? h.undo : h.redo)();
      console.groupEnd();
      return { success: true, message: `${commandType === 'undo' ? 'Undid' : 'Redid'} the last change.` };
    }

    // Handle update_element_by_key: may dispatch UPDATE_SOURCE_CLASSES and/or UPDATE_SOURCE_TEXT
    if (commandType === 'update_element_by_key') {
      let sourceKey = params.sourceKey as string;

      // Fallback: if AI didn't provide a valid sourceKey, use the selected element
      if ((!sourceKey || INVALID_SOURCE_KEYS.has(sourceKey)) && ctx.selectedElementKey && !INVALID_SOURCE_KEYS.has(ctx.selectedElementKey)) {
        console.warn(`[AI] sourceKey was "${sourceKey}", falling back to selected element: ${ctx.selectedElementKey}`);
        sourceKey = ctx.selectedElementKey;
      }

      if (!sourceKey || INVALID_SOURCE_KEYS.has(sourceKey)) {
        const result = {
          success: false,
          message: `update_element_by_key requires a valid sourceKey. Got: "${sourceKey}". Use the sourceKey from Context Elements or select an element in the editor first.`,
        };
        console.warn('invalid sourceKey →', result.message);
        console.groupEnd();
        return result;
      }

      // The page wrapper is editor infrastructure — styling it reflows every
      // section on the page ("all sections float in a padded box").
      if (isWrapperKey(sourceKey)) {
        const result = {
          success: false,
          message: `update_element_by_key failed: "${sourceKey}" is the page WRAPPER (editor infrastructure), not a content element. Never style it. Target a section or element key from read_page_content instead.`,
        };
        console.warn(result.message);
        console.groupEnd();
        return result;
      }

      const hasClasses = params.classes !== undefined;
      const hasText = params.textContent !== undefined;

      if (!hasClasses && !hasText) {
        console.groupEnd();
        return { success: false, message: 'update_element_by_key requires at least classes or textContent.' };
      }

      // Files-truth: an element with no scanned source location is written
      // NOWHERE — the accepted edit carried no source command and the tool
      // used to answer "classes updated" anyway (2026-10-05: rev 53, an
      // empty durable row right after a file write re-rendered the canvas).
      // Wait out a pending scan once; still missing → an honest failure.
      const isLocalSurface = isLocalCtx(ctx);
      const findScanned = () => findScannedByKey(ctx.getScannedElements(), sourceKey);
      let scannedEl = findScanned();
      if (isLocalSurface && !scannedEl?.sourceLocation) {
        await waitForLocalScan(4000);
        scannedEl = findScanned();
        if (!scannedEl?.sourceLocation) {
          console.groupEnd();
          return { success: false, message: `update_element_by_key failed: "${sourceKey}" is not on the current canvas (it may still be re-rendering) — call read_source_elements and retry with a current key.` };
        }
      }
      // From a page, an element rendered by a component is an INSTANCE edit:
      // kept as an override on this placement, the component file unchanged.
      const instanceOnly = isLocalSurface && !!scannedEl?.sourceLocation && !writesSourceClasses(scannedEl.sourceLocation);

      ctx.takeSnapshot();

      const messages: string[] = [];
      const commands: EditorCommand[] = [];

      if (hasClasses || hasText) {
        // UPDATE_SOURCE_CLASSES requires the key to be registered in sourceClasses first.
        // If the key isn't registered yet (e.g. the user hasn't clicked it), auto-register it
        // using the current classes from scannedElements, then retry the update.
        if (!ctx.doc.getMap('sourceClasses').has(sourceKey)) {
          commands.push({
            type: 'REGISTER_SOURCE_ELEMENT',
            sourceKey,
            classes: scannedEl?.classes ?? '',
            ...(scannedEl?.sourceLocation ? { sourceLocation: scannedEl.sourceLocation } : {}),
          } as EditorCommand);
        }
      }
      if (hasClasses) {
        commands.push({ type: 'UPDATE_SOURCE_CLASSES', sourceKey, classes: params.classes,
          originalClasses: scannedEl?.classes, sourceLocation: scannedEl?.sourceLocation } as EditorCommand);
        messages.push('classes updated');
      }

      if (hasText) {
        commands.push({ type: 'UPDATE_SOURCE_TEXT', sourceKey, textContent: params.textContent,
          originalText: scannedEl?.textContent, sourceLocation: scannedEl?.sourceLocation } as EditorCommand);
        messages.push('text updated');
      }
      await acceptEditorCommands(ctx.doc, commands, ctx.claimSnapshot?.());
      if (hasText) {
        // sourceText.observeDeep only syncs to iframe during undo — for AI-initiated changes
        // we must manually trigger the SYNC_TEXT_TO_IFRAME → UPDATE_TEXT forwarding path.
        window.postMessage({ type: 'SYNC_TEXT_TO_IFRAME', payload: { key: sourceKey, textContent: params.textContent } }, '*');
      }

      if (instanceOnly) messages.push(`an override on this page only (the page passes it as a prop; ${scannedEl!.sourceLocation!.file} keeps its own value) — push_instance_to_source makes it the default everywhere`);
      const result = { success: true, message: messages.join(', ') || 'done' };
      console.log(result);
      console.groupEnd();
      return result;
    }

    // ---- Variable write commands ----

    if (commandType === 'update_variable_value') {
      const { collectionId, variableId, modeId: explicitModeId, value } = params as {
        collectionId: string;
        variableId: string;
        modeId?: string;
        value: VariableValue & { opacity?: number; unit?: string };
      };

      const collection = selectVariableCollection(ctx.doc, collectionId);
      if (!collection) {
        const result = { success: false, message: `Collection "${collectionId}" not found` };
        console.warn(result.message); console.groupEnd();
        return result;
      }

      const variable = collection.variables.find(v => v.id === variableId);
      if (!variable) {
        const result = { success: false, message: `Variable "${variableId}" not found in collection "${collection.name}"` };
        console.warn(result.message); console.groupEnd();
        return result;
      }

      const modeId = explicitModeId ?? collection.modes.find(m => m.isDefault)?.id;
      if (!modeId) {
        const result = { success: false, message: `No default mode found for collection "${collection.name}"` };
        console.warn(result.message); console.groupEnd();
        return result;
      }

      // Normalize value (AI may omit optional fields with defaults)
      const normalizedValue: VariableValue =
        value.type === 'color'
          ? { type: 'color', hex: value.hex, opacity: (value as { opacity?: number }).opacity ?? 100 }
          : value.type === 'number'
            ? { type: 'number', value: (value as { value: number }).value, unit: (value as { unit?: string }).unit ?? 'px' }
            : { type: 'string', value: (value as { value: string }).value };

      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'UPDATE_VARIABLE_VALUE', collectionId, variableId, modeId, value: normalizedValue } as EditorCommand);

      const result = { success: true, message: `Updated --${variable.name} in mode "${collection.modes.find(m => m.id === modeId)?.name ?? modeId}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'create_variable') {
      const { collectionId, name, type, value } = params as {
        collectionId: string;
        name: string;
        type: 'color' | 'number' | 'string';
        value: VariableValue & { opacity?: number; unit?: string };
      };

      const collection = selectVariableCollection(ctx.doc, collectionId);
      if (!collection) {
        const result = { success: false, message: `Collection "${collectionId}" not found` };
        console.warn(result.message); console.groupEnd();
        return result;
      }

      // Build values map: same value for all modes
      const normalizedValue: VariableValue =
        value.type === 'color'
          ? { type: 'color', hex: value.hex, opacity: (value as { opacity?: number }).opacity ?? 100 }
          : value.type === 'number'
            ? { type: 'number', value: (value as { value: number }).value, unit: (value as { unit?: string }).unit ?? 'px' }
            : { type: 'string', value: (value as { value: string }).value };

      const variableId = `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const valuesForAllModes = Object.fromEntries(collection.modes.map(m => [m.id, normalizedValue]));

      ctx.takeSnapshot();
      await ctx.dispatch({
        type: 'ADD_VARIABLE',
        collectionId,
        variable: { id: variableId, name, type, values: valuesForAllModes },
      } as EditorCommand);

      const result = { success: true, message: `Created --${name}`, data: { variableId } };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'delete_variable') {
      const { collectionId, variableId } = params as { collectionId: string; variableId: string };

      const collection = selectVariableCollection(ctx.doc, collectionId);
      if (!collection) {
        const result = { success: false, message: `Collection "${collectionId}" not found` };
        console.warn(result.message); console.groupEnd();
        return result;
      }

      const variable = collection.variables.find(v => v.id === variableId);
      if (!variable) {
        const result = { success: false, message: `Variable "${variableId}" not found` };
        console.warn(result.message); console.groupEnd();
        return result;
      }

      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'DELETE_VARIABLE', collectionId, variableId } as EditorCommand);

      const result = { success: true, message: `Deleted --${variable.name}` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'create_variable_collection') {
      const { name } = params as { name: string };
      // Mirror the UI (VariablesQuickPanel/AssetsPanel): createDefaultCollection
      // builds the canonical shape (Light/Dark modes); only the name differs.
      const collection = { ...createDefaultCollection(), name };
      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'ADD_VARIABLE_COLLECTION', collection } as EditorCommand);
      const result = { success: true, message: `Created collection "${name}"`, data: { collectionId: collection.id } };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'add_variable_mode') {
      const { collectionId, name } = params as { collectionId: string; name: string };
      const collection = selectVariableCollection(ctx.doc, collectionId);
      if (!collection) {
        const result = { success: false, message: `Collection "${collectionId}" not found` };
        console.warn(result.message); console.groupEnd();
        return result;
      }
      // Mirror VariablesEditor.handleAddMode: new modes are never default and
      // get no value backfill — variables stay empty for the mode until set.
      const mode = { id: crypto.randomUUID(), name, isDefault: false };
      ctx.takeSnapshot();
      const applied = await ctx.dispatch({ type: 'ADD_VARIABLE_MODE', collectionId, mode } as EditorCommand);
      if (applied === false) {
        const result = { success: false, message: `add_variable_mode failed for collection "${collectionId}"` };
        console.warn(result.message); console.groupEnd();
        return result;
      }
      const result = { success: true, message: `Added mode "${name}" to "${collection.name}"`, data: { modeId: mode.id } };
      console.log(result); console.groupEnd();
      return result;
    }

    // Handle add_page_content: generate ID + index, then dispatch ADD_ELEMENT
    if (commandType === 'add_page_content') {
      const { pageId, type = 'frame', tag, textContent, staticMarkup, classes, parentId, index: explicitIndex, beforeId, afterId } = params as {
        pageId: string;
        type?: string;
        tag?: string;
        textContent?: string;
        staticMarkup?: string;
        classes?: string;
        parentId?: string;
        index?: number;
        beforeId?: string;
        afterId?: string;
      };

      // Fail loudly on a bad pageId — ADD_ELEMENT would refuse it anyway, and
      // reporting success here left the AI (and user) staring at an unchanged
      // canvas after a "done" activity row.
      if (!(ctx.doc.getMap('pages') as Y.Map<unknown>).has(pageId)) {
        const result = { success: false, message: `add_page_content failed: page "${pageId}" not found. Call read_page_content to list pages.` };
        console.warn(result.message);
        console.groupEnd();
        return result;
      }

      // task-133 Task 9: files-truth runtime — the doc path below renders
      // NOTHING in a local iframe (no doc-RENDER). Resolved once here; the
      // quality guards run for both runtimes, then the local branch writes
      // the REAL file.
      const isLocalRuntime = isLocalProjectId(selectProjectId(ctx.doc) ?? '');

      // Root-level structural guards. Weak models scaffold empty containers
      // ("fill later") and spam bare fragments as separate root adds — the
      // page fills with invisible roots and one drag handle per fragment
      // (observed live: 2 empty divs, then 6 fragment roots). One add = ONE
      // complete visible section.
      let markup = staticMarkup;
      // Root frame with NO markup = an invisible div squatting on the page.
      // This exact path (schema read as "create a layout container first")
      // produced the "2 empty divs on every run, every model" litter; the
      // stray roots also break the wrapper auto-unwrap in Layers.
      if (!parentId && type === 'frame' && !markup?.trim()) {
        const result = { success: false, message: 'add_page_content failed: a page-root frame REQUIRES staticMarkup. Send the COMPLETE section (full structure, real content, CTAs) as staticMarkup in this ONE call — never add an empty container to fill later.' };
        console.warn(result.message);
        console.groupEnd();
        return result;
      }
      if (!parentId && markup?.trim()) {
        const parsedBody = new DOMParser().parseFromString(markup, 'text/html').body;
        const hasVisibleContent = !!parsedBody.textContent?.trim() ||
          !!parsedBody.querySelector('img,svg,video,iframe,canvas,input,textarea,select,button');
        if (!hasVisibleContent) {
          const result = { success: false, message: 'add_page_content failed: the markup renders EMPTY (no text or media). Send the COMPLETE section — full structure, real content, CTAs — in this ONE call. Do not scaffold empty containers to fill later.' };
          console.warn(result.message);
          console.groupEnd();
          return result;
        }
        if (parsedBody.children.length > 1) {
          // Local: multi-root markup is written verbatim (writeInsert takes
          // one markup string); data-with-props is doc-renderer machinery.
          if (!isLocalRuntime) markup = `<section data-with-props='true'>${markup}</section>`;
        } else {
          // Model-authored passthrough wrapper (<div><section>…</section></div>)
          // puts a junk "div" root row in Layers. Strip ONLY the classless
          // case — a classed div carries meaningful styling.
          const only = parsedBody.children[0];
          const hasOwnText = Array.from(only.childNodes)
            .some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
          if (only.tagName === 'DIV' && !only.getAttribute('class') && !hasOwnText &&
              only.children.length === 1 && only.children[0].tagName === 'SECTION') {
            markup = only.children[0].outerHTML;
          }
        }
      }

      if (isLocalRuntime) {
        // Same combined-params refusal as the WC anchor branch below.
        if ((beforeId !== undefined || afterId !== undefined) && parentId !== undefined) {
          const result = { success: false, message: 'add_page_content failed: beforeId/afterId position elements on their own — omit parentId' };
          console.warn(result.message);
          console.groupEnd();
          return result;
        }
        // Gap 13: beforeId/afterId are honored (scanned-key anchors); only
        // parentId/index remain meaningless for the real file.
        const placementIgnored = parentId !== undefined || explicitIndex !== undefined;
        const result = await executeLocalAddPageContent(ctx, { pageId, type, tag, textContent, classes, markup, beforeId, afterId, placementIgnored });
        if (result.success) console.log(result); else console.warn(result.message);
        console.groupEnd();
        return result;
      }

      const rootElements = selectPageRootElements(ctx.doc, pageId);
      let index: number;
      if (beforeId || afterId) {
        // Anchor placement: models handle "before/after X" far better than
        // computing array indexes. Root sections only.
        if (parentId) {
          const result = { success: false, message: 'add_page_content failed: beforeId/afterId position root sections only — omit parentId (or pass index instead)' };
          console.warn(result.message);
          console.groupEnd();
          return result;
        }
        const anchor = (beforeId ?? afterId) as string;
        const pos = rootElements.findIndex(el => el.id === anchor);
        if (pos === -1) {
          const result = { success: false, message: `add_page_content failed: anchor "${anchor}" is not a root element of page "${pageId}". Call read_page_content to list root element ids.` };
          console.warn(result.message);
          console.groupEnd();
          return result;
        }
        index = beforeId ? pos : pos + 1;
      } else if (explicitIndex !== undefined) {
        index = explicitIndex;
      } else if (parentId) {
        const elements = ctx.doc.getMap('elements') as Y.Map<Y.Map<unknown>>;
        let siblingCount = 0;
        elements.forEach(el => { if (el.get('parentId') === parentId) siblingCount++; });
        index = siblingCount;
      } else {
        index = rootElements.length;
      }

      const classTokens = classes?.split(/\s+/).filter(Boolean) ?? [];
      const classData: ClassData = { base: classTokens, sm: [], md: [], lg: [], xl: [], '2xl': [] };

      const elementId = `element-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      ctx.takeSnapshot();
      const addCommand: EditorCommand = {
        type: 'ADD_ELEMENT',
        element: {
          id: elementId,
          pageId,
          parentId: parentId ?? null,
          index,
          type: type as ElementType,
          ...(tag ? { tag } : {}),
          ...(textContent ? { textContent } : {}),
          ...(markup ? { staticMarkup: markup } : {}),
          classes: classData,
        },
      } as EditorCommand;

      // AI content is born WITHOUT static inline svgs: every convertible svg
      // becomes a real pen shape (node editing, tight bbox) in the same undo
      // step. Unconvertible svgs (multi-shape, arcs) stay inline — the
      // select-time auto-convert / manual button handles those later.
      const conversions = markup ? planElementSvgCommands(addKeysToMarkup(markup, elementId), elementId, pageId) : [];
      await acceptEditorCommands(ctx.doc, [addCommand, ...conversions], ctx.claimSnapshot?.());

      const emptyFrame = type === 'frame' && !markup?.trim();
      const result = {
        success: true,
        message: emptyFrame
          ? 'Empty frame added — it renders invisible (zero height) until you add content or size classes'
          : 'Content added to page',
        data: { elementId, ...(emptyFrame ? { emptyFrame: true } : {}) },
      };
      console.log(result);
      console.groupEnd();
      return result;
    }

    // select_page: switch the rendered page, then wait for the iframe's fresh
    // scan so subsequent reads see the new page (poll: scannedElementsRef is
    // replaced by identity on every accepted scan — see SelectionContext).
    // applyCommand (not ctx.dispatch): noSnapshot contract — same path as the
    // UI page switch in PagesContext.
    if (commandType === 'select_page') {
      const { pageId, __scanTimeoutMs } = params as { pageId: string; __scanTimeoutMs?: number };
      const pagesMap = ctx.doc.getMap('pages');
      if (!pagesMap.has(pageId)) {
        console.groupEnd();
        return { success: false, message: `select_page failed: page "${pageId}" not found. Call read_pages/read_page_content to list pages.` };
      }
      const before = ctx.getScannedElements();
      // An open master view (open_component) sits OVER the page; Editor only
      // drops it when currentPageId CHANGES, so re-selecting the current page
      // left the component's placeholder render ("Sample post") on the canvas
      // (owner report 2026-10-06). Selecting a page always shows the page.
      if (getLocalComponentViewFile()) requestPageView();
      applyCommand(ctx.doc, { type: 'SET_CURRENT_PAGE', pageId } as EditorCommand);
      const scanned = await awaitScanChange(ctx.getScannedElements, before, __scanTimeoutMs ?? SELECT_PAGE_SCAN_TIMEOUT_MS);
      console.groupEnd();
      return scanned
        ? { success: true, message: `Switched to page "${pageId}"`, data: { pageId, elementCount: ctx.getScannedElements().length } }
        : { success: true, message: `Switched to page "${pageId}" — scan pending (canvas still rendering). Retry read tools if they look stale.`, data: { pageId } };
    }

    // set_breakpoint: the same session command the breakpoint menu dispatches
    // (applyCommand, like select_page: not undoable).
    if (commandType === 'set_breakpoint') {
      const { breakpoint } = params as { breakpoint: Breakpoint };
      applyCommand(ctx.doc, { type: 'SET_BREAKPOINT', breakpoint });
      console.groupEnd();
      return { success: true, message: `Canvas is on "${breakpoint}" (${BREAKPOINTS[breakpoint]}px wide)` };
    }

    // edit_file / write_file: what the element tools cannot address —
    // imports, frontmatter, expressions, new files. ONE journaled file-batch
    // (rewriteLocalFile, shared with every whole-file write) so later
    // class/structure edits on the file keep working; ⌘Z restores the bytes.
    if (commandType === 'edit_file' || commandType === 'write_file') {
      const { path } = params as { path: string };
      console.groupEnd();
      if (!isLocalCtx(ctx)) return fail(`${commandType} needs a files-truth project.`);
      if (!/^src\/[^]+$/.test(path) || path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '' || seg === 'node_modules')) {
        return fail(`${commandType} failed: "${path}" — only files under src/ can be written.`);
      }
      const nextFrom = (current: string | null): string => {
        if (commandType === 'write_file') return (params as { content: string }).content;
        const { oldString, newString, replaceAll } = params as { oldString: string; newString: string; replaceAll?: boolean };
        if (current === null) throw new Error(`${path} does not exist — write_file creates files.`);
        if (!oldString) throw new Error('oldString is empty.');
        const parts = current.split(oldString);
        if (parts.length === 1) throw new Error(`oldString not found in ${path} — read_file it and copy the exact text.`);
        if (parts.length > 2 && !replaceAll) throw new Error(`oldString occurs ${parts.length - 1} times in ${path} — add context to make it unique, or pass replaceAll.`);
        return replaceAll ? parts.join(newString) : current.replace(oldString, () => newString);
      };
      // A posts loop the model writes gets its cards' post stamp here, not by its own memory (stampPostCards).
      let stamped = false;
      const stampedFrom = (current: string | null): string => {
        const next = nextFrom(current);
        const out = path.endsWith('.astro') ? stampPostCards(next) : next;
        stamped = out !== next;
        return out;
      };
      try {
        ctx.takeSnapshot();
        const r = await rewriteLocalFile(path, stampedFrom, ctx.claimSnapshot?.());
        if (!r.changed) return { success: true, message: `${path} unchanged` };
        const note = stamped ? ' — each posts-loop card now sits in <div class="contents" data-sq-post-slug={…}> (the editor reads the card\'s post from it: keep it; read_file before editing that loop)' : '';
        // task-270: a new file under src/pages IS a page — the doc follows the files.
        const [pageId] = r.created ? followLocalPageFiles(ctx.doc, [path]) : [];
        if (pageId) return { success: true, message: `Created ${path} — page "${pageId}" (select_page opens it)${note}`, data: { pageId } };
        return { success: true, message: `${r.created ? 'Created' : 'Wrote'} ${path}${note}` };
      } catch (err) {
        return fail(`${commandType} failed: ${err instanceof Error ? err.message : 'the file was not written'}`);
      }
    }

    // open_component: the master view (task-136/137) — the same event the
    // Assets panel fires; Editor re-points the iframe at /__sq_component_view.
    if (commandType === 'open_component') {
      const { file, __scanTimeoutMs } = params as { file: string | null; __scanTimeoutMs?: number };
      if (file !== null) {
        if (!isLocalProjectId(selectProjectId(ctx.doc) ?? '')) { console.groupEnd(); return { success: false, message: 'open_component needs a files-truth project.' }; }
        if (!/^src\/.+\.astro$/.test(file) || file.startsWith('src/pages/')) { console.groupEnd(); return { success: false, message: `open_component failed: "${file}" is not a component or layout file (src/**/*.astro outside src/pages).` }; }
        const exists = await readSourceState(selectProjectId(ctx.doc) ?? '', file).then((t) => t !== null, () => false);
        if (!exists) { console.groupEnd(); return { success: false, message: `open_component failed: ${file} does not exist — list_files.` }; }
      }
      const before = ctx.getScannedElements();
      if (file === null) requestPageView();
      else requestLocalComponentView(file);
      const scanned = await awaitScanChange(ctx.getScannedElements, before, __scanTimeoutMs ?? SELECT_PAGE_SCAN_TIMEOUT_MS);
      console.groupEnd();
      const label = file ?? 'the page';
      return scanned
        ? { success: true, message: `Canvas shows ${label}`, data: { file, elementCount: ctx.getScannedElements().length } }
        : { success: true, message: `Opening ${label} — scan pending. Retry read tools if they look stale.`, data: { file } };
    }

    // Handle add_drawn_element: build DrawnElementData (the ADD_DRAWN_ELEMENT
    // handler writes sourceClasses itself — no parallel write here).
    if (commandType === 'add_drawn_element') {
      const { tag, classes = '', textContent = '', parentKey, insertIndex = 0, pageId } = params as {
        tag: string; classes?: string; textContent?: string;
        parentKey: string | null; insertIndex?: number; pageId?: string;
      };
      const effectivePageId = pageId ?? selectCurrentPageId(ctx.doc);
      if (!effectivePageId) {
        console.groupEnd();
        return { success: false, message: 'No page available — provide pageId' };
      }

      // task-133 Task 9: local (files-truth) — a doc drawn element renders
      // NOTHING in a local iframe. REUSE the canvas-draw materialization
      // (serialize + real-file write + undo record + pending selection).
      // insertIndex is ignored — the write lands inside-end of parentKey
      // (or the page anchor), same as a user draw.
      if (isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
        const refusal = requireCurrentLocalPage(ctx, 'add_drawn_element', pageId ?? null);
        if (refusal) { console.warn(refusal.message); console.groupEnd(); return refusal; }
        // The source owner projects scan anchors through accepted edits.
        const r = await insertLocalDrawnElement({
          draw: { tag, classes, textContent, parentKey: parentKey ?? null },
          isSlotDraw: false,
          scannedElements: ctx.getScannedElements(),
          pageFile: ctx.getCurrentPageFile(),
          pushUndo: ctx.pushStructuralUndo,
        });
        if (r.ok) markLocalScanStaleAfterWrite(); // diagnostic; never an edit gate
        console.groupEnd();
        return r.ok
          ? { success: true, message: `Drew <${tag}> into ${r.file} (line ${r.insertedLine}) — the canvas rescans automatically.`, data: { file: r.file, insertedLine: r.insertedLine } }
          : { success: false, message: `add_drawn_element failed: ${r.reason}` };
      }

      const elementKey = generateDrawnKey();
      ctx.takeSnapshot();
      await ctx.dispatch({
        type: 'ADD_DRAWN_ELEMENT',
        element: {
          key: elementKey,
          tag,
          classes,
          textContent,
          parentKey,
          insertIndex,
          pageId: effectivePageId,
        },
      } as EditorCommand);
      const result = { success: true, message: `Drew <${tag}> on the page`, data: { key: elementKey } };
      console.log(result);
      console.groupEnd();
      return result;
    }

    // set_home_page shares store/homePage.ts with PagesContext.setHomePage —
    // one home of the task-060 "persist BOTH pages" invariant.
    if (commandType === 'set_home_page') {
      // Gap 24 local mode: the doc flag is session-only (seeding re-stamps
      // '/' every open) — flipping it would report a success that reverts on
      // reopen. Same honest refusal as PagesContext.setHomePage.
      if (isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
        console.groupEnd();
        return { success: false, message: `set_home_page failed: ${LOCAL_HOME_IS_INDEX}` };
      }
      const { pageId } = params as { pageId: string };
      const r = await setHomePageAndPersist({
        doc: ctx.doc,
        dispatch: ctx.dispatch,
        takeSnapshot: ctx.takeSnapshot,
        pageId,
      });
      console.groupEnd();
      if (!r.ok) {
        return { success: false, message: `set_home_page failed: page "${pageId}" not found or not eligible` };
      }
      return r.changed
        ? { success: true, message: `Page "${pageId}" is now the home page` }
        : { success: true, message: 'That page is already the home page.' };
    }

    // task-133 Task 9 follow-up: add_page in the local (files-truth) runtime.
    // A doc-only ADD_PAGE has no backing route/file — the page aliased the
    // index in the iframe and edits there source-wrote the REAL index file
    // (task-145 data-loss class). REUSE the task-145 path: createLocalDocPage
    // writes the real src/pages file FIRST (POST /__sq/local/page); the doc
    // page follows only on success — a failed write adds NOTHING, and this
    // tool reports success ONLY when the endpoint succeeded. ⌘Z is its own
    // structural step (PagesContext precedent, #17).
    if (commandType === 'add_page' && isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
      const projectId = selectProjectId(ctx.doc) ?? '';
      const requestedName =
        (params.page as { name?: string } | undefined)?.name ??
        (params.name as string | undefined) ??
        'New Page';
      const entry = findLocalProjectEntry(projectId);
      if (!entry) {
        console.groupEnd();
        return { success: false, message: 'add_page failed: this local project is not in the recents list — reopen it from the Projects page.' };
      }
      try {
        const newPageId = await createLocalDocPage(ctx.doc, entry.path, requestedName, ctx.pushStructuralUndo);
        // The page FILE must be on disk before the switch: a canvas that asks
        // for the route first gets Astro's 404 and keeps it (task-271, e2e-
        // proven: the switch came 80-150 ms before the file). Page creation
        // itself resolves at acceptance — the UI never waits on the disk — so
        // the wait lives here, with the switch.
        await awaitJournaledFiles(projectId, { agent: true });
        // Auto-switch parity with the non-local path (task-119 UX) — follow-up
        // local writes must target the new page's file (current-page law).
        const before = ctx.getScannedElements();
        applyCommand(ctx.doc, { type: 'SET_CURRENT_PAGE', pageId: newPageId } as EditorCommand);
        const scanned = await awaitScanChange(ctx.getScannedElements, before, (params.__scanTimeoutMs as number | undefined) ?? SELECT_PAGE_SCAN_TIMEOUT_MS);
        console.groupEnd();
        // switchedToPage reflects the scan-CONFIRMED switch (select_page
        // message-split parity) — never claim the canvas shows the new page
        // when the rescan hasn't landed.
        return {
          success: true,
          message: scanned
            ? `Page "${newPageId}" created — real file written under src/pages and switched to it.`
            : `Page "${newPageId}" created — real file written under src/pages; switch pending, scan pending (canvas still rendering). Retry read tools if they look stale.`,
          data: { pageId: newPageId, switchedToPage: scanned },
        };
      } catch (err) {
        console.groupEnd();
        return { success: false, message: `add_page failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // Gap 22: remove_page in the local (files-truth) runtime must delete the
    // REAL src/pages file — a doc-only DELETE_PAGE left the file on disk and
    // the page re-seeded from /__sq/local/pages on the next open (the exact
    // task-148 orphan class the UI path was fixed for). REUSE the UI path:
    // deleteLocalDocPage is file-FIRST, records the same structural undo
    // entry, and this tool reports the endpoint's refusal verbatim. No
    // takeSnapshot: ⌘Z replays the structural entry, not a doc snapshot.
    if (commandType === 'remove_page' && isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
      const projectId = selectProjectId(ctx.doc) ?? '';
      const pageId = params.pageId as string;
      const entry = findLocalProjectEntry(projectId);
      if (!entry) {
        console.groupEnd();
        return { success: false, message: 'remove_page failed: this local project is not in the recents list — reopen it from the Projects page.' };
      }
      // Finding 20: the page-file delete must not interleave with an in-flight
      // span write to the same file (the writer's read→splice→write would
      // resurrect the deleted file, or the delete's undo would hold pre-write
      // content) — take the same guard every structural span write holds.
      await acquireStructuralWrite(); // its turn behind any write in flight — never "retry"
      try {
        await deleteLocalDocPage(ctx.doc, entry.path, pageId, ctx.pushStructuralUndo, () => { ctx.takeSnapshot(); return ctx.claimSnapshot?.(); });
        console.groupEnd();
        return { success: true, message: `Page "${pageId}" deleted — its real file was removed from src/pages.` };
      } catch (err) {
        console.groupEnd();
        return { success: false, message: `remove_page failed: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        releaseStructuralWrite();
      }
    }

    // Gap 23: update_page (rename) in the local runtime renames the REAL
    // src/pages file via the host endpoint; the doc row is rekeyed only on
    // success (renameLocalDocPage — same path as the Pages-panel rename). A
    // doc-only RENAME_PAGE displayed a route that didn't exist and evaporated
    // on reopen. The page id CHANGES (ids derive from routes in local mode).
    if (commandType === 'update_page' && isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
      const projectId = selectProjectId(ctx.doc) ?? '';
      const { pageId, name } = params as { pageId: string; name: string };
      const entry = findLocalProjectEntry(projectId);
      if (!entry) {
        console.groupEnd();
        return { success: false, message: 'update_page failed: this local project is not in the recents list — reopen it from the Projects page.' };
      }
      try {
        const newId = await renameLocalDocPage(ctx.doc, entry.path, pageId, name, ctx.pushStructuralUndo);
        console.groupEnd();
        return {
          success: true,
          message: newId === pageId
            ? `Page "${pageId}" kept its route — the name maps to the same slug.`
            : `Page renamed — its src/pages file was moved; the page id is now "${newId}".`,
          data: { pageId: newId },
        };
      } catch (err) {
        console.groupEnd();
        return { success: false, message: `update_page failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // Gap 26: routes can't nest — local move_page reorders at root only
    // (the order persists through PagesContext's rootPages observer).
    if (commandType === 'move_page' && isLocalProjectId(selectProjectId(ctx.doc) ?? '') && params.newParentId) {
      console.groupEnd();
      return { success: false, message: 'move_page failed: local pages cannot be nested — a page\'s place is its file path. Omit newParentId to reorder.' };
    }

    // Gap 38 (task-148 remainder): delete_element in the local (files-truth)
    // runtime. A doc REMOVE_ELEMENT can't touch a scanned file:line:col
    // element (no doc node) and renders nothing either way — route the delete
    // through THE SAME module the Delete key uses (deleteLocalElement:
    // page-sync + in-flight guards, usage re-target, cross-file refusal,
    // verbatim-restore undo). No takeSnapshot: undo is the structural entry.
    if (commandType === 'delete_element' && isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
      const elementId = params.elementId as string;
      if (!isSourceKeyedElementKey(elementId)) {
        console.groupEnd();
        return { success: false, message: `delete_element failed: "${elementId}" is not a source key. Local elements are addressed by their scanned sourceKey (file:line:col) — call read_source_elements to list them.` };
      }
      // Preserve the scan's own/usage identity; the source owner projects it.
      const scannedByKey = new Map(ctx.getScannedElements().map(e => [e.key, e]));
      const ok = await deleteLocalElement({
        key: elementId,
        clearSelection: () => {}, // AI path holds no canvas selection
        pushUndo: ctx.pushStructuralUndo,
        scannedByKey,
      });
      console.groupEnd();
      return ok
        ? { success: true, message: `Element "${elementId}" removed from its source file — the canvas rescans automatically.` }
        : { success: false, message: `delete_element failed: the file was not changed — the target is inside a shared component or an instance copy. Retry with a page-level sourceKey from read_source_elements.` };
    }

    // Gap 38: move_element in the local runtime. REPARENT_ELEMENT is doc-only
    // — express the (newParentKey, insertIndex) gesture as a before/after
    // anchor with THE SAME planner the canvas reparent drop uses
    // (planLocalReparentInsert), then write via moveLocalElement.
    if (commandType === 'move_element' && isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
      const { pageId, elementKey, newParentKey, insertIndex } = params as {
        pageId?: string; elementKey: string; newParentKey: string | null; insertIndex: number;
      };
      const refusal = requireCurrentLocalPage(ctx, 'move_element', pageId ?? null);
      if (refusal) { console.warn(refusal.message); console.groupEnd(); return refusal; }
      if (!isSourceKeyedElementKey(elementKey)) {
        console.groupEnd();
        return { success: false, message: `move_element failed: "${elementKey}" is not a source key. Local elements are addressed by their scanned sourceKey (file:line:col) — call read_source_elements to list them.` };
      }
      // Findings 11/18: same stale-coordinates fence as delete_element — the
      // reparent plan below is computed FROM the scan.
      const scannedEls = ctx.getScannedElements();
      const parentKey = newParentKey ?? null;
      const childKeys = scannedEls.filter(el => (el.parentKey ?? null) === parentKey).map(el => el.key);
      const plan = planLocalReparentInsert(parentKey, childKeys, insertIndex, elementKey);
      if (!plan) {
        console.groupEnd();
        return { success: false, message: `move_element failed: ${NO_LOCAL_MOVE_ANCHOR}.` };
      }
      const ok = await moveLocalElement({
        key: elementKey,
        targetKey: plan.targetKey,
        position: plan.position,
        pushUndo: ctx.pushStructuralUndo,
        scannedByKey: new Map(scannedEls.map(e => [e.key, e])),
      });
      console.groupEnd();
      return ok
        ? { success: true, message: `Element moved in its source file — the canvas rescans automatically.` }
        : { success: false, message: `move_element failed: the file was not changed — the move crosses files or targets a shared component or instance copy.` };
    }

    ctx.takeSnapshot();
    const normalized = normalizeParams(commandType, params);

    // Map tool names to underlying EditorCommand types where they differ
    const commandTypeMap: Partial<Record<RegisteredCommandType, string>> = {
      add_page: 'ADD_PAGE',
      update_page: 'RENAME_PAGE',
      remove_page: 'DELETE_PAGE',
      delete_element: 'REMOVE_ELEMENT',
      delete_instance_child: 'DELETE_INSTANCE_CHILD',
      move_element: 'REPARENT_ELEMENT',
      reorder_page_elements: 'REORDER_PAGE_ELEMENTS',
      set_child_order: 'SET_CHILD_ORDER',
      set_grid_placement: 'GRID_PLACE_ELEMENT',
      update_link_attribute: 'UPDATE_LINK_ATTRIBUTE',
      unwrap_link: 'UNWRAP_LINK',
      update_image_attribute: 'UPDATE_IMAGE_ATTRIBUTE',
      update_page_seo: 'UPDATE_PAGE_SEO',
      move_page: 'MOVE_PAGE',
      delete_drawn_element: 'REMOVE_DRAWN_ELEMENT',
      delete_variable_collection: 'DELETE_VARIABLE_COLLECTION',
      rename_variable_mode: 'RENAME_VARIABLE_MODE',
      rename_variable: 'UPDATE_VARIABLE_NAME',
      retype_variable: 'UPDATE_VARIABLE_TYPE',
    };

    const dispatchType = commandTypeMap[commandType] ?? commandType;
    const command = { type: dispatchType, ...normalized } as EditorCommand;
    console.log('dispatching:', command);
    const applied = await ctx.dispatch(command);

    if (applied === false) {
      const result = {
        success: false,
        message: `${commandType} failed: target not found or invalid. Params: ${JSON.stringify(params)}`,
      };
      console.error('dispatch returned false →', result.message);
      console.groupEnd();
      return result;
    }

    // add_page auto-switches to the new page (user-approved UX, task-119) so the
    // model — and the user — land on what was just created. Same await + applyCommand
    // path as select_page (the batch snapshot was already taken above).
    // task-133 Task 9 review: switchedToPage reflects the scan-CONFIRMED
    // switch (select_page message-split parity) — a timed-out scan must not
    // read as "the canvas shows the new page".
    let addPageScanned: boolean | null = null;
    if (commandType === 'add_page') {
      const newPageId = (normalized.page as { id: string }).id;
      const before = ctx.getScannedElements();
      applyCommand(ctx.doc, { type: 'SET_CURRENT_PAGE', pageId: newPageId } as EditorCommand);
      addPageScanned = await awaitScanChange(ctx.getScannedElements, before, (params.__scanTimeoutMs as number | undefined) ?? SELECT_PAGE_SCAN_TIMEOUT_MS);
    }

    const result = {
      success: true,
      message: addPageScanned === false
        ? `${commandType} executed — switch pending, scan pending (canvas still rendering). Retry read tools if they look stale.`
        : `${commandType} executed successfully`,
      data: extractResultData(commandType, normalized, { addPageScanned }),
    };
    console.log('success', result.data ?? '');
    console.groupEnd();
    return result;
  } catch (error) {
    console.error('threw:', error);
    console.groupEnd();
    return {
      success: false,
      message: `${commandType} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Extract useful data to return to the AI after command execution.
 */
function extractResultData(
  commandType: RegisteredCommandType,
  params: Record<string, unknown>,
  extras: { addPageScanned?: boolean | null } = {},
): Record<string, unknown> | undefined {
  if (commandType === 'add_page') {
    const page = params.page as Record<string, unknown>;
    return { pageId: page?.id, pageName: page?.name, switchedToPage: extras.addPageScanned !== false };
  }
  return undefined;
}

// ============================================================================
// Blog Tool Helpers
// ============================================================================

const BLOG_SKIP_TAGS = new Set([
  'script', 'style', 'svg', 'path', 'circle', 'rect', 'line',
  'polyline', 'polygon', 'defs', 'use', 'g', 'symbol', 'clippath',
]);

/** Parse all element selectors (tag-N) and their current classes from HTML markup. */
function parseCardSelectors(markup: string): Array<{ selector: string; tag: string; classes: string }> {
  const tagCounts = new Map<string, number>();
  const result: Array<{ selector: string; tag: string; classes: string }> = [];
  const tagRegex = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let match;
  while ((match = tagRegex.exec(markup)) !== null) {
    const tag = match[1].toLowerCase();
    if (BLOG_SKIP_TAGS.has(tag)) continue;
    const count = tagCounts.get(tag) ?? 0;
    tagCounts.set(tag, count + 1);
    const classMatch = match[2].match(/class="([^"]*)"/);
    result.push({ selector: `${tag}-${count}`, tag, classes: classMatch?.[1] ?? '' });
  }
  return result;
}

/** Extract flat base-breakpoint class overrides from a :blogcard Yjs element. */
function extractFlatClassOverrides(cardEl: Y.Map<unknown> | undefined): Record<string, string> {
  if (!cardEl) return {};
  const classOverrides = cardEl.get('classOverrides') as Y.Map<unknown> | undefined;
  if (!classOverrides) return {};
  const flat: Record<string, string> = {};
  classOverrides.forEach((selectorOverride, selector) => {
    const selectorMap = selectorOverride as Y.Map<unknown>;
    const baseClasses = selectorMap?.get('base') as Y.Array<string> | undefined;
    if (baseClasses && baseClasses.length > 0) {
      flat[selector] = baseClasses.toArray().join(' ');
    }
  });
  return flat;
}

/** Resolve a collection (and optionally a field) by name, with AI-friendly errors. */
function resolveCollectionAndField(doc: Y.Doc, collectionName: string, fieldName?: string):
  | { col: ContentCollection; field?: CollectionField; error?: undefined }
  | { error: string } {
  const col = selectContentCollections(doc).find(c => c.name === collectionName);
  if (!col) return { error: `Collection "${collectionName}" not found. Use read_collections.` };
  if (fieldName === undefined) return { col };
  const field = col.fields.find(f => f.name === fieldName);
  if (!field) return { error: `Field "${fieldName}" not found in "${collectionName}". Fields: ${col.fields.map(f => f.name).join(', ')}` };
  return { col, field };
}

/**
 * Shared scaffold for schema-CRUD tools: resolve names → snapshot → dispatch →
 * re-write content.config (the create_collection pattern). Only the dispatched
 * command and result message vary per tool.
 */
async function runSchemaMutation(
  ctx: ToolExecutionContext,
  collectionName: string,
  fieldName: string | undefined,
  buildCommand: (col: ContentCollection, field?: CollectionField) => EditorCommand,
  successMessage: string,
  data?: Record<string, unknown>,
): Promise<ToolCallResult> {
  const resolved = resolveCollectionAndField(ctx.doc, collectionName, fieldName);
  if (resolved.error !== undefined) {
    const result = { success: false, message: resolved.error };
    console.warn(result.message); console.groupEnd();
    return result;
  }
  ctx.takeSnapshot();
  await ctx.dispatch(buildCommand(resolved.col, resolved.field));
  await contentOps.writeContentConfig(selectContentCollections(ctx.doc));
  const result = { success: true, message: successMessage, ...(data ? { data } : {}) };
  console.log(result); console.groupEnd();
  return result;
}

// ============================================================================
// Blog Read Query Execution
// ============================================================================

async function executeBlogReadQuery(
  doc: Y.Doc,
  commandType: string,
  params: Record<string, unknown>,
  currentPageId: string | null,
): Promise<unknown> {
  if (commandType === 'read_collections') {
    const all = selectContentCollections(doc);
    const filtered = params.collectionName
      ? all.filter(c => c.name === params.collectionName)
      : all;
    return {
      collections: filtered.map(c => ({
        id: c.id,
        name: c.name,
        fields: c.fields.map(f => ({ name: f.name, type: f.type })),
      })),
    };
  }

  if (commandType === 'read_collection_posts') {
    const { collectionName } = params as { collectionName: string };
    const discovered = await contentOps.fetchCollections();
    const col = discovered.find(c => c.name === collectionName);
    if (!col) return { error: `Collection "${collectionName}" not found on disk` };
    return {
      posts: col.posts.map(p => ({ slug: p.slug, frontmatter: p.frontmatter })),
      count: col.posts.length,
    };
  }

  if (commandType === 'read_blog_slots') {
    const pageId = (params.pageId as string | undefined) ?? currentPageId;
    if (!pageId) return { error: 'No page ID available — provide pageId or navigate to a page' };
    const elements = selectPageDrawnElements(doc, pageId);
    const blogEls = elements.filter(el => el.slotType === 'blog');
    const collections = selectContentCollections(doc);
    const slots = blogEls.map(el => {
      const binding = readBlogSlotBinding(doc, el.key);
      const col = binding ? collections.find(c => c.id === binding.collectionId) : null;
      const cardMarkup = selectResolvedStaticMarkup(doc, el.key + ':blogcard');
      const cardSelectors = cardMarkup
        ? parseCardSelectors(cardMarkup).map(s => s.selector)
        : [];
      return {
        slotKey: el.key,
        collectionId: binding?.collectionId ?? null,
        collectionName: col?.name ?? null,
        settings: binding?.settings ?? null,
        cardSelectors,
      };
    });
    return { slots, count: slots.length };
  }

  if (commandType === 'read_blog_card_template') {
    const { slotKey } = params as { slotKey: string };
    const cardId = slotKey + ':blogcard';
    const markup = selectResolvedStaticMarkup(doc, cardId);
    if (!markup) return { error: `No blog card template found for slot "${slotKey}". Bind a collection first.` };
    const selectors = parseCardSelectors(markup);
    const elements = doc.getMap('elements');
    const cardEl = elements.get(cardId) as Y.Map<unknown> | undefined;
    const overridesMap = cardEl?.get('classOverrides') as Y.Map<unknown> | undefined;
    const hasOverrides = (overridesMap?.size ?? 0) > 0;
    return { selectors, hasOverrides };
  }

  if (commandType === 'read_post_page') {
    const { pageId } = params as { pageId: string };
    const binding = selectPostPageBinding(doc, pageId);
    if (!binding) return { error: `Page "${pageId}" is not a post page or has no binding` };
    return binding;
  }

  return { error: `Unknown blog read query: ${commandType}` };
}

// ============================================================================
// Blog Write Command Execution
// ============================================================================

async function executeBlogCommand(
  ctx: ToolExecutionContext,
  commandType: string,
  params: Record<string, unknown>,
): Promise<ToolCallResult> {
  console.group(`[AI:blog] ${commandType}`);
  console.log('params:', params);

  try {
    if (commandType === 'create_collection') {
      const { name, fields: rawFields } = params as {
        name: string;
        fields?: Array<{ name: string; type: string }>;
      };
      const fields: CollectionField[] = rawFields
        ? rawFields.map((f, i) => ({
            id: `field-${Date.now()}-${i}`,
            name: f.name,
            type: f.type as CollectionField['type'],
            required: false,
          }))
        : DEFAULT_FIELDS;
      const collectionId = `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const collection: ContentCollection = {
        id: collectionId,
        name,
        fields,
        createdAt: new Date().toISOString(),
      };
      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'ADD_CONTENT_COLLECTION', collection } as EditorCommand);
      const allCollections = selectContentCollections(ctx.doc);
      await contentOps.writeContentConfig(allCollections);
      const result = { success: true, message: `Created collection "${name}"`, data: { collectionId } };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'create_post') {
      const { collectionName, slug, frontmatter, body = '' } = params as {
        collectionName: string;
        slug: string;
        frontmatter: Record<string, string>;
        body?: string;
      };
      const stackRefusal = await ensureStackFor(ctx, body);
      if (stackRefusal) { console.groupEnd(); return stackRefusal; }
      await contentOps.createPost(collectionName, slug, frontmatter, body);
      const result = { success: true, message: `Created post "${slug}" in "${collectionName}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'update_post') {
      const { collectionName, slug, frontmatter: newFrontmatter, body: newBody } = params as {
        collectionName: string;
        slug: string;
        frontmatter?: Record<string, string>;
        body?: string;
      };
      // Fetch existing post to merge
      const discovered = await contentOps.fetchCollections();
      const col = discovered.find(c => c.name === collectionName);
      const post = col?.posts.find(p => p.slug === slug);
      if (!post) {
        const result = { success: false, message: `Post "${slug}" not found in "${collectionName}"` };
        console.warn(result.message); console.groupEnd();
        return result;
      }
      const mergedFrontmatter = { ...post.frontmatter, ...(newFrontmatter ?? {}) };
      const body = newBody ?? post.body;
      const stackRefusal = await ensureStackFor(ctx, body);
      if (stackRefusal) { console.groupEnd(); return stackRefusal; }
      await contentOps.updatePost(collectionName, slug, mergedFrontmatter, body, { baseline: { frontmatter: post.frontmatter, body: post.body } });
      const result = { success: true, message: `Updated post "${slug}" in "${collectionName}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'delete_post') {
      const { collectionName, slug } = params as { collectionName: string; slug: string };
      ctx.takeSnapshot(); // ⌘Z brings the exact bytes back
      await contentOps.deletePost(collectionName, slug, ctx.claimSnapshot?.());
      const result = { success: true, message: `Deleted post "${slug}" from "${collectionName}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'update_blog_card_classes') {
      const { slotKey, selector, classes } = params as {
        slotKey: string;
        selector: string;
        classes: string;
      };
      ctx.takeSnapshot();
      await ctx.dispatch({
        type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
        instanceId: slotKey + ':blogcard',
        selector,
        breakpoint: 'base',
        classes: classes.split(/\s+/).filter(Boolean),
      } as EditorCommand);
      const result = { success: true, message: `Updated classes on "${selector}" in blog card` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'update_blog_settings') {
      const { slotKey, ...rawSettings } = params as { slotKey: string; [key: string]: unknown };
      const settings = Object.fromEntries(
        Object.entries(rawSettings).filter(([, v]) => v !== undefined),
      );
      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey, settings } as EditorCommand);
      const result = { success: true, message: `Updated blog slot settings for "${slotKey}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'bind_blog_collection') {
      const { slotKey, collectionName } = params as { slotKey: string; collectionName: string };
      const collections = selectContentCollections(ctx.doc);
      const col = collections.find(c => c.name === collectionName);
      if (!col) {
        const result = { success: false, message: `Collection "${collectionName}" not found. Use read_collections to see available collections.` };
        console.warn(result.message); console.groupEnd();
        return result;
      }
      // Fetch BlogCard library HTML for new bindings
      let cardMarkup: string | undefined;
      try {
        const resp = await fetch('/__sq/component-html?path=library/BlogCard.astro');
        if (resp.ok) cardMarkup = await resp.text();
      } catch {
        // cardMarkup stays undefined — SET_BLOG_SLOT_COLLECTION will skip card creation if element exists
      }
      ctx.takeSnapshot();
      await ctx.dispatch({
        type: 'SET_BLOG_SLOT_COLLECTION',
        slotKey,
        collectionId: col.id,
        ...(cardMarkup ? { cardMarkup, cardAstroSource: 'library/BlogCard.astro' } : {}),
      } as EditorCommand);
      const result = { success: true, message: `Bound slot "${slotKey}" to collection "${collectionName}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'add_collection_field') {
      const { collectionName, fieldName, fieldType } = params as { collectionName: string; fieldName: string; fieldType: CollectionField['type'] };
      const field: CollectionField = {
        id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: fieldName,
        type: fieldType,
        required: false,
      };
      return runSchemaMutation(ctx, collectionName, undefined,
        (col) => ({ type: 'ADD_COLLECTION_FIELD', collectionId: col.id, field } as EditorCommand),
        `Added field "${fieldName}" (${fieldType}) to "${collectionName}"`,
        { fieldId: field.id });
    }

    if (commandType === 'rename_collection_field') {
      const { collectionName, fieldName, newName } = params as { collectionName: string; fieldName: string; newName: string };
      return runSchemaMutation(ctx, collectionName, fieldName,
        (col, field) => ({ type: 'RENAME_COLLECTION_FIELD', collectionId: col.id, fieldId: field!.id, name: newName } as EditorCommand),
        `Renamed field "${fieldName}" to "${newName}" in "${collectionName}"`);
    }

    if (commandType === 'delete_collection_field') {
      const { collectionName, fieldName } = params as { collectionName: string; fieldName: string };
      return runSchemaMutation(ctx, collectionName, fieldName,
        (col, field) => ({ type: 'DELETE_COLLECTION_FIELD', collectionId: col.id, fieldId: field!.id } as EditorCommand),
        `Deleted field "${fieldName}" from "${collectionName}"`);
    }

    if (commandType === 'rename_collection') {
      const { collectionName, newName } = params as { collectionName: string; newName: string };
      return runSchemaMutation(ctx, collectionName, undefined,
        (col) => ({ type: 'RENAME_CONTENT_COLLECTION', collectionId: col.id, name: newName } as EditorCommand),
        `Renamed collection "${collectionName}" to "${newName}"`);
    }

    if (commandType === 'delete_collection') {
      const { collectionName } = params as { collectionName: string };
      return runSchemaMutation(ctx, collectionName, undefined,
        (col) => ({ type: 'DELETE_CONTENT_COLLECTION', collectionId: col.id } as EditorCommand),
        `Deleted collection "${collectionName}" (post pages deleted, blog slots unbound; markdown files on disk kept)`);
    }

    if (commandType === 'bind_content_field') {
      const { elementKey, slotKey, fieldName } = params as { elementKey: string; slotKey: string; fieldName: string };
      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'SET_CONTENT_BINDING', elementKey, slotKey, fieldName } as EditorCommand);
      const result = { success: true, message: `Bound "${elementKey}" to field "${fieldName}"` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'unbind_blog_slot') {
      const { slotKey } = params as { slotKey: string };
      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'UNBIND_BLOG_SLOT', slotKey } as EditorCommand);
      const result = { success: true, message: `Unbound blog slot "${slotKey}" — it keeps its settings and shows a blank placeholder card` };
      console.log(result); console.groupEnd();
      return result;
    }

    if (commandType === 'set_post_page_binding') {
      const { pageId, elementKey, fieldName } = params as {
        pageId: string;
        elementKey: string;
        fieldName: string;
      };
      const existing = selectPostPageBinding(ctx.doc, pageId);
      if (!existing) {
        const result = { success: false, message: `Page "${pageId}" has no post-page binding. Use read_post_page to verify it is a post page.` };
        console.warn(result.message); console.groupEnd();
        return result;
      }
      ctx.takeSnapshot();
      await ctx.dispatch({ type: 'SET_POST_PAGE_BINDING', pageId, elementKey, fieldName } as EditorCommand);
      const result = { success: true, message: `Bound element "${elementKey}" to field "${fieldName}" on post page` };
      console.log(result); console.groupEnd();
      return result;
    }

    const result = { success: false, message: `Unknown blog command: ${commandType}` };
    console.groupEnd();
    return result;
  } catch (error) {
    console.error('threw:', error);
    console.groupEnd();
    return {
      success: false,
      message: `${commandType} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Layout Command Execution
// ============================================================================

async function executeLayoutCommand(
  ctx: ToolExecutionContext,
  commandType: string,
  params: Record<string, unknown>,
): Promise<ToolCallResult | Record<string, unknown>> {
  console.group(`[AI:layout] ${commandType}`);
  console.log('params:', params);

  try {
    // Gap 38: SET_PAGE_LAYOUT is a doc command and local iframes never
    // receive doc-derived RENDER — the dispatch below would report success
    // with zero visible effect, and the doc row evaporates on reopen (files
    // are truth). The ⌘K picker now applies layouts by rewriting the page
    // file (applyLocalPageLayout), but this tool context does not thread the
    // pageFile/pushUndo plumbing that path needs — refuse honestly and point
    // the user at the picker instead of lying.
    if (
      (commandType === 'apply_layout' || commandType === 'detach_layout' || commandType === 'set_layout_props') &&
      isLocalProjectId(selectProjectId(ctx.doc) ?? '')
    ) {
      console.groupEnd();
      return { success: false, message: `${commandType} failed: page layouts in local projects live in each page's real Astro source, which this AI tool cannot rewrite yet. Ask the user to pick the layout from the ⌘K picker — that applies it to the real page file.` };
    }

    if (commandType === 'read_layouts') {
      const result = {
        layouts: ctx.layoutLibrary.map(l => ({
          name: l.name,
          props: l.props.map(p => ({ name: p.name, type: p.type, defaultValue: p.defaultValue })),
          slots: l.slots,
        })),
      };
      console.groupEnd();
      return result;
    }

    if (commandType === 'apply_layout') {
      const { pageId, layoutName } = params as { pageId: string; layoutName: string };
      const layout = ctx.layoutLibrary.find(l => l.name === layoutName);
      if (!layout) {
        const available = ctx.layoutLibrary.map(l => l.name).join(', ') || '(none)';
        console.groupEnd();
        return { success: false, message: `Layout "${layoutName}" not found. Available: ${available}` };
      }
      // Picker parity (Editor layout-drop branch): seed prop values from the
      // layout's declared defaults.
      const layoutProps: Record<string, string> = {};
      for (const p of layout.props ?? []) {
        if (p.defaultValue != null) layoutProps[p.name] = p.defaultValue;
      }
      ctx.takeSnapshot();
      const applied = await ctx.dispatch({ type: 'SET_PAGE_LAYOUT', pageId, layoutName, layoutProps } as EditorCommand);
      console.groupEnd();
      return applied === false
        ? { success: false, message: `apply_layout failed — page "${pageId}" not found?` }
        : { success: true, message: `Applied layout "${layoutName}" to page` };
    }

    if (commandType === 'detach_layout') {
      const { pageId } = params as { pageId: string };
      ctx.takeSnapshot();
      const applied = await ctx.dispatch({ type: 'SET_PAGE_LAYOUT', pageId, layoutName: null } as EditorCommand);
      console.groupEnd();
      return applied === false
        ? { success: false, message: `detach_layout failed — page "${pageId}" not found?` }
        : { success: true, message: 'Layout detached — page content kept' };
    }

    if (commandType === 'set_layout_props') {
      const { pageId, props } = params as { pageId: string; props: Record<string, string> };
      // PageLayoutBlock parity: merge into existing props under the current layout.
      const { layoutName, layoutProps } = selectPageLayout(ctx.doc, pageId);
      if (!layoutName) {
        console.groupEnd();
        return { success: false, message: `Page "${pageId}" has no layout — apply one first with apply_layout` };
      }
      ctx.takeSnapshot();
      await ctx.dispatch({
        type: 'SET_PAGE_LAYOUT',
        pageId,
        layoutName,
        layoutProps: { ...layoutProps, ...props },
      } as EditorCommand);
      console.groupEnd();
      return { success: true, message: `Updated layout props on "${layoutName}"` };
    }

    console.groupEnd();
    return { success: false, message: `Unknown layout command: ${commandType}` };
  } catch (error) {
    console.error('threw:', error);
    console.groupEnd();
    return {
      success: false,
      message: `${commandType} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Instance Lifecycle Command Execution (async)
// ============================================================================

/** Markup shape produced when a :4321 squatter poisons the component scan. */
const BARE_ROOT_DIV_RE = /^<div[^>]*\bid="root"[^>]*>\s*<\/div>$/i;

async function executeInstanceCommand(
  ctx: ToolExecutionContext,
  commandType: string,
  params: Record<string, unknown>,
): Promise<ToolCallResult> {
  console.group(`[AI:instance] ${commandType}`);
  console.log('params:', params);

  try {
    if (commandType === 'reset_instance') {
      const { instanceId } = params as { instanceId: string };
      const yEl = ctx.doc.getMap('elements').get(instanceId) as Y.Map<unknown> | undefined;
      if (!yEl) {
        console.groupEnd();
        return { success: false, message: `Instance "${instanceId}" not found. Use read_page_content to list elements.` };
      }
      const r = await resetInstanceToOriginal({
        doc: ctx.doc,
        dispatch: ctx.dispatch,
        takeSnapshot: ctx.takeSnapshot,
        instanceId,
        currentPageId: (yEl.get('pageId') as string | undefined) ?? selectCurrentPageId(ctx.doc),
        isBlogSlot: yEl.get('componentType') === BLOG_SLOT_COMPONENT_TYPE,
        builtIn: ctx.componentLibrary,
      });
      console.groupEnd();
      return r.ok
        ? { success: true, message: `Reset instance "${instanceId}" to master` }
        : { success: false, message: r.reason ?? 'Reset failed' };
    }

    if (commandType === 'make_component') {
      // Files-truth projects never reach here: localSourceTools owns make_component there.
      const { key, pageId } = params as { key: string; pageId?: string };
      const effectivePageId = pageId ?? selectCurrentPageId(ctx.doc);
      if (!effectivePageId) {
        console.groupEnd();
        return { success: false, message: 'No page available — provide pageId' };
      }
      // task-121: steer instead of an opaque serialize failure on non-drawn elements
      const yTarget = ctx.doc.getMap('elements').get(key) as Y.Map<unknown> | undefined;
      if (yTarget && !yTarget.get('isDrawn')) {
        console.groupEnd();
        return {
          success: false,
          message: `"${key}" is not a drawn element — make_component only converts draw-tool elements. To create a component from markup, use create_component.`,
        };
      }
      const r = await makeComponentFromDrawn({
        doc: ctx.doc,
        currentPageId: effectivePageId,
        key,
        existingNames: ctx.componentLibrary.map(c => c.name),
        takeSnapshot: ctx.takeSnapshot,
      });
      console.groupEnd();
      return r.ok
        ? { success: true, message: `Component "${r.componentName}" created`, data: { componentName: r.componentName, instanceId: r.instanceId } }
        : { success: false, message: r.reason ?? 'make_component failed' };
    }

    if (commandType === 'create_component') {
      const { name, staticMarkup, replaceElementId, pageId, category } = params as { name: string; staticMarkup: string; replaceElementId?: string; pageId?: string; category?: string };
      // Files-truth (local) runtime, 2026-09-21: REUSE the ⌘K theme-template
      // path — the markup IS the source. insertLocalComponent materializes
      // `src/components/<Name>.astro` (same-name file reused, never
      // overwritten), writes the import + `<Name />` into the page file and,
      // with replaceElementId (a scanned sourceKey), removes the replaced
      // element in the same guarded sequence (DragGutter Replace semantics).
      // Before this the tool refused every local project outright.
      if (isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
        const refusal = requireCurrentLocalPage(ctx, 'create_component', pageId ?? null);
        if (refusal) { console.groupEnd(); return refusal; }
        const localProjectPath = findLocalProjectEntry(selectProjectId(ctx.doc) ?? '')?.path ?? null;
        if (!localProjectPath) {
          console.groupEnd();
          return { success: false, message: 'create_component failed: this local project is not in the recents list — reopen it from the Projects page.' };
        }
        const scanned = ctx.getScannedElements();
        if (replaceElementId && !scanned.some(el => el.key === replaceElementId || el.sourceKey === replaceElementId)) {
          console.groupEnd();
          return { success: false, message: `create_component failed: replaceElementId "${replaceElementId}" is not on the current page. Call read_source_elements to list keys, or omit it to append at the end.` };
        }
        const template: ThemeComponentTemplate = {
          id: `ai-${name}`, name, category: category ?? '', image: '', html: staticMarkup, themeId: 'ai', componentPath: '',
        };
        const r = await insertLocalComponent({
          component: template,
          selection: null,
          scannedElements: scanned,
          pageFile: ctx.getCurrentPageFile(),
          pushUndo: ctx.pushStructuralUndo,
          localProjectPath,
          replaceKey: replaceElementId ?? null,
          scannedByKey: new Map(scanned.map(e => [e.key, e])),
        });
        if (r.ok) markLocalScanStaleAfterWrite();
        console.groupEnd();
        return r.ok
          ? { success: true, message: `Component "${name}" created under src/components/ and placed${replaceElementId ? ` in place of "${replaceElementId}"` : ''} — written to ${r.file} (line ${r.insertedLine}); the canvas rescans automatically.${category ? ' (category is not applied in local projects — use set_component_category)' : ''}`, data: { file: r.file, insertedLine: r.insertedLine } }
          : { success: false, message: `create_component failed: ${r.reason}` };
      }
      const effectivePageId = pageId ?? selectCurrentPageId(ctx.doc);
      if (!effectivePageId) {
        console.groupEnd();
        return { success: false, message: 'No page available — provide pageId' };
      }
      const r = await createComponentFromMarkup({
        doc: ctx.doc, currentPageId: effectivePageId, name, staticMarkup,
        existingNames: ctx.componentLibrary.map(c => c.name),
        replaceElementId, category, takeSnapshot: ctx.takeSnapshot,
      });
      console.groupEnd();
      return r.ok
        ? { success: true, message: `Component "${r.componentName}" created`, data: { componentName: r.componentName, instanceId: r.instanceId } }
        : { success: false, message: r.reason ?? 'create_component failed' };
    }

    if (commandType === 'set_component_category') {
      const { componentPath, category } = params as { componentPath: string; category: string | null };
      const component = ctx.componentLibrary.find(c => c.path === componentPath || c.name === componentPath);
      if (!component) {
        const available = ctx.componentLibrary.slice(0, 30).map(c => c.path).join(', ');
        console.groupEnd();
        return { success: false, message: `Component "${componentPath}" not found in the library. Available: ${available}` };
      }
      // Writes the folder MANIFEST, not an @category tag on the file (the old
      // /__sq/set-component-category is gone). Same contract to the model;
      // multi-word names now work, because the manifest holds the name.
      const projectId = selectProjectId(ctx.doc) ?? '';
      const localPath = findLocalProjectEntry(projectId)?.path ?? null;
      const urls = folderManifestUrls(localPath);

      const library = ctx.componentLibrary.map(entry => ({ ...entry }));
      const plan = (manifest: FolderManifest): FolderManifest => {
        // Materialize first, or a find-or-create by name would mint a SECOND
        // folder alongside the @category folder of the same name.
        const { manifest: base } = materializeTree(
          manifest,
          resolveFolderTree(library, manifest),
        );

        let target = base;
        let folderId: string | null = null;
        if (category !== null) {
          const existing = Object.entries(base.folders).find(([, n]) => n.name === category);
          if (existing) {
            folderId = existing[0];
          } else {
            folderId = newFolderId();
            target = {
              ...base,
              roots: [...base.roots, folderId],
              folders: { ...base.folders, [folderId]: { name: category, children: [] } },
            };
          }
        }
        const list = folderId ? target.folders[folderId].children : target.roots;
        return planFolderMove(target, {
          selectedIds: [componentItemId(component.path)],
          targetFolderId: folderId,
          insertIndex: list.length,
        });
      };
      try {
        if (isLocalProjectId(projectId)) {
          await acceptFolderManifest(projectId, `wc://${projectId}`, plan);
        } else {
          const next = plan(parseManifest(await (await urls.fetch(urls.get)).json()));
          const resp = await urls.fetch(urls.post, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(urls.body(next)),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            console.groupEnd();
            return { success: false, message: `set_component_category failed: ${(err as { error?: string }).error ?? resp.status}` };
          }
        }
      } catch (e) {
        console.groupEnd();
        return { success: false, message: `set_component_category failed: ${e instanceof Error ? e.message : String(e)}` };
      }

      console.groupEnd();
      return {
        success: true,
        message: category
          ? `Moved "${component.name}" into folder "${category}"`
          : `Removed "${component.name}" from its folder`,
      };
    }

    if (commandType === 'place_component_instance') {
      const { componentPath, pageId, targetKey, collectionName } = params as { componentPath: string; pageId?: string; targetKey?: string; collectionName?: string };
      const effectivePageId = pageId ?? selectCurrentPageId(ctx.doc);
      if (!effectivePageId) {
        console.groupEnd();
        return { success: false, message: 'No page available — provide pageId' };
      }
      const component = ctx.componentLibrary.find(c => c.path === componentPath || c.name === componentPath);
      if (!component) {
        const available = ctx.componentLibrary.slice(0, 30).map(c => c.path).join(', ');
        console.groupEnd();
        return { success: false, message: `Component "${componentPath}" not found in the library. Available: ${available}` };
      }
      // ⚠️ A :4321 squatter can poison the component scan — its html becomes
      // the squatter's app shell. Never insert that.
      if (BARE_ROOT_DIV_RE.test(component.html.trim())) {
        console.groupEnd();
        return { success: false, message: `Component "${component.name}" scanned as a bare div#root — its markup is poisoned (check for an unrelated server on :4321). Not inserting.` };
      }

      // task-133 Task 9: local (files-truth) — a doc instance renders NOTHING
      // in a local iframe. Only the project's OWN components exist as real
      // files; REUSE the ⌘K insert flow (import + lineDelta-adjusted insert +
      // guard + undo record + pending selection). Null selection = v0
      // page-anchor placement (append at the end of the page).
      if (isLocalProjectId(selectProjectId(ctx.doc) ?? '')) {
        const refusal = requireCurrentLocalPage(ctx, 'place_component_instance', pageId ?? null);
        if (refusal) { console.warn(refusal.message); console.groupEnd(); return refusal; }
        // Refused before any write: an unknown target / collection must not leave a half-done list behind.
        const target = targetKey ? findScannedByKey(ctx.getScannedElements(), targetKey) : null;
        if (targetKey && !target) { console.groupEnd(); return fail(`Element "${targetKey}" is not on the current canvas — read_source_elements for keys.`); }
        if (collectionName && component.name !== BLOG_SLOT_COMPONENT_TYPE) { console.groupEnd(); return fail('collectionName is for a BlogSlot only.'); }
        if (collectionName && !(await contentOps.fetchCollections()).some(c => c.name === collectionName)) {
          console.groupEnd(); return fail(`Collection "${collectionName}" not found — read_collections (create_collection makes one).`);
        }
        // Gaps 11/36: built-in/theme components MATERIALIZE into the project's
        // src/components/ inside insertLocalComponent when the project path is
        // known — same threading as Editor.handleSelectComponent. Folder not
        // in recents ⇒ null ⇒ the module's own honest refusal stands.
        // The source owner projects scan anchors through accepted edits.
        const localProjectPath =
          findLocalProjectEntry(selectProjectId(ctx.doc) ?? '')?.path ?? null;
        const r = await insertLocalComponent({
          component,
          selection: target ?? null,
          scannedElements: ctx.getScannedElements(),
          pageFile: ctx.getCurrentPageFile(),
          pushUndo: ctx.pushStructuralUndo,
          localProjectPath,
        });
        if (r.ok) markLocalScanStaleAfterWrite(); // diagnostic; never an edit gate
        console.groupEnd();
        if (r.ok && collectionName) {
          const bound = await bindPlacedBlogSlot(ctx, r.file, r.insertedLine, collectionName);
          return bound.success
            ? { success: true, message: `Placed a BlogSlot in ${r.file} (line ${r.insertedLine}) showing "${collectionName}".`, data: { file: r.file, insertedLine: r.insertedLine } }
            : bound;
        }
        return r.ok
          ? { success: true, message: `Placed "${component.name}" — written to ${r.file} (line ${r.insertedLine}); the canvas rescans automatically.`, data: { file: r.file, insertedLine: r.insertedLine } }
          : { success: false, message: `place_component_instance failed: ${r.reason}` };
      }

      const elementId = generateId();
      const index = selectPageRootElements(ctx.doc, effectivePageId).length;
      ctx.takeSnapshot();
      // Same path as the ⌘K picker (Editor/LeftSidebar): buildAddCommand
      // discriminates theme templates vs local library components.
      const command = buildAddCommand({
        elementId,
        pageId: effectivePageId,
        component,
        parentId: null,
        index,
        resolveComponent: (name) => ctx.componentLibrary.find(c => c.name === name),
      });
      const applied = await ctx.dispatch(command);
      console.groupEnd();
      return applied === false
        ? { success: false, message: `Failed to place "${component.name}" — page "${effectivePageId}" not found?` }
        : { success: true, message: `Placed "${component.name}" on the page`, data: { elementId } };
    }

    if (commandType === 'push_instance_to_source') {
      const { instanceId } = params as { instanceId: string };
      const yEl = ctx.doc.getMap('elements').get(instanceId) as Y.Map<unknown> | undefined;
      if (!yEl) {
        console.groupEnd();
        return { success: false, message: `Instance "${instanceId}" not found` };
      }
      const astroSource = (yEl.get('astroSource') as string | undefined) ?? null;
      if (!astroSource) {
        console.groupEnd();
        return { success: false, message: `Instance "${instanceId}" has no astroSource — cannot push` };
      }
      const r = await pushInstanceToSource({
        doc: ctx.doc,
        dispatch: ctx.dispatch,
        takeSnapshot: ctx.takeSnapshot,
        instanceId,
        astroSource,
        currentPageId: (yEl.get('pageId') as string | undefined) ?? selectCurrentPageId(ctx.doc),
      });
      console.groupEnd();
      return r.ok
        ? { success: true, message: `Pushed instance overrides to ${astroSource} — all instances now share them` }
        : { success: false, message: r.reason ?? 'Push failed' };
    }

    console.groupEnd();
    return { success: false, message: `Unknown instance command: ${commandType}` };
  } catch (error) {
    console.error('threw:', error);
    console.groupEnd();
    return {
      success: false,
      message: `${commandType} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Project Command Execution (async, non-Yjs — never snapshots)
// ============================================================================

async function executeProjectCommand(
  ctx: ToolExecutionContext,
  commandType: string,
  params: Record<string, unknown>,
): Promise<ToolCallResult> {
  console.group(`[AI:project] ${commandType}`);
  console.log('params:', params);

  try {
    if (commandType === 'rename_project') {
      const { name } = params as { name: string };
      const projectId = selectProjectId(ctx.doc);
      if (!projectId) {
        console.groupEnd();
        return { success: false, message: 'No active project' };
      }
      await renameProject(projectId, name);
      console.groupEnd();
      return { success: true, message: `Project renamed to "${name}"` };
    }

    if (commandType === 'export_project') {
      const projectId = selectProjectId(ctx.doc) ?? '';
      await awaitProjectFiles(projectId, { agent: true });
      await downloadFilesTruthZip(projectId, selectProjectName(ctx.doc) || 'project', ctx.doc);
      console.groupEnd();
      return { success: true, message: 'Export ZIP of the project files downloaded' };
    }

    if (commandType === 'deploy_project') {
      const token = getToken('vercel');
      if (!token) {
        console.groupEnd();
        return { success: false, message: 'No Vercel token saved. Publish the site from the Publish window instead.' };
      }
      const projectName = selectProjectName(ctx.doc) || 'project';
      // The deploy input IS the project rows (Deploy modal parity); Vercel builds it.
      const projectId = selectProjectId(ctx.doc) ?? '';
      await awaitProjectFiles(projectId, { agent: true });
      const artifacts = await projectFilesAsArtifacts(projectId, projectName, ctx.doc);
      const { url } = await deployToVercel({ files: artifacts.files, binaries: artifacts.binaries, token, projectName });
      console.groupEnd();
      return { success: true, message: `Deployed to ${url}`, data: { url } };
    }

    console.groupEnd();
    return { success: false, message: `Unknown project command: ${commandType}` };
  } catch (error) {
    console.error('threw:', error);
    console.groupEnd();
    return {
      success: false,
      message: `${commandType} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Image Tools (task-119): Pexels stock search + AI image generation
// ============================================================================

/** Read tool — returns data/error objects for the LLM, never throws. */
async function executeStockSearch(params: Record<string, unknown>): Promise<unknown> {
  const config = loadAIConfig();
  if (!config?.pexelsApiKey) return { error: 'Pexels API key not configured (AI settings)' };
  try {
    const photos = await searchStockImages(params.query as string, config.pexelsApiKey, {
      orientation: params.orientation as 'landscape' | 'portrait' | 'square' | undefined,
      count: params.count as number | undefined,
    });
    if (photos.length === 0) {
      return { photos: [], note: 'No results. Retry with broader keywords, or use generate_image if available.' };
    }
    return { photos };
  } catch (err) {
    return { error: `Stock search failed: ${String(err)}. Continue without stock images or try generate_image.` };
  }
}

/** noSnapshot write — generates bytes, ingests via the ONE asset-upload path.
 *  abortSignal (from the SDK's tool-execute options) cancels the in-flight
 *  provider request so Stop doesn't leave a billed generation + orphan asset. */
async function executeGenerateImage(
  ctx: ToolExecutionContext,
  _commandType: RegisteredCommandType,
  params: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<ToolCallResult> {
  const gen = resolveImageGen(loadAIConfig());
  if (!gen) return { success: false, message: 'No image-capable provider configured (AI settings).' };
  try {
    const img = await generateImage(params.prompt as string, (params.orientation as ImageOrientation) ?? 'square', gen, { signal: abortSignal });
    // Run cancelled mid-generation: drop the bytes rather than upload an asset
    // and transfer it into the iframe after the user hit Stop.
    if (abortSignal?.aborted) return { success: false, cancelled: true, message: 'Image generation cancelled.' };
    const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const file = new File([img.bytes as BlobPart], `ai-generated-${Date.now()}.${ext}`, { type: img.mimeType });
    const projectId = selectProjectId(ctx.doc) ?? '';
    let srcValue: string;
    let assetId: string | undefined;
    if (isLocalProjectId(projectId)) {
      // Local law: no Dexie for local_ ids — bytes land in the folder's own
      // public/uploads and the applied src is a plain URL the real site serves.
      const { src } = await uploadLocalAssetFile(projectId, file);
      srcValue = src;
    } else {
      ({ assetId } = await uploadAssetBlob(projectId, file));
      await transferAssetToIframe(assetId, file);
      srcValue = `sq-asset:${assetId}`;
    }

    // Auto-apply when the caller named the target: eliminates the extra LLM
    // round-trip (and the src the model would otherwise transcribe by
    // hand into update_image_attribute — a frequent broken-image cause).
    const elementId = params.elementId as string | undefined;
    // The reducer silently no-ops a missing instance target, so check it here:
    // a vanished target falls back to the model-applies message (which carries
    // the src) instead of reporting an apply that never happened.
    const target = elementId ? parseKey(elementId) : null;
    const targetExists = !!target && (target.type === 'source' || ctx.doc.getMap('elements').has(target.instanceId));
    if (elementId && targetExists) {
      ctx.takeSnapshot();
      await acceptEditorCommands(ctx.doc, [
        { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId, attribute: 'src', value: srcValue },
        { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId, attribute: 'alt', value: (params.prompt as string).slice(0, 120) },
      ], ctx.claimSnapshot?.());
      return { success: true, message: `Image generated and applied to ${elementId}.`, data: { assetId } };
    }
    return { success: true, message: `Image generated and stored. Apply it NOW with update_image_attribute attribute="src" value="${srcValue}" before generating the next image — it is invisible on the page until you do.`, data: { assetId } };
  } catch (err) {
    return { success: false, message: `Image generation failed: ${String(err)}. Continue the build without this image or use search_stock_images.` };
  }
}

// ============================================================================
// Confirmation Gate (confirmMessage registry entries)
// ============================================================================

function confirmText(entry: CommandRegistryEntry, params: Record<string, unknown>): string {
  return typeof entry.confirmMessage === 'function' ? entry.confirmMessage(params) : String(entry.confirmMessage);
}

/** Editorial layouts D10: a body using <Stack> needs the component FILE before
 *  the write (the import itself is added by the post write path). */
async function ensureStackFor(ctx: ToolExecutionContext, body: string): Promise<{ success: false; message: string } | null> {
  if (!/<Stack[\s>/]/.test(body)) return null;
  const path = findLocalProjectEntry(selectProjectId(ctx.doc) ?? '')?.path ?? null;
  if (await ensureSqComponent(path, 'Stack')) return null;
  return { success: false, message: 'The Stack layout component could not be added to this project, so the post was not written.' };
}

/** Adds the optional `confirm` flag the confirm gate reads to a gated tool's schema. */
export function withConfirmParam<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.extend({ confirm: z.boolean().optional().describe('true ONLY when the user asked for this in the conversation.') });
}

/** A confirmMessage-gated tool (one that can't be undone) runs only with confirm:true; otherwise it says what needs
 *  the user's OK and does nothing — the agent asks in its reply. Chat and MCP alike: never a popup (owner 2026-11-10). */
export function confirmGate(entry: CommandRegistryEntry, params: Record<string, unknown>): ToolCallResult | Record<string, unknown> {
  const { confirm, ...rest } = params;
  if (!entry.confirmMessage || confirm === true) return rest;
  return {
    success: false,
    cancelled: true,
    needsConfirmation: true,
    message: `${confirmText(entry, params)} Ask the user; re-run with confirm:true only after they say yes.`,
  };
}

/** Build description string for a command, appending examples if present */
function buildDescription(entry: { description: string; examples?: string[] }): string {
  if (entry.examples?.length) {
    return `${entry.description}\nExamples: ${entry.examples.join('; ')}`;
  }
  return entry.description;
}

// ============================================================================
// Typed tool() Helper
// ============================================================================

/**
 * Typed wrapper around AI SDK v6 `tool()` that pins the input type from a zod
 * schema. The SDK's `tool()` overloads can't infer `INPUT` when given a
 * heterogeneous `z.ZodType` because `FlexibleSchema` is a wide union — this
 * helper centralizes the one cast required to bridge the SDK's `FlexibleSchema`
 * shape and provides correct typing on the `execute` parameter at call sites,
 * so we no longer need `as any` on every tool definition.
 */
function defineCommandTool<TSchema extends z.ZodTypeAny, TOutput>(opts: {
  description: string;
  schema: TSchema;
  // The AI SDK passes { toolCallId, messages, abortSignal } as the second arg —
  // the abortSignal is what makes Stop cancel an in-flight tool (image gen).
  execute: (params: z.infer<TSchema>, options?: { abortSignal?: AbortSignal }) => Promise<TOutput>;
}): Tool<z.infer<TSchema>, TOutput> {
  type Input = z.infer<TSchema>;
  // The single cast: zodSchema() in this SDK build is typed against its own
  // narrower zod re-export, so a generic z.ZodTypeAny widens past it, and the
  // SDK's `Schema<unknown>` return narrows back to unknown. We bridge both with
  // one localized cast here instead of `as any` at every call site.
  const inputSchema = zodSchema(opts.schema as never) as Schema<Input>;
  // tool()'s NeverOptional<OUTPUT, ...> conditional can't simplify when OUTPUT
  // is a generic, so the input-arg type doesn't structurally match. The
  // standard workaround for typed tool-factory wrappers around the AI SDK v6
  // overloads is a double cast on the config arg — encapsulated here so call
  // sites stay clean.
  const cfg = {
    description: opts.description,
    inputSchema,
    execute: opts.execute,
  } as unknown as Parameters<typeof tool<Input, TOutput>>[0];
  return tool<Input, TOutput>(cfg);
}

// ============================================================================
// Tool Generation
// ============================================================================

/**
 * Generate AI SDK tool definitions from the command registry.
 * Each registered command becomes a callable tool.
 */
export function generateCommandTools(
  ctx: ToolExecutionContext,
  categories?: CommandCategory[],
): ToolSet {
  const tools: ToolSet = {};
  const entries = Object.entries(commandRegistry) as Array<[RegisteredCommandType, (typeof commandRegistry)[RegisteredCommandType]]>;
  const isLocal = isLocalProjectId(selectProjectId(ctx.doc) ?? '');

  type CategoryExecutor = (
    ctx: ToolExecutionContext,
    commandType: RegisteredCommandType,
    params: Record<string, unknown>,
  ) => ToolCallResult | Record<string, unknown> | unknown | Promise<ToolCallResult | Record<string, unknown> | unknown>;

  // Categories with dedicated executors; everything else rides executeCommand
  // (the generic snapshot → commandTypeMap → dispatch path).
  const writeExecutors: Partial<Record<CommandCategory, CategoryExecutor>> = {
    layout: executeLayoutCommand,
    instance: executeInstanceCommand,
    project: executeProjectCommand,
    blog: executeBlogCommand,
  };

  for (const [commandType, entry] of entries) {
    if (categories && !categories.includes(entry.category)) continue;
    if ('isAvailable' in entry && entry.isAvailable && !entry.isAvailable(ctx.availability)) continue;
    if (isLocal && LOCAL_HIDDEN_TOOLS.has(commandType)) continue;
    const localHandler = isLocal ? LOCAL_HANDLERS[commandType] : undefined;
    const localSource: CategoryExecutor | null = localHandler ? (c, _t, p) => localHandler(c, p)
      // A drawn element IS a source element on files-truth: delete it like one.
      : isLocal && commandType === 'delete_drawn_element' ? (c, _t, p) => executeCommand(c, 'delete_element' as RegisteredCommandType, { elementId: p.elementKey })
      : null;

    const isReadOnly = 'readOnly' in entry && entry.readOnly === true;

    if (isReadOnly) {
      // Read tools return data directly (not wrapped in ToolCallResult)
      const readExecutor: CategoryExecutor = localSource ?? (commandType === 'verify_layout'
        ? (c, _t, p) => executeVerifyLayout(c, p)
        : commandType === 'search_stock_images'
        ? (_c, _t, p) => executeStockSearch(p)
        : commandType === 'list_files' || commandType === 'read_file'
        ? (c, type, p) => executeFileRead(c.doc, type, p)
        : entry.category === 'blog'
          ? (c, type, p) => executeBlogReadQuery(c.doc, type, p, selectCurrentPageId(c.doc))
          : entry.category === 'layout'
            ? executeLayoutCommand
            : (c, type, p) => executeReadQuery(c.doc, type, p, c.getScannedElements()));
      tools[commandType] = defineCommandTool({
        description: buildDescription(entry),
        schema: entry.schema,
        execute: async (params) => {
          console.log(`[AI:read] ${commandType}`, params);
          return readExecutor(ctx, commandType, params as Record<string, unknown>);
        },
      });
      continue;
    }

    // Write tools share ONE wrapper: confirm gate + noSnapshot + executor.
    // generate_image is dispatched separately below (needs the abortSignal).
    const executor = localSource ?? writeExecutors[entry.category] ?? executeCommand;
    const noSnapshot = 'noSnapshot' in entry && entry.noSnapshot === true;
    // A gated tool takes the `confirm` flag the gate reads.
    const gated = 'confirmMessage' in entry && Boolean(entry.confirmMessage) && entry.schema instanceof z.ZodObject;
    const schema = gated ? withConfirmParam(entry.schema as z.ZodObject<z.ZodRawShape>) : entry.schema;
    tools[commandType] = defineCommandTool({
      description: buildDescription(entry),
      schema,
      execute: async (rawParams, options) => {
        const gateResult = confirmGate(entry, rawParams as Record<string, unknown>);
        if ('success' in gateResult && gateResult.success === false && 'cancelled' in gateResult) return gateResult as ToolCallResult;
        const params = gateResult as Record<string, unknown>;
        // noSnapshot entries never take a batch snapshot. (Their executors
        // must not dispatch Yjs commands either — ctx.dispatch would snapshot.)
        const execCtx = noSnapshot ? { ...ctx, takeSnapshot: () => {} } : ctx;
        // generate_image is the only long-running tool — thread the SDK's
        // abortSignal so Stop cancels the provider request. Others ignore it.
        if (commandType === 'generate_image') {
          return executeGenerateImage(execCtx, commandType, params as Record<string, unknown>, options?.abortSignal);
        }
        // Owner 2026-11-10 (no "retry in a moment"): a local write acts on the
        // page the canvas is switching to, so it waits for that page's scan.
        // File tools stay immediate — they are how a page that never renders gets fixed.
        if (isLocal && !PAGE_INDEPENDENT_LOCAL_WRITES.has(commandType) && !(await whenLocalPageInSync())) {
          return { success: false, message: `${commandType} failed: ${LOCAL_PAGE_NOT_LOADED_REASON}. If the page shows an error, fix it with edit_file or write_file.` };
        }
        return executor(execCtx, commandType, params as Record<string, unknown>);
      },
    });
  }

  return tools;
}
