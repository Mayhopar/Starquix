/**
 * Editor half of the update notifier (desktop/src/update-check.mjs). The Projects banner is not on screen while editing:
 * a release main finds mid-session (hourly), or after a project opened at launch (first check ~5 s in), would go
 * unseen. Shown until the user answers (Later or Update), then not again this app run; leaving the editor takes it down
 * (the Projects banner is there). A leaf component: its state never re-renders the editor.
 */
import { useEffect } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui';
import { useDesktopUpdate } from '@/hooks/useDesktopUpdate';
import { openExternal } from '@/utils/supportLinks';

const UPDATE_TOAST_ID = 'sq-update-available';
let answered: string | null = null; // the version the user said Later/Update to, this app run

export function UpdateToast(): null {
  const update = useDesktopUpdate();
  const latest = update?.latest; const page = update?.page;
  useEffect(() => {
    if (!latest || !page || answered === latest) return;
    const answer = () => { answered = latest; toast.dismiss(UPDATE_TOAST_ID); };
    toast(() => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        {`Starquix ${latest} is available.`}
        <Button variant="ghost" size="sm" label="Later" onClick={answer} />
        <Button variant="secondary" size="sm" label="Update" onClick={() => { answer(); openExternal(page); }} />
      </span>
    ), { id: UPDATE_TOAST_ID, duration: Infinity, style: { maxWidth: 'none' } }); // one line: the default 350px wraps it
    return () => { toast.dismiss(UPDATE_TOAST_ID); };
  }, [latest, page]);
  return null;
}

export function _resetUpdateToastForTests() { answered = null; }
