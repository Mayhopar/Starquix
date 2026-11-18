import type { SourceLocation } from '@/store/types';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, allowsCrossFileOverrideWrite, type LocalWriteOrigin } from '@/utils/localWriteScope';
import type { MaterializationCommand } from './types';
import { getLocalSourceScanRevision } from '@/utils/localPageSync';

/** Does a class edit at this location write its file from this origin?
 * Cross-file overlays (e.g. master placement overrides) stay doc-only. */
export function writesSourceClasses(sourceLocation: SourceLocation | undefined,
  origin: LocalWriteOrigin = captureLocalWriteOrigin()): sourceLocation is SourceLocation {
  return !!sourceLocation && !(isCrossFileAtOrigin(origin, sourceLocation.file)
    && !allowsCrossFileOverrideWrite(origin, sourceLocation.file));
}

/** Scope is captured at the gesture, and persisted with the command. Instance
 * overrides still receive a durable Yjs edit, but deliberately no source command. */
export function classCommands(sourceLocation: SourceLocation | undefined, newClasses: string, baseClasses: string | null,
  origin: LocalWriteOrigin = captureLocalWriteOrigin(), delay = 5000): MaterializationCommand[] {
  if (!writesSourceClasses(sourceLocation, origin)) return [];
  return [{ kind: 'class-write', payload: { sourceLocation, newClasses, baseClasses, origin,
    sourceRevision: sourceLocation.sourceRevision ?? getLocalSourceScanRevision(), deferUntil: Date.now() + delay } }];
}
