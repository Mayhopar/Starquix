/**
 * The current page's files-truth blog binding (task-240), parsed from the
 * page FILE on every scan arrival — a bind writes the file, the frame reloads,
 * ELEMENTS_SCANNED lands, the binding re-reads. Same trigger and same
 * non-local no-op rules as useLocalPageLayoutName. Unchanged bytes keep the
 * same binding object (no re-render fan-out per scan). A page may hold several
 * BlogSlots (task-244): `pageLine` = the page line of the selection (its
 * usage on the page) — the slot holding it is returned (L18).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { useLocalScanVersion } from '@/hooks/useLocalPageLayout';
import { fetchLocalPageSource, getLocalPageFile, subscribeLocalPageFile } from '@/utils/localPageSync';
import { NO_SLOT, parseBlogBindings, slotAtLine, type BlogBinding } from '@/utils/blogBinding';

const NEVER_UNSUBSCRIBE = () => {};
const neverSubscribe = () => NEVER_UNSUBSCRIBE;
const noPageFile = () => null;

export function useBlogBinding(pageLine: number | null = null): BlogBinding | null {
  const localPath = useLocalProjectPath();
  const scanVersion = useLocalScanVersion(localPath);
  // The page FILE is a dependency of its own: the pagination move changes it
  // under an unchanged route, and a read keyed on the scan alone raced the
  // Editor's publish of the new path (live-measured: an empty block).
  const file = useSyncExternalStore(
    localPath ? subscribeLocalPageFile : neverSubscribe,
    localPath ? getLocalPageFile : noPageFile,
  );
  const [source, setSource] = useState<string | null>(null);
  const last = useRef<{ file: string; source: string | null } | null>(null);

  useEffect(() => {
    if (!localPath) return;
    if (!file || !file.startsWith('src/pages/') || !file.endsWith('.astro')) { last.current = null; setSource(null); return; }
    let cancelled = false;
    fetchLocalPageSource(localPath, file)
      .then((source) => {
        if (cancelled || getLocalPageFile() !== file) return;
        if (last.current?.file === file && last.current.source === source) return;
        last.current = { file, source };
        setSource(source);
      })
      .catch(() => { if (!cancelled) { last.current = null; setSource(null); } });
    return () => { cancelled = true; };
  }, [localPath, scanVersion, file]);

  const all = useMemo(() => (source === null ? null : parseBlogBindings(source)), [source]);
  return useMemo(() => (source === null || !all ? null : all[slotAtLine(source, pageLine)] ?? NO_SLOT), [all, source, pageLine]);
}
