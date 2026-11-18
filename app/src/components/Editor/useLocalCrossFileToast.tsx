/**
 * Refusal UX for THE local-mode write-scope law (utils/localWriteScope.ts).
 *
 * A refused write is never a dead end: the user's intent was "change this
 * here", and the honest answer is "that lives in a component — here it is".
 * The toast names the file and carries a one-click Open that reuses the EXACT
 * navigation the Assets panel uses (`sq:go-to-source-component`, handled in
 * LeftSidebar → setActiveTopTab('assets') + handleSelectComponent), so the
 * component view opens the same way it always has — no parallel route.
 *
 * Lives in the UI layer because the action needs a real Button; the guard
 * itself stays React-free so services/BaseViteWriter can import it.
 */
import { useEffect } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui';
import {
  LOCAL_CROSS_FILE_WRITE_EVENT,
  localCrossFileRefusal,
  type LocalCrossFileWriteDetail,
} from '@/utils/localWriteScope';

/** Fixed id: a burst (auto-repeat delete, a drag firing several writes)
 *  collapses into ONE visible toast — react-hot-toast replaces same-id toasts. */
export const LOCAL_CROSS_FILE_TOAST_ID = 'sq-local-cross-file-write';

export function openLocalComponentFile(file: string): void {
  window.dispatchEvent(new CustomEvent('sq:go-to-source-component', { detail: { path: file } }));
}

export function useLocalCrossFileToast(): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const { file } = ((e as CustomEvent<LocalCrossFileWriteDetail>).detail ?? {}) as Partial<LocalCrossFileWriteDetail>;
      if (!file) return;
      toast(
        (t) => (
          <span className="flex items-center gap-2">
            {localCrossFileRefusal(file)}
            <Button
              variant="secondary"
              size="sm"
              label="Open"
              onClick={() => {
                toast.dismiss(t.id);
                openLocalComponentFile(file);
              }}
            />
          </span>
        ),
        { id: LOCAL_CROSS_FILE_TOAST_ID, duration: 6000 },
      );
    };
    window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, handler);
    return () => window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, handler);
  }, []);
}
