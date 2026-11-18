/**
 * The editor injects content into an infrastructure wrapper — the
 * `#sq-components` div in `src/pages/preview/[projectId]/[pageId].astro`. The
 * wrapper is the outermost container (source-tracked + selectable, but
 * auto-unwrapped from Layers), so the editor treats "selection/context is on
 * the wrapper" as being at the document top level.
 *
 * The classifier itself lives in `store/keyKind.ts` (`classifyKey`); this is a
 * compatibility re-export.
 */
export { isWrapperKey as isPageWrapperKey } from '@/store/keyKind';
