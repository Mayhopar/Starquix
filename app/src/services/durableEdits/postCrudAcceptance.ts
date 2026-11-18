import { parseFrontmatter, serializeFrontmatter } from '@/core/collections/content-ops';
import { equalPostValue, PostSourceConflict } from '@/postmodel/frontmatterPatch';
import { acceptFileChanges, projectIdForFolder } from './fileAcceptance';
import type { MutationSnapshot } from '@/store/documentMutation';
import { readProjectedContentFiles } from './collectionAcceptance';
import { ensureStackImport } from '@/core/stack/ensureStackImport';

type PostChange = { action: 'create'; slug: string; frontmatter: Record<string, unknown>; body: string }
  | { action: 'rename'; slug: string; newSlug: string; frontmatter: Record<string, unknown>; body: string }
  | { action: 'delete'; slug: string }
  | { action: 'delete-collection' };

function assertIdentity(value: string): void {
  if (!value || /[\\\0]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid post identity');
}

/** CRUD operates on the accepted source prefix, never on an ACK-dependent
 * listing. Renames preserve exact raw bytes and post format in one CAS batch.
 * `snapshot` (the editor's claimed undo) makes a delete one ⌘Z: it carries the exact deleted bytes back. */
export function acceptPostFileChange(folder: string, collection: string, change: PostChange, snapshot?: MutationSnapshot) {
  const projectId = projectIdForFolder(folder);
  assertIdentity(collection);
  if ('slug' in change) assertIdentity(change.slug);
  if (change.action === 'rename') assertIdentity(change.newSlug);
  const frozen = structuredClone(change);
  return acceptFileChanges(folder, async () => {
    const files = await readProjectedContentFiles(projectId);
    const prefix = `src/content/${collection}/`;
    if (frozen.action === 'delete-collection') return Object.entries(files).filter(([file]) => file.startsWith(prefix))
      .map(([file, beforeSource]) => ({ file, beforeSource, afterSource: null }));
    const file = ['mdx', 'md'].map(extension => `${prefix}${frozen.slug}.${extension}`).find(candidate => candidate in files);
    const targetSlug = frozen.action === 'rename' ? frozen.newSlug : frozen.slug;
    const target = `${prefix}${targetSlug}.${frozen.action === 'rename' && file?.endsWith('.md') ? 'md' : 'mdx'}`;
    if (frozen.action === 'create' || frozen.action === 'rename') {
      const identity = target.replace(/\.mdx?$/, '').toLowerCase();
      if (Object.keys(files).some(candidate => candidate.replace(/\.mdx?$/i, '').toLowerCase() === identity)) throw new PostSourceConflict('A post with that name already exists.');
    }
    if (frozen.action === 'create') return [{ file: target, beforeSource: null, afterSource: serializeFrontmatter(frozen.frontmatter, ensureStackImport(frozen.body, target)) }];
    if (!file) throw new PostSourceConflict('The post no longer exists.');
    const beforeSource = files[file];
    if (frozen.action === 'delete') return [{ file, beforeSource, afterSource: null }];
    const saved = parseFrontmatter(beforeSource);
    if (saved.body !== frozen.body || Object.entries(frozen.frontmatter).some(([key, value]) => !equalPostValue(saved.frontmatter[key], value))) throw new PostSourceConflict();
    return [{ file, beforeSource, afterSource: null }, { file: target, beforeSource: null, afterSource: beforeSource }];
  }, undefined, undefined, snapshot);
}
