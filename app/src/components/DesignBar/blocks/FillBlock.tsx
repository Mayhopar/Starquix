import { ImageIcon as SharedImageIcon } from '@/assets/icons';
/**
 * Fill Block - Tailwind version
 *
 * Controls for background color, gradients, and media.
 * Three tabs: Solid, Gradient, Media (task-141 — the old Image tab is
 * absorbed into Media; the tab CONTENT branches by element capability).
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { findClass, setClass } from '../utils';
import { ImageFillControls } from '../fill/ImageFillControls';
import { ExceptionImageFillControls } from '../fill/ExceptionImageFillControls';
import type { ComputedStyles } from '@/context/SelectionContext';
import { makeLocalAssetSource } from '@/components/AssetsPanel/assetSources';
import { useClassStore } from '@/context/ClassStoreContext';
import { ColorPicker } from '../ColorPicker';
import { SegmentedControl, Row, Field, Button, Dropzone, IconButton, OperationNotice } from '@/components/ui';
import { CloseIcon } from '@/assets/icons';
import { useSelectedElement, useSelectionContext, useRectActions } from '@/context/SelectionContext';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { sourceMediaMutation } from '@/services/sourceMediaMutation';
import { getHexForColorClass } from '../tailwindColors';
import { GRADIENT_DIRECTIONS } from '../classPatterns';
import { useYjsValue, useDispatch } from '@/store/hooks';
import { isDrawnKey, parseKey } from '@/store/types';
import { selectCurrentPageId, selectProjectId } from '@/store/selectors';
import { useUndoContext, type AssetSideEffect } from '@/context/UndoContext';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { isLocalProjectId, localPageId, dynamicRoutePattern, SQ_DEFAULTS_DIR } from '@/utils/localMode';
import { getLocalComponentViewFile, requestPageView } from '@/services/localComponentView';
import type { ComponentUsages } from '@/vite-plugin/project-fs';
import { usePages } from '@/context/PagesContext';
import { uploadImageFile, uploadLocalAssetFile, syncImageAttrToIframe, rebindLocalBoundAsset, repointLocalBoundAsset, makePlaceholderImageFile, fetchComponentUsages, postComponentDefaultImage, type DefaultImageOp } from '@/utils/imageUpload';
import {
  parseObjectFit, setObjectFit, parseObjectPosition, setObjectPosition,
  OBJECT_FIT_OPTIONS, OBJECT_POSITION_OPTIONS,
} from './ImageBlock';
import { sanitizeUrl } from '@/utils/sanitizeUrl';
import { useAssetUpload } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { validateImageFile, validateVideoFile, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from '@/utils/imageValidation';

// ============================================================================
// Constants
// ============================================================================

type FillTab = 'solid' | 'gradient' | 'media';

const BG_SIZE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' }
];

const BG_POSITION_OPTIONS = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' }
];

const BG_REPEAT_OPTIONS = [
  { value: 'repeat', label: 'Repeat' },
  { value: 'no-repeat', label: 'No Repeat' },
  { value: 'repeat-x', label: 'Repeat X' },
  { value: 'repeat-y', label: 'Repeat Y' }
];


// ============================================================================
// Helpers
// ============================================================================

const parseBgColor = (classes: string): { colorClass: string; hex: string; opacity: number } => {
  // Check for CSS variable reference: bg-[var(--name)]
  const varToken = findClass(classes, /^bg-\[var\(--.+\)\]$/);
  if (varToken) {
    return { colorClass: varToken, hex: '', opacity: 100 };
  }

  // Check for arbitrary hex with opacity: bg-[#ff0000]/50
  const hexWithOpacity = findClass(classes, /^bg-\[#[0-9a-fA-F]+\](\/\d+)?$/);
  if (hexWithOpacity) {
    const match = hexWithOpacity.match(/^bg-\[(#[0-9a-fA-F]+)\](\/(\d+))?$/);
    if (match) {
      return {
        colorClass: hexWithOpacity,
        hex: match[1],
        opacity: match[3] ? parseInt(match[3], 10) : 100
      };
    }
  }

  // Check for named colors with opacity, e.g. a user-doc token // ui-lint-line: user-document class example (bg-blue-500/50)
  const colorToken = findClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/);
  if (colorToken) {
    const hex = getHexForColorClass(colorToken, 'bg');
    const match = colorToken.match(/^bg-([a-z]+)(-(\d+))?(\/(\d+))?$/);
    const opacity = match && match[5] ? parseInt(match[5], 10) : 100;
    return {
      colorClass: colorToken.replace(/\/\d+$/, ''),
      hex: hex || '#ffffff',
      opacity
    };
  }

  return { colorClass: '', hex: '', opacity: 100 };
};

const parseGradient = (classes: string): {
  direction: string;
  fromColor: string;
  viaColor: string;
  toColor: string;
} => {
  const dirToken = findClass(classes, /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/);
  const direction = dirToken ? dirToken.replace('bg-gradient-', '') : '';

  // Parse from color
  const fromToken = findClass(classes, /^from-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/);
  const fromHex = findClass(classes, /^from-\[#[0-9a-fA-F]+\](\/\d+)?$/);

  // Parse via color
  const viaToken = findClass(classes, /^via-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/);
  const viaHex = findClass(classes, /^via-\[#[0-9a-fA-F]+\](\/\d+)?$/);

  // Parse to color
  const toToken = findClass(classes, /^to-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/);
  const toHex = findClass(classes, /^to-\[#[0-9a-fA-F]+\](\/\d+)?$/);

  return {
    direction,
    fromColor: fromToken || fromHex || '',
    viaColor: viaToken || viaHex || '',
    toColor: toToken || toHex || ''
  };
};

const parseBgImage = (classes: string): {
  url: string;
  size: string;
  position: string;
  repeat: string;
} => {
  // bg-[url('...')] or bg-[url("...")]
  const urlToken = findClass(classes, /^bg-\[url\(.+\)\]$/);
  let url = '';
  if (urlToken) {
    const match = urlToken.match(/^bg-\[url\(['"]?(.+?)['"]?\)\]$/);
    if (match) url = match[1];
  }

  // Size: bg-cover, bg-contain, bg-auto
  const sizeToken = findClass(classes, /^bg-(cover|contain|auto)$/);
  const size = sizeToken ? sizeToken.replace('bg-', '') : '';

  // Position: bg-center, bg-top, bg-bottom, bg-left, bg-right, bg-left-top, etc.
  const posToken = findClass(classes, /^bg-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/);
  let position = '';
  if (posToken) {
    position = posToken.replace('bg-', '').replace('left-top', 'top-left').replace('left-bottom', 'bottom-left').replace('right-top', 'top-right').replace('right-bottom', 'bottom-right');
  }

  // Repeat: bg-repeat, bg-no-repeat, bg-repeat-x, bg-repeat-y
  const repeatToken = findClass(classes, /^bg-(repeat|no-repeat|repeat-x|repeat-y)$/);
  const repeat = repeatToken ? repeatToken.replace('bg-', '') : '';

  return { url, size, position, repeat };
};

/**
 * Extract URL from computed backgroundImage value like 'url("https://example.com/img.webp")'
 * Returns empty string if none or 'none'.
 */
const parseComputedBgImage = (computed: string | undefined): string => {
  if (!computed || computed === 'none') return '';
  const match = computed.match(/url\(["']?(.+?)["']?\)/);
  return match ? match[1] : '';
};

const detectActiveTab = (classes: string, computedBgImage?: string): FillTab => {
  // Check for media first (bg-url class or inline style)
  if (findClass(classes, /^bg-\[url\(.+\)\]$/) || parseComputedBgImage(computedBgImage)) return 'media';
  // Check for gradient
  if (findClass(classes, /^bg-gradient-to-/)) return 'gradient';
  // Default to solid
  return 'solid';
};

// ============================================================================
// Shared media surface (task-144)
// ============================================================================

/**
 * THE unified img surface — dropzone + preview (hover-✕) + always-visible
 * [primary | Delete] action row + error line. Every img branch (overlay,
 * local resolved, bound) renders THIS component; edit it once and the change
 * lands in every runtime. Branch-specific extras (alt/URL/fit/notes) ride as
 * children below the action row.
 *
 * EXPORTED (content editor): the post body's media slots render this same
 * surface. Reuse it — do not copy it — so an improvement here reaches every
 * image branch at once.
 */
export const MediaSurface: React.FC<{
  accept: string;
  busy: boolean;
  dropText: React.ReactNode;
  onFiles: (files: File[]) => void;
  onOpenPicker: () => void;
  previewUrl: string | null;
  /** powers the hover-✕ AND the Delete button; null hides both (blank-slot rule) */
  onDelete: (() => void) | null;
  primaryLabel: string;
  error: string | null;
  children?: React.ReactNode;
}> = ({ accept, busy, dropText, onFiles, onOpenPicker, previewUrl, onDelete, primaryLabel, error, children }) => (
  <div className="space-y-1">
    <Dropzone onFiles={onFiles} accept={accept} disabled={busy} className="p-1">
      {previewUrl && (
        <div className="relative group w-full">
          <img
            src={previewUrl}
            alt="Current media"
            className="w-full h-20 object-cover rounded-inner"
          />
          {onDelete && (
            <IconButton
              size="sm"
              aria-label="Remove media"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-bg/80 hover:bg-bg text-text"
            >
              <CloseIcon className="w-4 h-4" />
            </IconButton>
          )}
        </div>
      )}
      {dropText}
    </Dropzone>
    {/* ALWAYS-VISIBLE actions — hover-only affordances were undiscoverable */}
    <div className="flex gap-1">
      <Button
        variant="secondary"
        size="sm"
        label={primaryLabel}
        disabled={busy}
        className="flex-1"
        onClick={onOpenPicker}
      />
      {/* the destructive action is quiet and hugs its label; the primary one leads */}
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          label="Delete"
          disabled={busy}
          className="text-error"
          onClick={onDelete}
        />
      )}
    </div>
    {children}
    {error && <div className="text-xs text-error px-1">{error}</div>}
  </div>
);

/** Shared alt-text field (commits on blur / Enter). */
const AltTextField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}> = ({ value, onChange, onBlur }) => (
  <div>
    <Row title="Alt text" size="sm" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      placeholder="Describe the image"
      className="w-full py-1 px-2 text-xs bg-input-fill text-text border border-input-stroke rounded-sm outline-none focus:border-accent-strong"
    />
  </div>
);

/** Shared object-fit / object-position controls (class writes). */
const FitPositionFields: React.FC<{
  classes: string;
  onClassesChange: (classes: string) => void;
}> = ({ classes, onClassesChange }) => (
  <>
    <div>
      <Row title="Fit" size="sm" />
      <SegmentedControl
        options={OBJECT_FIT_OPTIONS}
        value={parseObjectFit(classes) || 'fill'}
        onChange={(fit) => onClassesChange(setObjectFit(classes, fit))}
        showChevron={false}
      />
    </div>
    <div>
      <Row title="Position" size="sm" />
      <Field
        as="select"
        value={parseObjectPosition(classes)}
        onChange={(pos) => onClassesChange(setObjectPosition(classes, pos))}
        options={OBJECT_POSITION_OPTIONS}
      />
    </div>
  </>
);

// ============================================================================
// Component
// ============================================================================

interface FillBlockProps {
  variant?: string;
  getCurrentClasses?: () => string;
  computedStyles?: ComputedStyles | null;
  classes: string;
  onClassesChange: (classes: string) => void;
  /** Computed background-image from inline styles (e.g., 'url("/path/to/image.webp")') */
  computedBackgroundImage?: string;
  /** Cross-origin safe preview thumbnail of the background image */
  bgImagePreviewDataUrl?: string;
}

export const FillBlock: React.FC<FillBlockProps> = props => {
  const selection = useSelectedElement();
  const localPath = useLocalProjectPath();
  // A bound asset (astro <Image> output) keeps its dedicated controls: its
  // source tag is a component, which the Fill conversion cannot rewrite.
  const ordinary = !!localPath && !!selection.sourceLocation && !!selection.key && !isDrawnKey(selection.key) && !selection.mediaFill && !selection.boundAssetPath && ['img', 'div', 'section', 'article', 'figure', 'span', 'main', 'header', 'footer', 'a', 'button', 'p'].includes(selection.tagName ?? '');
  return ordinary ? <SourceImageFill {...props} /> : <LegacyFillBlock {...props} />;
};
const SourceImageFill: React.FC<FillBlockProps> = props => {
  const selection = useSelectedElement();
  const { getSelectedRect } = useRectActions();
  const { patchSelection } = useSelectionContext();
  const localPath = useLocalProjectPath();
  const projectId = useYjsValue(selectProjectId) ?? '';
  const pageId = useYjsValue(selectCurrentPageId) ?? '';
  const { registerElement } = useClassStore();
  const { takeSnapshot, pushStructuralUndo } = useUndoContext();
  const dispatch = useDispatch();
  const assetSource = useMemo(() => makeLocalAssetSource(projectId, localPath!), [projectId, localPath]);
  const loc = selection.sourceLocation!;
  return <ImageFillControls assetSource={assetSource} input={{
    ownerId: `${projectId}/${pageId}/${selection.key}/${loc.file}:${loc.line}:${loc.column}/${props.variant ?? ''}`,
    projectId, projectPath: localPath, sourceLocation: loc, tagName: selection.tagName ?? '',
    computedBackgroundImage: props.computedBackgroundImage,
    classes: props.classes, variant: props.variant ?? '', getCurrentClasses: props.getCurrentClasses,
    geometry: props.computedStyles ?? selection.computedStyles,
    preview: selection.tagName === 'img' ? selection.imagePreviewDataUrl : props.bgImagePreviewDataUrl ?? null,
    imageSrc: selection.imageSrc, imageAlt: selection.imageAlt,
    box: () => { const rect = getSelectedRect(); return rect ? { width: rect.width, height: rect.height } : null; },
    onClassesChange: props.onClassesChange,
    onImageAttribute: (attribute, value) => {
      takeSnapshot();
      return dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: selection.key!, attribute, value });
    },
    onSourceImageReset: () => dispatch({ type: 'CLEAR_SOURCE_IMAGE_ATTRIBUTES', sourceKey: selection.key! }),
    onSourceConverted: facts => patchSelection(selection.key!, facts),
    onSourceClasses: classes => registerElement(selection.key!, classes, loc), pushStructuralUndo,
  }} />;
};
const LegacyFillBlock: React.FC<FillBlockProps> = ({
  classes,
  onClassesChange,
  computedBackgroundImage,
  bgImagePreviewDataUrl
}) => {
  // Parse all values using useMemo
  const {
    bgColor,
    gradient,
    bgImage,
    detectedTab
  } = useMemo(() => {
    const parsed = parseBgImage(classes);
    // Fallback to computed inline backgroundImage if no class-based bg image
    if (!parsed.url && computedBackgroundImage) {
      parsed.url = parseComputedBgImage(computedBackgroundImage);
    }
    return {
      bgColor: parseBgColor(classes),
      gradient: parseGradient(classes),
      bgImage: parsed,
      detectedTab: detectActiveTab(classes, computedBackgroundImage)
    };
  }, [classes, computedBackgroundImage]);

  const [activeTab, setActiveTab] = useState<FillTab>(detectedTab);


  // Image upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = useState(bgImage.url);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get project/page IDs for upload
  const projectId = useYjsValue(selectProjectId);
  const pageId = useYjsValue(selectCurrentPageId);
  const { uploadAsset } = useAssetUpload(projectId || '');

  // ── task-140 media fill (local mode, source containers) ──────────────────
  // Design: docs/plans/2026-07-31-media-fill-design.md. The attr toggle rides
  // the generic image-attr write; the drop resolves the TAG via the tag-swap
  // op. Children/eligibility are re-checked server-side (honest gate).
  const localProjectPath = useLocalProjectPath();
  const isLocalProject = !!localProjectPath;
  const { key: selectedKey, tagName: selectedTag, sourceLocation: selectedSourceLocation, mediaFill, hasElementChildren, imageAlt, imageSrc, imagePreviewDataUrl, boundAssetPath, ownerComponentFile, imageComponentIndex } = useSelectedElement();
  // task-141: drawn elements resolve doc-side (RESOLVE_DRAWN_MEDIA) in all runtimes
  const isDrawnElement = isDrawnKey(selectedKey);
  const MEDIA_ELIGIBLE_TAGS = ['div', 'section', 'article', 'figure', 'span', 'img', 'video'];
  const mediaEligible = isLocalProject && !!selectedSourceLocation &&
    (MEDIA_ELIGIBLE_TAGS.includes(selectedTag ?? '') || mediaFill);
  // task-141: an already-resolved <img>/<video> source element (local mode) —
  // Media tab shows the replace dropzone; Solid/Gradient un-resolve first.
  const isResolvedMedia = isLocalProject && !!selectedSourceLocation &&
    (selectedTag === 'img' || selectedTag === 'video');
  // task-142: astro <Image> output — no source location (render is attributed
  // to node_modules, never tagged) but the bridge decodes the bound src/
  // asset. Media tab = data-aware swap (rebind: new file + repoint refs).
  // task-143: a default-image asset (src/assets/sq-defaults/) is OUR write —
  // it has no content refs, so the bound rebind flow would just error. Those
  // imgs route to the component-default handlers instead, everywhere.
  const isSqDefaultAsset = !!boundAssetPath && boundAssetPath.includes(`/${SQ_DEFAULTS_DIR}/`);
  const isBoundMedia = isLocalProject && !selectedSourceLocation &&
    selectedTag === 'img' && !!boundAssetPath && !isSqDefaultAsset;
  // task-142: local img with NO handle at all (astro <Image src={prop}> in the
  // component view, remote images) — nothing writable; Fill shows an honest
  // note instead of the dead legacy Image block.
  const isPropDrivenImg = isLocalProject && selectedTag === 'img' &&
    !selectedSourceLocation && !boundAssetPath;
  // task-143 usage picker: in the COMPONENT VIEW a prop-driven img is set by
  // whoever renders the component — "Edit component" would be circular, so
  // offer the pages that (transitively) use it instead. Outside the component
  // view the existing note + Edit-component jump stays.
  const componentViewFile = (isPropDrivenImg || isSqDefaultAsset) ? getLocalComponentViewFile() : null;
  // The img surfaces that have no writable source location — shared by the
  // tab-force effect, the tab-change guard, and the background-treatment
  // exclusion so a new flag is added in ONE place.
  const isSourcelessMediaSurface = isBoundMedia || isPropDrivenImg || isSqDefaultAsset;
  // task-144: img/video with a source key and no project path yet — same
  // unified UI, doc-overlay writes (UPDATE_IMAGE_ATTRIBUTE + class writer; the
  // bridge handler accepts img AND video and resolves sq-asset refs for both).
  // The difference lives in the write adapter, not the surface. No img↔video
  // tag conversion here — that is a structural file write, project-only
  // (honest reject).
  const isOverlayMedia = !isLocalProject && (selectedTag === 'img' || selectedTag === 'video') &&
    !isDrawnElement && !mediaFill;
  const isOverlayVideo = isOverlayMedia && selectedTag === 'video';
  // gaps 2/31 honest state: converting a childless container into a real
  // <img>/<video> is a structural tag-swap (file write) — project-only. With
  // no project path the Media tab still applies a background image; SAY so
  // instead of silently hiding the conversion.
  const isConvertLocked = !isLocalProject && !isDrawnElement && !mediaFill &&
    !!selectedSourceLocation && !hasElementChildren &&
    MEDIA_ELIGIBLE_TAGS.includes(selectedTag ?? '') &&
    selectedTag !== 'img' && selectedTag !== 'video';
  // Surfaces pinned to the Media tab (no Solid/Gradient escape) — the ONE
  // union the tab-force effect and tab-change guard both consume.
  const lockedToMediaTab = isSourcelessMediaSurface || isOverlayMedia;
  // Which component file default-image reads/writes target (usage fetch +
  // default write agree by construction).
  const defaultImageComponentFile = ownerComponentFile ?? componentViewFile;
  // Unified surface: the img is the component's DEFAULT slot — a placeholder
  // in the component view, or an sq-defaults-backed img anywhere.
  const isDefaultImageSurface = isSqDefaultAsset || (isPropDrivenImg && !!componentViewFile);
  const usageComponentFile = componentViewFile ? defaultImageComponentFile : null;
  const [usageBody, setUsageBody] = useState<ComponentUsages | null>(null);
  const [usageUnavailable, setUsageUnavailable] = useState(false);
  const [usageRevision, refreshUsages] = useState(0);
  useEffect(() => {
    if (!usageComponentFile || !localProjectPath) { setUsageBody(null); return; }
    let cancelled = false;
    setUsageUnavailable(false); setUsageBody(null);
    fetchComponentUsages(localProjectPath, usageComponentFile)
      .then(body => { if (!cancelled) setUsageBody(body); })
      .catch(() => { if (!cancelled) setUsageUnavailable(true); });
    return () => { cancelled = true; };
  }, [usageComponentFile, localProjectPath, usageRevision]);

  const { pages: docPages, setActivePage } = usePages();
  // Usages → openable doc pages. A dynamic route ('/works/[slug]') matches
  // its seeded concrete instances ('/works/inito', …); the literal '[slug]'
  // placeholder page (kept when no instances were discovered) also matches
  // the pattern. A content usage (component imported by an .mdx entry) maps
  // by slug to the concrete page rendering that entry.
  const usagePages = useMemo(() => {
    if (!usageBody) return [];
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    const push = (p: { id: string; name: string }): void => {
      if (!seen.has(p.id)) { seen.add(p.id); out.push({ id: p.id, name: p.name }); }
    };
    for (const u of usageBody.usages ?? []) {
      if (u.dynamic) {
        const pattern = dynamicRoutePattern(u.route);
        for (const p of docPages) if (pattern.test(p.name)) push(p);
      } else {
        const p = docPages.find(pp => pp.id === localPageId(u.route));
        if (p) push(p);
      }
    }
    for (const cu of usageBody.contentUsages ?? []) {
      const p = docPages.find(pp => pp.name.toLowerCase().endsWith('/' + cu.slug));
      if (p) push(p);
    }
    return out;
  }, [usageBody, docPages]);

  const { select: selectElement } = useSelectionContext();
  const goToUsagePage = useCallback((usagePageId: string) => {
    // LeftSidebar handles this by running its real tab-switch path — exits
    // the component view (works even when the target IS the current page,
    // where Editor's page-change clear can't fire) and drops any Assets
    // takeover so the canvas shows the page. The component-view selection is
    // meaningless on the page — clear it so no stale rect/panel lingers.
    selectElement(null);
    requestPageView();
    setActivePage(usagePageId);
  }, [selectElement, setActivePage]);

  // task-141 Media tab branch: tag-swap slot UI only for childless local-mode
  // source containers; everything else gets the background treatment.
  const showSlotUI = mediaEligible && !isResolvedMedia && (mediaFill || !hasElementChildren);
  // task-141: Media.astro instance with no project path — a data-sq-media
  // element resolves doc-side via RESOLVE_INSTANCE_MEDIA. The clicked DOM element
  // carries the instance-CHILD key (el-…:div-0); the doc command targets the
  // instance ROOT.
  const isDocMediaInstance = !isLocalProject && mediaFill;
  const parsedSelectedKey = parseKey(selectedKey);
  const instanceRootKey =
    parsedSelectedKey?.type === 'instance-child' ? parsedSelectedKey.instanceId :
    parsedSelectedKey?.type === 'instance-root' ? parsedSelectedKey.instanceId :
    selectedKey;
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Get takeSnapshot for undo support
  const { takeSnapshot, pushStructuralUndo } = useUndoContext();
  const dispatch = useDispatch();

  // Acceptance owns exact source bytes and the shared structural inverse.
  const swapWithUndo = useCallback(async (kind: 'image' | 'video' | 'container', src: string): Promise<boolean> => {
    if (!selectedSourceLocation) return false;
    return !!await sourceMediaMutation({ location: selectedSourceLocation, kind, src }, pushStructuralUndo);
  }, [selectedSourceLocation, pushStructuralUndo]);

  // A replacement thumbnail belongs to this exact selection visit. Captured
  // bytes never enter source/Yjs; release the temporary URL on replacement or exit.
  const mediaOwner = `${projectId}\0${pageId}\0${selectedKey}`;
  const mediaOwnerRef = useRef({ id: mediaOwner });
  const exceptionPending = useRef<object | null>(null);
  const exceptionHistory = useRef({ projectId, projectPath: localProjectPath, takeSnapshot });
  if (exceptionHistory.current.projectId !== projectId || exceptionHistory.current.projectPath !== localProjectPath || exceptionHistory.current.takeSnapshot !== takeSnapshot) {
    exceptionHistory.current = { projectId, projectPath: localProjectPath, takeSnapshot };
  }
  const captureExceptionHistory = useCallback(() => {
    const history = exceptionHistory.current;
    const activeProject = getActiveSaveProjectId();
    return (sideEffect: AssetSideEffect) => {
      // Receipt history belongs to the captured project/Undo provider, not the
      // selected image. Page/selection changes must not discard an ACK's inverse.
      // A project/path/provider visit change cannot publish into a new stack.
      if (exceptionHistory.current === history && getActiveSaveProjectId() === activeProject) history.takeSnapshot(sideEffect);
    };
  }, []);
  if (mediaOwnerRef.current.id !== mediaOwner) mediaOwnerRef.current = { id: mediaOwner };
  useEffect(() => () => { mediaOwnerRef.current = { id: '' }; }, []);
  const [replacementPreview, setReplacementPreview] = useState<{ owner: object; url: string } | null>(null);
  useEffect(() => () => {
    if (replacementPreview) URL.revokeObjectURL(replacementPreview.url);
  }, [replacementPreview]);
  useEffect(() => { setReplacementPreview(null); }, [mediaOwner, imageSrc]);
  useEffect(() => { setMediaBusy(false); setMediaError(null); }, [mediaOwner]);
  const exceptionAssetSource = useMemo(() => projectId && localProjectPath ? makeLocalAssetSource(projectId, localProjectPath) : undefined, [projectId, localProjectPath]);
  const selectedMediaPreview = replacementPreview?.owner === mediaOwnerRef.current
    ? replacementPreview.url : imagePreviewDataUrl;

  // task-142: bound-media swap — upload lands next to the old asset, content
  // refs repoint, binding survives. Undo/redo repoint between the two files
  // (both stay on disk).
  const handleBoundMediaDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file || !boundAssetPath || !projectId) return;
    if (validateImageFile(file)) { setMediaError('Choose a PNG, JPEG, GIF, WebP, or SVG image up to 10 MB.'); return; }
    if (mediaBusy || exceptionPending.current === mediaOwnerRef.current) return;
    const capturedOwner = mediaOwnerRef.current;
    const recordHistory = captureExceptionHistory();
    exceptionPending.current = capturedOwner;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const oldPath = boundAssetPath;
      const { newAsset } = await rebindLocalBoundAsset(projectId, oldPath, file);
      recordHistory({
        reverse: () => { void repointLocalBoundAsset(projectId, newAsset, oldPath); },
        forward: () => { void repointLocalBoundAsset(projectId, oldPath, newAsset); },
      });
    } catch (e) {
      if (mediaOwnerRef.current === capturedOwner) setMediaError('Image save needs checking. Open the content or component source to check the result.');
    } finally {
      if (exceptionPending.current === capturedOwner) exceptionPending.current = null;
      if (mediaOwnerRef.current === capturedOwner) setMediaBusy(false);
    }
  }, [boundAssetPath, projectId, mediaBusy, captureExceptionHistory]);

  // task-143 unified image UX: the component-editor placeholder is a real
  // slot — Replace/drop writes the COMPONENT'S DEFAULT image (import + prop
  // destructure default; the component-view stub injector skips props with
  // defaults, so the default renders). Delete clears it → placeholder again.
  const defaultImageWrite = useCallback(async (op: DefaultImageOp): Promise<{ previous: string | null; asset: string }> => {
    if (!defaultImageComponentFile || !localProjectPath) throw new Error('no component in view');
    return postComponentDefaultImage(localProjectPath, defaultImageComponentFile, imageComponentIndex ?? 0, op);
  }, [defaultImageComponentFile, localProjectPath, imageComponentIndex]);

  const handleDefaultImageDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (validateImageFile(file)) { setMediaError('Choose a PNG, JPEG, GIF, WebP, or SVG image up to 10 MB.'); return; }
    if (mediaBusy || exceptionPending.current === mediaOwnerRef.current) return;
    const capturedOwner = mediaOwnerRef.current;
    const recordHistory = captureExceptionHistory();
    exceptionPending.current = capturedOwner;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const { previous, asset } = await defaultImageWrite({ file });
      recordHistory({
        reverse: () => { void defaultImageWrite(previous ? { to: previous } : { clear: true }); },
        forward: () => { void defaultImageWrite({ to: asset }); },
      });
    } catch (e) {
      if (mediaOwnerRef.current === capturedOwner) setMediaError('Image save needs checking. Open the content or component source to check the result.');
    } finally {
      if (exceptionPending.current === capturedOwner) exceptionPending.current = null;
      if (mediaOwnerRef.current === capturedOwner) setMediaBusy(false);
    }
  }, [defaultImageWrite, mediaBusy, captureExceptionHistory]);

  const handleDefaultImageRemove = useCallback(async () => {
    if (mediaBusy || exceptionPending.current === mediaOwnerRef.current) return;
    const capturedOwner = mediaOwnerRef.current;
    const recordHistory = captureExceptionHistory();
    exceptionPending.current = capturedOwner;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const { previous } = await defaultImageWrite({ clear: true });
      if (previous) {
        recordHistory({
          reverse: () => { void defaultImageWrite({ to: previous }); },
          forward: () => { void defaultImageWrite({ clear: true }); },
        });
      }
    } catch (e) {
      if (mediaOwnerRef.current === capturedOwner) setMediaError('Image reset needs checking. Open the component source to check the result.');
    } finally {
      if (exceptionPending.current === capturedOwner) exceptionPending.current = null;
      if (mediaOwnerRef.current === capturedOwner) setMediaBusy(false);
    }
  }, [defaultImageWrite, mediaBusy, captureExceptionHistory]);


  // task-142 "delete" for bound media: the content schema requires an image,
  // so remove = rebind to a generated placeholder file. Undo repoints back.
  const handleBoundMediaRemove = useCallback(async () => {
    if (mediaBusy || exceptionPending.current === mediaOwnerRef.current) return;
    const capturedOwner = mediaOwnerRef.current;
    try {
      const placeholder = await makePlaceholderImageFile();
      if (mediaOwnerRef.current !== capturedOwner) return;
      await handleBoundMediaDrop([placeholder]);
    } catch (e) {
      if (mediaOwnerRef.current === capturedOwner) setMediaError('The placeholder could not be prepared. Try again.');
    }
  }, [mediaBusy, handleBoundMediaDrop]);

  // task-144: overlay img/video writes — upload via THE shared path
  // (sq-asset — the same adapter ImageUploadOverlay uses for video), then
  // UPDATE_IMAGE_ATTRIBUTE doc overlay + iframe sync. The accepted file kind
  // MATCHES the element's tag: no tag conversion here.
  const handleOverlayMediaDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file || !selectedKey || !projectId || !pageId) return;
    const validationError = isOverlayVideo ? validateVideoFile(file) : validateImageFile(file);
    if (validationError) { setMediaError(validationError); return; }
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      takeSnapshot();
      const { src } = await uploadImageFile({ file, projectId, pageId, uploadAsset });
      dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: selectedKey, attribute: 'src', value: src });
      syncImageAttrToIframe(selectedKey, 'src', src);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setMediaBusy(false);
    }
  }, [selectedKey, projectId, pageId, uploadAsset, mediaBusy, dispatch, takeSnapshot, isOverlayVideo]);

  const handleOverlayMediaRemove = useCallback(() => {
    if (!selectedKey) return;
    takeSnapshot();
    dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: selectedKey, attribute: 'src', value: '' });
    syncImageAttrToIframe(selectedKey, 'src', '');
  }, [selectedKey, dispatch, takeSnapshot]);

  // task-144: URL field — sanitize on commit, same dispatch as the upload path.
  const [overlayUrl, setOverlayUrl] = useState(imageSrc ?? '');
  useEffect(() => {
    setOverlayUrl(imageSrc ?? '');
  }, [imageSrc, selectedKey]);
  const handleOverlayUrlBlur = useCallback(() => {
    if (!selectedKey || overlayUrl === (imageSrc ?? '')) return;
    const sanitized = sanitizeUrl(overlayUrl);
    if (sanitized === null) {
      setMediaError('Invalid URL scheme');
      setOverlayUrl(imageSrc ?? '');
      return;
    }
    setMediaError(null);
    takeSnapshot();
    dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: selectedKey, attribute: 'src', value: sanitized });
    syncImageAttrToIframe(selectedKey, 'src', sanitized);
  }, [selectedKey, overlayUrl, imageSrc, takeSnapshot, dispatch]);

  // task-144: loading attr — the bridge doesn't report it, so default lazy
  // (the img default the old Image block also assumed).
  const [overlayLoading, setOverlayLoading] = useState<'lazy' | 'eager'>('lazy');
  useEffect(() => { setOverlayLoading('lazy'); }, [selectedKey]);
  const handleOverlayLoadingChange = useCallback((value: 'lazy' | 'eager') => {
    if (!selectedKey) return;
    setOverlayLoading(value);
    takeSnapshot();
    dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: selectedKey, attribute: 'loading', value });
    syncImageAttrToIframe(selectedKey, 'loading', value);
  }, [selectedKey, takeSnapshot, dispatch]);

  // task-142: ALWAYS-VISIBLE Replace via file picker — the hover-✕/dropzone
  // affordances were undiscoverable ("there is no delete button").
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceHandlerRef = useRef<(files: File[]) => void>(() => {});
  const openReplacePicker = useCallback((handler: (files: File[]) => void) => {
    replaceHandlerRef.current = handler;
    replaceInputRef.current?.click();
  }, []);

  const handleMediaDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file || !selectedSourceLocation || !projectId) return;
    const kind = file.type.startsWith('image/') ? 'image' as const
      : file.type.startsWith('video/') ? 'video' as const : null;
    if (!kind) { setMediaError('Images and videos only'); return; }
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    const owner = mediaOwnerRef.current;
    try {
      const { src } = await uploadLocalAssetFile(projectId, file);
      const ok = await swapWithUndo(kind, src);
      if (ok && kind === 'image' && mediaOwnerRef.current === owner) {
        setReplacementPreview({ owner, url: URL.createObjectURL(file) });
      }
      if (!ok) setMediaError('Write failed — is the local instance running?');
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setMediaBusy(false);
    }
  }, [selectedSourceLocation, projectId, mediaBusy, swapWithUndo]);


  // task-141: drawn-element media resolve — upload via THE upload path, then
  // snapshot + doc command (undoable). Local mode writes a real file; other
  // runtimes ride the sq-asset pipeline.
  const handleDrawnMediaDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file || !selectedKey || !projectId) return;
    const kind = file.type.startsWith('image/') ? 'image' as const
      : file.type.startsWith('video/') ? 'video' as const : null;
    if (!kind) { setMediaError('Images and videos only'); return; }
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      let src: string;
      if (isLocalProjectId(projectId)) {
        ({ src } = await uploadLocalAssetFile(projectId, file));
      } else {
        const { assetId } = await uploadAsset(file);
        await transferAssetToIframe(assetId, file);
        src = `sq-asset:${assetId}`;
      }
      takeSnapshot();
      dispatch({ type: 'RESOLVE_DRAWN_MEDIA', key: selectedKey, kind, src });
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setMediaBusy(false);
    }
  }, [selectedKey, projectId, mediaBusy, uploadAsset, takeSnapshot, dispatch]);

  const handleDrawnMediaRemove = useCallback(() => {
    if (!selectedKey) return;
    takeSnapshot();
    dispatch({ type: 'RESOLVE_DRAWN_MEDIA', key: selectedKey, kind: 'none' });
  }, [selectedKey, takeSnapshot, dispatch]);

  // task-141: doc-side Media.astro instance resolve — sq-asset pipeline + doc command
  const handleInstanceMediaDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file || !selectedKey || !projectId) return;
    const kind = file.type.startsWith('image/') ? 'image' as const
      : file.type.startsWith('video/') ? 'video' as const : null;
    if (!kind) { setMediaError('Images and videos only'); return; }
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const { assetId } = await uploadAsset(file);
      await transferAssetToIframe(assetId, file);
      takeSnapshot();
      dispatch({ type: 'RESOLVE_INSTANCE_MEDIA', key: instanceRootKey!, kind, src: `sq-asset:${assetId}` });
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setMediaBusy(false);
    }
  }, [selectedKey, instanceRootKey, projectId, mediaBusy, uploadAsset, takeSnapshot, dispatch]);

  const handleInstanceMediaRemove = useCallback(() => {
    if (!selectedKey) return;
    takeSnapshot();
    dispatch({ type: 'RESOLVE_INSTANCE_MEDIA', key: instanceRootKey!, kind: 'none' });
  }, [selectedKey, instanceRootKey, takeSnapshot, dispatch]);

  // Sync tab when classes change externally; an unresolved media slot and a
  // resolved img/video open straight on the Media tab (task-140/141).
  useEffect(() => {
    setActiveTab(mediaFill || isResolvedMedia || lockedToMediaTab ? 'media' : detectedTab);
  }, [detectedTab, mediaFill, isResolvedMedia, lockedToMediaTab]);

  // task-141 unification: the Fill Media tab is the ONE image surface — the
  // old Image block is hidden for resolved media, so alt lives here (attr
  // write, same UPDATE_IMAGE_ATTRIBUTE path the Image block used).
  const [localAlt, setLocalAlt] = useState(imageAlt ?? '');
  useEffect(() => {
    setLocalAlt(imageAlt ?? '');
  }, [imageAlt, selectedKey]);
  const handleAltBlur = useCallback(() => {
    if (!selectedKey || localAlt === (imageAlt ?? '')) return;
    takeSnapshot();
    dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: selectedKey, attribute: 'alt', value: localAlt });
    syncImageAttrToIframe(selectedKey, 'alt', localAlt);
  }, [selectedKey, localAlt, imageAlt, takeSnapshot, dispatch]);

  // task-141: clicking Solid/Gradient on a resolved img/video un-resolves it
  // (tag swap back to <div>) before switching tabs. Undoable via ⌘Z (inverse
  // write restores src + alt); a failed write keeps the Media tab with an error.
  const handleTabChange = useCallback(async (tab: FillTab) => {
    // task-142/144: sourceless media has nothing to un-resolve, and an overlay
    // img never had Solid/Gradient — the Media tab is the only surface for both.
    if (lockedToMediaTab) return;
    if (!isResolvedMedia || tab === 'media') {
      setActiveTab(tab);
      return;
    }
    if (!selectedSourceLocation) return;
    setMediaError(null);
    setMediaBusy(true);
    try {
      const ok = await swapWithUndo('container', '');
      if (!ok) {
        setMediaError('Write failed — is the local instance running?');
        return;
      }
      setActiveTab(tab);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Write failed');
    } finally {
      setMediaBusy(false);
    }
  }, [lockedToMediaTab, isResolvedMedia, selectedSourceLocation, swapWithUndo]);

  // task-141: explicit un-resolve — the discoverable "remove" for resolved media.
  const handleResolvedMediaRemove = useCallback(async () => {
    if (!selectedSourceLocation) return;
    setMediaError(null);
    setMediaBusy(true);
    try {
      const ok = await swapWithUndo('container', '');
      if (!ok) setMediaError('Write failed — is the local instance running?');
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Write failed');
    } finally {
      setMediaBusy(false);
    }
  }, [selectedSourceLocation, swapWithUndo]);

  // Sync local URL input and clear local upload preview when bg image URL changes (undo/redo, new element, etc.)
  useEffect(() => {
    setLocalImageUrl(bgImage.url);
    setLocalPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [bgImage.url]);

  // ============================================================================
  // Solid Tab Handlers
  // ============================================================================

  const handleColorChange = useCallback((colorClass: string, hex: string) => {
    // Remove old bg color classes and gradient classes
    let newClasses = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^bg-\[#[0-9a-fA-F]+\](\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^bg-\[var\(--.+\)\]$/, null);
    newClasses = setClass(newClasses, /^bg-opacity-\d+$/, null);
    // Clear gradient when setting solid color
    newClasses = setClass(newClasses, /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/, null);
    newClasses = setClass(newClasses, /^from-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^from-\[#[0-9a-fA-F]+\](\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^via-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^via-\[#[0-9a-fA-F]+\](\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^to-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^to-\[#[0-9a-fA-F]+\](\/\d+)?$/, null);

    if (colorClass) {
      newClasses = newClasses + ` ${colorClass}`;
    }

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  // ============================================================================
  // Gradient Tab Handlers
  // ============================================================================

  const handleGradientDirectionChange = useCallback((direction: string) => {
    // Clear solid bg color when setting gradient
    let newClasses = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
    newClasses = setClass(newClasses, /^bg-\[#[0-9a-fA-F]+\](\/\d+)?$/, null);
    // Remove old direction
    newClasses = setClass(newClasses, /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/, null);

    if (direction) {
      newClasses = newClasses + ` bg-gradient-${direction}`;
    }

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  const handleGradientColorChange = useCallback((prefix: 'from' | 'via' | 'to', colorClass: string, hex: string) => {
    // Remove old color for this prefix (including any /N opacity suffix)
    let newClasses = setClass(classes, new RegExp(`^${prefix}-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\\d+)?(\\/\\d+)?$`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}-\\[#[0-9a-fA-F]+\\](\\/\\d+)?$`), null);

    if (colorClass) {
      // Convert bg-xxx to from/via/to-xxx
      const convertedClass = colorClass.replace(/^bg-/, `${prefix}-`);
      newClasses = newClasses + ` ${convertedClass}`;
    }

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  // ============================================================================
  // Image Tab Handlers
  // ============================================================================

  const handleImageUrlChange = useCallback((url: string) => {
    const sanitizedUrl = sanitizeUrl(url);
    if (sanitizedUrl === null) return;

    let newClasses = setClass(classes, /^bg-\[url\(.+\)\]$/, null);
    if (sanitizedUrl) {
      newClasses = newClasses + ` bg-[url('${sanitizedUrl}')]`;
    }

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  // Commit URL input on blur — takes one snapshot per edit instead of per keystroke
  const handleImageUrlBlur = useCallback(() => {
    if (localImageUrl !== bgImage.url) {
      takeSnapshot();
      handleImageUrlChange(localImageUrl);
    }
  }, [localImageUrl, bgImage.url, handleImageUrlChange, takeSnapshot]);

  const uploadFile = useCallback(async (file: File) => {
    if (!projectId || !pageId) {
      setUploadError('Project or page not found');
      return;
    }

    // Take snapshot BEFORE async upload so undo captures the correct baseline,
    // even if the user makes other edits during the upload.
    takeSnapshot();
    setIsUploading(true);
    setUploadError(null);

    try {
      if (isLocalProjectId(projectId)) {
        // task-132 files-truth: real file in the folder's public/, plain URL class token
        const { src, previewUrl } = await uploadLocalAssetFile(projectId, file);
        handleImageUrlChange(src);
        setLocalPreviewUrl(previewUrl);
      } else {
        const { assetId } = await uploadAsset(file);
        await transferAssetToIframe(assetId, file);
        handleImageUrlChange(`sq-asset:${assetId}`);
        setLocalPreviewUrl(URL.createObjectURL(file));
      }

      setIsUploading(false);
    } catch (error) {
      console.error('[FillBlock] Upload failed:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
      setIsUploading(false);
    }
  }, [projectId, pageId, handleImageUrlChange, uploadAsset, takeSnapshot]);

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    uploadFile(file);
  }, [uploadFile]);

  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Handle upload zone click
  const handleUploadZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // task-142: background images had NO remove affordance — the only way out
  // was manually blanking the URL field. One undoable clear.
  const handleBgImageRemove = useCallback(() => {
    takeSnapshot();
    handleImageUrlChange('');
    setLocalPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [takeSnapshot, handleImageUrlChange]);

  const handleImageSizeChange = useCallback((size: string) => {
    let newClasses = setClass(classes, /^bg-(cover|contain|auto)$/, null);

    // Always add explicit size class so mergeClasses can override base classes
    // bg-auto is the browser default, so it's harmless for source elements
    const sizeClass = size || 'auto';
    newClasses = newClasses + ` bg-${sizeClass}`;

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  const handleImagePositionChange = useCallback((position: string) => {
    let newClasses = setClass(classes, /^bg-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/, null);

    // Always add explicit position class so mergeClasses can override base classes
    // bg-center is the most sensible default for background images
    const twPosition = (position || 'center')
      .replace('top-left', 'left-top').replace('top-right', 'right-top')
      .replace('bottom-left', 'left-bottom').replace('bottom-right', 'right-bottom');
    newClasses = newClasses + ` bg-${twPosition}`;

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  const handleImageRepeatChange = useCallback((repeat: string) => {
    let newClasses = setClass(classes, /^bg-(repeat|no-repeat|repeat-x|repeat-y)$/, null);

    // Always add explicit repeat class so mergeClasses can override base classes
    // bg-repeat is the browser default, so it's harmless for source elements
    const repeatClass = repeat || 'repeat';
    newClasses = newClasses + ` bg-${repeatClass}`;

    onClassesChange(newClasses.trim());
  }, [classes, onClassesChange]);

  // ============================================================================
  // Render
  // ============================================================================

  if (isSourcelessMediaSurface && !isDrawnElement && !isDocMediaInstance) {
    const editOwner = ownerComponentFile && !componentViewFile ? <Button variant="ghost" size="sm" label={'Edit ' + (ownerComponentFile.split('/').pop() ?? 'component')} onClick={() => { window.dispatchEvent(new CustomEvent('sq:go-to-source-component', { detail: { path: ownerComponentFile } })); }} /> : null;
    return <ExceptionImageFillControls ownerId={mediaOwner} src={boundAssetPath ?? imageSrc ?? (isDefaultImageSurface ? '' : 'bound')} preview={selectedMediaPreview ?? null} caption={isBoundMedia ? 'Content image' : isDefaultImageSurface ? 'Component default' : 'Component property'} busy={mediaBusy} error={mediaError} onFiles={isBoundMedia ? handleBoundMediaDrop : isDefaultImageSurface ? handleDefaultImageDrop : undefined} assetSource={exceptionAssetSource} dropText={isBoundMedia ? 'Drop image to replace — updates the content data' : 'Drop image — becomes the component default'}>
      {isBoundMedia ? <>
        <OperationNotice title="This image is bound to a content entry." detail="This entry requires an image. Replacing keeps its data binding; using a placeholder can be undone." />
        <Button variant="ghost" size="sm" label="Use placeholder" disabled={mediaBusy} onClick={() => { void handleBoundMediaRemove(); }} />
      </> : isDefaultImageSurface ? <>
        <OperationNotice title="This component’s default image" detail="Pages that pass their own image keep it. Reset restores the placeholder; Undo restores the previous default." />
        {isSqDefaultAsset && <Button variant="ghost" size="sm" label="Reset default image" disabled={mediaBusy} onClick={() => { void handleDefaultImageRemove(); }} />}
        {usageComponentFile && (usageUnavailable ? <OperationNotice title="Component usages are unavailable." action={{ label: 'Retry usages', onClick: () => refreshUsages(n => n + 1) }} /> : usageBody === null ? <Row size="sm" title="Reading component usages…" hover={false} /> : usagePages.length ? <Row size="sm" title="Used on" hover={false} /> : <Row size="sm" title="No page usages found" hover={false} />)}
        {usagePages.map(p => <Button key={p.id} variant="ghost" size="sm" label={p.name} onClick={() => goToUsagePage(p.id)} />)}
      </> : <OperationNotice title="This image comes from component props." detail="Change the image where the component is used." />}
      {editOwner}
    </ExceptionImageFillControls>;
  }

  return (
    <div className="space-y-1 pr-8 pb-2">
      {/* Tab Switcher */}
      <SegmentedControl
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'media', label: 'Media' }
        ]}
        value={activeTab}
        onChange={(tab) => handleTabChange(tab as FillTab)}
        showChevron={false}
      />

      {/* Media Tab — task-141: drawn elements resolve doc-side in all runtimes */}
      {activeTab === 'media' && isDrawnElement && (
        <div className="space-y-1">
          <Dropzone
            onFiles={handleDrawnMediaDrop}
            accept="image/*,video/*"
            disabled={mediaBusy}
          >
            {mediaBusy ? 'Uploading…' : 'Drop image or video — the shape becomes it'}
          </Dropzone>
          <Button
            variant="ghost"
            size="sm"
            label="Remove media"
            onClick={handleDrawnMediaRemove}
            className="w-full"
          />
          {mediaError && <div className="text-xs text-error px-1">{mediaError}</div>}
        </div>
      )}

      {/* Media Tab — task-141: Media.astro instance resolves doc-side (no project path) */}
      {activeTab === 'media' && !isDrawnElement && isDocMediaInstance && (
        <div className="space-y-1">
          <Dropzone
            onFiles={handleInstanceMediaDrop}
            accept="image/*,video/*"
            disabled={mediaBusy}
          >
            {mediaBusy ? 'Uploading…' : 'Drop image or video — the box becomes it'}
          </Dropzone>
          <Button
            variant="ghost"
            size="sm"
            label="Remove media"
            onClick={handleInstanceMediaRemove}
            className="w-full"
          />
          {mediaError && <div className="text-xs text-error px-1">{mediaError}</div>}
        </div>
      )}

      {/* Media Tab — task-141: resolved img/video is the ONE image surface —
          replace dropzone + alt (img) + fit/position (object-* classes). */}
      {activeTab === 'media' && !isDrawnElement && !isDocMediaInstance && isResolvedMedia && (
        <MediaSurface
          accept="image/*,video/*"
          busy={mediaBusy}
          dropText={mediaBusy ? 'Uploading…' : 'Drop image or video to replace'}
          onFiles={handleMediaDrop}
          onOpenPicker={() => openReplacePicker((files) => { void handleMediaDrop(files); })}
          previewUrl={selectedMediaPreview ?? null}
          onDelete={() => { void handleResolvedMediaRemove(); }}
          primaryLabel="Replace media…"
          error={mediaError}
        >
          {selectedTag === 'img' && (
            <AltTextField value={localAlt} onChange={setLocalAlt} onBlur={handleAltBlur} />
          )}
          <FitPositionFields classes={classes} onClassesChange={onClassesChange} />
          {/* No preview to hover (e.g. video capture unavailable) — keep a
              visible remove affordance. */}
          {!imagePreviewDataUrl && (
            <Button
              variant="ghost"
              size="sm"
              label="Remove media"
              onClick={handleResolvedMediaRemove}
              className="w-full"
            />
          )}
        </MediaSurface>
      )}

      {/* Media Tab — task-140/141: for a childless local-mode source container
          the tab is a media slot (a dropped file resolves the real tag,
          img/video, in the source file); for everything else it is the
          background-image treatment (the old Image tab body). */}
      {activeTab === 'media' && !isDrawnElement && !isDocMediaInstance && showSlotUI && (
        <div className="space-y-1">
          {/* No arming step — the dropzone IS the media surface; a dropped
              file resolves the real tag (img/video) in the source file. */}
          <Dropzone
            onFiles={handleMediaDrop}
            accept="image/*,video/*"
            disabled={mediaBusy}
          >
            {mediaBusy ? 'Uploading…' : 'Drop image or video — the box becomes it'}
          </Dropzone>
          {mediaError && <div className="text-xs text-error px-1">{mediaError}</div>}
        </div>
      )}

      {/* Solid Tab */}
      {activeTab === 'solid' && (
        <ColorPicker
          value={bgColor.colorClass}
          onChange={handleColorChange}
          prefix="bg"
          placeholder="None"
        />
      )}

      {/* Gradient Tab */}
      {activeTab === 'gradient' && (
        <div className="space-y-1">
          {/* Direction */}
          <div>
            <Row title="Direction" size="sm" />
            <Field
              as="select"
              value={gradient.direction}
              onChange={handleGradientDirectionChange}
              options={GRADIENT_DIRECTIONS}
              placeholder="Select direction"
            />
          </div>

          {/* From Color */}
          <div>
            <Row title="From" size="sm" />
            <ColorPicker
              value={gradient.fromColor.replace(/^from-/, 'bg-')}
              onChange={(colorClass, hex) => handleGradientColorChange('from', colorClass, hex)}
              prefix="bg"
              placeholder="Start color"
            />
          </div>

          {/* Via Color (optional) */}
          <div>
            <Row title="Via (optional)" size="sm" />
            <ColorPicker
              value={gradient.viaColor.replace(/^via-/, 'bg-')}
              onChange={(colorClass, hex) => handleGradientColorChange('via', colorClass, hex)}
              prefix="bg"
              placeholder="Middle color"
            />
          </div>

          {/* To Color */}
          <div>
            <Row title="To" size="sm" />
            <ColorPicker
              value={gradient.toColor.replace(/^to-/, 'bg-')}
              onChange={(colorClass, hex) => handleGradientColorChange('to', colorClass, hex)}
              prefix="bg"
              placeholder="End color"
            />
          </div>

        </div>
      )}

      {/* Media Tab — task-144: overlay img/video (no project path) — the SAME
          unified surface as resolved media; writes ride the UPDATE_IMAGE_ATTRIBUTE
          doc overlay + the class writer. accept matches the ELEMENT's kind — no
          tag-swap here, so a video only takes video files and vice versa.
          The bridge never reports imageSrc/preview for <video> (img-only
          scan fields), so the video branch keeps Delete always visible
          instead of gating on a src it cannot see. */}
      {activeTab === 'media' && isOverlayMedia && (
        <MediaSurface
          accept={isOverlayVideo ? ALLOWED_VIDEO_TYPES.join(',') : 'image/*'}
          busy={mediaBusy}
          dropText={mediaBusy ? 'Uploading…'
            : isOverlayVideo ? 'Drop video to replace'
            : imageSrc ? 'Drop image to replace' : 'Drop image here'}
          onFiles={(files) => { void handleOverlayMediaDrop(files); }}
          onOpenPicker={() => openReplacePicker((files) => { void handleOverlayMediaDrop(files); })}
          previewUrl={selectedMediaPreview ?? null}
          onDelete={isOverlayVideo || imageSrc ? handleOverlayMediaRemove : null}
          primaryLabel={isOverlayVideo ? 'Replace video…' : imageSrc ? 'Replace image…' : 'Add image…'}
          error={mediaError}
        >
          {!isOverlayVideo && (
            <AltTextField value={localAlt} onChange={setLocalAlt} onBlur={handleAltBlur} />
          )}
          <div>
            <Row title="Source URL" size="sm" />
            <input
              type="text"
              value={overlayUrl}
              onChange={(e) => setOverlayUrl(e.target.value)}
              onBlur={handleOverlayUrlBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder={isOverlayVideo ? 'https://example.com/video.mp4' : 'https://example.com/image.jpg'}
              className="w-full py-1 px-2 text-xs bg-input-fill text-text border border-input-stroke rounded-sm outline-none focus:border-accent-strong"
            />
          </div>
          {!isOverlayVideo && (
            <div>
              <Row title="Loading" size="sm" />
              <SegmentedControl
                options={[
                  { value: 'lazy', label: 'Lazy' },
                  { value: 'eager', label: 'Eager' },
                ]}
                value={overlayLoading}
                onChange={(value) => handleOverlayLoadingChange(value as 'lazy' | 'eager')}
                showChevron={false}
              />
            </div>
          )}
          <FitPositionFields classes={classes} onClassesChange={onClassesChange} />
        </MediaSurface>
      )}

      {/* Media Tab — background treatment (old Image tab body) */}
      {activeTab === 'media' && !isDrawnElement && !isDocMediaInstance && !showSlotUI && !isResolvedMedia && !isSourcelessMediaSurface && !isOverlayMedia && (
        <div className="space-y-1">
          {/* gaps 2/31: childless container with no project path — same drop
              target a project converts, but here the file lands as a
              BACKGROUND image. Honest note instead of a hidden surface. */}
          {isConvertLocked && (
            <div className="text-xs text-text-secondary px-1">
              Applies as a background image. Turning this box into a real
              image or video element needs a local project.
            </div>
          )}
          {/* Upload Zone */}
          <div>
            <Row title="Image" size="sm" />
            <div
              onClick={handleUploadZoneClick}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                p-3 border-2 border-dashed rounded-sm cursor-pointer transition-colors
                ${isDragging ? 'border-accent-strong bg-info-subtle' : 'border-stroke hover:border-text-muted'}
                ${isUploading ? 'opacity-50 pointer-events-none' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(',')}
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-1 text-center">
                {isUploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-text-muted" />
                    <span className="text-xs text-text-muted">Uploading...</span>
                  </>
                ) : (
                  <>
                    <SharedImageIcon className="w-4 h-4 text-text-muted" />
                    <span className="text-xs text-text-muted">
                      Drop image or click to browse
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Error message */}
          {uploadError && (
            <div className="text-xs text-error px-1">{uploadError}</div>
          )}

          {/* Background image preview — only render with data URL (cross-origin URLs 404 from editor) */}
          {(localPreviewUrl || bgImagePreviewDataUrl) && (
            <img
              key={localPreviewUrl || bgImagePreviewDataUrl}
              src={localPreviewUrl || bgImagePreviewDataUrl}
              alt="Background preview"
              className="w-full h-20 object-cover rounded-sm border border-stroke"
            />
          )}

          {/* ALWAYS-VISIBLE remove whenever a background image is set (task-142) */}
          {(bgImage.url || localPreviewUrl || bgImagePreviewDataUrl) && (
            <Button
              variant="danger"
              size="sm"
              label="Remove background image"
              onClick={handleBgImageRemove}
              className="w-full"
            />
          )}

          {/* URL Input */}
          <div>
            <Row title="Image URL" size="sm" />
            <input
              type="text"
              className="w-full py-1 px-2 text-xs bg-input-fill text-text border border-input-stroke rounded-sm outline-none"
              value={localImageUrl}
              onChange={(e) => setLocalImageUrl(e.target.value)}
              onBlur={handleImageUrlBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder="https://example.com/image.jpg"
            />
          </div>

          {/* Size */}
          <div>
            <Row title="Size" size="sm" />
            <SegmentedControl
              options={BG_SIZE_OPTIONS}
              value={bgImage.size || 'auto'}
              onChange={handleImageSizeChange}
              showChevron={false}
            />
          </div>

          {/* Position */}
          <div>
            <Row title="Position" size="sm" />
            <Field
              as="select"
              value={bgImage.position}
              onChange={handleImagePositionChange}
              options={BG_POSITION_OPTIONS}
            />
          </div>

          {/* Repeat */}
          <div>
            <Row title="Repeat" size="sm" />
            <SegmentedControl
              options={BG_REPEAT_OPTIONS}
              value={bgImage.repeat || 'repeat'}
              onChange={handleImageRepeatChange}
              showChevron={false}
            />
          </div>

        </div>
      )}

      {/* Shared hidden input for the visible Replace buttons (task-142).
          Rendered LAST and only for the branches that use it — earlier
          placement hijacked the upload-zone input in tests and other flows. */}
      {(isResolvedMedia || isBoundMedia || isDefaultImageSurface || isOverlayMedia) && (
        <input
          ref={replaceInputRef}
          type="file"
          accept={isOverlayVideo ? ALLOWED_VIDEO_TYPES.join(',')
            : isBoundMedia || isDefaultImageSurface || isOverlayMedia ? 'image/*' : 'image/*,video/*'}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) replaceHandlerRef.current([f]);
            e.target.value = '';
          }}
        />
      )}
    </div>
  );
};

export default FillBlock;
