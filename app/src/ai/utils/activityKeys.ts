// src/ai/utils/activityKeys.ts
// Maps AI tool calls to the entity keys they affect, for activity indicators.
// Consumers: ElementsTree + chat activity feed (bare element keys),
// PagesPanel (`page:<id>`), VariablesTable (`variable:<id>`).
//
// Two extractors because creates only know their id at RESULT time:
//   - extractAffectedKey(toolName, args)          → live "AI is editing" glow
//   - extractTouchedKey(toolName, args, result)   → persistent "Edited by AI" badge

/** Element-key arg fields, in precedence order. `parentKey`/`parentId`/
 *  `newParentKey` are deliberately absent — inserting INTO a container does
 *  not make the container AI-authored. */
const ELEMENT_ARG_FIELDS = ['sourceKey', 'key', 'elementKey', 'elementId', 'instanceId', 'slotKey'] as const;

/** Tools whose pageId names the page ITSELF (badge the page row). Tools that
 *  merely act on elements OF a page (add_page_content, reorder, …) must not
 *  light the page row. */
const PAGE_OBJECT_TOOLS = new Set([
  'update_page',
  'remove_page',
  'move_page',
  'set_home_page',
  'update_page_seo',
  'apply_layout',
  'detach_layout',
  'set_layout_props',
]);

const VARIABLE_TOOLS = new Set([
  'update_variable_value',
  'rename_variable',
  'delete_variable',
  'retype_variable',
]);

function isNoBadgeTool(toolName: string): boolean {
  return (
    toolName.startsWith('read_') ||
    toolName === 'verify_layout' ||
    toolName === 'undo' ||
    toolName === 'redo'
  );
}

export function extractAffectedKey(toolName: string, args: Record<string, unknown>): string | null {
  if (isNoBadgeTool(toolName)) return null;

  if (VARIABLE_TOOLS.has(toolName)) {
    return typeof args.variableId === 'string' && args.variableId ? `variable:${args.variableId}` : null;
  }

  for (const field of ELEMENT_ARG_FIELDS) {
    const v = args[field];
    if (typeof v === 'string' && v) return v;
  }

  if (PAGE_OBJECT_TOOLS.has(toolName)) {
    return args.pageId != null ? `page:${args.pageId}` : null;
  }
  if (toolName === 'add_page') {
    const id = (args.page as Record<string, unknown> | undefined)?.id ?? args.id;
    return typeof id === 'string' && id ? `page:${id}` : null;
  }

  return null;
}

/**
 * Badge key for a COMPLETED tool call. Creates return the new entity id only
 * in `result.data` (add_page_content → elementId, add_drawn_element → key,
 * place_component_instance → elementId, make_component → instanceId,
 * create_variable → variableId); everything else falls back to the args key.
 */
export function extractTouchedKey(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): string | null {
  const data = (result as { data?: Record<string, unknown> } | null | undefined)?.data;
  if (data && typeof data === 'object') {
    if (typeof data.elementId === 'string' && data.elementId) return data.elementId;
    if (typeof data.key === 'string' && data.key) return data.key;
    if (typeof data.instanceId === 'string' && data.instanceId) return data.instanceId;
    if (typeof data.variableId === 'string' && data.variableId) return `variable:${data.variableId}`;
  }
  return extractAffectedKey(toolName, args);
}
