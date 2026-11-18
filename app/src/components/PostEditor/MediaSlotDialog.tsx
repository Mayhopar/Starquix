import { useEffect, useRef, useState } from 'react';
import { Modal, OperationNotice, Row } from '@/components/ui';
import { MediaSurface } from '@/components/DesignBar/blocks/FillBlock';

/**
 * An upload that resolves with nothing is a FAILURE, not a value: serializing
 * `""` into the items array turns the slot into a permanently broken image and
 * the user sees the same placeholder with no explanation (owner, 2026-08-11 —
 * "nothing happens"). Refuse the write and say so.
 */
export const EMPTY_UPLOAD_MESSAGE =
  'The upload finished without returning a file path, so nothing was saved. Try again, or pick a different file.';
export const MEDIA_REFUSAL_MESSAGE = 'This media slot cannot be changed safely. Its current value is still here.';

/**
 * Fill one media slot of a `<Media/>` block.
 *
 * Renders the EXPORTED MediaSurface rather than a second picker: its own doc
 * comment states the rule — every image branch renders that component, so an
 * improvement to drops, previews or the delete affordance lands here too.
 *
 * FAILURE CONTRACT: this dialog closes on SUCCESS only. Every other outcome —
 * a rejected upload, an empty src, a model write the editor refused — keeps it
 * open and presents finite copy through OperationNotice, because closing on silence
 * is indistinguishable from "the app ignored me".
 */
export function MediaSlotDialog({ currentSrc, onUpload, onPick, onClear, onClose }: {
  currentSrc: string;
  /** Upload a file and return the src to write into the items array. */
  onUpload: (file: File) => Promise<string>;
  /** Write `src` into the model. Returns null when the write happened, or the
   *  reason it did NOT — a finite refusal is shown and the dialog stays open. */
  onPick: (src: string) => string | null;
  /** null when the slot is already empty — hides the delete affordance.
   *  Same return contract as onPick. */
  onClear: (() => string | null) | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const uploading = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const handleFiles = (files: File[]) => {
    const file = files[0];
    if (!file || uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setError(null);
    void Promise.resolve().then(() => onUpload(file))
      .then(src => {
        if (!mounted.current) return;
        const value = typeof src === 'string' ? src.trim() : '';
        if (value === '' || /^blob:/i.test(value)) {
          setError(EMPTY_UPLOAD_MESSAGE);
          return;
        }
        const refusal = onPick(value);
        if (refusal !== null) {
          setError(MEDIA_REFUSAL_MESSAGE);
          return;
        }
        onClose();
      })
      // The slot keeps whatever it had; the dialog stays open with the reason.
      .catch(() => { if (mounted.current) setError('The upload could not be completed. Try again, or pick a different file.'); })
      .finally(() => { uploading.current = false; if (mounted.current) setBusy(false); });
  };

  const handleClear = onClear
    ? () => {
        setError(null);
        const refusal = onClear();
        if (refusal !== null) {
          setError(MEDIA_REFUSAL_MESSAGE);
          return;
        }
        onClose();
      }
    : null;

  return (
    <Modal isOpen size="sm" onClose={() => { if (!uploading.current) onClose(); }}>
      <div className="p-3 space-y-2">
        <Row title="Media" size="sm" hover={false} className="px-0" />
        {error !== null && <OperationNotice title="The media slot was not updated." detail={error} />}
        <MediaSurface
          accept="image/*,video/*"
          busy={busy}
          dropText="Drop an image or click to browse"
          onFiles={handleFiles}
          onOpenPicker={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*,video/*';
            input.onchange = () => handleFiles([...(input.files ?? [])]);
            input.click();
          }}
          previewUrl={currentSrc || null}
          onDelete={handleClear}
          primaryLabel={error === null ? 'Upload' : 'Try again'}
          // The reason lives in the notice above — one statement, not two.
          error={null}
        />
      </div>
    </Modal>
  );
}
