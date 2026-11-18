import { useEffect, useRef } from 'react';
import { useUndoContext } from '@/context/UndoContext';
import { useComponentLibrary } from '@/hooks/useComponentLibrary';
import { useContentCollections } from '@/hooks/useContentCollections';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { allCardAssignments, projectSourcesPath, projectSourcesSnapshot, useCardTitleLockVersion } from '@/utils/cardTitleLock';
import { convertListsOnOpen, librarySource, sourcesComplete } from '@/services/listConversion';

/** task-244: once per open, simple imported lists become BlogSlots (services/listConversion) — after THIS project's sources are read. */
export function ListConversionOnOpen() {
  const localPath = useLocalProjectPath();
  const version = useCardTitleLockVersion(); // a new read of the sources
  const { takeSnapshot, claimSnapshot } = useUndoContext();
  const { userProject, isLoading } = useComponentLibrary();
  const { collections, isLoading: collectionsLoading, error: collectionsError } = useContentCollections();
  const done = useRef<string | null>(null);
  const checked = useRef<object | null>(null);
  useEffect(() => {
    const files = projectSourcesSnapshot();
    // The component list must be loaded: "not on disk" is what lets a slot whose card was deleted heal.
    // …and the collections read (a heal skips a slot whose collection shows no fields — never maps blind).
    if (!localPath || isLoading || !userProject.length || collectionsLoading || collectionsError || done.current === localPath || projectSourcesPath() !== localPath || checked.current === files) return;
    const onDisk = new Set(userProject.map((c) => c.path));
    const exists = (f: string) => onDisk.has(f);
    checked.current = files;
    if (!sourcesComplete(files, exists)) return;
    done.current = localPath;
    const fieldsOf = (c: string) => collections.find((x) => x.name === c)?.inferredFields ?? [];
    void (async () => {
      const blogSlotLibrary = await librarySource('BlogSlot');
      if (!blogSlotLibrary || await convertListsOnOpen({ files, blogSlotLibrary, exists, assignments: allCardAssignments(), fieldsOf, takeSnapshot, claimSnapshot })) return;
      if (done.current === localPath) { done.current = null; checked.current = null; } // busy: retry on the next read
    })();
  }, [localPath, version, takeSnapshot, claimSnapshot, isLoading, userProject, collections, collectionsLoading, collectionsError]);
  return null;
}
