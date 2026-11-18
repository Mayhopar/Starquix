/**
 * "How widely is this component used, and how much of it is unpushed?" — the
 * ONE join point between the two runtimes' answers (owner review 2026-08-03).
 *
 * Feeds two shared surfaces:
 *   - the Push / Reset confirmation's blast-radius sentence (InstanceMenu);
 *   - the master view's usage affordance, which was a dead end
 *     (ComponentUsageBadge).
 *
 * Both surfaces are runtime-branch-free. The branch lives HERE and nowhere else,
 * because the two runtimes genuinely do not share a source of truth for
 * placements:
 *   - WC / server: placements are doc elements carrying `astroSource`.
 *   - local: files are truth, so pages come from the host's existing
 *     `/__sq/local/component-usages` reverse-import walk (task-143 — reused, not
 *     reinvented), while the unpushed edits still live in the shared doc tiers.
 *
 * Both branches return the same struct, so nothing downstream can tell them
 * apart.
 */
import { useEffect, useState } from 'react';
import { useYjsValue } from '@/store/hooks';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { fetchComponentUsages } from '@/utils/imageUpload';
import { localPageId } from '@/utils/localMode';
import {
  selectDocComponentUsage,
  selectLocalOverriddenPlacements,
  EMPTY_COMPONENT_USAGE,
  type ComponentUsage,
  type ComponentUsagePage,
} from '@/store/componentUsage';

export type { ComponentUsage, ComponentUsagePage };

/**
 * `here` = the placement the caller is standing on (local mode only; undefined
 * in the master view and in WC/server, where placements are doc elements). It
 * only narrows `overriddenPlacements` — see selectLocalOverriddenPlacements,
 * which drops the master's own bare key from the count of placements a Push
 * from `here` would LEAVE overriding, because that Push clears it (task-187).
 */
export function useComponentUsage(source: string | null, here?: string): ComponentUsage {
  const localPath = useLocalProjectPath();
  const isLocal = !!localPath;

  const docUsage = useYjsValue<ComponentUsage>(
    (d) => (isLocal ? EMPTY_COMPONENT_USAGE : selectDocComponentUsage(d, source)),
  );
  const localOverridden = useYjsValue<number>(
    (d) => (isLocal ? selectLocalOverriddenPlacements(d, source, here) : 0),
  );

  const [localPages, setLocalPages] = useState<ComponentUsagePage[]>([]);
  useEffect(() => {
    if (!isLocal || !localPath || !source) {
      setLocalPages([]);
      return;
    }
    let cancelled = false;
    fetchComponentUsages(localPath, source)
      .then((r) => {
        if (cancelled) return;
        setLocalPages(
          (r.usages ?? []).map((p) => ({ pageId: localPageId(p.route), label: p.route })),
        );
      })
      // A failed lookup must never block the action it annotates — the
      // confirmation simply says less (InstanceMenu degrades on absent counts).
      .catch(() => { if (!cancelled) setLocalPages([]); });
    return () => { cancelled = true; };
  }, [isLocal, localPath, source]);

  if (!source) return EMPTY_COMPONENT_USAGE;
  return isLocal
    ? { pages: localPages, overriddenPlacements: localOverridden }
    : docUsage;
}
