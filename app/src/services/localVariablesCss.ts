/** Variables owners commit CSS/import commands with their document gesture.
 * These compatibility entry points schedule that durable projection only. */
import { localFetch } from '@/utils/sqLocalBase';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { requestMaterialization } from './durableEdits/materializer';
import { flushDurableSourceWrites } from './durableEdits/sourceMaterialization';
import { acceptVariablesCss } from './durableEdits/featureAcceptance';
import { projectIdFromPath } from '@/utils/localMode';

export const VARIABLES_CSS_FILE = 'src/styles/sq-variables.css';
export type VariablesSetupFailure = 'setup-conflict' | 'setup-read-unavailable' | 'setup-unconfirmed';
export type VariablesSetupEvent = { type: 'queued' | 'settled' } | { type: 'failed'; failure: VariablesSetupFailure }
  | { type: 'import-start'; id: string } | { type: 'import-result'; id: string; added: boolean | null };
export class VariablesImportNotReady extends Error {}
export const isVariablesImportDeferred = (error: unknown): boolean => error instanceof VariablesImportNotReady;
export interface LocalVariablesDeps {
  writeImport: (file: string, name: string, importPath: string) => Promise<unknown>;
  fetch: typeof localFetch;
}
const defaultDeps: LocalVariablesDeps = {
  writeImport: async (file, name, importPath) => (await import('./ViteStructuralWriter')).viteStructuralWriter.writeImport(file, name, importPath, false, false, true),
  fetch: localFetch,
};
export function variablesImportSpecifier(fromFile: string): string {
  const from = fromFile.split('/').slice(0, -1), to = VARIABLES_CSS_FILE.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const relative = [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export async function persistLocalVariablesCss(projectPath: string, css: string): Promise<void> {
  const projectId = projectIdFromPath(projectPath);
  if (!projectId) throw new Error('Variables require a persistent project identity');
  await acceptVariablesCss(projectId, projectPath, css);
}
export function flushLocalVariablesCss(projectPath: string): Promise<void> {
  return flushDurableSourceWrites(projectIdFromPath(projectPath) ?? projectPath);
}
export function flushPendingLocalVariablesCss(): Promise<void> {
  const projectId = getActiveSaveProjectId();
  return projectId ? flushDurableSourceWrites(projectId) : Promise.resolve();
}
/** Compatibility save coordinator sees no memory-owned variables work. */
export function hasPendingLocalVariablesCss(): boolean { return false; }
export function hasUnsavedLocalVariablesCss(): boolean { return false; }
export function observeLocalVariablesSetup(_path: string, listener: (event: VariablesSetupEvent) => void): () => void {
  listener({ type: 'settled' }); return () => {};
}
export async function resumeLocalVariablesCss(projectPath: string, isCurrent: () => boolean): Promise<void> {
  const projectId = projectIdFromPath(projectPath);
  if (isCurrent() && projectId) requestMaterialization(projectId);
}
export async function retryLocalVariablesSetup(projectPath: string, isCurrent: () => boolean): Promise<boolean> {
  await resumeLocalVariablesCss(projectPath, isCurrent); return false;
}
export function _resetLocalVariablesCss(): void { /* Durable state belongs to the project database. */ }

/** Explicit import callers retain the scoped structural acceptance writer. */
export async function ensureVariablesImport(projectPath: string, deps: LocalVariablesDeps = defaultDeps, isCurrent: () => boolean = () => true): Promise<string[]> {
  const response = await deps.fetch(`/__sq/local/scan-layouts?path=${encodeURIComponent(projectPath)}`);
  if (!response.ok) throw new Error(`Variables layouts could not be read (${response.status})`);
  let targets = ((await response.json()) as Array<{ path: string }>).map(layout => `src/layouts/${layout.path}`);
  if (!targets.length) {
    const response = await deps.fetch(`/__sq/local/pages?path=${encodeURIComponent(projectPath)}`);
    if (!response.ok) throw new Error(`Variables pages could not be read (${response.status})`);
    const pages = (await response.json() as { pages?: Array<{ route: string; file: string }> }).pages ?? [];
    targets = pages.map(page => page.file).filter(file => file.endsWith('.astro')); // no layout: every page (task-268)
  }
  for (const file of targets) {
    if (!isCurrent()) throw new VariablesImportNotReady('Variables import owner changed');
    const result = await deps.writeImport(file, '', variablesImportSpecifier(file));
    if (result === false || (result && typeof result === 'object' && 'success' in result && result.success === false)) throw new Error('Variables import refused');
  }
  return targets;
}
