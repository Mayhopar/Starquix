import type { SourceIdentityMap, SourceCoordinate } from '../services/durableEdits/types';
import type { SourceLocation } from '../bridge';
// @ts-expect-error browser-safe shared transform parser
import { scanTopLevelElements, templateStartOffset } from '../../../preview-template/src/plugins/sq-source-transforms.js';

/** Offsets are normalized LF offsets supplied by the actual source splice. */
export interface PreservedSourceSpan { beforeStart: number; afterStart: number; length: number }
export type SourceTransformObserver = (before: string, after: string, spans: PreservedSourceSpan[]) => void;

const same = (a: SourceCoordinate | null, b: SourceCoordinate | null) => !!a && !!b && a.line === b.line && a.column === b.column;

export function projectCoordinate(loc: SourceLocation, maps: SourceIdentityMap[]): SourceLocation | null {
  let point: SourceCoordinate | null = loc;
  let removed: { id: string; index: number; inverse: boolean } | undefined;
  for (const map of maps) {
    if (removed) {
      if (removed.id === map.id && removed.inverse !== !!map.inverse) {
        point = map.entries[removed.index]?.after ?? null;
        removed = undefined;
      }
      continue;
    }
    const index = map.entries.findIndex(entry => same(entry.before, point));
    if (index < 0) return null;
    point = map.entries[index].after;
    if (!point) removed = { id: map.id, index, inverse: !!map.inverse };
  }
  return point ? { ...loc, ...point, ...(maps.length ? { sourceVersion: maps[maps.length - 1].afterVersion } : {}) } : null;
}

export function sourceVersion(source: string): string {
  let a = 2166136261;
  for (let i = 0; i < source.length; i++) a = Math.imul(a ^ source.charCodeAt(i), 16777619);
  return `s${(a >>> 0).toString(16)}:${source.length}`;
}

function starts(source: string): number[] {
  const out: number[] = [];
  const walk = (fragment: string, base: number) => {
    for (const span of scanTopLevelElements(fragment)) {
      out.push(base + span.start);
      if (span.closeStart !== null && !/^(script|style|textarea)$/i.test(span.tag)) {
        walk(fragment.slice(span.openEnd, span.closeStart), base + span.openEnd);
      }
    }
  };
  const start = templateStartOffset(source);
  walk(source.slice(start), start);
  return out;
}

/** Identity comes from retained/moved source ranges, never matching content. */
export function createSourceIdentityMap(before: string, after: string, spans: PreservedSourceSpan[]): SourceIdentityMap {
  const old = before.replace(/\r\n/g, '\n'), next = after.replace(/\r\n/g, '\n');
  const nextStarts = new Set(starts(next)), paired = new Set<number>();
  const coordinate = (source: string, offset: number) => ({
    line: source.slice(0, offset).split('\n').length,
    column: offset - source.lastIndexOf('\n', offset - 1),
  });
  const entries: SourceIdentityMap['entries'] = starts(old).map(offset => {
    const span = spans.find(part => offset >= part.beforeStart && offset < part.beforeStart + part.length);
    const target = span ? span.afterStart + offset - span.beforeStart : null;
    if (target !== null && !nextStarts.has(target)) throw new Error('Source transform lost a preserved element boundary');
    if (target !== null && paired.has(target)) throw new Error('Source transform duplicated a source identity');
    if (target !== null) paired.add(target);
    return { before: coordinate(old, offset), after: target === null ? null : coordinate(next, target) };
  });
  for (const offset of nextStarts) if (!paired.has(offset)) entries.push({ before: null, after: coordinate(next, offset) });
  return { id: crypto.randomUUID(), beforeVersion: sourceVersion(before), afterVersion: sourceVersion(after), entries };
}

/** The two retained ranges around a known replacement; insertions use start=end. */
export function spliceSourceSpans(length: number, start: number, end: number, insertedLength: number): PreservedSourceSpan[] {
  return [{ beforeStart: 0, afterStart: 0, length: start },
    { beforeStart: end, afterStart: start + insertedLength, length: length - end }];
}
