/**
 * The selected element's BlogCard field binding (task-240 Phase 2), parsed
 * from the element's own source bytes and re-read on every scan arrival —
 * same trigger + non-local no-op rules as useBlogBinding. `bindable` = an
 * image field may fill the element (a box only while it is a placeholder).
 */
import { useEffect, useState } from 'react';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { useLocalScanVersion } from '@/hooks/useLocalPageLayout';
import { readLocalElementSource } from '@/utils/localElementSource';
import { canBindField, readDateFormat, readFieldBinding, readSlotBinding } from '@/utils/fieldBinding';
import type { SourceLocation } from '@/store/types';

/** `slot` = the slot a block-form card element reads (`f('x')`, utils/cardSetup), else null. */
/** `dateFormat` = the format a field-bound TEXT element shows ('' = as stored, null = not a text binding we write). */
export interface FieldBindingRead { field: string | null; bindable: boolean; slot: string | null; dateFormat: string | null }
const NONE: FieldBindingRead = { field: null, bindable: false, slot: null, dateFormat: null };

export function useFieldBinding(loc: SourceLocation | null, tagName: string | null): FieldBindingRead {
  const localPath = useLocalProjectPath();
  const scanVersion = useLocalScanVersion(localPath);
  const [read, setRead] = useState<FieldBindingRead>(NONE);
  const file = loc?.file ?? null;
  const line = loc?.line ?? 0;
  const column = loc?.column ?? 0;

  useEffect(() => {
    if (!localPath || !file || !line || !column || !tagName) { setRead(NONE); return; }
    let cancelled = false;
    readLocalElementSource({ file, line, column })
      .then((r) => { if (!cancelled) setRead({ field: readFieldBinding(r.source, tagName), bindable: canBindField(r.source, tagName), slot: readSlotBinding(r.source, tagName), dateFormat: readDateFormat(r.source, tagName) }); })
      .catch(() => { if (!cancelled) setRead(NONE); });
    return () => { cancelled = true; };
  }, [localPath, file, line, column, tagName, scanVersion]);

  return read;
}
