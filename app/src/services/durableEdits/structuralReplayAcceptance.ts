import type * as Y from 'yjs';
import type { StructuralOp, StructuralUndoStep } from '@/store/structuralUndo';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { structuralFile, applyStructuralTransform } from './structuralTransform';
import type { DurableFileChange } from './types';
import { stripStamps } from '@/utils/stampAttr';
import { readProjectedSourceState } from './projectedSource';
import { acceptFileChanges, preparePageFilePlan, projectIdForFolder } from './fileAcceptance';
import { applyCommand } from '@/store/commands';
import type { EditorCommand } from '@/store/types';
import { localPageId, routeForPageFile } from '@/utils/localMode';
import { prepareFrontmatterPatch, applyPreparedPostPatch } from '@/postmodel/frontmatterPatch';
import { invertIdentityMaps, structuralIdentityMap } from './sourceIdentity';
import { prepareSourceGesture } from './sourceGesture';

/** Replay is one accepted gesture even when the source sequence spans files.
 * Keep consecutive operations on one file in the same pure transform. */
/** `origin`: the page the edit was made on — its replay belongs there, from
 *  whatever page the user is on now (default: the current surface). */
export async function acceptStructuralReplay(doc: Y.Doc, input: StructuralOp[], sourceFiles?: DurableFileChange[], direction: 'before' | 'after' = 'before', sourceSteps?: StructuralUndoStep[], masterWrite = false, origin: LocalWriteOrigin = captureLocalWriteOrigin()) {
  if (sourceFiles?.length) {
    const projectId = doc.getMap('meta').get('projectId') as string;
    // masterWrite: the gesture crossed surfaces on purpose (a Fill-kind
    // conversion inside a component); its undo/redo crosses the same way.
    if (!masterWrite && sourceFiles.some(file => file.identityMaps?.length && isCrossFileAtOrigin(origin, file.file))) throw new Error('Structural replay belongs to another surface');
    return acceptFileChanges(`wc://${projectId}`, sourceFiles.map(file => direction === 'before'
      ? { ...file, beforeSource: file.afterSource, afterSource: file.beforeSource, identityMaps: invertIdentityMaps(file.identityMaps ?? []) } : file), doc);
  }
  const operations = structuredClone(input);
  if (sourceSteps?.length || operations.some(op => op.kind.startsWith('page-') || op.kind === 'content-body')) {
    const projectId = doc.getMap('meta').get('projectId') as string;
    const folder = `wc://${projectId}`;
    projectIdForFolder(folder, doc);
    const actions: EditorCommand[] = [];
    return acceptFileChanges(folder, async () => {
    const files = new Map<string, DurableFileChange>();
    const load = async (file: string) => {
      if (!files.has(file)) {
        const source = await readProjectedSourceState(projectId, file);
        files.set(file, { file, beforeSource: source, afterSource: source });
      }
      return files.get(file)!;
    };
    const steps = sourceSteps?.length ? structuredClone(direction === 'before' ? [...sourceSteps].reverse() : sourceSteps)
      : [{ forward: operations, inverse: operations }];
    for (const step of steps) {
      const stepOperations = direction === 'before' ? step.inverse : step.forward;
      if (step.sourceFiles?.length) {
        for (const original of step.sourceFiles) {
          if (!(masterWrite || step.masterWrite) && original.identityMaps?.length && isCrossFileAtOrigin(origin, original.file)) throw new Error('Structural replay belongs to another surface');
          const change = direction === 'before' ? { ...original, beforeSource: original.afterSource, afterSource: original.beforeSource,
            identityMaps: invertIdentityMaps(original.identityMaps ?? []) } : original;
          const current = await load(change.file);
          if (current.afterSource !== change.beforeSource) throw new Error(`Source changed before acceptance: ${change.file}`);
          current.afterSource = change.afterSource;
          current.identityMaps = [...current.identityMaps ?? [], ...change.identityMaps ?? []];
        }
        // File evidence includes page bytes; preserve the page's document half.
        for (const op of stepOperations) {
          if (op.kind === 'page-delete') actions.push({ type: 'DELETE_PAGE', pageId: op.pageId });
          if (op.kind === 'page-restore') actions.push({ type: 'ADD_PAGE', page: { id: localPageId(op.route), name: op.route, children: [], rootElementIds: [] } });
        }
        continue;
      }
    for (const op of stepOperations) {
      if ('folder' in op) projectIdForFolder(op.folder, doc);
      if (op.kind === 'page-move') {
        if (![op.from, op.to].every(file => file.startsWith('src/pages/') && file.endsWith('.astro'))) throw new Error('Invalid page move');
        const from = await load(op.from); const to = await load(op.to);
        if (from.afterSource === null || to.afterSource !== null) throw new Error('Page move baseline changed');
        to.afterSource = from.afterSource; from.afterSource = null;
      } else if (op.kind === 'page-delete' || op.kind === 'page-restore') {
        if (!op.file.startsWith('src/pages/') || !op.file.endsWith('.astro') || routeForPageFile(op.file) !== op.route) throw new Error('Invalid page target');
        const file = await load(op.file);
        if (op.kind === 'page-delete') {
          if (file.afterSource === null) throw new Error('Page file does not exist');
          file.afterSource = null;
          actions.push({ type: 'DELETE_PAGE', pageId: op.pageId });
        } else {
          if (file.afterSource !== null) throw new Error('Page file already exists');
          file.afterSource = op.content;
          actions.push({ type: 'ADD_PAGE', page: { id: localPageId(op.route), name: op.route, children: [], rootElementIds: [] } });
        }
      } else if (op.kind === 'content-body') {
        const plan = await preparePageFilePlan(folder, { action: 'delete-post', collection: op.collection, slug: op.slug });
        const file = await load(plan.file);
        if (file.afterSource === null) throw new Error('Post file does not exist');
        file.afterSource = applyPreparedPostPatch(file.afterSource, prepareFrontmatterPatch(file.afterSource, {}), op.body);
      } else {
        if (op.kind === 'insert' || op.kind === 'append-page') op.markup = stripStamps(op.markup);
        const name = structuralFile(op);
        if (isCrossFileAtOrigin(origin, name)) throw new Error('Structural edits cannot change another surface file');
        const file = await load(name);
        if (file.afterSource === null) throw new Error('Structural file does not exist');
        const result = applyStructuralTransform(file.afterSource, op);
        (file.identityMaps ??= []).push(structuralIdentityMap(file.afterSource, result.content, op, result));
        file.afterSource = result.content;
      }
    }
    }
    return [...files.values()];
    }, doc, staged => {
      for (const action of actions) if (!applyCommand(staged, action)) throw new Error(`Page replay refused: ${action.type}`);
    });
  }
  const projectId = doc.getMap('meta').get('projectId') as string;
  const gesture = prepareSourceGesture(projectId, [], origin);
  return acceptFileChanges(`wc://${projectId}`, async () => {
    // Legacy undo records already contain sequential coordinates. New records
    // above use the original file evidence, including inverse identities.
    for (const operation of operations) await gesture.apply(operation);
    return [...gesture.files.values()];
  }, doc);
}
