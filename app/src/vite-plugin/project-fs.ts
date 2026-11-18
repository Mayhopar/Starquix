/**
 * Typed re-export of the plugin's project-fs helpers (same pattern as
 * component-discovery.ts / layout-discovery.ts). The implementation is
 * preview-template/src/plugins/sq-project-fs.js — plain JS so the SAME code
 * serves /__sq/local/* inside the project's instance.
 *
 * This used to be re-exported from server/localProject.ts next to the
 * host-folder lifecycle (spawn/pick/stamp); that disk is gone — see
 * docs/plans/2026-09-10-remove-open-local-folder-design.md.
 */
export type {
  LocalPage, DeletedLocalPage, RenamedLocalPage, ContentUsage, ComponentUsages,
  DefaultImageResult, LocalAsset, RebindResult,
} from '../../../preview-template/src/plugins/sq-project-fs.js';
export {
  routeForPageFile, discoverLocalPages, findComponentUsages, findImagePropAt,
  writeComponentDefaultImage, writeDefaultImageAsset, createLocalPage, deleteLocalPage,
  restoreLocalPage, renameLocalPage, moveLocalPage, writeLocalAsset, writeLocalContentAsset,
  writeLocalFontFile, mergeLocalFontCss, ensureLocalFontsLink, listLocalContentFiles,
  listLocalAssets, resolveBoundAsset, repointContentRefs, rebindLocalAsset, rebindToExisting,
  resolveLocalAssetFile, SQ_INSERTABLE_COMPONENTS, SQ_UPGRADE_MARKERS,
  SQ_COMPONENT_NAME, projectHasMdx, resolveLocalContentPath,
} from '../../../preview-template/src/plugins/sq-project-fs.js';
