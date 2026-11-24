import type { SourceLocation } from '@/bridge';
import { readProjectedSourceState } from './projectedSource';
import type { StructuralOp } from '@/store/structuralUndo';
import { db } from '@/db';
import { laneMemo, listProjectRows } from './store';
import { pm } from '@/utils/probeMark';
import type { DurableFileChange, SourceCoordinate, SourceIdentityMap } from './types';
import { sourceVersion, projectCoordinate } from '@/vite-plugin/source-transform-identity';
export { sourceVersion, projectCoordinate } from '@/vite-plugin/source-transform-identity';
// Shared parser primitives used by the structural writer itself.
// @ts-expect-error browser-safe shared transform module
import { scanTopLevelElements, templateStartOffset, resolveElementSpan, dedentBlockLines } from '../../../../preview-template/src/plugins/sq-source-transforms.js';

/** Content version shared with the tagger. Identity is supplied by maps, never
 * inferred by matching text; the version only identifies a scan's source. */

/** A revision is ordering evidence, not proof that a scan describes these
 * bytes. Verify even an initial coordinate with no accepted map history. */
export function assertSourceLocationVersion(loc: SourceLocation, baseline: string | null): void {
  if (loc.sourceVersion && (baseline === null || loc.sourceVersion !== sourceVersion(baseline))) {
    throw new Error('Source target version does not match the projected source baseline');
  }
}

type Node = SourceCoordinate & { start: number; end: number; tag: string };
function nodes(source: string): Node[] {
  const text = source.replace(/\r\n/g, '\n');
  // Line starts once, then a binary search per node: O(S + E log L) instead of re-splitting the
  // prefix for every element (38 ms at E = 509 on a 54 KB page, paid several times per edit).
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const locate = (offset: number): { line: number; column: number } => {
    let low = 0, high = lineStarts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid] <= offset) low = mid; else high = mid - 1; }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };
  const result: Node[] = [];
  const walk = (fragment: string, base: number) => {
    for (const span of scanTopLevelElements(fragment)) {
      const start = base + span.start;
      result.push({ start, end: base + span.end, tag: span.tag, ...locate(start) });
      if (span.closeStart !== null && !/^(script|style|textarea)$/i.test(span.tag)) {
        walk(fragment.slice(span.openEnd, span.closeStart), base + span.openEnd);
      }
    }
  };
  const start = templateStartOffset(text);
  walk(text.slice(start), start);
  return result;
}
const coordinate = (node: SourceCoordinate): SourceCoordinate => ({ line: node.line, column: node.column });

/** Pair survivors by the order explicitly prescribed by this operation.
 * A moved subtree is removed from that order and inserted at its returned
 * landing region, so byte-identical siblings never need text matching. */
export function structuralIdentityMap(before: string, after: string, op: StructuralOp,
  result: Record<string, unknown>): SourceIdentityMap {
  const old = nodes(before), next = nodes(after);
  let survivors = [...old];
  const pairs = new Map<Node, Node>();
  let additions: Node[] = [];
  if (op.kind === 'remove' || op.kind === 'move') {
    const span = resolveElementSpan(before.replace(/\r\n/g, '\n'), op.kind === 'move' ? op.from : op.loc);
    const taken = old.filter(node => node.start >= span.start && node.start < span.end);
    survivors = old.filter(node => !taken.includes(node));
    if (op.kind === 'move') {
      // `>=`: a moved `{cond && (` expression opens on a line with no element.
      const landed = next.findIndex(node => node.line >= (result.insertedLine as number));
      if (landed < 0) throw new Error('Moved source identity has no landing region');
      const moved = next.slice(landed, landed + taken.length);
      taken.forEach((node, i) => pairs.set(node, moved[i]));
      additions = moved;
    }
  } else if (op.kind === 'insert' || op.kind === 'append-page') {
    const start = result.insertedLine as number;
    const count = dedentBlockLines(op.markup.replace(/\r\n/g, '\n')).length;
    additions = next.filter(node => node.line >= start && node.line < start + count);
  } else if (op.kind === 'restore') {
    const normalized = before.replace(/\r\n/g, '\n');
    const offset = normalized.split('\n').slice(0, op.loc.line - 1).reduce((n, line) => n + line.length + 1, 0) + op.loc.column - 1;
    additions = next.filter(node => node.start >= offset && node.start < offset + op.text.replace(/\r\n/g, '\n').length);
  } else if (op.kind === 'restore-region') {
    const start = op.loc.line, end = start + op.lineCount;
    survivors = old.filter(node => node.line < start || node.line >= end);
    const offset = before.replace(/\r\n/g, '\n').split('\n').slice(0, start - 1).reduce((n, line) => n + line.length + 1, 0);
    additions = next.filter(node => node.start >= offset && node.start < offset + op.segment.replace(/\r\n/g, '\n').length);
  }
  const remaining = next.filter(node => !additions.includes(node));
  if (survivors.length !== remaining.length) throw new Error('Structural source identity is ambiguous');
  survivors.forEach((node, i) => {
    if (node.tag !== remaining[i].tag) throw new Error('Structural source identity changed unexpectedly');
    pairs.set(node, remaining[i]);
  });
  const mapped = new Set(pairs.values());
  return { id: crypto.randomUUID(), beforeVersion: sourceVersion(before), afterVersion: sourceVersion(after),
    entries: [...old.map(node => ({ before: coordinate(node), after: pairs.has(node) ? coordinate(pairs.get(node)!) : null })),
      ...next.filter(node => !mapped.has(node)).map(node => ({ before: null, after: coordinate(node) }))] };
}

/** Attribute-only edits preserve the complete structural order. */
export function attributeIdentityMap(before: string, after: string): SourceIdentityMap {
  return structuralIdentityMap(before, after, { kind: 'import', pageFile: '', name: '', importPath: '', remove: false }, {});
}

export function invertIdentityMaps(maps: SourceIdentityMap[]): SourceIdentityMap[] {
  return [...maps].reverse().map(map => ({ ...map, inverse: !map.inverse,
    beforeVersion: map.afterVersion, afterVersion: map.beforeVersion,
    entries: map.entries.map(entry => ({ before: entry.after, after: entry.before })) }));
}


/** Read immutable accepted evidence, including already materialized commands.
 * Source ACK changes bytes only; it cannot retire identities a preview holds. */
function acceptedSourceChanges(projectId: string, file: string): Promise<Array<{ revision: number; change: DurableFileChange }>> {
  // Inside an acceptance slot the answer is computed once per file (callers only filter/map it).
  return laneMemo(projectId, `changes:${file}`, () => readAcceptedSourceChanges(projectId, file));
}
async function readAcceptedSourceChanges(projectId: string, file: string): Promise<Array<{ revision: number; change: DurableFileChange }>> {
  pm('sc:start');
  const rows = await listProjectRows(projectId);
  pm('sc:rows', { n: rows.length });
  let rc = 0;
  const result: Array<{ revision: number; change: DurableFileChange }> = [];
  for (const row of rows) for (const [index, command] of row.commands.entries()) {
    let files: DurableFileChange[] = command.kind === 'file-batch' ? command.payload.files
      : 'preparedFiles' in command.payload ? command.payload.preparedFiles ?? [] : [];
    if (!files.length) {
      rc++;
      const receipt = await db.durableCommandReceipts.get([projectId, JSON.stringify([row.operationId, index])]);
      files = receipt?.prepared.files ?? [];
    }
    for (const change of files) if (change.file === file) result.push({ revision: row.revision, change });
  }
  pm('sc:end', { rc, n: result.length });
  return result;
}

export async function acceptedIdentityMaps(projectId: string, file: string): Promise<Array<{ revision: number; map: SourceIdentityMap }>> {
  return (await acceptedSourceChanges(projectId, file)).flatMap(({ revision, change }) =>
    (change.identityMaps ?? []).map(map => ({ revision, map })));
}

/** Recover the exact selector baseline from accepted CAS evidence. Positional
 * write-back keys cannot be reinterpreted against a later reordered file. */
export async function sourceSelectorProjection(projectId: string, file: string, revision: number,
  current: string, inGesture: DurableFileChange[] = [], version?: string): Promise<{ source: string; maps: SourceIdentityMap[] }> {
  const changes = (await acceptedSourceChanges(projectId, file)).filter(item => item.revision > revision)
    .map(item => item.change).concat(inGesture);
  const source = changes[0]?.beforeSource ?? current;
  if (changes[0]?.beforeSource === null) throw new Error('Selector source did not exist at its scan revision');
  if (version && sourceVersion(source) !== version) throw new Error('Selector source version does not match its owned baseline');
  let expected = source;
  const maps: SourceIdentityMap[] = [];
  for (const change of changes) {
    if (change.beforeSource !== expected || change.afterSource === null) throw new Error('Selector source baseline is not owned');
    const stepMaps = change.identityMaps ?? [];
    if (!stepMaps.length && change.beforeSource !== change.afterSource) throw new Error('Selector source change has no identity evidence');
    maps.push(...stepMaps); expected = change.afterSource;
  }
  if (expected !== current) throw new Error('Selector source differs from its accepted projection');
  return { source, maps };
}

/** `currentVersion` = the file's bytes NOW (files are truth): a scan that
 * rendered exactly those bytes is fresh even when no accepted map produced
 * them — a Push, an import or an outside editor wrote them (owner 2026-09-16). */
function projectionStart(loc: SourceLocation, history: Array<{ revision: number; map: SourceIdentityMap }>, scanRevision: number, currentVersion?: string): number {
  const version = (loc as SourceLocation & { sourceVersion?: string }).sourceVersion;
  let start = history.findIndex(entry => entry.revision > scanRevision);
  if (version) {
    const known = history.findIndex(entry => entry.revision > scanRevision && entry.map.beforeVersion === version);
    if (known >= 0) start = known;
    else if (history[history.length - 1]?.map.afterVersion === version || start < 0 || version === currentVersion) start = history.length;
    else if (history.length) throw new Error('Source target version is not owned by this project');
  }
  return start < 0 ? history.length : start;
}

export async function resolveProjectedSourceLocation(projectId: string, loc: SourceLocation, scanRevision = 0, throughRevision = Infinity): Promise<SourceLocation> {
  const history = (await acceptedIdentityMaps(projectId, loc.file)).filter(entry => entry.revision <= throughRevision);
  scanRevision = loc.sourceRevision ?? scanRevision;
  // The runtime may be unreadable (offline, no transport): then no freshness fast path — history decides as before.
  const current = loc.sourceVersion && history.length ? await readProjectedSourceState(projectId, loc.file).catch(() => null) : null;
  const mapped = projectCoordinate(loc, history.slice(projectionStart(loc, history, scanRevision, current === null ? undefined : sourceVersion(current))).map(entry => entry.map));
  if (!mapped) throw new Error('Source element has been deleted');
  return { ...mapped, sourceRevision: history.length ? history[history.length - 1].revision : scanRevision };
}

export type SourceIdentityView = { location: SourceLocation; fromRevision: number; toRevision: number };

/** Compact read-side aliases for every source scan a frozen acceptance prefix
 * can admit, including scans arriving after gesture invocation. Revision ranges
 * distinguish byte-identical coordinate reuse; no source-content matching. */
export async function sourceIdentityViews(projectId: string, loc: SourceLocation, through: number): Promise<SourceIdentityView[]> {
  const history = (await acceptedIdentityMaps(projectId, loc.file)).filter(entry => entry.revision <= through);
  const maps = history.slice(projectionStart(loc, history, loc.sourceRevision ?? 0));
  const result: SourceIdentityView[] = [];
  const add = (location: SourceLocation | null, fromRevision: number, toRevision: number) => {
    if (location && fromRevision <= toRevision) result.push({ location, fromRevision, toRevision });
  };
  add(loc, loc.sourceRevision ?? 0, maps.length ? maps[0].revision - 1 : through);
  for (let index = 0; index < maps.length; index++) {
    if (maps[index + 1]?.revision === maps[index].revision) continue;
    add(projectCoordinate(loc, maps.slice(0, index + 1).map(entry => entry.map)), maps[index].revision,
      maps[index + 1] ? maps[index + 1].revision - 1 : through);
  }
  return result;
}

/** Semantic carriers belong to elements, not reusable coordinate keys. Compare
 * both original owners through the same accepted map prefix, never by content. */
export async function sameProjectedSourceIdentity(projectId: string, retained: SourceLocation | undefined,
  target: SourceLocation | undefined, through: number): Promise<boolean> {
  if (!retained || !target || retained.file !== target.file) return false;
  if (!!retained.sourceVersion !== !!target.sourceVersion) return false;
  try {
    const [left, right] = await Promise.all([
      resolveProjectedSourceLocation(projectId, retained, retained.sourceRevision ?? 0, through),
      resolveProjectedSourceLocation(projectId, target, target.sourceRevision ?? 0, through),
    ]);
    return left.file === right.file && left.line === right.line && left.column === right.column
      && left.sourceVersion === right.sourceVersion;
  } catch (error) {
    if (isRetiredSourceIdentity(error)) return false;
    throw error; // Storage failures cannot retire accepted semantic state.
  }
}

export function isRetiredSourceIdentity(error: unknown): boolean {
  return error instanceof Error && (error.message === 'Source element has been deleted'
    || error.message === 'Source target version is not owned by this project');
}
