import * as Y from 'yjs';
import type { SourceLocation } from '@/bridge';
import { captureLocalSourceScanClasses } from '@/utils/localPageSync';
import { sameProjectedSourceIdentity, sourceIdentityViews, type SourceIdentityView } from './sourceIdentity';
import { SOURCE_OWNED_FIELD } from '@/store/sourceOverrideEntries';
import { pm } from '@/utils/probeMark';

type ClassTarget = { sourceLocation: SourceLocation; classes?: string };
export const SOURCE_CLASS_CARRIERS = 'acceptedSourceClassCarriers';
export type SourceClassCarrier = { owner: SourceLocation; view: SourceLocation; views?: SourceIdentityView[]; revision: number; classes: string; baseClasses?: string };
export type PreparedClassTarget = ClassTarget & { reset: boolean; views?: SourceIdentityView[]; carrierId?: string; carrier?: SourceClassCarrier };

export function sourceClassCarriers(doc: Y.Doc): Map<string, SourceClassCarrier> {
  const result = new Map<string, SourceClassCarrier>();
  doc.getMap<string>(SOURCE_CLASS_CARRIERS).forEach((raw, id) => { result.set(id, JSON.parse(raw) as SourceClassCarrier); });
  return result;
}

/** Same element identity: file bytes + coordinates, ignoring the scan counter. */
function sameElement(a: SourceLocation, b: SourceLocation): boolean {
  return a.file === b.file && a.line === b.line && a.column === b.column && a.sourceVersion === b.sourceVersion;
}

function sameAddress(a: SourceLocation | undefined, b: SourceLocation): boolean {
  return !!a && sameElement(a, b) && a.sourceRevision === b.sourceRevision;
}

function owner(entry: Y.Map<unknown> | undefined): SourceLocation | undefined {
  return (entry?.get('sourceLocation') as Y.Map<unknown> | undefined)?.toJSON() as SourceLocation | undefined;
}

/** Explicit historical intents never adopt a current scan's class baseline. */
export function captureSourceClassTarget(projectId: string, key: string, sourceLocation?: SourceLocation): ClassTarget | undefined {
  const target = captureLocalSourceScanClasses(projectId, key);
  return target && (!sourceLocation || sameAddress(sourceLocation, target.sourceLocation)) ? target
    : sourceLocation?.sourceVersion ? { sourceLocation } : undefined;
}

// Runtime-probe marks (desktop/probe, the V2 writer probe): which branch produced the value. Hoisted so a call allocates nothing without the recorder.
const BRANCH_CARRIER = { b: 'carrier' }, BRANCH_STALE_OWNER = { b: 'scan-stale-owner' }, BRANCH_ENTRY = { b: 'entry' }, BRANCH_SCAN_FALLBACK = { b: 'scan-fallback' };

/** Synchronous controls see the current scan, while accepted edits made since
 * that scan retain their current doc value under the same owned address. */
export function currentSourceClassValue(entry: Y.Map<unknown> | undefined, target: ClassTarget | undefined, doc?: Y.Doc): string | undefined {
  if (target && doc) {
    const accepted = [...sourceClassCarriers(doc).values()].filter(carrier => carrier.revision > (target.sourceLocation.sourceRevision ?? 0)
      && (sameAddress(carrier.view, target.sourceLocation) || sameAddress(carrier.owner, target.sourceLocation)
        || carrier.views?.some(view => {
          const loc = target.sourceLocation, revision = loc.sourceRevision ?? 0;
          return revision >= view.fromRevision && revision <= view.toRevision && view.location.file === loc.file
            && view.location.line === loc.line && view.location.column === loc.column && view.location.sourceVersion === loc.sourceVersion;
        })))
      .sort((a, b) => b.revision - a.revision)[0];
    if (accepted) { pm('v2:csv', BRANCH_CARRIER); return accepted.classes; }
  }
  // Stale = PROVEN to be another element: a versioned owner whose file bytes
  // (sourceVersion) or coordinates differ. Not the scan counter — every preview
  // reload bumps sourceRevision, so comparing it made every override "stale"
  // after Reset's reload and ⌘Z repainted the master. Not an unversioned owner
  // either (a doc-only placement overlay is never stamped).
  const entryOwner = owner(entry);
  if (target && entryOwner?.sourceVersion !== undefined && !sameElement(entryOwner, target.sourceLocation)) { pm('v2:csv', BRANCH_STALE_OWNER); return target.classes; }
  const own = entry?.get('classes') as string | undefined;
  pm('v2:csv', own === undefined ? BRANCH_SCAN_FALLBACK : BRANCH_ENTRY);
  return own ?? target?.classes;
}

export async function prepareSourceClassTarget(projectId: string, entry: Y.Map<unknown> | undefined,
  target: ClassTarget | undefined, through: number, doc?: Y.Doc): Promise<PreparedClassTarget | undefined> {
  if (!target) return undefined;
  const reset = !await sameProjectedSourceIdentity(projectId, owner(entry), target.sourceLocation, through);
  if (doc) for (const [carrierId, carrier] of [...sourceClassCarriers(doc)].sort((a, b) => b[1].revision - a[1].revision)) {
    if (!await sameProjectedSourceIdentity(projectId, carrier.owner, target.sourceLocation, through)) continue;
    return { ...target, reset, carrierId, carrier, views: await sourceIdentityViews(projectId, carrier.owner, through),
      classes: carrier.revision > (target.sourceLocation.sourceRevision ?? 0) || target.classes === undefined ? carrier.classes : target.classes };
  }
  return { ...target, reset, views: target.sourceLocation.sourceVersion ? await sourceIdentityViews(projectId, target.sourceLocation, through) : undefined };
}

/** Accepted values and original anchors are identity-indexed, not overwritten
 * when another element claims a coordinate. The journal persists this map. */
export function stampAcceptedSourceClass(doc: Y.Doc, location: SourceLocation | undefined, classes: string,
  baseline: string | null | undefined, revision: number, target?: PreparedClassTarget): void {
  if (!location?.sourceVersion) return;
  const id = target?.carrierId ?? JSON.stringify([location.file, location.sourceVersion, location.sourceRevision ?? 0, location.line, location.column]);
  const carrier = sourceClassCarriers(doc).get(id) ?? target?.carrier;
  const value: SourceClassCarrier = { owner: carrier?.owner ?? location, view: location, views: target?.views, revision, classes,
    ...(carrier?.baseClasses !== undefined ? { baseClasses: carrier.baseClasses } : baseline != null ? { baseClasses: baseline } : {}) };
  doc.getMap<string>(SOURCE_CLASS_CARRIERS).set(id, JSON.stringify(value));
}

/** Undo restores semantic values, then stamps them as a NEW accepted revision.
 * A refreshed scan is only a view address; it never outranks this chronology. */
export async function prepareSourceClassReplay(projectId: string, doc: Y.Doc, snapshot: Record<string, string> | undefined,
  through: number): Promise<Map<string, SourceClassCarrier>> {
  const result = new Map<string, SourceClassCarrier>();
  if (!snapshot) return result;
  const before = sourceClassCarriers(doc);
  for (const id of new Set([...before.keys(), ...Object.keys(snapshot)])) {
    const previous = before.get(id);
    const saved = snapshot[id] ? JSON.parse(snapshot[id]) as SourceClassCarrier : undefined;
    const classes = saved?.classes ?? previous?.baseClasses;
    if (classes === undefined || (previous && previous.classes === classes)) continue;
    const carrier = saved ?? previous!;
    let view = previous?.view ?? carrier.view;
    const views = await sourceIdentityViews(projectId, carrier.owner, through);
    const projected = views.find(candidate => candidate.toRevision === through)?.location;
    for (const candidate of [projected, view, carrier.owner]) {
      if (!candidate) continue;
      const scan = captureLocalSourceScanClasses(projectId, `${candidate.file}:${candidate.line}:${candidate.column}`);
      if (scan && await sameProjectedSourceIdentity(projectId, carrier.owner, scan.sourceLocation, through)) { view = scan.sourceLocation; break; }
    }
    result.set(id, { ...carrier, view, views, classes, revision: through + 1 });
  }
  return result;
}

/** Rebase only a newly occupied coordinate; a same-element rescan keeps its
 * original anchor. Historical undo snapshots were captured before this step. */
export function applySourceClassTarget(doc: Y.Doc, key: string, target: PreparedClassTarget | undefined): void {
  if (!target) return;
  const entries = doc.getMap<Y.Map<unknown>>('sourceClasses');
  let entry = entries.get(key);
  if (!entry) { entry = new Y.Map<unknown>(); entries.set(key, entry); }
  if (target.reset) {
    for (const field of ['baseClasses', 'fileClasses', 'edited', SOURCE_OWNED_FIELD]) entry.delete(field);
    doc.getMap('acceptedSourceClassTargets').delete(key);
  }
  if (target.carrier?.baseClasses !== undefined) entry.set('baseClasses', target.carrier.baseClasses);
  if (target.classes !== undefined) entry.set('classes', target.classes);
  entry.set('sourceLocation', new Y.Map(Object.entries(target.sourceLocation)));
}
