import { parseKey, type SourceLocation } from '@/store/types';
import type * as Y from 'yjs';
import { captureLocalSourceScanOwnership } from './localPageSync';

/**
 * Parse a source-location key like `src/Hero.astro:5:1` into a SourceLocation.
 * Returns null for anything that is not a source key (instance roots, instance
 * children, drawn elements, junk).
 *
 * A source key has three legal tails, all optional and in this order:
 * `~<pqs><16 hex>` (the task-149/159/160 PLACEMENT — which invocation of the
 * defining component this element belongs to), `#N` (the scanner's
 * intra-placement repeat counter), or both. The placement is an IDENTITY
 * segment, never part of the path, so it is stripped: what comes out is always
 * a real, writable `file:line:column`.
 *
 * This does NOT own that grammar and must never re-state it. It used to, as
 * `/^(.+):(\d+):(\d+)$/`, which matched neither tail and returned null for
 * every placement-scoped key — silently dropping every image edit made on a
 * component-owned element in local mode (`hooks/useSourceImageSync.ts` treats
 * null as an early return, so the write never happened, with no error, no toast
 * and no log). `store/types.ts`'s `parseKey` is the one parser that knows the
 * tails; delegating keeps it that way.
 */
export function parseSourceLocationFromKey(key: string): SourceLocation | null {
  const parsed = parseKey(key);
  if (parsed?.type !== 'source') return null;
  return { file: parsed.file, line: parsed.line, column: parsed.col };
}

/** A new gesture's key names the current admitted scan, not a retained undo
 * registration at the same coordinate. No scan evidence means no rebasing. */
export function currentScannedSourceLocation(projectId: string | null | undefined, key: string): SourceLocation | undefined {
  const parsed = parseSourceLocationFromKey(key);
  if (!projectId || !parsed) return undefined;
  const ownership = captureLocalSourceScanOwnership(projectId, parsed.file);
  return ownership.sourceVersion ? { ...parsed, ...ownership } : undefined;
}

/** Retain the coordinate's scan ownership when a writer starts from a doc key. */
export function registeredSourceLocation(doc: Y.Doc, key: string, mapName = 'sourceClasses'): SourceLocation | null {
  const parsed = parseSourceLocationFromKey(key);
  if (!parsed) return null;
  for (const name of new Set([mapName, 'sourceClasses'])) {
    const own = ownSourceLocation(doc, key, name);
    if (own) return own;
  }
  return parsed;
}

/** The identity registered on THIS map's entry only — never borrowed from
 * another tier's entry on the same (reusable) coordinate key. */
export function ownSourceLocation(doc: Y.Doc, key: string, mapName: string): SourceLocation | null {
  const parsed = parseSourceLocationFromKey(key);
  if (!parsed) return null;
  const location = doc.getMap<Y.Map<unknown>>(mapName).get(key)?.get('sourceLocation') as Y.Map<unknown> | undefined;
  if (location?.get('file') !== parsed.file) return null;
  return { ...parsed,
    line: location.get('line') as number, column: location.get('column') as number,
    ...(location.has('sourceVersion') ? { sourceVersion: location.get('sourceVersion') as string } : {}),
    ...(location.has('sourceRevision') ? { sourceRevision: location.get('sourceRevision') as number } : {}),
  };
}
