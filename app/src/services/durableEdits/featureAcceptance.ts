import * as Y from 'yjs';
import { acceptProjectEdit, inspectAcceptedProject } from './acceptance';
import { withProjectedSource, readProjectedSourceState, projectedSourceFiles } from './projectedSource';
import type { AcceptedEdit, MaterializationCommand, DurableFileChange, DurableValue } from './types';
import { parseFrontmatter, preparePostUpdate } from '@/core/collections/content-ops';
import { applyPreparedPostPatch, PostSourceConflict, type PostUpdateOptions } from '@/postmodel/frontmatterPatch';
import { EMPTY_MANIFEST, decodeFolderManifest, type FolderManifest } from '@/store/folderManifest';
import { commitMutationSnapshot, type MutationSnapshot } from '@/store/documentMutation';
import { localFetch } from '@/utils/sqLocalBase';
import { VARIABLES_CSS_FILE, variablesImportSpecifier } from '@/services/localVariablesCss';
import { applyStructuralTransform } from './structuralTransform';
import { structuralIdentityMap } from './sourceIdentity';
import { prepareLayoutAppend } from './layoutAppend';
import { prepareClassIdentities } from './prepareClassIdentity';
import { validateFeatureCommand } from './commandReceipts';
import { ensureStackImport } from '@/core/stack/ensureStackImport';

export const FOLDER_MANIFEST_FILE = '.starquix/folders.json';

/** Non-Yjs feature owners still use the sole project acceptance lane. */
async function acceptFeature(projectId: string, operationId: string,
  prepare: () => Promise<MaterializationCommand>, snapshot?: MutationSnapshot): Promise<AcceptedEdit> {
  const doc = new Y.Doc();
  const commands: MaterializationCommand[] = [];
  try {
    const accepted = await acceptProjectEdit(doc, { projectId, operationId, commands, mutate: () => {},
      prepare: revision => withProjectedSource(projectId, revision, async () => { commands.push(await prepare()); }),
    });
    const files = commands.flatMap(command => 'preparedFiles' in command.payload ? command.payload.preparedFiles ?? [] : []);
    try { if (files.length) snapshot?.attachFiles?.(files); }
    catch (error) { console.error('[feature inverse observer]', error); }
    if (commands.length) commitMutationSnapshot(snapshot);
    return accepted;
  } finally { doc.destroy(); }
}

async function postSource(projectId: string, collection: string, slug: string) {
  if (!collection || !slug || /[\\\0]/.test(collection + slug) || [...collection.split('/'), ...slug.split('/')].some(part => !part || part === '.' || part === '..')) throw new Error('Invalid post identity');
  for (const extension of ['mdx', 'md']) {
    const file = `src/content/${collection}/${slug}.${extension}`;
    const source = await readProjectedSourceState(projectId, file);
    if (source !== null) return { file, source };
  }
  throw new PostSourceConflict('The post no longer exists.');
}

export function readAcceptedPost(projectId: string, collection: string, slug: string) {
  return inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision, async () => {
    const { file, source } = await postSource(projectId, collection, slug);
    return { file, source, ...parseFrontmatter(source) };
  }));
}

export function acceptPostWrite(projectId: string, collection: string, slug: string,
  frontmatter: Record<string, unknown>, body: string, options?: PostUpdateOptions,
  operationId = crypto.randomUUID()): Promise<AcceptedEdit> {
  const values = structuredClone(frontmatter), baseline = options ? structuredClone(options) : undefined;
  return acceptPreparedPostWrite(projectId, collection, slug, async () => ({ frontmatter: values, body, options: baseline }), operationId);
}

/** Compile/owner preparation starts inside the immediately registered lane,
 * so navigation's acceptance boundary includes even slow post validation. */
export function acceptPreparedPostWrite(projectId: string, collection: string, slug: string,
  prepare: () => Promise<{ frontmatter: Record<string, unknown>; body: string; options?: PostUpdateOptions }>,
  operationId: string): Promise<AcceptedEdit> {
  return acceptFeature(projectId, operationId, async () => {
    const { frontmatter: values, body: rawBody, options: baseline } = await prepare();
    const { file, source } = await postSource(projectId, collection, slug);
    const body = ensureStackImport(rawBody, file);
    const { patch, nextBody } = preparePostUpdate(source, values, body, baseline);
    return { kind: 'post-write', payload: { collection, slug, frontmatter: values as Record<string, DurableValue>, body,
      expectedSource: source, preparedFiles: [{ file, beforeSource: source, afterSource: applyPreparedPostPatch(source, patch, nextBody) }] } };
  });
}

export function acceptFolderManifest(projectId: string, localPath: string | null, manifest: FolderManifest | ((current: FolderManifest) => FolderManifest),
  operationId = crypto.randomUUID(), snapshot?: MutationSnapshot): Promise<AcceptedEdit> {
  const frozen = typeof manifest === 'function' ? manifest : structuredClone(manifest);
  return acceptFeature(projectId, operationId, async () => {
    if (localPath !== null && localPath !== `wc://${projectId}`) throw new Error('Folder intent belongs to another project');
    const beforeSource = await readProjectedSourceState(projectId, FOLDER_MANIFEST_FILE);
    const next = decodeFolderManifest(typeof frozen === 'function' ? frozen(beforeSource === null ? EMPTY_MANIFEST : decodeFolderManifest(JSON.parse(beforeSource))) : frozen);
    return { kind: 'folder-manifest', payload: {
    localPath, manifest: next, preparedFiles: [{ file: FOLDER_MANIFEST_FILE,
      beforeSource, afterSource: JSON.stringify(next, null, 2) + '\n' }],
    } };
  }, snapshot);
}

export function readAcceptedFolderManifest(projectId: string, _localPath: string | null): Promise<FolderManifest> {
  return inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision, async () => {
    const source = await readProjectedSourceState(projectId, FOLDER_MANIFEST_FILE);
    return source === null ? EMPTY_MANIFEST : decodeFolderManifest(JSON.parse(source));
  }));
}

/** The files that import the variables file: the layouts — or, on a site with
 * none, EVERY page. (Home alone left the other pages of the built site without
 * variables and without the base CSS the file carries; the canvas injects both,
 * so it only showed once published — task-268.) */
async function variablesImportTargets(projectId: string, projectPath: string, inGesture: Map<string, DurableFileChange>): Promise<Set<string>> {
  const accepted = [...projectedSourceFiles(projectId), ...inGesture.values()];
  const within = (dir: string, files: string[]) => {
    const found = new Set(files);
    for (const change of accepted) if (change.file.startsWith(dir) && change.file.endsWith('.astro')) {
      if (change.afterSource === null) found.delete(change.file); else found.add(change.file);
    }
    return found;
  };
  const layouts = await localFetch(`/__sq/local/scan-layouts?path=${encodeURIComponent(projectPath)}`);
  if (!layouts.ok) throw new Error('Variables layouts could not be read');
  const targets = within('src/layouts/', ((await layouts.json()) as Array<{ path: string }>).map(layout => `src/layouts/${layout.path}`));
  if (targets.size) return targets;
  const response = await localFetch(`/__sq/local/pages?path=${encodeURIComponent(projectPath)}`);
  if (!response.ok) throw new Error('Variables page could not be read');
  const pages = (await response.json() as { pages?: Array<{ file: string }> }).pages ?? [];
  return within('src/pages/', pages.map(page => page.file).filter(file => file.endsWith('.astro')));
}

const variablesImport = (file: string) => ({ kind: 'import' as const, pageFile: file, name: '', importPath: variablesImportSpecifier(file), remove: false });

/** A page born while the variables file exists imports it from its first byte:
 * the rule above, applied to the files a gesture CREATES — Add Page, the AI's
 * add_page and write_file, a restored or renamed page (task-268). */
export async function withVariablesImport(projectId: string, projectPath: string, files: DurableFileChange[]): Promise<DurableFileChange[]> {
  const born = (file: DurableFileChange) => file.beforeSource === null && file.afterSource !== null && /^src\/pages\/.+\.astro$/.test(file.file);
  if (!files.some(born) || await readProjectedSourceState(projectId, VARIABLES_CSS_FILE) === null) return files;
  const targets = await variablesImportTargets(projectId, projectPath, new Map(files.map(file => [file.file, file])));
  return files.map(file => born(file) && targets.has(file.file)
    ? { ...file, afterSource: applyStructuralTransform(file.afterSource!, variablesImport(file.file)).content } : file);
}

/** CSS and every import are one immutable source projection, with identity
 * maps for existing layout elements shifted by new frontmatter imports. */
export async function prepareVariablesCommand(projectId: string, projectPath: string, css: string,
  inGesture: Map<string, DurableFileChange> = new Map()): Promise<MaterializationCommand> {
  if (projectPath !== `wc://${projectId}`) throw new Error('Variables intent belongs to another project');
  const read = (file: string) => inGesture.has(file) ? Promise.resolve(inGesture.get(file)!.afterSource) : readProjectedSourceState(projectId, file);
  const targets = await variablesImportTargets(projectId, projectPath, inGesture);
  const files: DurableFileChange[] = [{ file: VARIABLES_CSS_FILE, beforeSource: await read(VARIABLES_CSS_FILE), afterSource: css }];
  const imports: Array<{ file: string; name: string; importPath: string }> = [];
  for (const file of targets) {
    const beforeSource = await read(file);
    if (beforeSource === null) continue;
    const op = variablesImport(file); imports.push({ file, name: '', importPath: op.importPath });
    const result = applyStructuralTransform(beforeSource, op);
    if (result.content !== beforeSource) files.push({ file, beforeSource, afterSource: result.content,
      identityMaps: [structuralIdentityMap(beforeSource, result.content, op, result)] });
  }
  return { kind: 'variables-css', payload: { projectPath, file: VARIABLES_CSS_FILE, css, imports, preparedFiles: files } };
}

export function acceptVariablesCss(projectId: string, projectPath: string, css: string, operationId = crypto.randomUUID()) {
  return acceptFeature(projectId, operationId, () => prepareVariablesCommand(projectId, projectPath, css));
}

export async function prepareFeatureProjections(projectId: string, revision: number, commands: MaterializationCommand[], variablesCss?: string): Promise<void> {
  if (variablesCss === undefined && !commands.some(command => command.kind === 'layout-append' && !command.payload.preparedFiles)) return;
  await withProjectedSource(projectId, revision, async () => {
    const files = new Map<string, DurableFileChange>();
    for (const [index, command] of commands.entries()) {
      validateFeatureCommand(projectId, command);
      if (command.kind === 'class-write' || command.kind === 'source-batch') await prepareClassIdentities(projectId, revision, commands.slice(0, index + 1), true);
      if (command.kind === 'layout-append' && !command.payload.preparedFiles) {
        const file = command.payload.pageFile;
        const source = files.has(file) ? files.get(file)!.afterSource : await readProjectedSourceState(projectId, file);
        if (source === null) throw new Error('Layout source does not exist');
        command.payload.preparedFiles = [prepareLayoutAppend(source, command.payload)];
      }
      const changes = command.kind === 'file-batch' ? command.payload.files : 'preparedFiles' in command.payload ? command.payload.preparedFiles ?? [] : [];
      for (const change of changes) files.set(change.file, change);
    }
    if (variablesCss !== undefined) commands.push(await prepareVariablesCommand(projectId, `wc://${projectId}`, variablesCss, files));
  });
}
