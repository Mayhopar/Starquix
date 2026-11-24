import { useEffect, useState } from 'react';

/** Update notifier (desktop/src/update-check.mjs → preload `sqDesktop.update`): a newer release with this machine's
 *  installer and the release page main built for it, else both null. */
export interface UpdateState { current: string; latest: string | null; page: string | null }
type DesktopUpdate = { state(): Promise<UpdateState>; onState(callback: (state: UpdateState) => void): () => void };

/** Main's live answer; null outside the desktop app (the editor in a plain browser) and until main answers. */
export function useDesktopUpdate(): UpdateState | null {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  useEffect(() => {
    const updates = (globalThis as { sqDesktop?: { update?: DesktopUpdate } }).sqDesktop?.update;
    if (!updates) return;
    updates.state().then(setUpdate, () => {});
    return updates.onState(setUpdate);
  }, []);
  return update;
}
