/**
 * task-141: direct canvas file drop — no arming step. The bridge sends
 * CANVAS_FILE_DROP with the hovered element's payload + the File objects
 * (structured clone); this handler classifies the target and routes:
 * - swap:       img/video local source element → tag-swap write (src swap / kind change)
 * - convert:    childless local source container → tag-swap write (div → img/video)
 * - drawn:      drawn element (any runtime) → snapshot + RESOLVE_DRAWN_MEDIA
 * - background: container with children (local) → bg-[url(...)] classes; video toasts (task-134)
 * - overlay-swap / overlay-background (task-144): WC source img/video/container →
 *   sq-asset upload + UPDATE_IMAGE_ATTRIBUTE / UPDATE_SOURCE_CLASSES overlay;
 *   same-kind swaps only (video file → <video>, image file → <img>) — a kind
 *   change (image↔video, container→media) needs local's tag-swap write
 * - reject:     always TOASTED (task-144: a silent no-op reads as "it worked")
 */
import toast from 'react-hot-toast';
import type { MessageHandler } from './context';
import type { SourceLocation } from '@/core/state/index';
import { isDrawnKey } from '@/store/types';
import { isLocalProjectId } from '@/utils/localMode';
import { uploadLocalAssetFile, rebindLocalBoundAsset, repointLocalBoundAsset, syncImageAttrToIframe } from '@/utils/imageUpload';
import { uploadAssetBlob } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { sourceMediaMutation } from '@/services/sourceMediaMutation';
import { captureLocalWriteOrigin, isCrossFileAtOrigin } from '@/utils/localWriteScope';
import { readCurrentImageFillSource, readImageFillSourceState } from '@/services/imageFillSourceRead';
import { validateImageFile } from '@/utils/imageValidation';
import { changeBackgroundFill, backgroundFillSupported } from '@/services/imageFillModel';
import type { ImageFillGeometry } from '@/services/imageFillGeometry';
import { readImageFillSource, normalizeImageFillSource, inspectImageFillContainerTag } from '../../../../../preview-template/src/plugins/sq-image-fill.js';

export type MediaDropAction = 'image-fill' | 'swap' | 'convert' | 'drawn' | 'background' | 'rebind' | 'overlay-swap' | 'overlay-background' | 'reject';

export interface MediaDropTarget {
  key: string | null;
  tagName: string | null;
  hasElementChildren: boolean;
  hasSourceLocation: boolean;
  insideAnchor: boolean;
  isLocalMode: boolean;
  fileKind: 'image' | 'video' | null;
  /** task-142: astro <Image> bound to content data — decoded src/ asset path */
  boundAssetPath?: string | null;
  mediaFill?: boolean;
}

const CONTAINER_TAGS = ['div', 'section', 'article', 'figure', 'span'];

export function classifyMediaDrop(t: MediaDropTarget): MediaDropAction {
  if (!t.fileKind || !t.key) return 'reject';
  if (isDrawnKey(t.key)) return 'drawn'; // doc-side, works in every runtime
  // task-142: content-bound astro <Image> — drop = data-aware rebind. Checked
  // BEFORE the anchor rule: replacing an image inside a link is legitimate
  // (every card image sits in an <a>).
  if (t.isLocalMode && t.tagName === 'img' && !t.hasSourceLocation && t.boundAssetPath && t.fileKind === 'image') {
    return 'rebind';
  }
  if (t.insideAnchor) return 'reject';
  if (!t.hasSourceLocation) return 'reject';
  // task-144: WC/server — overlay writes (sq-asset + doc commands); tag-swap
  // and file writes stay local-only. Only SAME-KIND src swaps are expressible
  // here: an image src on a <video> (or vice versa) renders a dead element,
  // and container→media needs local's tag-swap write — those reject loudly.
  if (!t.isLocalMode) {
    if (t.tagName === 'img' && t.fileKind === 'image') return 'overlay-swap';
    if (t.tagName === 'video' && t.fileKind === 'video') return 'overlay-swap';
    if (CONTAINER_TAGS.includes(t.tagName ?? '') && t.fileKind === 'image') return 'overlay-background';
    return 'reject';
  }
  if (t.tagName === 'img') return t.fileKind === 'image' ? 'image-fill' : 'reject';
  if (t.tagName === 'video') return 'swap';
  if (!CONTAINER_TAGS.includes(t.tagName ?? '')) return 'reject';
  return t.fileKind === 'image' && !t.mediaFill || t.hasElementChildren ? 'background' : 'convert';
}

interface CanvasFileDropPayload {
  target: {
    key?: string;
    tagName?: string;
    sourceLocation?: SourceLocation | null;
    hasElementChildren?: boolean;
    insideAnchor?: boolean;
    boundAssetPath?: string | null;
    mediaFill?: boolean;
    classes?: string;
    computedStyles?: ImageFillGeometry;
  } | null;
  files: File[];
}

export const handleCanvasFileDrop: MessageHandler = async (ctx, rawPayload) => {
  const { target, files } = (rawPayload ?? {}) as CanvasFileDropPayload;
  const file = files?.[0];
  if (!file) return;

  const kind = file.type.startsWith('image/') ? 'image' as const
    : file.type.startsWith('video/') ? 'video' as const : null;
  if (!kind) {
    toast('Images and videos only', { icon: '⚠️' });
    return;
  }

  const projectId = ctx.env.projectId;
  if (!projectId) return;
  const isLocalMode = isLocalProjectId(projectId);

  const action = classifyMediaDrop({
    key: target?.key ?? null,
    tagName: target?.tagName ?? null,
    hasElementChildren: target?.hasElementChildren === true,
    hasSourceLocation: !!target?.sourceLocation,
    insideAnchor: target?.insideAnchor === true,
    isLocalMode,
    fileKind: kind,
    boundAssetPath: target?.boundAssetPath ?? null,
    mediaFill: target?.mediaFill,
  });
  const origin = captureLocalWriteOrigin();
  const page = ctx.refs.currentPageId.current;
  const selected = ctx.refs.selectedKey.current;
  const isCurrent = () => ctx.env.projectId === projectId && ctx.refs.currentPageId.current === page && ctx.refs.selectedKey.current === selected;
  let uploaded = false;
  let sourceStarted = false;

  try {
    switch (action) {
      case 'reject':
        // task-142/144: EVERY reject says why — a silent no-op reads as
        // "it worked" while nothing was saved (the old DOM-only ghost bug).
        if ((target?.tagName === 'img' || target?.tagName === 'video') && !target?.sourceLocation) {
          toast('This image is set by component props or content data — replace it via Fill → Media', { icon: '⚠️' });
        } else if (target?.insideAnchor) {
          toast('This element is inside a link — replace its image via Fill → Media', { icon: '⚠️' });
        } else if (!target?.sourceLocation) {
          toast('This element has no writable source — nothing was changed', { icon: '⚠️' });
        } else if (!isLocalMode && kind === 'image' && target?.tagName === 'video') {
          // Gap 63: writing an image src onto a <video> renders a dead element
          // — the kind change needs local's tag-swap write. Refuse honestly.
          toast('Turning this video into an image isn’t supported here yet — drop a video file', { icon: '⚠️' });
        } else if (!isLocalMode && kind === 'video') {
          toast('Videos can only replace video elements here — drop it onto a video', { icon: '⚠️' });
        } else {
          toast('Drop onto an image, video, or container element', { icon: '⚠️' });
        }
        return;

      case 'rebind': {
        // Content-bound astro <Image>: new file next to the old asset,
        // content refs repointed, binding survives (same op as Fill → Media).
        const oldPath = target!.boundAssetPath!;
        const { newAsset } = await rebindLocalBoundAsset(projectId, oldPath, file);
        ctx.actions.takeSnapshot({
          reverse: () => { void repointLocalBoundAsset(projectId, newAsset, oldPath); },
          forward: () => { void repointLocalBoundAsset(projectId, oldPath, newAsset); },
        });
        return;
      }

      case 'image-fill': {
        if (validateImageFile(file) || isCrossFileAtOrigin(origin, target!.sourceLocation!.file)) throw new Error('Image cannot be edited here');
        const sourceRead = await readImageFillSourceState(target!.sourceLocation!);
        if (!isCurrent()) return;
        const { expectedTag } = sourceRead;
        let source = await readCurrentImageFillSource({ location: target!.sourceLocation!, previous: sourceRead, native: true, isCurrent });
        if (!source || !isCurrent()) return;
        const { src } = await uploadLocalAssetFile(projectId, file); uploaded = true;
        if (!isCurrent()) return;
        source = await readCurrentImageFillSource({ location: target!.sourceLocation!, previous: source, native: true, isCurrent });
        if (!source || !isCurrent()) return;
        const request = { expectedTag: source.expectedTag, change: { type: 'replace' as const, src }, ...(target?.computedStyles?.maxWidth === '100%' ? { preserveMaxWidth: true as const } : {}) };
        const nextSource = normalizeImageFillSource(source.content, source.location ?? target!.sourceLocation!, request);
        sourceStarted = true;
        const receipt = await sourceMediaMutation({ location: target!.sourceLocation!, kind: 'image-fill', src: '', imageFill: request, origin, isCurrent }, ctx.actions.pushStructuralUndo);
        if (!receipt || !receipt.changed) throw new Error('Fill was not acknowledged');
        if (!isCurrent()) return;
        const normalized = inspectImageFillContainerTag(readImageFillSource(nextSource, source.location ?? target!.sourceLocation!).expectedTag);
        ctx.refs.registerElement.current(target!.key!, normalized.classes, target!.sourceLocation!);
        return;
      }

      case 'swap':
      case 'convert': {
        const { src } = await uploadLocalAssetFile(projectId, file);
        await sourceMediaMutation({ location: target!.sourceLocation!, kind, src, origin, isCurrent }, ctx.actions.pushStructuralUndo);
        return;
      }

      // task-144: WC source img/video (same-kind file) — sq-asset upload +
      // UPDATE_IMAGE_ATTRIBUTE overlay + live iframe sync (same write adapter
      // as Fill → Media / ImageUploadOverlay; the bridge resolves sq-asset
      // src on <video> too — see bridge video-attrs tests).
      case 'overlay-swap': {
        const { assetId } = await uploadAssetBlob(projectId, file);
        await transferAssetToIframe(assetId, file);
        const src = `sq-asset:${assetId}`;
        const key = target!.key!;
        ctx.actions.takeSnapshot();
        ctx.actions.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'src', value: src });
        syncImageAttrToIframe(key, 'src', src);
        return;
      }

      // task-144: WC source container — bg classes ride the class pipeline
      // (mirror of the local background branch, minus the file write).
      case 'overlay-background': {
        const { assetId } = await uploadAssetBlob(projectId, file);
        await transferAssetToIframe(assetId, file);
        const src = `sq-asset:${assetId}`;
        const key = target!.key!;
        const current = ctx.actions.getClassesFromYjs(key) || '';
        const withoutBgUrl = current
          .split(/\s+/)
          .filter(c => c && !/^bg-\[url\(.+\)\]$/.test(c))
          .join(' ');
        ctx.actions.takeSnapshot();
        ctx.actions.dispatch({
          type: 'UPDATE_SOURCE_CLASSES',
          sourceKey: key,
          classes: `${withoutBgUrl} bg-[url('${src}')] bg-cover`.trim(),
        });
        return;
      }

      case 'drawn': {
        let src: string;
        if (isLocalMode) {
          ({ src } = await uploadLocalAssetFile(projectId, file));
        } else {
          const { assetId } = await uploadAssetBlob(projectId, file);
          await transferAssetToIframe(assetId, file);
          src = `sq-asset:${assetId}`;
        }
        ctx.actions.takeSnapshot();
        ctx.actions.dispatch({ type: 'RESOLVE_DRAWN_MEDIA', key: target!.key!, kind, src });
        return;
      }

      case 'background': {
        if (kind === 'video') { toast('Video backgrounds are unavailable.', { icon: '⚠️' }); return; }
        if (validateImageFile(file) || isCrossFileAtOrigin(origin, target!.sourceLocation!.file)) throw new Error('Image cannot be edited here');
        if (!backgroundFillSupported(ctx.actions.getClassesFromYjs(target!.key!) || target?.classes || '', target?.computedStyles)) throw new Error('Background requires its source');
        const { src } = await uploadLocalAssetFile(projectId, file); uploaded = true;
        if (!isCurrent()) return;
        const key = target!.key!;
        const current = ctx.actions.getClassesFromYjs(key) || target?.classes || '';
        const classes = changeBackgroundFill(current, { type: 'replace', src });
        ctx.actions.takeSnapshot();
        ctx.actions.dispatch({ type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes });
        return;
      }
    }
  } catch {
    if (isCurrent()) toast(sourceStarted ? 'Fill save needs checking. Open Source to check the result.' : uploaded ? "Image uploaded. Fill wasn't changed. Open Fill to choose the uploaded image." : "Media couldn't be changed. Open Fill to check this image's source or binding.", { icon: '⚠️' });
  }
};
