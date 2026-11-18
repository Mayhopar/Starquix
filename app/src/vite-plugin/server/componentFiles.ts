/**
 * Component FILE operations — create / rename / delete / promote — for BOTH
 * component roots (built-in library and a user's local project).
 *
 * Files-truth unification (Phase 1): the implementation lives in
 * preview-template/src/plugins/sq-project-fs.js (plain JS — the sq plugin
 * serves it inside a files-truth instance too). This module is the typed
 * re-export for host callers and the existing tests.
 */
export {
  ComponentFileError,
  resolveInRoot,
  createComponentFile,
  renameComponentFile,
  deleteComponentFile,
  moveComponentToSystemDir,
} from '../../../../preview-template/src/plugins/sq-project-fs.js';
