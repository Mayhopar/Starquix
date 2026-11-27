import { CONTENT_CONFIG_FILES, parseFrontmatter } from '@/core/collections/content-ops';
import { addFieldToContentConfig, makeFieldOptionalInContentConfig, removeFieldFromContentConfig } from '@/core/collections/contentConfigSchema';
import type { FieldType } from '@/core/collections/types';
import { applyPreparedPostPatch, prepareFrontmatterPatch, prepareFrontmatterRemoval } from '@/postmodel/frontmatterPatch';
import { localFetch } from '@/utils/sqLocalBase';
import { acceptFileChanges, projectIdForFolder } from './fileAcceptance';
import type { MutationSnapshot } from '@/store/documentMutation';
import { projectedSourceFiles, readProjectedSourceState } from './projectedSource';
import type { DurableFileChange } from './types';

type CollectionFieldChange = { action: 'add'; name: string; defaultValue: unknown; type: FieldType }
  | { action: 'remove'; name: string } | { action: 'optional'; name: string };

/** Runs inside the acceptance lane, so every preceding accepted post is part
 * of this collection even while its source projection is still pending. */
export async function readProjectedContentFiles(projectId: string): Promise<Record<string, string>> {
  const response = await localFetch(`/__sq/local/content?path=${encodeURIComponent(`wc://${projectId}`)}`);
  if (!response.ok) throw new Error('The collection could not be read.');
  const { files } = await response.json() as { files: Record<string, string> };
  for (const change of projectedSourceFiles(projectId)) {
    if (change.encoding) continue;
    if (change.afterSource === null) delete files[change.file]; else files[change.file] = change.afterSource;
  }
  return Object.fromEntries(Object.entries(files).filter(([file]) => file.startsWith('src/content/') && /\.mdx?$/.test(file)));
}

/** One field gesture owns its exact post patches and surgical schema edit.
 * No source write or shared success occurs before the complete batch commits.
 * `snapshot` (the editor's claimed undo) makes it one ⌘Z: every post's exact bytes come back. */
export function acceptCollectionFieldChange(folder: string, collection: string, change: CollectionFieldChange, snapshot?: MutationSnapshot) {
  const projectId = projectIdForFolder(folder);
  if (!collection || /[\\/\0]/.test(collection) || collection === '.' || collection === '..'
    || !/^[a-zA-Z_][\w-]*$/.test(change.name)) throw new Error('Invalid collection field identity');
  const frozen = structuredClone(change);
  return acceptFileChanges(folder, async () => {
    const files: DurableFileChange[] = [];
    // Making a field optional is a schema edit only: every post stays valid as it is.
    const posts = frozen.action === 'optional' ? [] : Object.entries(await readProjectedContentFiles(projectId))
      .filter(([file]) => file.startsWith(`src/content/${collection}/`)).sort(([left], [right]) => left.localeCompare(right));
    for (const [file, beforeSource] of posts) {
      if (frozen.action === 'add' && Object.prototype.hasOwnProperty.call(parseFrontmatter(beforeSource).frontmatter, frozen.name)) continue;
      const patch = frozen.action === 'add'
        ? prepareFrontmatterPatch(beforeSource, { [frozen.name]: frozen.defaultValue })
        : prepareFrontmatterRemoval(beforeSource, frozen.name);
      if (patch.edits.length) files.push({ file, beforeSource, afterSource: applyPreparedPostPatch(beforeSource, patch) });
    }
    // Astro 5's path owns the schema when both names exist. Never generate a
    // replacement config or create one for an undeclared collection.
    for (const file of CONTENT_CONFIG_FILES) {
      const beforeSource = await readProjectedSourceState(projectId, file);
      if (beforeSource === null) continue;
      const afterSource = frozen.action === 'add'
        ? addFieldToContentConfig(beforeSource, collection, frozen.name, frozen.type)
        : frozen.action === 'remove' ? removeFieldFromContentConfig(beforeSource, collection, frozen.name)
          : makeFieldOptionalInContentConfig(beforeSource, collection, frozen.name);
      if (afterSource !== beforeSource) files.push({ file, beforeSource, afterSource });
      break;
    }
    if (frozen.action === 'optional' && !files.length) throw new Error('The field could not be made optional.');
    return files;
  }, undefined, undefined, snapshot);
}
