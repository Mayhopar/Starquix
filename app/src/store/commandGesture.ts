import * as Y from 'yjs';
import { applyCommand } from './commands';
import { prepareEditorCommand, classifyEditorAction } from './durableDispatch';
import { parseKey, type EditorCommand } from './types';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { classCommands, writesSourceClasses } from '@/services/durableEdits/classCommands';
import { isGridCommand, gridCommandClasses } from '@/utils/gridGeometry';
import { textCommands } from '@/services/durableEdits/textCommands';
import { capturePropOverride, preparePropOverrides, stampMasterFileValue } from '@/services/durableEdits/propOverrideCommands';
import type { DurableFileChange, MaterializationCommand } from '@/services/durableEdits/types';
import { LINK_MARKUP_FIELD, LINK_MARKUP_OWNER_FIELD, SOURCE_OWNED_FIELD, sourceOwnedImageValues, linkMarkupOwner, spliceLinkMarkupText, type LinkMarkupOwner } from './sourceOverrideEntries';
import { prepareSourceImageChanges } from '@/services/durableEdits/sourceAttributeAcceptance';
import { withProjectedSource } from '@/services/durableEdits/projectedSource';
import { captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { commitMutationSnapshot, type MutationSnapshot } from './documentMutation';
import { isLocalProjectId } from '@/utils/localMode';
import { registeredSourceLocation, currentScannedSourceLocation } from '@/utils/sourceLocationKey';
import { getLocalSourceScanRevision } from '@/utils/localPageSync';
import { sameProjectedSourceIdentity, resolveProjectedSourceLocation, isRetiredSourceIdentity } from '@/services/durableEdits/sourceIdentity';
import { getFileValue } from '@/services/classWriteBaseline';
import { encodeInnerHtmlEntities } from '../../../preview-template/src/plugins/sq-prop-fallback.js';
import { captureSourceClassTarget, prepareSourceClassTarget, applySourceClassTarget, stampAcceptedSourceClass,
  type PreparedClassTarget } from '@/services/durableEdits/sourceClassIdentity';

/** One frozen gesture; reducer seeds and dependent commands share staging. */
export async function acceptEditorCommands(doc: Y.Doc, input: EditorCommand[], snapshot?: MutationSnapshot,
  sourceCommands: MaterializationCommand[] = []) {
  const projectId = doc.getMap('meta').get('projectId');
  if (typeof projectId !== 'string' || !projectId) throw new Error('Project storage is not ready');
  const actions = input.map(action => {
    if ((action.type === 'UPDATE_SOURCE_CLASSES' || action.type === 'UPDATE_SOURCE_TEXT' || action.type === 'UPDATE_SOURCE_MARKUP') && !action.sourceLocation) {
      return prepareEditorCommand({ ...action, sourceLocation: currentScannedSourceLocation(projectId, action.sourceKey) });
    }
    if (isGridCommand(action) && !action.sourceLocation) {
      return prepareEditorCommand({ ...action, sourceLocation: currentScannedSourceLocation(projectId, action.key) });
    }
    return prepareEditorCommand(action);
  });
  for (const action of actions) if (action.type === 'UPDATE_SOURCE_TEXT' && action.sourceLocation?.sourceVersion) {
    const current = currentScannedSourceLocation(projectId, action.sourceKey), loc = action.sourceLocation;
    if (current && current.sourceVersion === loc.sourceVersion && current.sourceRevision === loc.sourceRevision
      && current.line === loc.line && current.column === loc.column) action.originalText = getFileValue('text', action.sourceKey) ?? action.originalText;
  }
  if (actions.some(action => classifyEditorAction(action) !== 'project')) throw new Error('Session action inside project gesture');
  const origin = captureLocalWriteOrigin();
  const commands = structuredClone(sourceCommands);
  const imageTargets = new Map(actions.flatMap(action => {
    if (!isLocalProjectId(projectId) || action.type !== 'UPDATE_IMAGE_ATTRIBUTE') return [];
    const location = currentScannedSourceLocation(projectId, action.elementId)
      ?? registeredSourceLocation(doc, action.elementId, 'sourceImageAttributes');
    return location && writesSourceClasses(location, origin) ? [[action, { location, attribute: action.attribute, value: action.value }] as const] : [];
  }));
  const prepareImages = prepareSourceImageChanges(projectId, [...imageTargets.values()], false, origin);
  const sourceTextResults: Array<{ sourceKey: string; retainedMarkup: boolean }> = [];
  const classTargets = new Map(actions.flatMap(action => {
    const key = action.type === 'UPDATE_SOURCE_CLASSES' ? action.sourceKey
      : isGridCommand(action) ? action.key : undefined;
    return key ? [[action, { key, target: captureSourceClassTarget(projectId, key, 'sourceLocation' in action ? action.sourceLocation : undefined) }] as const] : [];
  }));
  const preparedClassTargets = new Map<EditorCommand, PreparedClassTarget | undefined>();
  // Instance class/text edits on a page live in files as props (utils/propOverrides.ts).
  // Text: the value is what the file write would carry — inline markup when the
  // element has a link carrier (resolved in prepareMarkupTargets), else plain text.
  // A canvas grid placement (drag, resize) is a class edit too: without the
  // prop a card inside a placed component moved on canvas only (2026-11-12).
  const propTargets = actions.flatMap(action => {
    const grid = isGridCommand(action);
    if (!grid && action.type !== 'UPDATE_SOURCE_CLASSES' && action.type !== 'UPDATE_SOURCE_TEXT' && action.type !== 'UPDATE_SOURCE_MARKUP') return [];
    const key = grid ? action.key : action.sourceKey;
    const kind = grid || action.type === 'UPDATE_SOURCE_CLASSES' ? 'class' as const : 'text' as const;
    const target = capturePropOverride(key, action.sourceLocation, origin, kind);
    return target ? [{ action, key, target }] : [];
  });
  const propValue = (action: EditorCommand): string => {
    if (action.type === 'UPDATE_SOURCE_CLASSES') return action.classes;
    // The classes the grid reducer is about to write, from the same start.
    if (isGridCommand(action)) return gridCommandClasses(preparedClassTargets.get(action)?.classes
      ?? (doc.getMap<Y.Map<unknown>>('sourceClasses').get(action.key)?.get('classes') as string | undefined) ?? '', action);
    if (action.type === 'UPDATE_SOURCE_MARKUP') return action.markup;
    return resolvedText.get(action) ?? encodeInnerHtmlEntities((action as Extract<EditorCommand, { type: 'UPDATE_SOURCE_TEXT' }>).textContent);
  };
  let acceptedRevision = 0;
  const prepareClassTargets = async (revision: number) => {
    acceptedRevision = revision + 1;
    for (const [action, { key, target }] of classTargets) preparedClassTargets.set(action,
      await prepareSourceClassTarget(projectId, doc.getMap<Y.Map<unknown>>('sourceClasses').get(key), target, revision, doc));
  };
  type MarkupTarget = { markup: string; owner: LinkMarkupOwner };
  const markupTargets = new Map<EditorCommand, MarkupTarget | undefined>();
  /** The inline markup a text action's file write carries (link carrier spliced). */
  const resolvedText = new Map<EditorCommand, string>();
  let retainedMarkup: Map<string, MarkupTarget> | undefined;
  const resetTextAnchors = new Set<EditorCommand>();
  let markupRevision = 0;
  const prepareMarkupTargets = async (revision: number) => {
    markupRevision = revision + 1;
    if (!isLocalProjectId(projectId)) return;
    if (!actions.some(action => (action.type === 'UPDATE_SOURCE_MARKUP' || action.type === 'UPDATE_SOURCE_TEXT') && action.sourceLocation?.sourceVersion)) return;
    // A coordinate is just an index. Relocate the complete owned carrier set
    // together, so claiming an old key never destroys the moved occupant.
    const carriers = new Map<string, MarkupTarget>();
    const coordinate = async (location: import('@/bridge').SourceLocation) => {
      const projected = await resolveProjectedSourceLocation(projectId, location, location.sourceRevision ?? 0, revision);
      return `${projected.file}:${projected.line}:${projected.column}`;
    };
    const candidates: MarkupTarget[] = [];
    doc.getMap<Y.Map<unknown>>('sourceLinkAttributes').forEach(entry => {
      const markup = entry.get(LINK_MARKUP_FIELD), owner = linkMarkupOwner(entry);
      if (typeof markup === 'string' && owner?.location.sourceVersion) candidates.push({ markup, owner });
    });
    candidates.sort((a, b) => (a.owner.acceptedRevision ?? 0) - (b.owner.acceptedRevision ?? 0)
      || (a.owner.actionIndex ?? 0) - (b.owner.actionIndex ?? 0));
    for (const candidate of candidates) {
      try { carriers.set(await coordinate(candidate.owner.location), candidate); }
      catch (error) { if (!isRetiredSourceIdentity(error)) throw error; }
    }
    for (const [index, action] of actions.entries()) {
      if ((action.type !== 'UPDATE_SOURCE_MARKUP' && action.type !== 'UPDATE_SOURCE_TEXT') || !action.sourceLocation?.sourceVersion) continue;
      const identityKey = await coordinate(action.sourceLocation);
      const owner = { location: action.sourceLocation, acceptedRevision: markupRevision, actionIndex: index };
      if (action.type === 'UPDATE_SOURCE_MARKUP') {
        carriers.set(identityKey, { markup: action.markup, owner });
        continue;
      }
      const textEntry = doc.getMap<Y.Map<unknown>>('sourceText').get(action.sourceKey);
      const textOwner = (textEntry?.get('sourceLocation') as Y.Map<unknown> | undefined)?.toJSON() as import('@/bridge').SourceLocation | undefined;
      if (textEntry && !await sameProjectedSourceIdentity(projectId, textOwner, action.sourceLocation, revision)) resetTextAnchors.add(action);
      const candidates = [...carriers.values()].sort((a, b) =>
        (b.owner.acceptedRevision ?? 0) - (a.owner.acceptedRevision ?? 0) || (b.owner.actionIndex ?? 0) - (a.owner.actionIndex ?? 0));
      let selected: MarkupTarget | undefined;
      for (const candidate of candidates) if (await sameProjectedSourceIdentity(projectId, candidate.owner.location, action.sourceLocation, revision)) {
        selected = candidate; break;
      }
      markupTargets.set(action, selected);
      const markup = selected && spliceLinkMarkupText(selected.markup, action.textContent);
      if (markup !== undefined && markup !== null) { carriers.set(identityKey, { markup, owner }); resolvedText.set(action, markup); }
      else carriers.delete(identityKey);
    }
    retainedMarkup = carriers;
  };
  const holdKeys = new Set<string>();
  const accepted = await acceptProjectEdit(doc, { projectId, operationId: crypto.randomUUID(), commands, holdKeys,
    prepare: async revision => {
      await prepareClassTargets(revision); await prepareMarkupTargets(revision);
      if (imageTargets.size) await withProjectedSource(projectId, revision, async () => {
        const files = await prepareImages();
        if (files.length) commands.push({ kind: 'file-batch', payload: { files } });
      });
      // ponytail: planned from the accepted source, not on top of the image batch
      // above — one gesture editing a page <img> AND an instance prop on the same
      // page file would conflict (AI batches only; the UI never does both).
      const propFiles = await preparePropOverrides(projectId, revision, propTargets.map(p => ({ target: p.target, value: propValue(p.action), key: p.key })));
      if (propFiles) commands.push(propFiles);
    },
    mutate: staged => {
    snapshot?.stage(staged);
    const seededClassTargets = new Set<string>();
    for (const action of actions) {
      if (action.type === 'UPDATE_SOURCE_TEXT' && resetTextAnchors.has(action)) {
        const entry = staged.getMap<Y.Map<unknown>>('sourceText').get(action.sourceKey);
        entry?.delete('baseText'); entry?.delete('fileText');
      }
      if (action.type === 'UPDATE_SOURCE_TEXT' && markupTargets.has(action)) {
        const map = staged.getMap<Y.Map<unknown>>('sourceLinkAttributes');
        const target = markupTargets.get(action);
        let entry = map.get(action.sourceKey);
        if (target) {
          if (!entry) { entry = new Y.Map<unknown>(); map.set(action.sourceKey, entry); }
          entry.set(LINK_MARKUP_FIELD, target.markup);
          entry.set(LINK_MARKUP_OWNER_FIELD, JSON.stringify(target.owner));
        } else if (entry) {
          entry.delete(LINK_MARKUP_FIELD); entry.delete(LINK_MARKUP_OWNER_FIELD);
        }
      }
      const target = classTargets.get(action);
      if (target && !seededClassTargets.has(target.key)) {
        applySourceClassTarget(staged, target.key, preparedClassTargets.get(action));
        seededClassTargets.add(target.key);
      }
      const sourceClassKey = action.type === 'UPDATE_SOURCE_CLASSES' && isLocalProjectId(projectId) && parseKey(action.sourceKey)?.type === 'source' ? action.sourceKey : null;
      const sourceEntry = sourceClassKey ? staged.getMap<Y.Map<unknown>>('sourceClasses').get(sourceClassKey) : undefined;
      const sourceBaseline = sourceEntry?.get('classes') as string | undefined;
      const grid = isGridCommand(action) ? action : null;
      const prior = grid ? staged.getMap<Y.Map<unknown>>('sourceClasses').get(grid.key)?.get('classes') as string | undefined : undefined;
      if (!applyCommand(staged, action)) throw new Error(`Editor action refused: ${action.type}`);
      if (action.type === 'UPDATE_IMAGE_ATTRIBUTE' && imageTargets.has(action)) {
        const entry = staged.getMap<Y.Map<unknown>>('sourceImageAttributes').get(action.elementId);
        if (entry) entry.set(SOURCE_OWNED_FIELD, JSON.stringify({ ...sourceOwnedImageValues(entry), [action.attribute]: action.value }));
      }
      if (sourceClassKey && action.type === 'UPDATE_SOURCE_CLASSES') {
        const location = sourceEntry?.get('sourceLocation') as Y.Map<unknown> | undefined;
        const parsed = parseKey(sourceClassKey);
        const loc = action.sourceLocation ?? location?.toJSON() as import('@/bridge').SourceLocation | undefined
          ?? (parsed?.type === 'source' ? { file: parsed.file, line: parsed.line, column: parsed.col } : undefined);
        const baseline = preparedClassTargets.get(action) ? sourceBaseline ?? action.originalClasses : action.originalClasses ?? sourceBaseline;
        if (propTargets.some(p => p.action === action)) stampMasterFileValue(staged, sourceClassKey);
        const writes = classCommands(loc, action.classes, baseline ?? null, origin, 0);
        commands.push(...writes);
        if (writes.length) {
          holdKeys.add(sourceClassKey);
          staged.getMap<Y.Map<unknown>>('sourceClasses').get(sourceClassKey)?.set(SOURCE_OWNED_FIELD, '1');
          staged.getMap<string>('acceptedSourceClassTargets').set(sourceClassKey, action.classes);
          stampAcceptedSourceClass(staged, loc, action.classes, baseline, acceptedRevision, preparedClassTargets.get(action));
        }
      }
      if ((action.type === 'UPDATE_SOURCE_TEXT' || action.type === 'UPDATE_SOURCE_MARKUP') && isLocalProjectId(projectId)) {
        const parsed = parseKey(action.sourceKey);
        if (parsed?.type === 'source') {
          const entry = staged.getMap<Y.Map<unknown>>('sourceClasses').get(action.sourceKey);
          const location = entry?.get('sourceLocation') as Y.Map<unknown> | undefined;
          const registered = action.sourceLocation ?? location?.toJSON() as import('@/bridge').SourceLocation | undefined
            ?? registeredSourceLocation(staged, action.sourceKey, 'sourceText')!;
          const loc = { ...registered, sourceRevision: registered.sourceRevision ?? getLocalSourceScanRevision() };
          if (action.type === 'UPDATE_SOURCE_TEXT') {
            staged.getMap<Y.Map<unknown>>('sourceText').get(action.sourceKey)?.set('sourceLocation', new Y.Map(Object.entries(loc)));
          }
          const markup = staged.getMap<Y.Map<unknown>>('sourceLinkAttributes').get(action.sourceKey)?.get(LINK_MARKUP_FIELD);
          if (action.type === 'UPDATE_SOURCE_TEXT') sourceTextResults.push({ sourceKey: action.sourceKey, retainedMarkup: typeof markup === 'string' });
          // Files get HTML element content: textContent is plain text, encode it.
          const text = action.type === 'UPDATE_SOURCE_MARKUP' ? action.markup
            : typeof markup === 'string' ? markup : encodeInnerHtmlEntities(action.textContent);
          const writes = textCommands(loc, text, origin);
          commands.push(...writes);
          if (writes.length) {
            if (action.type === 'UPDATE_SOURCE_TEXT') staged.getMap<Y.Map<unknown>>('sourceText').get(action.sourceKey)?.set(SOURCE_OWNED_FIELD, '1');
            if (typeof markup === 'string') {
              const entry = staged.getMap<Y.Map<unknown>>('sourceLinkAttributes').get(action.sourceKey)!;
              entry.set(SOURCE_OWNED_FIELD, '1');
              entry.set(LINK_MARKUP_OWNER_FIELD, JSON.stringify({ location: loc, acceptedRevision: markupRevision, actionIndex: actions.indexOf(action) }));
            }
          }
        }
      }
      if (!grid) continue;
      const entry = staged.getMap<Y.Map<unknown>>('sourceClasses').get(grid.key);
      if (!entry) continue;
      const classes = entry.get('classes') as string;
      const parsed = parseKey(grid.key);
      if (parsed?.type === 'instance-child') {
        if (!applyCommand(staged, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: parsed.instanceId,
          selector: parsed.selector, breakpoint: 'base', classes: classes.split(/\s+/).filter(Boolean) })) throw new Error('Grid instance update refused');
      } else {
        // Grid reducers replace classes directly. Keep the same first-edit
        // anchor and explicit edit marker as UPDATE_SOURCE_CLASSES so undo
        // can restore source even when its snapshot removes the whole entry.
        if (!entry.has('baseClasses') && prior !== undefined) entry.set('baseClasses', prior);
        entry.set('edited', true);
        if (propTargets.some(p => p.action === action)) stampMasterFileValue(staged, grid.key);
        const location = entry.get('sourceLocation') as Y.Map<unknown> | undefined;
        const loc = grid.sourceLocation ?? location?.toJSON() as import('@/bridge').SourceLocation | undefined;
        if (loc) {
          const writes = classCommands(loc, classes, prior ?? null, origin, 0);
          commands.push(...writes);
          if (writes.length) {
            holdKeys.add(grid.key);
            entry.set(SOURCE_OWNED_FIELD, '1');
            staged.getMap<string>('acceptedSourceClassTargets').set(grid.key, classes);
            stampAcceptedSourceClass(staged, loc, classes, prior, acceptedRevision, preparedClassTargets.get(action));
          }
        }
      }
    }
    if (retainedMarkup) {
      const map = staged.getMap<Y.Map<unknown>>('sourceLinkAttributes');
      map.forEach(entry => {
        if (linkMarkupOwner(entry)?.location.sourceVersion) { entry.delete(LINK_MARKUP_FIELD); entry.delete(LINK_MARKUP_OWNER_FIELD); }
      });
      for (const [key, carrier] of retainedMarkup) {
        let entry = map.get(key);
        if (!entry) { entry = new Y.Map<unknown>(); map.set(key, entry); }
        entry.set(LINK_MARKUP_FIELD, carrier.markup);
        entry.set(LINK_MARKUP_OWNER_FIELD, JSON.stringify(carrier.owner));
        entry.set(SOURCE_OWNED_FIELD, '1');
      }
    }
  } });
  const files = new Map<string, DurableFileChange>();
  for (const command of commands) {
    const changes = command.kind === 'file-batch' ? command.payload.files
      : command.kind === 'source-batch' || command.kind === 'class-write' ? command.payload.preparedFiles ?? [] : [];
    for (const change of changes) {
      const previous = files.get(change.file);
      files.set(change.file, previous ? { ...change, beforeSource: previous.beforeSource,
        identityMaps: [...previous.identityMaps ?? [], ...change.identityMaps ?? []] } : structuredClone(change));
    }
  }
  try {
    if (files.size) snapshot?.attachFiles?.([...files.values()]);
    const commandIds = commands.flatMap((command, index) => command.kind === 'layout-append'
      || (command.kind === 'source-batch' && !command.payload.preparedFiles) ? [JSON.stringify([accepted.operationId, index])] : []);
    if (commandIds.length) snapshot?.attachSourceReceipts?.({ commandIds, direction: 'before' });
  } catch (error) { console.error('Source inverse observer failed after durable acceptance', error); }
  commitMutationSnapshot(snapshot);
  return { ...accepted, sourceTextResults };
}
