import { useCallback } from 'react';
import type { PropDef } from '../vite-plugin/component-discovery';
import type { ScannedComponent } from './useComponentLibrary';
import { useLocalProjectPath } from './useLocalProjectPath';
import { readJsonResponse } from '@/utils/readJsonResponse';
import { issueCopy } from '@/utils/operationIssue';
import type { SectionReadState } from '@/utils/sectionReadState';
import { decodeLayouts } from './discoveryDecode';
import { readAcceptedLayouts } from '@/services/durableEdits/layoutFileAcceptance';
import { getDurableEditStatus, subscribeDurableEditStatus } from '@/services/durableEdits/status';
import { projectIdFromPath } from '@/utils/localMode';
import { createLibraryStore, onHotEvent, useLibraryState } from './projectLibraryStore';

export interface ScannedLayout {
  name: string;
  path: string;
  absolutePath: string;
  props: PropDef[];
  slots: string[];
  frontmatter: string;
  /** Frontmatter-stripped layout markup (chrome + <slot/>s). Flows through from discovery. */
  body: string;
  /** task-137: 'user-project' when scanned from a local project's src/layouts. */
  source?: 'built-in' | 'user-project';
}

/** Layouts surface in the picker / asset tree as if they were components. */
export function layoutToScannedComponent(l: ScannedLayout): ScannedComponent {
  if (l.source === 'user-project') {
    // Local project's own layout — path is real-file-relative so the
    // component-view route and write pipeline address the actual file.
    return {
      name: l.name,
      path: `src/layouts/${l.path}`,
      source: 'user-project',
      // The REAL template body — an empty html here false-tripped the
      // task-149 empty-markup guard when a layout reached component-insert.
      html: l.body,
      category: 'Layouts',
      props: l.props,
      slots: l.slots,
      dependencies: [],
      frontmatter: l.frontmatter,
    };
  }
  return {
    name: l.name,
    path: `layouts/${l.name}.astro`,
    source: 'built-in',
    html: l.body,
    category: 'Layouts',
    props: l.props,
    slots: l.slots,
    dependencies: [],
    frontmatter: l.frontmatter,
  };
}

export interface LayoutLibrary {
  layouts: ScannedLayout[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  readState: SectionReadState<ScannedLayout[]>;
}

const EMPTY_RESULTS: ScannedLayout[] = [];

/** A disk change the layout list sees: a layout written, or a listed one (or its folder) removed. */
export function affectsLayoutList(files: readonly string[], gone: readonly string[], listed: readonly { path: string }[] | null): boolean {
  return files.some(p => /^src\/layouts\/.+\.astro$/.test(p))
    || gone.some(g => !!listed?.some(l => { const file = `src/layouts/${l.path}`; return file === g || file.startsWith(`${g}/`); }));
}

/** One read per project, shared by every hook (projectLibraryStore). Desktop reads the ACCEPTED
 *  layouts (edits not yet on disk included), so our own accepted edit revalidates too. */
const projectLayouts = createLibraryStore<ScannedLayout>({
  operation: 'layouts',
  async read(path, signal) {
    if (path?.startsWith('wc://')) return (await readAcceptedLayouts(path, signal)).map(l => ({ ...l, source: 'user-project' as const }));
    const read = await readJsonResponse(await fetch('/__sq/scan-layouts', { signal }), decodeLayouts);
    return path ? read.map(l => ({ ...l, source: 'user-project' as const })) : read;
  },
  affects: affectsLayoutList,
  watch(path, revalidate) {
    const offHot = onHotEvent('sq:layouts-changed', revalidate);
    const projectId = projectIdFromPath(path);
    if (!projectId) return offHot;
    let observed = getDurableEditStatus(projectId).acceptedRevision;
    const offAccepted = subscribeDurableEditStatus(() => {
      const status = getDurableEditStatus(projectId);
      if (status.phase === 'accepted' && status.acceptedRevision > observed) {
        observed = status.acceptedRevision;
        // A class edit or in-place file batch cannot change a layout: skip the acceptance-lane read it would cost.
        if (!status.layoutNeutral) revalidate();
      }
    });
    return () => { offHot(); offAccepted(); };
  },
});

export function useLayoutLibrary(): LayoutLibrary {
  // task-137 local mode: scan the USER's src/layouts instead of ours.
  const localPath = useLocalProjectPath();
  const readState = useLibraryState(projectLayouts, localPath);
  const refresh = useCallback(() => projectLayouts.refresh(localPath), [localPath]);
  return { layouts: readState.status === 'ready' ? readState.data : EMPTY_RESULTS, isLoading: readState.status === 'loading',
    error: readState.status === 'unavailable' ? issueCopy(readState.issue).title : null, readState, refresh };
}
