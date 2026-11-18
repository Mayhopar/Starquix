import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dropzone, OperationNotice, Popover, Row } from '@/components/ui';
import type { MediaAssetEntry, MediaAssetSource } from '@/components/AssetsPanel/assetSources';
import { ALLOWED_IMAGE_TYPES } from '@/utils/imageValidation';

function ProjectImages({ source, onPick, disabled, pickFiles }: { source: MediaAssetSource; onPick: (asset: MediaAssetEntry) => void; disabled: boolean; pickFiles?: boolean }) {
  const [items, setItems] = useState<MediaAssetEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    let owned: MediaAssetEntry[] = [];
    setState('loading'); setItems([]);
    void source.list().then(list => {
      if (disposed) { source.dispose?.(list); return; }
      owned = list; setItems(list.filter(asset => asset.kind === 'image')); setState('ready');
    }).catch(() => { if (!disposed) setState('unavailable'); });
    return () => { disposed = true; source.dispose?.(owned); };
  }, [source, revision]);
  if (state === 'unavailable') return <OperationNotice title="Project images are unavailable." action={{ label: 'Retry', onClick: () => refresh(n => n + 1) }} />;
  if (state === 'loading') return <Row size="sm" title="Loading project images…" hover={false} />;
  if (!items.length) return <Row size="sm" title="No project images" caption="Upload an image to add one." hover={false} />;
  return <div className="max-h-40 overflow-y-auto">{items.map(asset => <Row key={asset.name} size="sm" title={asset.name.split('/').pop()} disabled={disabled || !(pickFiles ? source.fileFor : asset.applySrc)} caption={!(pickFiles ? source.fileFor : asset.applySrc) ? 'Imported image · edit its binding' : undefined} left={asset.thumbUrl ? [{ type: 'custom', node: <img src={asset.thumbUrl} alt="" className="w-4 h-4 object-cover rounded-inner" /> }] : undefined} right={[{ type: 'custom', unboxed: true, node: <Button label="Use" aria-label={`Use ${asset.name.split('/').pop()}`} variant="ghost" size="sm" disabled={disabled || !(pickFiles ? source.fileFor : asset.applySrc)} onClick={() => onPick(asset)} /> }]} />)}</div>;
}
export interface ImageFillShellProps {
  ownerId: string; src: string; preview: string | null; caption: string;
  busy?: boolean; phase?: string; disabled?: boolean; uploadDisabled?: boolean;
  onChooseFile?: (file: File) => void; assetSource?: MediaAssetSource;
  onPick?: (asset: MediaAssetEntry) => void; pickFiles?: boolean;
  dropText?: string; children?: ReactNode;
}
/** Shared presentation only; each image capability keeps its own mutation owner. */
export function ImageFillShell({ ownerId, src, preview, caption, busy = false, phase, disabled = false, uploadDisabled = false, onChooseFile, assetSource, onPick, pickFiles, dropText, children }: ImageFillShellProps) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previousOwner = useRef(ownerId);
  if (previousOwner.current !== ownerId) { previousOwner.current = ownerId; setOpen(false); setLibrary(false); }
  useEffect(() => { setPreviewFailed(false); }, [preview]);
  const locked = disabled || uploadDisabled || busy;
  return <>
    <Row size="sm" title={src ? 'Image' : 'No image'} caption={caption} hover={false} className="px-0"
      left={preview && !previewFailed ? [{ type: 'custom', node: <Button iconOnly variant="ghost" size="sm" aria-label="Open image properties" onClick={() => setOpen(true)} icon={<img src={preview} alt="" onError={() => setPreviewFailed(true)} className="w-4 h-4 object-cover rounded-inner" />} /> }] : undefined}
      right={[{ type: 'custom', unboxed: true, node: <Button ref={triggerRef} label={onChooseFile ? src ? 'Replace image' : 'Choose image' : 'Image details'} aria-label="Edit image Fill" variant="ghost" size="sm" onClick={() => setOpen(true)} /> }]} />
    <Popover isOpen={open} onClose={() => { setOpen(false); triggerRef.current?.focus(); }} triggerRef={triggerRef} placement="bottom-end" offset={4} width={280} maxHeight={480}>
      <div className="p-2 space-y-2">
        <Row size="sm" title="Image Fill" hover={false} />
        {onChooseFile ? <>
          <Dropzone accept={ALLOWED_IMAGE_TYPES.join(',')} disabled={locked} className="h-32" onFiles={files => { if (files[0]) onChooseFile(files[0]); }}>
            {preview && !previewFailed ? <img src={preview} alt="" onError={() => setPreviewFailed(true)} className="max-h-24 max-w-full object-contain" /> : <span>{src ? 'Preview unavailable' : 'Upload image'}</span>}
            <span>{dropText ?? (src ? 'Drop an image to replace' : 'Drop or choose an image')}</span>
          </Dropzone>
          <input ref={fileRef} type="file" className="hidden" accept={ALLOWED_IMAGE_TYPES.join(',')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onChooseFile(file); }} />
          <Row size="sm" hover={false} title={<Button label={phase === 'uploading' ? 'Uploading…' : phase === 'applying' ? 'Applying…' : 'Upload image'} aria-label="Upload image" loading={busy} disabled={locked} variant="secondary" size="sm" onClick={() => fileRef.current?.click()} />} right={assetSource && onPick ? [{ type: 'custom', unboxed: true, node: <Button label="Project media" variant="ghost" size="sm" disabled={locked} onClick={() => setLibrary(value => !value)} /> }] : undefined} />
          {library && assetSource && onPick && <ProjectImages source={assetSource} disabled={locked} onPick={onPick} pickFiles={pickFiles} />}
        </> : preview && !previewFailed ? <img src={preview} alt="" onError={() => setPreviewFailed(true)} className="max-h-32 max-w-full object-contain" /> : <Row size="sm" title="Preview unavailable" hover={false} />}
        {children}
      </div>
    </Popover>
  </>;
}
