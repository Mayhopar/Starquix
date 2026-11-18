/**
 * Structure / link / layout / instance / read / export AI + MCP tools on the
 * files-truth runtime (2026-10-05 audit). Their registry executors dispatched
 * Yjs commands the site never renders (reorder, set_child_order, links,
 * detach…) or gated on a retired runtime (export refused in the desktop
 * app). Each tool here edits the REAL file:
 *  - file transforms → ONE whole-file write with a whole-file ⌘Z
 *    (commitWholeLocalFile; the writer's same-file law still applies — an
 *    element inside a shared component is edited from its master view);
 *  - class tokens → acceptEditorCommands (the canvas grid-drop path);
 *  - instance overrides → localMasterOverrides (the DesignBar Push / Reset);
 *  - layouts → applyLocalPageLayout / detachLayoutSource (the ⌘K pick and its inverse);
 *  - export → the Dexie rows (the Export button).
 */
import { commitWholeLocalFile } from '@/components/Editor/localBlogBind';
import { applyLocalPageLayout, detachLayoutSource } from '@/components/Editor/localLayoutApply';
import { insertLocalComponent } from '@/components/Editor/localComponentInsert';
import { buildGridPlacementTokens } from '@/components/Canvas/viewportMessages/dragAndDrop';
import { acquireStructuralWrite, releaseStructuralWrite } from '@/store/structuralWriteGuard';
import { isLocalPageInSync, markLocalScanStaleAfterWrite, LOCAL_PAGE_NOT_LOADED_REASON } from '@/utils/localPageSync';
import { readLocalFile, readLocalElementSource } from '@/utils/localElementSource';
import { settleAcceptedWrites } from '@/utils/acceptedSource';
import { detectPageLayout } from '@/utils/detectPageLayout';
import { reorderElements, updateAttribute } from '@/vite-plugin/ast-updater';
import { unwrapLinkSource } from '@/utils/linkSource';
import { acceptEditorCommands } from '@/store/commandGesture';
import { resetLocalOverrides, localOverridesForPlacement } from '@/store/localMasterOverrides';
import { pushLocalOverridesUndoable } from '@/store/localPushUndo';
import { requestPreviewReload } from '@/components/Canvas/reloadPreview';
import { awaitProjectFiles } from '@/services/durableEdits/sourceMaterialization';
import { downloadFilesTruthZip } from '@/export/filesTruthZip';
import { parseKey } from '@/store/types';
import { selectCurrentBreakpoint, selectCurrentPageId, selectProjectId, selectProjectName } from '@/store/selectors';
import type { EditorCommand } from '@/store/types';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import type { ThemeComponentTemplate } from '@/components/ComponentPickerModal/ComponentPickerModal';
import type { ToolCallResult, ToolExecutionContext } from './commandTools';
import { fail, findScannedByKey, localProjectPathOf, requireCurrentLocalPage } from './localToolUtils';

/** Doc-only concepts with no file meaning — hidden from the files-truth catalogue. */
export const LOCAL_HIDDEN_SOURCE_TOOLS = new Set(['delete_instance_child']);

const KEYS_HINT = 'read_source_elements lists the current canvas keys.';

type Params = Record<string, unknown>;
type Handler = (ctx: ToolExecutionContext, params: Params) => Promise<unknown>;
type Located = ScannedElement & { sourceLocation: NonNullable<ScannedElement['sourceLocation']> };

const notOnCanvas = (tool: string, key: string) => fail(`${tool} failed: "${key}" is not on the canvas. ${KEYS_HINT}`);
const onCanvas = (ctx: ToolExecutionContext, key: string) => {
  const el = findScannedByKey(ctx.getScannedElements(), key);
  return el?.sourceLocation ? el as Located : null;
};

/** Read → transform → ONE whole-file write + whole-file undo, under the structural write guard. */
async function rewriteFile(ctx: ToolExecutionContext, file: string, transform: (source: string) => string | Promise<string>, failure: string): Promise<ToolCallResult> {
  // The write-tool wrapper already waited for the page; this is the invariant.
  if (!isLocalPageInSync()) return fail(`${failure} — ${LOCAL_PAGE_NOT_LOADED_REASON}.`);
  await acquireStructuralWrite(); // its turn behind any write in flight — never "retry"
  // Disk catches up first: a write just ahead in the queue may not be on disk yet.
  try {
    let before: string;
    await settleAcceptedWrites();
    try { before = await readLocalFile(file); } catch { return fail(`${failure} — could not read ${file}.`); }
    let after: string;
    try { after = await transform(before); } catch (err) { return fail(`${failure} — ${err instanceof Error ? err.message : String(err)}`); }
    if (after === before) return { success: true, message: `${file} already matches — nothing to change` };
    const r = await commitWholeLocalFile({ file, before, after, pushUndo: ctx.pushStructuralUndo, failure });
    if (!r.ok) return fail(`${failure} — ${r.reason}. An element inside a shared component is edited from its master view: open_component it first.`);
    markLocalScanStaleAfterWrite();
    return { success: true, message: `Wrote ${file} — the canvas rescans automatically.` };
  } finally {
    releaseStructuralWrite();
  }
}

/** Sibling elements of one file, in the caller's order → a single reorder rewrite. */
async function reorderSiblings(ctx: ToolExecutionContext, tool: string, keys: string[], parentKey: string | null | undefined): Promise<ToolCallResult> {
  if (keys.length < 2) return { success: true, message: 'Nothing to reorder' };
  const els = keys.map((k) => onCanvas(ctx, k));
  const missing = keys.filter((_, i) => !els[i]);
  if (missing.length) return fail(`${tool} failed: not on the canvas: ${missing.join(', ')}. ${KEYS_HINT}`);
  const located = els as Located[];
  const parent = parentKey === undefined ? located[0].parentKey ?? null : parentKey;
  if (located.some((e) => (e.parentKey ?? null) !== parent)) return fail(`${tool} failed: the keys are not all children of ${parent ?? 'the page root'}.`);
  const siblings = ctx.getScannedElements().filter((e) => (e.parentKey ?? null) === parent);
  if (siblings.length !== keys.length) return fail(`${tool} failed: pass ALL ${siblings.length} children in the new order (got ${keys.length}).`);
  const file = located[0].sourceLocation.file;
  if (located.some((e) => e.sourceLocation.file !== file)) return fail(`${tool} failed: these elements live in different files — move_element them one by one.`);
  if (new Set(located.map((e) => `${e.sourceLocation.line}:${e.sourceLocation.column}`)).size !== located.length) {
    return fail(`${tool} failed: some keys are repeated renders of one source element (a loop) — reorder the data instead.`);
  }
  const locs = located.map((e) => ({ file, line: e.sourceLocation.line, column: e.sourceLocation.column }));
  return rewriteFile(ctx, file, (src) => reorderElements(src, locs, locs.map((_, i) => i)), `${tool} failed`);
}

/** 1-based line/column of `<Name` in the page (the layout tag). */
function layoutTagLoc(src: string, name: string): { line: number; column: number } {
  const at = src.search(new RegExp(`<${name}[\\s/>]`));
  if (at < 0) throw new Error(`<${name}> not found`);
  const before = src.slice(0, at);
  return { line: before.split('\n').length, column: at - before.lastIndexOf('\n') };
}

/** "2", "2 / span 3", "2 / 5" → 1-based start + span. */
function parseGridLine(v: string): { start: number; span: number } | null {
  const m = v.trim().match(/^(\d+)(?:\s*\/\s*(?:span\s+(\d+)|(\d+)))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const span = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) - start : 1;
  return start >= 1 && span >= 1 ? { start, span } : null;
}

const LINK_ATTR: Record<string, string> = { href: 'href', target: 'target', rel: 'rel', title: 'title', ariaLabel: 'aria-label' };

/** The component file + placement an instance key belongs to. */
function placementOf(key: string): { file: string; placement: string | undefined } | null {
  const p = parseKey(key) as { type?: string; file?: string; placement?: string } | null;
  if (p?.type !== 'source' || !p.file || !/^src\/(components|layouts)\//.test(p.file)) return null;
  return { file: p.file, placement: p.placement };
}

async function instanceOverrides(ctx: ToolExecutionContext, tool: 'reset_instance' | 'push_instance_to_source', instanceId: string): Promise<unknown> {
  const at = placementOf(instanceId);
  if (!at) return fail(`${tool} failed: "${instanceId}" is not an element of a component on this page. ${KEYS_HINT}`);
  const entries = localOverridesForPlacement(ctx.doc, at.file, at.placement);
  if (entries.length === 0) return { success: true, message: `${at.file} has no instance edits here — nothing to ${tool === 'reset_instance' ? 'reset' : 'push'}` };
  if (tool === 'reset_instance') {
    ctx.takeSnapshot();
    await resetLocalOverrides(ctx.doc, entries, ctx.claimSnapshot?.());
    requestPreviewReload();
    return { success: true, message: `Discarded ${entries.length} instance edit(s) — the instance shows ${at.file} again` };
  }
  // The DesignBar Push's own code path: one ⌘Z takes it back (owner 2026-11-10: no popup — undo instead).
  const r = await pushLocalOverridesUndoable(ctx.doc, at.file, at.placement, ctx);
  if (r.pushed > 0) requestPreviewReload();
  return r.failed === 0
    ? { success: true, message: `Pushed ${r.pushed} edit(s) into ${at.file} — every placement now shows them (⌘Z in the editor takes it back)` }
    : fail(`Pushed ${r.pushed}, ${r.failed} failed: ${r.reasons.join('; ')}`);
}

function editPageLayout(ctx: ToolExecutionContext, tool: string, params: Params, edit: (src: string, file: string, name: string) => string | Promise<string>) {
  const refusal = requireCurrentLocalPage(ctx, tool, (params.pageId as string) || null);
  if (refusal) return Promise.resolve(refusal);
  const file = ctx.getCurrentPageFile();
  if (!file?.startsWith('src/pages/')) return Promise.resolve(fail(`${tool} failed: open a page first.`));
  return rewriteFile(ctx, file, (src) => {
    const layout = detectPageLayout(src);
    if (!layout) throw new Error('this page has no layout');
    return edit(src, file, layout.name);
  }, `${tool} failed`);
}

/** Every tool this module answers on files-truth, by name. */
export const LOCAL_SOURCE_HANDLERS: Record<string, Handler> = {
  reorder_page_elements: async (ctx, params) => {
    const { pageId, elementIds } = params as { pageId: string; elementIds: string[] };
    return requireCurrentLocalPage(ctx, 'reorder_page_elements', pageId || null) ?? reorderSiblings(ctx, 'reorder_page_elements', elementIds, undefined);
  },
  set_child_order: async (ctx, params) => {
    const { pageId, parentKey, childKeys } = params as { pageId: string; parentKey: string; childKeys: string[] };
    return requireCurrentLocalPage(ctx, 'set_child_order', pageId || null) ?? reorderSiblings(ctx, 'set_child_order', childKeys, parentKey);
  },
  set_grid_placement: async (ctx, params) => {
    const { key, gridColumn, gridRow } = params as { key: string; gridColumn: string; gridRow: string };
    const el = onCanvas(ctx, key);
    if (!el) return notOnCanvas('set_grid_placement', key);
    const col = parseGridLine(gridColumn); const row = parseGridLine(gridRow);
    if (!col || !row) return fail('set_grid_placement failed: use CSS line values like "2", "2 / span 3" or "2 / 4".');
    const current = selectCurrentBreakpoint(ctx.doc);
    const bp = current === 'base' ? '' : `${current}:`;
    const tokens = buildGridPlacementTokens(bp, col.start - 1, row.start - 1, col.span, row.span);
    ctx.takeSnapshot();
    await acceptEditorCommands(ctx.doc, [{ type: 'GRID_PLACE_ELEMENT', key: el.key, ...tokens } as EditorCommand], ctx.claimSnapshot?.());
    return { success: true, message: `Placed "${key}" at column ${gridColumn}, row ${gridRow}` };
  },
  update_link_attribute: async (ctx, params) => {
    const { elementId, attribute, value } = params as { elementId: string; attribute: string; value: string };
    const el = onCanvas(ctx, elementId);
    if (!el) return notOnCanvas('update_link_attribute', elementId);
    if (el.tagName.toLowerCase() !== 'a') return fail(`update_link_attribute failed: "${elementId}" is a <${el.tagName}>, not a link.`);
    if (attribute === 'target' && value && !['_blank', '_self', '_parent', '_top'].includes(value)) return fail('update_link_attribute failed: target must be _blank, _self, _parent or _top.');
    const loc = el.sourceLocation;
    return rewriteFile(ctx, loc.file, (src) => updateAttribute(src, loc.file, loc, LINK_ATTR[attribute] ?? attribute, value), 'update_link_attribute failed');
  },
  unwrap_link: async (ctx, params) => {
    const { elementId } = params as { elementId: string };
    const el = onCanvas(ctx, elementId);
    if (!el) return notOnCanvas('unwrap_link', elementId);
    return rewriteFile(ctx, el.sourceLocation.file, (src) => unwrapLinkSource(src, el.sourceLocation), 'unwrap_link failed');
  },
  reset_instance: (ctx, params) => instanceOverrides(ctx, 'reset_instance', params.instanceId as string),
  push_instance_to_source: (ctx, params) => instanceOverrides(ctx, 'push_instance_to_source', params.instanceId as string),
  make_component: async (ctx, params) => {
    const { key, pageId, name } = params as { key: string; pageId?: string; name?: string };
    const refusal = requireCurrentLocalPage(ctx, 'make_component', pageId || null);
    if (refusal) return refusal;
    const el = onCanvas(ctx, key);
    const path = localProjectPathOf(ctx);
    if (!el || !path) return notOnCanvas('make_component', key);
    if (el.sourceLocation.file !== ctx.getCurrentPageFile()) return fail('make_component failed: the element already lives in a component file.');
    const { source } = await readLocalElementSource(el.sourceLocation);
    if (/[{}]/.test(source)) return fail('make_component failed: the element uses {expressions} from the page — write_file a component with props instead.');
    const used = new Set(ctx.componentLibrary.map((c) => c.name));
    let compName = (name ?? `${el.tagName[0].toUpperCase()}${el.tagName.slice(1)}Block`).replace(/[^A-Za-z0-9]/g, '');
    if (!/^[A-Z]/.test(compName)) compName = `C${compName}`;
    for (let n = 2; used.has(compName); n++) compName = compName.replace(/\d*$/, String(n));
    const scanned = ctx.getScannedElements();
    const template: ThemeComponentTemplate = { id: `ai-${compName}`, name: compName, category: '', image: '', html: source, themeId: 'ai', componentPath: '' };
    const r = await insertLocalComponent({
      component: template, selection: null, scannedElements: scanned, pageFile: ctx.getCurrentPageFile(),
      pushUndo: ctx.pushStructuralUndo, localProjectPath: path, replaceKey: el.key, scannedByKey: new Map(scanned.map((e) => [e.key, e])),
    });
    if (r.ok) markLocalScanStaleAfterWrite();
    return r.ok ? { success: true, message: `Made ${r.file} and placed <${compName} /> in place of "${key}"`, data: { file: r.file } } : fail(`make_component failed: ${r.reason}`);
  },
  apply_layout: async (ctx, params) => {
    const { pageId, layoutName } = params as { pageId: string; layoutName: string };
    const refusal = requireCurrentLocalPage(ctx, 'apply_layout', pageId || null);
    if (refusal) return refusal;
    const fromLibrary = ctx.componentLibrary.find((c) => c.name === layoutName && c.path.startsWith('src/layouts/'));
    const fromLayouts = ctx.layoutLibrary.find((l) => l.name === layoutName && l.path.startsWith('src/layouts/'));
    const component = fromLibrary ?? (fromLayouts ? ({ name: fromLayouts.name, path: fromLayouts.path } as ScannedComponent) : undefined);
    if (!component) return fail(`apply_layout failed: no layout "${layoutName}" in src/layouts — read_layouts.`);
    const r = await applyLocalPageLayout({ component, pageFile: ctx.getCurrentPageFile(), localProjectPath: localProjectPathOf(ctx), pushUndo: ctx.pushStructuralUndo });
    if (r.ok) markLocalScanStaleAfterWrite();
    return r.ok ? { success: true, message: `Page now uses ${layoutName}` } : fail(`apply_layout failed: ${r.reason}`);
  },
  detach_layout: (ctx, params) => editPageLayout(ctx, 'detach_layout', params, (src, _file, name) => detachLayoutSource(src, name)),
  set_layout_props: (ctx, params) => editPageLayout(ctx, 'set_layout_props', params, async (src, file, name) => {
    let out = src;
    for (const [prop, value] of Object.entries(params.props as Record<string, string>)) {
      if (!/^[A-Za-z_][\w-]*$/.test(prop)) throw new Error(`"${prop}" is not a prop name`);
      out = await updateAttribute(out, file, { file, ...layoutTagLoc(out, name) }, prop, value);
    }
    return out;
  }),
  read_page_content: async (ctx, params) => {
    const pageId = params.pageId as string;
    if (pageId && pageId !== selectCurrentPageId(ctx.doc)) return { error: `select_page("${pageId}") first — reads see the page on the canvas.` };
    const file = ctx.getCurrentPageFile();
    const source = file ? await readLocalFile(file).catch(() => null) : null;
    const scanned = ctx.getScannedElements();
    const own = scanned.filter((e) => e.sourceLocation?.file === file);
    const ownKeys = new Set(own.map((e) => e.key));
    const roots = own.filter((e) => !e.parentKey || !ownKeys.has(e.parentKey));
    // Elements rendered by components/layouts are edited in THEIR file (open_component).
    const renderedFiles = [...new Set(scanned.map((e) => e.sourceLocation?.file).filter((f): f is string => !!f && f !== file))];
    return {
      file, rootElements: roots.map((e) => ({ key: e.key, tagName: e.tagName, classes: e.classes })), renderedFiles, source,
      ...(roots.length ? {} : { hint: 'No element on this page is owned by its file (content comes from components/layouts or {expressions}) — edit those via open_component, or the page source via edit_file.' }),
    };
  },
  read_component_content: async (ctx, params) => {
    const elementId = params.elementId as string;
    const el = onCanvas(ctx, elementId);
    if (!el) return { error: `"${elementId}" is not on the canvas. ${KEYS_HINT}` };
    const r = await readLocalElementSource(el.sourceLocation);
    return { file: el.sourceLocation.file, startLine: r.startLine, endLine: r.endLine, markup: r.source };
  },
  export_project: async (ctx) => {
    const projectId = selectProjectId(ctx.doc) ?? '';
    await awaitProjectFiles(projectId);
    await downloadFilesTruthZip(projectId, selectProjectName(ctx.doc) || 'project', ctx.doc);
    return { success: true, message: 'Export ZIP of the project files downloaded' };
  },
};
