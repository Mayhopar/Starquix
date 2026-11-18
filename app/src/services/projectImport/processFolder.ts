/**
 * Folder pick → import entries (files-truth import, Phase 6: the static
 * converter is gone — a project is copied in AS-IS by createFilesTruthProject).
 * Skip-dirs are dropped BEFORE bytes are read: a real folder pick includes
 * node_modules/.git/dist.
 */
import { assertTotalSize, isSkippedDir, prepareImportMetadata } from './importValidation';

export { isSkippedDir } from './importValidation';

export interface ImportEntry { path: string; content: Uint8Array }

const READER_WORKERS = 8;

/** Browser adapter: a webkitdirectory FileList → ImportEntry[] (paths keep the picked folder name). */
export async function entriesFromFileList(files: FileList | File[]): Promise<ImportEntry[]> {
  const metadata = Array.from(files as ArrayLike<File>).map((file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    size: typeof file.size === 'number' ? file.size : 0,
  }));
  const { entries } = prepareImportMetadata(metadata);
  const output = new Array<ImportEntry>(entries.length);
  let nextIndex = 0;
  let didFail = false;
  let failure: unknown;
  let actualSize = 0;

  const worker = async (): Promise<void> => {
    while (!didFail) {
      const index = nextIndex++;
      if (index >= entries.length) return;
      const entry = entries[index];
      try {
        const buffer = await entry.source.file.arrayBuffer();
        if (didFail) continue;
        actualSize += buffer.byteLength;
        assertTotalSize([actualSize]);
        output[index] = { path: entry.sourcePath, content: new Uint8Array(buffer) };
      } catch (error) {
        if (!didFail) {
          didFail = true;
          failure = error;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(READER_WORKERS, entries.length) }, worker));
  if (didFail) throw failure;
  return output;
}
