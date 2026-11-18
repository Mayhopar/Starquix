/**
 * Component discovery (scan) — implementation moved to
 * preview-template/src/plugins/sq-project-fs.js (files-truth Phase 1) so the
 * sq plugin can scan a project from inside its own astro dev. Typed re-export.
 */
export type { DiscoveredComponent, PropDef } from '../../../preview-template/src/plugins/sq-project-fs.js';
export {
  discoverComponents,
  extractContentBound,
  extractPageTemplate,
  extractCategory,
  extractFrontmatter,
  extractProps,
  extractSlots,
  extractDefaultChildren,
  extractDependencies,
} from '../../../preview-template/src/plugins/sq-project-fs.js';
