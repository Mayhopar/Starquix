/**
 * Canvas overlay: shows an "Upload" button over any hovered <img> element
 * (empty or already loaded — see ImageUploadOverlay.test.tsx). Editor-only
 * chrome, positioned via hoverRectStore like SelectionOverlay's hover box;
 * never written into iframe/source markup.
 */
import { useCallback, useRef, useState, useSyncExternalStore, type ChangeEvent, type FC } from 'react';
import { Button, OperationNotice } from '@/components/ui';
import { useDispatch, useYjsValue } from '@/store/hooks';
import { selectProjectId, selectCurrentPageId } from '@/store/selectors';
import { useUndoContext } from '@/context/UndoContext';
import { useScannedElementsRef } from '@/context/SelectionContext';
import { useAssetUpload } from '@/hooks/useAssetUpload';
import { validateImageFile, validateVideoFile, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from '@/utils/imageValidation';
import { uploadImageFile, syncImageAttrToIframe, rebindLocalBoundAsset, repointLocalBoundAsset } from '@/utils/imageUpload';
import { isLocalProjectId } from '@/utils/localMode';
import { hoverRectStore, type HoveredElementInfo } from './hoverRectStore';
import { useImageFill } from '@/components/DesignBar/fill/useImageFill';
import { useClassStore } from '@/context/ClassStoreContext';
import type { ScannedElement } from '@/context/SelectionContext';

export const ImageUploadOverlay: FC = () => {
  const hovered = useSyncExternalStore(hoverRectStore.subscribe, hoverRectStore.get);
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const projectId = useYjsValue(selectProjectId);
  const pageId = useYjsValue(selectCurrentPageId);
  const { uploadAsset } = useAssetUpload(projectId || '');
  const { scannedElementsRef } = useScannedElementsRef();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const pendingIsVideoRef = useRef(false);
  const currentOwner = useRef({ id: '', visit: 0 });
  const ownerId = `${projectId}/${pageId}/${hovered?.key ?? ''}`;
  if (currentOwner.current.id !== ownerId) currentOwner.current = { id: ownerId, visit: currentOwner.current.visit + 1 };
  const pickedOwner = useRef<typeof currentOwner.current | null>(null);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const elementKey = pendingKeyRef.current;
    if (!file || !elementKey || !projectId || !pageId) return;
    const owner = pickedOwner.current;
    const isCurrent = () => !!owner && currentOwner.current.id === owner.id && currentOwner.current.visit === owner.visit;
    if (!isCurrent()) return;

    const validationError = pendingIsVideoRef.current ? validateVideoFile(file) : validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    // task-144: local imgs WITHOUT a source location can't take an attr write —
    // route by what the img is (same law as LocalMediaSection.handlePick).
    const scanned = scannedElementsRef.current.find(el => el.key === elementKey);
    if (isLocalProjectId(projectId) && scanned && !scanned.sourceLocation) {
      if (scanned.boundAssetPath) {
        // Content-bound astro <Image> — rebind the DATA; undo = repoint pair.
        try {
          const oldPath = scanned.boundAssetPath;
          const { newAsset } = await rebindLocalBoundAsset(projectId, oldPath, file);
          if (!isCurrent()) return;
          takeSnapshot({
            reverse: () => { void repointLocalBoundAsset(projectId, newAsset, oldPath); },
            forward: () => { void repointLocalBoundAsset(projectId, oldPath, newAsset); },
          });
          setError(null);
        } catch {
          if (isCurrent()) setError("Image couldn't be replaced. The current binding is unchanged.");
        }
        return;
      }
      // Prop-driven — nothing writable; NEVER fall through to the DOM-ghost path.
      setError('This image is set by the component — edit it in the component editor.');
      return;
    }

    try {
      const { src } = await uploadImageFile({ file, projectId, pageId, uploadAsset });
      if (!isCurrent()) return;
      takeSnapshot();
      dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: elementKey, attribute: 'src', value: src });
      syncImageAttrToIframe(elementKey, 'src', src);
      setError(null);
    } catch {
      if (isCurrent()) setError("Image upload couldn't finish. The current image is unchanged.");
    }
  }, [projectId, pageId, uploadAsset, dispatch, takeSnapshot]);

  const isVideo = hovered?.tagName === 'video';
  const sourceImage = hovered?.key ? scannedElementsRef.current.find(element => element.key === hovered.key) : null;
  if (hovered?.tagName === 'img' && projectId && pageId && isLocalProjectId(projectId) && sourceImage?.sourceLocation) {
    return <SourceImageUpload key={`${projectId}/${pageId}/${hovered.key}`} hovered={hovered} element={sourceImage} projectId={projectId} pageId={pageId} />;
  }
  if (!hovered || (hovered.tagName !== 'img' && !isVideo) || !hovered.key) return null;

  return (
    <div
      className="absolute flex items-end justify-center pb-1.5 pointer-events-none z-[999]" // ui-lint-line: overlay stacking order (image upload affordance above hover outline)
      style={{
        left: hovered.rect.left,
        top: hovered.rect.top,
        width: hovered.rect.width,
        height: hovered.rect.height,
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        label="Upload"
        className="pointer-events-auto"
        onClick={(e) => {
          e.stopPropagation();
          pickedOwner.current = { ...currentOwner.current }; setError(null);
          pendingKeyRef.current = hovered.key ?? null;
          pendingIsVideoRef.current = isVideo;
          fileInputRef.current?.click();
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={(isVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES).join(',')}
        className="hidden"
        onChange={handleFileChange}
      />
      {error && (
        <div className="absolute top-full w-64 pointer-events-auto"><OperationNotice title={error} /></div>
      )}
    </div>
  );
};

/** The hover surface uses the same selection-owned Fill adapter as the inspector. */
function SourceImageUpload({ hovered, element, projectId, pageId }: { hovered: HoveredElementInfo; element: ScannedElement; projectId: string; pageId: string }) {
  const dispatch = useDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const { registerElement } = useClassStore();
  const { pushStructuralUndo } = useUndoContext();
  const fill = useImageFill({ ownerId: `${projectId}/${pageId}/${element.key}`, projectId, sourceLocation: element.sourceLocation!, tagName: 'img', classes: element.classes ?? '', variant: '', preview: null, box: () => ({ width: hovered.rect.width, height: hovered.rect.height }), geometry: hovered.computedStyles,
    onClassesChange: () => {},
    // Figma model: a replaced <img> src is an attribute edit (same tier the
    // doc-managed branch above uses), never a source conversion.
    onImageAttribute: (attribute, value) => dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: element.key, attribute, value }),
    onSourceImageReset: () => dispatch({ type: 'CLEAR_SOURCE_IMAGE_ATTRIBUTES', sourceKey: element.key }),
    onSourceClasses: classes => registerElement(element.key, classes, element.sourceLocation), pushStructuralUndo });
  const disabled = fill.busy || fill.state.target !== 'native';
  return <div className="absolute flex flex-col items-center justify-end pb-1.5 pointer-events-none z-overlay" style={{ left: hovered.rect.left, top: hovered.rect.top, width: hovered.rect.width, height: hovered.rect.height }}>
    <Button label="Upload" size="sm" variant="secondary" className="pointer-events-auto" disabled={disabled} title={fill.state.target === 'unsupported' ? 'Edit this image through its source or binding' : undefined} onClick={() => fileRef.current?.click()} />
    <input ref={fileRef} type="file" className="hidden" accept={ALLOWED_IMAGE_TYPES.join(',')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void fill.chooseFile(file); }} />
    {fill.issue && <div className="pointer-events-auto"><OperationNotice {...fill.issue} action={fill.canRetry ? { label: 'Retry apply', onClick: () => { void fill.retry(); }, busy: fill.busy } : undefined} /></div>}
  </div>;
}
