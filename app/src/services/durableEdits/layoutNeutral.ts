import type { DurableFileChange, MaterializationCommand } from './types';

const FOLDER_MANIFEST_FILE = '.starquix/folders.json';
const LAYOUTS_DIR = 'src/layouts/';

/** A file change that could alter the layout library (name, props, slots, body of a layout file)
 * or the folder manifest: it touches a layout, the manifest, or creates/deletes a file. */
const mayChangeLibrary = (file: string, change?: DurableFileChange): boolean => {
  const path = file.replace(/^\.\//, '');
  return path.startsWith(LAYOUTS_DIR) || path === FOLDER_MANIFEST_FILE
    || (change !== undefined && (change.beforeSource === null || change.afterSource === null));
};

/**
 * True when an accepted edit cannot have changed the layout library or the folder manifest.
 * Both are read back through the journal on EVERY accepted revision (a second acceptance-lane
 * job each plus a layout-plan POST), which a class edit never needs. Conservative on purpose:
 * only class writes and file batches that keep every file in place and outside src/layouts/**
 * and .starquix/folders.json count; any other command kind, and an empty list of files that
 * cannot be judged, is NOT neutral — except the empty command list (a document-only edit),
 * which cannot touch a file at all.
 */
export function isLayoutNeutral(commands: readonly MaterializationCommand[]): boolean {
  return commands.every(command => {
    if (command.kind === 'class-write') {
      return !mayChangeLibrary(command.payload.sourceLocation.file)
        && (command.payload.preparedFiles ?? []).every(change => !mayChangeLibrary(change.file, change));
    }
    if (command.kind === 'file-batch') return command.payload.files.every(change => !mayChangeLibrary(change.file, change));
    return false;
  });
}
