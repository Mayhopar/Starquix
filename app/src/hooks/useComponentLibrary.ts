import { useCallback, useMemo, useSyncExternalStore } from 'react';
import builtInFallback from 'virtual:built-in-components';
import { useLocalProjectPath } from './useLocalProjectPath';
import { localFetch } from '../utils/sqLocalBase';
import { readJsonResponse } from '@/utils/readJsonResponse';
import { issueCopy } from '@/utils/operationIssue';
import type { SectionReadState } from '@/utils/sectionReadState';
import { decodeComponents } from './discoveryDecode';
import { useActiveLibraryTheme } from '@/context/ThemesLibraryContext';
import { builtInsForTheme } from '@/utils/libraryThemes';
import { createLibraryStore, onHotEvent, useLibraryState } from './projectLibraryStore';

export interface ScannedComponent {
  name: string;
  path: string;
  source: 'built-in' | 'user-project';
  html: string;
  previewImage?: string;
  category: string;
  props: Array<{ name: string; type: string; required: boolean; defaultValue?: string }>;
  slots: string[];
  dependencies: string[];
  frontmatter?: string;
  /** Set when this component is a page template (see `@page-template` marker). Null/undefined otherwise. */
  pageTemplate?: string | null;
  /**
   * True when the scan sniffed content-collection access in the frontmatter
   * (component-discovery `extractContentBound`). Classifies marker-less local
   * components into the Assets panel's Dynamic section. Undefined on old scan
   * payloads → treated as static.
   */
  contentBound?: boolean;
  /** Library section theme (`@theme`, see utils/libraryThemes.ts); null/undefined = shared by every theme. */
  theme?: string | null;
  /** Library section (`@name`) a component is or was copied from; null/undefined = the user's own file. */
  section?: string | null;
  /**
   * Auto-created children when this component is dropped. Resolved by the
   * drop site (buildAddCommand) against the rest of the library to produce
   * a full ElementData.defaultChildren list. Parsed from the
   * `@default-children` frontmatter marker (see component-discovery.ts).
   */
  defaultChildren?: Array<{ name: string; slotName?: string }>;
}

export interface ComponentLibrary {
  builtIn: ScannedComponent[];
  userProject: ScannedComponent[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  projectState: SectionReadState<ScannedComponent[]>;
}

const EMPTY_RESULTS: ScannedComponent[] = [];

/** A disk change the project scan sees: a component or dynamic page written, or a listed
 *  one removed (a save's `*.sq-stamp-tmp` removal is not one — it comes with every edit). */
export function affectsComponentScan(files: readonly string[], gone: readonly string[], listed: readonly { path: string }[] | null): boolean {
  return files.some(p => /^src\/components\/.+\.astro$/.test(p) || /^src\/pages\/(.+\/)?[^/]*\[[^/]*\.astro$/.test(p))
    || gone.some(g => !!listed?.some(c => c.path === g || c.path.startsWith(`${g}/`)));
}

/** The built-in catalog: bundled (production); in dev the editor's own server scans it again.
 *  A failed read keeps the complete bundled list. Latest read wins; a superseded project read
 *  does not cancel it (the read that replaces it may be a disk change, which skips the built-ins). */
const fallback = builtInFallback as ScannedComponent[];
let builtIns = fallback, builtInRead = 0;
const builtInSubs = new Set<() => void>();
async function readBuiltIns(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const read = ++builtInRead;
  let data = fallback;
  try {
    data = (await readJsonResponse(await fetch('/__sq/scan-components?source=built-in', {}), decodeComponents))
      .map(c => ({ ...c, source: 'built-in' as const }));
  } catch { /* bundled catalog remains usable */ }
  if (read !== builtInRead) return;
  builtIns = data;
  for (const notify of [...builtInSubs]) notify();
}
const subscribeBuiltIns = (notify: () => void) => { builtInSubs.add(notify); return () => { builtInSubs.delete(notify); }; };

/** One scan per project, shared by every hook (projectLibraryStore). scan-components renders
 *  every component server-side; a disk change never re-reads the built-ins. The project is
 *  ready only once the built-ins it was read with are in. */
const projectComponents = createLibraryStore<ScannedComponent>({
  operation: 'components',
  async read(path, signal, full) {
    const builtInsDone = full ? readBuiltIns() : Promise.resolve();
    const scan = path ? localFetch(`/__sq/local/scan-components?path=${encodeURIComponent(path)}`, { signal })
      .then(r => readJsonResponse(r, decodeComponents))
      .then(read => read.map(c => ({ ...c, source: 'user-project' as const })))
      : Promise.resolve([]); // no project path yet: the project owns nothing
    const [result] = await Promise.allSettled([scan, builtInsDone]);
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  },
  affects: affectsComponentScan,
  watch: (_path, revalidate) => onHotEvent('sq:components-changed', revalidate),
});

export function useComponentLibrary(): ComponentLibrary {
  const localPath = useLocalProjectPath();
  const projectState = useLibraryState(projectComponents, localPath);
  const builtIn = useSyncExternalStore(subscribeBuiltIns, () => builtIns);
  const refresh = useCallback(() => projectComponents.refresh(localPath), [localPath]);
  // One theme at a time, HERE and not in a view: Starquix and Classic share every section name, and every by-name
  // consumer (Canvas, DesignBar, Assets, ⌘K…) must resolve `Hero` to the project's theme (utils/libraryThemes.ts).
  const activeTheme = useActiveLibraryTheme();
  const themedBuiltIn = useMemo(() => builtInsForTheme(builtIn, activeTheme), [builtIn, activeTheme]);
  return { builtIn: themedBuiltIn, userProject: projectState.status === 'ready' ? projectState.data : EMPTY_RESULTS,
    isLoading: projectState.status === 'loading', error: projectState.status === 'unavailable' ? issueCopy(projectState.issue).title : null,
    projectState, refresh };
}
