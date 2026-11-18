import { VideoIcon as SharedVideoIcon } from '@/assets/icons';
/**
 * Video Block
 *
 * Controls for editing <video> elements: upload (mp4/webm), source URL, and
 * playback toggles (autoplay / loop / muted / controls). Attributes ride the
 * UPDATE_IMAGE_ATTRIBUTE pipeline (attribute-agnostic; boolean attrs stored
 * as 'true'/'false' strings — see ImageAttributes in store/types.ts).
 */

import { useState, useCallback, useEffect, useRef, type FC } from 'react';
import { Row, Field, SegmentedControl, Dropzone, OperationNotice } from '@/components/ui';
import { useDispatch, useYjsValue } from '@/store/hooks';
import { selectImageAttributes, selectCurrentPageId, selectProjectId } from '@/store/selectors';
import { useUndoContext } from '@/context/UndoContext';
import type { ImageAttributes } from '@/store/types';
import { sanitizeUrl } from '@/utils/sanitizeUrl';
import { useAssetUpload } from '@/hooks/useAssetUpload';
import { validateVideoFile, ALLOWED_VIDEO_TYPES } from '@/utils/imageValidation';
import { uploadImageFile, syncImageAttrToIframe } from '@/utils/imageUpload';
import { parseObjectFit, setObjectFit } from './ImageBlock';

interface VideoBlockProps {
  /** Element key for Yjs updates */
  elementKey: string | null;
  /** Current src from bridge selection (initial value) */
  videoSrc?: string | null;
  /** Current block classes (for object-fit/position controls) */
  classes: string;
  /** Write classes back through DesignBar's handleClassesChange */
  onClassesChange: (classes: string) => void;
}

type UploadState = 'idle' | 'uploading' | 'error';

const BOOL_ATTRS = ['autoplay', 'loop', 'muted', 'controls'] as const;
type BoolAttr = (typeof BOOL_ATTRS)[number];

// ponytail: source-scanned <video> with no Yjs override reports the Video.astro
// defaults; pass real DOM state through SelectionContext if this ever misleads.
const BOOL_DEFAULTS: Record<BoolAttr, boolean> = {
  autoplay: true, loop: true, muted: true, controls: false,
};

const OBJECT_FIT_OPTIONS = [
  { value: 'fill', label: 'Fill' },
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
];

const ON_OFF = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
];

const BOOL_ATTR_LABELS: Record<BoolAttr, string> = {
  autoplay: 'Autoplay', loop: 'Loop', muted: 'Muted', controls: 'Controls',
};

export const VideoBlock: FC<VideoBlockProps> = ({
  elementKey,
  videoSrc,
  classes,
  onClassesChange,
}) => {
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const projectId = useYjsValue(selectProjectId);
  const pageId = useYjsValue(selectCurrentPageId);
  const { uploadAsset, getAssetUrl } = useAssetUpload(projectId || '');

  // Yjs override OR staticMarkup original (instance root/child); null for
  // untouched source elements.
  const videoAttributes = useYjsValue((doc) =>
    elementKey ? selectImageAttributes(doc, elementKey) : null
  );

  const [src, setSrc] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadError, setUploadError] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [srcError, setSrcError] = useState<string | null>(null);
  const rawSrc = videoAttributes?.src || videoSrc || '';
  const ownerKey = JSON.stringify([projectId, pageId, elementKey, rawSrc]);
  const owner = useRef({ key: ownerKey, revision: 0, mounted: true });
  if (owner.current.key !== ownerKey) {
    owner.current.key = ownerKey;
    owner.current.revision++;
  }
  useEffect(() => {
    owner.current.mounted = true;
    return () => { owner.current.mounted = false; owner.current.revision++; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const revision = owner.current.revision;
    setSrc(rawSrc);
    setSrcError(null);
    setFileError(null);
    setUploadError(false);
    setUploadState('idle');
    if (rawSrc.startsWith('sq-asset:')) {
      void getAssetUrl(rawSrc.slice(9)).then((url) => {
        if (!cancelled && owner.current.mounted && owner.current.revision === revision) setSrc(url || rawSrc);
      }).catch((error) => {
        console.error('[VideoBlock] Asset URL unavailable:', error);
      });
    }
    return () => { cancelled = true; };
  }, [ownerKey, rawSrc, getAssetUrl]);

  const updateAttribute = useCallback((attribute: keyof ImageAttributes, value: string) => {
    if (!elementKey) return;
    dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: elementKey, attribute, value });
    syncImageAttrToIframe(elementKey, attribute, value);
  }, [elementKey, dispatch]);

  const handleSrcBlur = useCallback(() => {
    const sanitized = sanitizeUrl(src);
    if (sanitized === null) {
      setSrcError('Use a video URL with a supported scheme, such as https://.');
      return;
    }
    setSrcError(null);
    if (sanitized !== (videoAttributes?.src || '')) {
      takeSnapshot();
      updateAttribute('src', sanitized);
    }
  }, [src, videoAttributes?.src, videoSrc, updateAttribute, takeSnapshot]);

  const boolValue = (attr: BoolAttr): 'true' | 'false' => {
    const stored = videoAttributes?.[attr];
    if (stored === 'true' || stored === 'false') return stored;
    return BOOL_DEFAULTS[attr] ? 'true' : 'false';
  };

  const handleBoolChange = useCallback((attr: BoolAttr, value: string) => {
    takeSnapshot();
    updateAttribute(attr, value);
  }, [updateAttribute, takeSnapshot]);

  const uploadFile = useCallback(async (file: File) => {
    if (!projectId || !pageId || !elementKey) {
      setUploadError(true);
      return;
    }
    // Snapshot BEFORE async upload so undo captures the pre-upload baseline
    takeSnapshot();
    const revision = ++owner.current.revision;
    const isCurrent = () => owner.current.mounted && owner.current.revision === revision;
    setUploadState('uploading');
    setUploadError(false);
    setFileError(null);
    setSrcError(null);
    try {
      const { src: newSrc, previewUrl } = await uploadImageFile({ file, projectId, pageId, uploadAsset });
      if (!isCurrent()) return;
      setSrc(previewUrl);
      updateAttribute('src', newSrc);
      setUploadState('idle');
    } catch (error) {
      console.error('[VideoBlock] Upload failed:', error);
      if (!isCurrent()) return;
      setUploadError(true);
      setUploadState('error');
    }
  }, [projectId, pageId, elementKey, updateAttribute, uploadAsset, takeSnapshot]);

  const handleFiles = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    const validationError = validateVideoFile(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    uploadFile(file);
  }, [uploadFile]);

  if (!elementKey) {
    return null;
  }

  const uploadIcon = (
    <SharedVideoIcon className="w-4 h-4" />
  );

  return (
    <div data-testid="video-block" className="space-y-2 pr-8 pb-2">
      {/* Upload zone */}
      <Dropzone
        onFiles={handleFiles}
        accept={ALLOWED_VIDEO_TYPES.join(',')}
        disabled={uploadState === 'uploading'}
        className="p-4 text-center"
      >
        {uploadState === 'uploading' ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-text-muted" />
            <span className="text-xs text-text-muted">Uploading...</span>
          </>
        ) : (
          <>
            <span className="text-text-muted">{uploadIcon}</span>
            <span className="text-xs text-text-muted">
              {src ? 'Drop video to replace' : 'Drop video or click to browse'}
            </span>
          </>
        )}
      </Dropzone>

      {fileError && <div className="text-xs text-error px-1">{fileError}</div>}
      {uploadError && <OperationNotice
        title="Video upload could not finish"
        detail="Check the current video before choosing a file again."
      />}

      {/* Source URL */}
      <div>
        <Row title="Source URL" size="sm" />
        <Field
          aria-label="Source URL"
          value={src}
          error={srcError || undefined}
          onChange={(value) => {
            owner.current.revision++;
            setSrc(value);
            setSrcError(null);
            setUploadError(false);
            setUploadState('idle');
          }}
          onBlur={handleSrcBlur}
          placeholder="https://example.com/video.mp4"
        />
      </div>

      {/* Playback toggles */}
      {BOOL_ATTRS.map((attr) => (
        <div key={attr}>
          <Row title={BOOL_ATTR_LABELS[attr]} size="sm" />
          <SegmentedControl
            options={ON_OFF}
            value={boolValue(attr)}
            onChange={(value) => handleBoolChange(attr, value)}
            showChevron={false}
          />
        </div>
      ))}

      {/* Fit */}
      <div>
        <Row title="Fit" size="sm" />
        <SegmentedControl
          options={OBJECT_FIT_OPTIONS}
          value={parseObjectFit(classes) || 'fill'}
          onChange={(fit) => onClassesChange(setObjectFit(classes, fit))}
          showChevron={false}
        />
      </div>
    </div>
  );
};

export default VideoBlock;
