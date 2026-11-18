import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OperationNotice } from '@/components/ui';
import type { MediaAssetEntry, MediaAssetSource } from '@/components/AssetsPanel/assetSources';
import { ImageFillShell } from './ImageFillShell';

/** Bound/default adapters consume bytes, including import-based project assets. */
export function ExceptionImageFillControls({ ownerId, src, preview, caption, dropText, busy, error, onFiles, assetSource, children }: {
  ownerId: string; src: string; preview: string | null; caption: string; dropText: string;
  busy: boolean; error: string | null; onFiles?: (files: File[]) => Promise<void>;
  assetSource?: MediaAssetSource; children: ReactNode;
}) {
  const owner = useRef({ id: ownerId });
  if (owner.current.id !== ownerId) owner.current = { id: ownerId };
  useEffect(() => () => { owner.current = { id: '' }; }, []);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState(false);
  useEffect(() => { setReading(false); setReadError(false); }, [ownerId]);
  const pick = async (entry: MediaAssetEntry) => {
    if (!assetSource?.fileFor || !onFiles || busy || reading) return;
    const captured = owner.current;
    setReading(true); setReadError(false);
    try {
      const file = await assetSource.fileFor(entry);
      if (owner.current !== captured) return;
      if (!file) throw new Error('Image bytes unavailable');
      await onFiles([file]);
    } catch { if (owner.current === captured) setReadError(true); }
    finally { if (owner.current === captured) setReading(false); }
  };
  return <div className="px-2 pb-2">
    <ImageFillShell ownerId={ownerId} src={src} preview={preview} caption={caption} busy={busy || reading} phase={busy ? 'applying' : undefined} onChooseFile={onFiles ? file => { setReadError(false); void onFiles([file]); } : undefined} assetSource={assetSource} pickFiles onPick={entry => { void pick(entry); }} dropText={dropText}>
      {children}
    </ImageFillShell>
    {error && <OperationNotice title={error} />}
    {readError && <OperationNotice title="This project image is unavailable." detail="The current image is unchanged. Choose another image or try again." />}
  </div>;
}
