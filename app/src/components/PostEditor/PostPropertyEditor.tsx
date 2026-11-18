import { useEffect, useRef, useState } from 'react';
import { Field, OperationNotice } from '@/components/ui';
import { MediaSurface } from '@/components/DesignBar/blocks/FillBlock';
export function PostPropertyImageEditor({ value, preview, onChange, onCommit, onUploadMedia, onBusyChange, onDraftValidityChange }: {
  value: string; preview: { url: string | null; unavailable: boolean };
  onChange: (value: string) => void; onCommit: () => Promise<boolean | void>;
  onUploadMedia?: (file: File) => Promise<string>; onBusyChange: (busy: boolean) => void;
  onDraftValidityChange: (valid: boolean) => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState(value);
  useEffect(() => { setPathDraft(value); }, [value]);
  const mounted = useRef(true); const pathRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);
  const uploading = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const upload = async (files: File[]) => {
    if (!files[0] || !onUploadMedia || uploading.current) return;
    uploading.current = true;
    setBusy(true); onBusyChange(true); setError(null);
    try {
      const src = await onUploadMedia(files[0]);
      if (!mounted.current) return;
      if (typeof src !== 'string' || !src.trim() || /^blob:/i.test(src.trim())) throw new Error('No writable image path');
      setPathDraft(src); onDraftValidityChange(true);
      onChange(src);
      // The post owner presents save refusal; this property remains open.
      await onCommit();
    } catch {
      if (mounted.current) setError('The image could not be added. Your current value is still here. Try the upload again.');
    } finally {
      uploading.current = false;
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  };
  return <div className="space-y-2">
    {onUploadMedia && <MediaSurface accept="image/*" busy={busy} dropText="Drop an image or click to browse"
      onFiles={files => { void upload(files); }} onOpenPicker={() => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
        input.onchange = () => { void upload(Array.from(input.files ?? [])); }; input.click();
      }} previewUrl={preview.url} onDelete={null} primaryLabel="Upload" error={null} />}
    {!onUploadMedia && preview.url && <img src={preview.url} alt="Current media" className="w-full h-20 object-cover rounded-inner" />}
    <Field ref={pathRef} aria-label="Image path" value={pathDraft} disabled={busy} placeholder="Empty" onChange={next => {
      setPathDraft(next);
      const valid = !!next.trim() && !/^blob:/i.test(next.trim());
      onDraftValidityChange(valid);
      if (!next.trim()) { setError('Choose a file path or image URL. The current image is kept until a valid replacement is entered.'); return; }
      if (!valid) { setError('Use a file path or image URL. Preview URLs cannot be saved.'); return; }
      setError(null); onChange(next);
    }} />
    {preview.unavailable && <div className="text-xs text-text-muted">Image preview unavailable. The stored path is unchanged.</div>}
    {error && <OperationNotice title={error} />}
  </div>;
}
