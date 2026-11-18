/** Bundled public dependencies only; actual project source wins on reuse. */
import { loadSnapshot } from '@/services/snapshotLoader';
import type { DurableFileChange } from '@/services/durableEdits/types';
import { acceptFileChanges, finishAcceptedFiles, projectIdForFolder } from '@/services/durableEdits/fileAcceptance';
import { readProjectedSourceState } from '@/services/durableEdits/projectedSource';
import { encodeFileBytes } from '@/services/durableEdits/fileEncoding';

export type AssetSource = { content: string; bundled: boolean };
type Asset = { file: string; bytes: Uint8Array };
const ASSET_REF = /(?:^|[\s'"`(=])((?:\/assets\/)[^\s'"`<>)},;]+)/g;
const SAFE_ASSET = /^public\/assets\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** Preflight the entire closure before the first mutation. Literal references
 * include CSS url(), img src and frontmatter arrays. URLs stay byte-exact. */
export async function planLibraryAssets(sources: AssetSource[]): Promise<Asset[]> {
  const references = new Map<string, boolean>();
  for (const source of sources) {
    for (const match of source.content.matchAll(ASSET_REF)) {
      const file = `public${match[1].split(/[?#]/, 1)[0]}`;
      if (!SAFE_ASSET.test(file) || file.split('/').some(part => part === '.' || part === '..')) {
        throw new Error(`invalid bundled asset reference: ${match[1]}`);
      }
      references.set(file, (references.get(file) ?? false) || source.bundled);
    }
  }
  if (!references.size) return [];
  const snapshot = await loadSnapshot();
  const assets: Asset[] = [];
  for (const [file, required] of references) {
    const content = snapshot[file];
    if (content === undefined && !required) continue; // user's own assets are theirs
    if (content === undefined || (typeof content !== 'string' && !(content instanceof Uint8Array))) {
      throw new Error(`could not read the bundled asset ${file}`);
    }
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    if (!bytes.byteLength) throw new Error(`could not read the bundled asset ${file}`);
    assets.push({ file, bytes });
  }
  return assets;
}

export async function createLibraryAssets(projectPath: string, assets: Asset[], collect?: DurableFileChange[]): Promise<string[]> {
  const created: string[] = [];
  const files: DurableFileChange[] = [];
  const projectId = projectIdForFolder(projectPath);
  const prepare = async () => {
    for (const { file, bytes } of assets) {
      if (await readProjectedSourceState(projectId, file, 'base64') !== null) continue;
      files.push({ file, encoding: 'base64', beforeSource: null, afterSource: encodeFileBytes(bytes) });
      created.push(file);
    }
    return files;
  };
  if (collect) collect.push(...await prepare());
  else await finishAcceptedFiles(await acceptFileChanges(projectPath, prepare));
  return created;
}

/** Read the accepted file and relative Astro closure from the same planning
 * projection. Scan HTML omits frontmatter; runtime files may still await ACK. */
export async function readProjectAssetSources(projectPath: string, file: string): Promise<AssetSource[]> {
  const projectId = projectIdForFolder(projectPath);
  const seen = new Set<string>();
  const sources: AssetSource[] = [];
  const visit = async (current: string): Promise<void> => {
    if (seen.has(current)) return;
    if (!current.startsWith('src/components/') || current.split('/').some(part => !part || part === '.' || part === '..') || /[\\%\0]/.test(current) || !current.endsWith('.astro')) {
      throw new Error(`invalid project component path: ${current}`);
    }
    seen.add(current);
    const content = await readProjectedSourceState(projectId, current);
    if (content === null) throw new Error(`could not read your component ${current}`);
    if (!content || content.includes('\0')) throw new Error(`invalid project component source: ${current}`);
    sources.push({ content, bundled: false });
    const frontmatter = content.match(/^---[\s\S]*?---/)?.[0] ?? '';
    for (const match of frontmatter.matchAll(/import\s+[^'"]*?['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.') || !spec.endsWith('.astro')) continue;
      const parts = current.split('/').slice(0, -1);
      for (const part of spec.split('/')) {
        if (part === '..') parts.pop();
        else if (part && part !== '.') parts.push(part);
      }
      const dep = parts.join('/');
      if (dep.startsWith('src/components/')) await visit(dep);
    }
  };
  await visit(file);
  return sources;
}

export async function reconcileProjectComponentAssets(projectPath: string, file: string, collect?: DurableFileChange[]): Promise<string[]> {
  return createLibraryAssets(projectPath, await planLibraryAssets(await readProjectAssetSources(projectPath, file)), collect);
}
