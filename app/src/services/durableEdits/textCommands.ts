import type { SourceLocation } from '@/bridge';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, allowsCrossFileOverrideWrite, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { getLocalSourceScanRevision } from '@/utils/localPageSync';
import type { MaterializationCommand } from './types';

/** Text and markup share one source transform; page-owned component edits
 * keep their durable instance overlay and cannot rewrite the master file.
 * `text` is HTML element content (the innerHTML form): plain text is encoded
 * first (encodeInnerHtmlEntities), or a typed `<` / `&` becomes markup. */
export function textCommands(sourceLocation: SourceLocation | undefined, text: string,
  origin: LocalWriteOrigin = captureLocalWriteOrigin(), masterWrite = false): MaterializationCommand[] {
  if (!sourceLocation || (!masterWrite && isCrossFileAtOrigin(origin, sourceLocation.file)
    && !allowsCrossFileOverrideWrite(origin, sourceLocation.file))) return [];
  return [{ kind: 'source-batch', payload: { payloads: [], skipped: [], sourceTextEdits: [{
    sourceLocation: { ...sourceLocation, sourceRevision: sourceLocation.sourceRevision ?? getLocalSourceScanRevision() },
    text, origin, masterWrite,
  }] } }];
}
