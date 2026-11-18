import { localFetch } from '@/utils/sqLocalBase';
import type { MutationSnapshot } from '@/store/documentMutation';
import { acceptFileChanges, projectIdForFolder } from './fileAcceptance';
import { projectedSourceFiles, readProjectedSourceState } from './projectedSource';
import type { DurableFileChange, SourceIdentityMap } from './types';
import { createSourceIdentityMap, type PreservedSourceSpan } from '@/vite-plugin/source-transform-identity';
import { inspectAcceptedProject } from './acceptance';
import { withProjectedSource } from './projectedSource';
import { decodeLayouts } from '@/hooks/discoveryDecode';
import { readJsonResponse } from '@/utils/readJsonResponse';

type LayoutIntent = { action: 'create'; name: string; astroContent: string }
  | { action: 'delete' | 'inline-delete'; name: string };

export interface LayoutFileSnapshot {
  file: string;
  content: string;
  expectedSource?: string | null;
  identityMaps?: SourceIdentityMap[];
}

function projectedFiles(projectId: string) {
  return Object.fromEntries(projectedSourceFiles(projectId).filter(change => change.file.startsWith('src/') && !change.encoding)
    .map(change => [change.file, change.afterSource]));
}

export function readAcceptedLayouts(folder: string, signal?: AbortSignal) {
  const projectId = projectIdForFolder(folder);
  return inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision, async () => {
    const response = await localFetch('/__sq/local/layout-plan', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', path: folder, projectedFiles: projectedFiles(projectId) }) });
    return readJsonResponse(response, value => decodeLayouts((value as { layouts?: unknown } | null)?.layouts));
  }));
}

export function acceptLayoutFileChange(folder: string, intent: LayoutIntent, snapshot?: MutationSnapshot) {
  const projectId = projectIdForFolder(folder), frozen = structuredClone(intent);
  return acceptFileChanges(folder, async () => {
    const response = await localFetch('/__sq/local/layout-plan', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...frozen, path: folder,
        projectedFiles: projectedFiles(projectId),
      }) });
    const result = await response.json() as { files?: Array<DurableFileChange & { preservedSpans?: PreservedSourceSpan[] }>; error?: string };
    if (!response.ok || !Array.isArray(result.files)) throw new Error(result.error ?? 'Layout preparation failed');
    return result.files.map(({ preservedSpans, ...file }) => preservedSpans && file.beforeSource !== null && file.afterSource !== null
      ? { ...file, identityMaps: [createSourceIdentityMap(file.beforeSource, file.afterSource, preservedSpans)] } : file);
  }, undefined, undefined, snapshot);
}

export function acceptLayoutFileRestore(folder: string, files: LayoutFileSnapshot[], snapshot?: MutationSnapshot) {
  const projectId = projectIdForFolder(folder), frozen = structuredClone(files);
  return acceptFileChanges(folder, async () => {
    if (!frozen.length || new Set(frozen.map(file => file.file)).size !== frozen.length) throw new Error('Invalid layout restore files');
    return Promise.all(frozen.map(async ({ file, content, expectedSource, identityMaps }) => {
      if (!file.startsWith('src/') || !file.endsWith('.astro') || /[\\\0]/.test(file)
        || file.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
        || typeof content !== 'string') throw new Error('Invalid layout restore file');
      const beforeSource = await readProjectedSourceState(projectId, file);
      if (expectedSource !== undefined && beforeSource !== expectedSource) throw new Error(`Layout restore source changed: ${file}`);
      return { file, beforeSource, afterSource: content, ...(identityMaps?.length ? { identityMaps } : {}) };
    }));
  }, undefined, undefined, snapshot);
}
