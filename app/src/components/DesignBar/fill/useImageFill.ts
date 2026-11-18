// ui-lint-exempt: This module parses and generates user-document Tailwind classes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SourceLocation } from '@/core/state/index';
import type { PushStructuralUndo } from '@/store/structuralUndo';
import { sourceMediaMutation } from '@/services/sourceMediaMutation';
import { captureLocalWriteOrigin, isCrossFileAtOrigin } from '@/utils/localWriteScope';
import { readCurrentImageFillSource } from '@/services/imageFillSourceRead';
import { uploadLocalAssetFile } from '@/utils/imageUpload';
import { validateImageFile } from '@/utils/imageValidation';
import { boxClasses, inspectImageFillContainerTag, inspectImageFillTag, normalizeImageFillSource, readImageFillSource } from '../../../../../preview-template/src/plugins/sq-image-fill.js';

import type { ImageFillGeometry } from '@/services/imageFillGeometry';
export type { ImageFillGeometry } from '@/services/imageFillGeometry';
export interface ImageFillInput {
  ownerId: string; projectId: string; projectPath?: string | null; sourceLocation: SourceLocation;
  tagName: string; computedBackgroundImage?: string; classes: string; variant: string; preview: string | null; geometry?: ImageFillGeometry | null;
  /** Figma model: the selection already knows its image (the bridge's imageAttributes); the panel never reads source to SHOW it. */
  imageSrc?: string | null; imageAlt?: string | null;
  /** The rendered box, read at apply time (never a subscription to rect ticks): a conversion (img ⇄ container) re-states it so nothing collapses. */
  box?: () => { width: number; height: number } | null;
  getCurrentClasses?: () => string;
  onClassesChange: (classes: string) => void;
  /** Instance edit of a native <img> (src / alt): the image override tier (`*` → Push / Reset). */
  onImageAttribute?: (attribute: 'src' | 'alt', value: string) => void;
  /** After a structural write (img ⇄ container) the FILE owns src/alt: drop the session override so a rescan can't repaint the old image. */
  onSourceImageReset?: () => void;
  /** The write's result, published to the selection in the same tick as the class store — the panel never sees a stale tag/src. */
  onSourceConverted?: (facts: { tagName: 'img' | 'div'; classes: string; imageSrc: string | null; imageAlt: string | null; imagePreviewDataUrl: string | null }) => void;
  onSourceClasses: (classes: string) => void;
  pushStructuralUndo: PushStructuralUndo;
}
import { backgroundFillState, backgroundFillSupported, changeBackgroundFill, type FillChange, type ImageFillState } from '@/services/imageFillModel';
export { backgroundFillState, changeBackgroundFill } from '@/services/imageFillModel';
export type { FillChange, ImageFillState } from '@/services/imageFillModel';
export interface FillIssue { title: string; detail?: string }
class FillWriteUnconfirmed extends Error {}
// Figma model for a native <img>: it is edited IN PLACE — src / alt are
// attributes (image override tier), fit / position are object-* classes (class
// tier). Nothing is converted, so nothing about its layout needs preserving
// and no geometry can make it "unsupported".
const NATIVE_FIT = /^object-(cover|contain|fill|none|scale-down)$/;
const NATIVE_POSITION = /^object-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/;
const nativeToken = (classes: string, re: RegExp) => classes.split(/\s+/).find(t => re.test(t))?.slice(7);
/** The rendered box as classes when the author did not size the element — the
 *  plugin's rule (an emptied <img> has no intrinsic size, like a converted
 *  container); the sized-by test mirrors inspectImageFillTag's. */
function withBoxClasses(classes: string, box: { width: number; height: number } | null): string {
  const tokens = classes.split(/\s+/).filter(t => t && !/^(?:w|h)-auto$/.test(t));
  return [...tokens, ...boxClasses(box, { width: tokens.some(t => /^(?:w-|size-)/.test(t)), height: tokens.some(t => /^(?:h-|size-|aspect-)/.test(t)) })].join(' ');
}
function changeNativeImageClasses(classes: string, change: Extract<FillChange, { type: 'fit' | 'position' }>): string {
  const re = change.type === 'fit' ? NATIVE_FIT : NATIVE_POSITION;
  return [...classes.split(/\s+/).filter(t => t && !re.test(t)), `object-${change.value}`].join(' ');
}
// ponytail: Fill state is derived from what the selection already carries
// (tag, classes, src/alt, thumbnail) — exactly like Figma reads a layer. The
// source is read only when a structural write needs it (execute), never to
// decide what the panel shows; a refused read can't blank the panel.
const initial = (input: ImageFillInput): ImageFillState => {
  if (input.tagName === 'img') return { target: 'native', src: input.imageSrc ?? '', fit: (nativeToken(input.classes, NATIVE_FIT) as ImageFillState['fit'] | undefined) ?? 'cover', position: (nativeToken(input.classes, NATIVE_POSITION) as ImageFillState['position'] | undefined) ?? 'center', repeat: 'no-repeat', description: input.imageAlt ?? '', preview: input.preview };
  const background = backgroundFillState(input.classes);
  if (input.geometry?.imageFillOwned) return { target: 'owned', ...background, description: input.imageAlt ?? '', preview: input.preview };
  const hasAuthoredBackground = !backgroundFillSupported(input.classes, input.geometry, input.computedBackgroundImage);
  return { target: hasAuthoredBackground ? 'unsupported' : 'background', ...background, preview: input.preview, description: '' };
};

/** One selection visit owns reads, uploaded bytes and an acknowledged source edit. */
export function useImageFill(input: ImageFillInput) {
  const inputRef = useRef(input); inputRef.current = input;
  const owner = useRef({ id: input.ownerId, visit: 0 });
  if (owner.current.id !== input.ownerId) owner.current = { id: input.ownerId, visit: owner.current.visit + 1 };
  const [state, setState] = useState<ImageFillState>(() => initial(input));
  const stateRef = useRef(state); stateRef.current = state;
  const stateOwner = useRef(input.ownerId);
  const [issue, setIssue] = useState<FillIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'applying'>('idle');
  const pending = useRef(false);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => () => { owner.current.visit++; }, []);
  useEffect(() => {
    // Our own write republishes the selection with the new tag: same owner,
    // same gesture — re-derive the kind, keep the busy/issue/preview state.
    if (stateOwner.current === input.ownerId) { setState(s => ({ ...initial(input), preview: s.preview })); return; }
    stateOwner.current = input.ownerId;
    retryRef.current = null; setIssue(null); setBusy(false); setPhase('idle'); pending.current = false;
    setState(initial(input));
    // Selection identity owns the reset, not optimistic class repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.ownerId, input.tagName, input.geometry?.imageFillOwned]);

  // Mirror what the selection carries (its src/alt for an <img>, its bg-*
  // classes otherwise) into the optimistic state; the thumbnail only when the
  // selection's own changes (an upload's blob preview must survive a class edit).
  useEffect(() => {
    setState(s => ({ ...s, ...(input.tagName === 'img' ? { src: input.imageSrc ?? '', description: input.imageAlt ?? '' } : backgroundFillState(input.classes)) }));
  }, [input.classes, input.imageSrc, input.imageAlt, input.tagName]);
  useEffect(() => { setState(s => ({ ...s, preview: input.preview })); }, [input.preview]);

  /** Rewrite the source tag (img→container or container→img) and adopt the result. */
  const convertSource = useCallback(async (change: FillChange, captured: ImageFillInput, current: () => boolean, origin: ReturnType<typeof captureLocalWriteOrigin>, masterWrite: boolean, preview: string | null) => {
    if (change.type === 'repeat') throw new Error('Image source unavailable'); // narrows to the plugin's change type
    const target = stateRef.current.target;
    const source = await readCurrentImageFillSource({ location: captured.sourceLocation, projectPath: captured.projectPath, native: target === 'native', isCurrent: current });
    if (!source || !current()) return;
    const box = captured.box?.() ?? null;
    const request = { expectedTag: source.expectedTag, change: { ...change, variant: change.variant ?? captured.variant }, ...(box ? { box } : {}), ...(target === 'native' && captured.geometry?.maxWidth === '100%' ? { preserveMaxWidth: true as const } : {}) };
    const nextContent = normalizeImageFillSource(source.content, source.location ?? captured.sourceLocation, request);
    if (nextContent === source.content) return;
    let receipt;
    try {
      receipt = await sourceMediaMutation({ location: captured.sourceLocation, kind: 'image-fill', src: '', imageFill: request, origin, masterWrite, isCurrent: current }, captured.pushStructuralUndo);
    } catch { throw new FillWriteUnconfirmed(); }
    if (!receipt || !receipt.changed) throw new Error('Image source was not acknowledged');
    if (!current()) return;
    const nextRead = readImageFillSource(nextContent, source.location ?? captured.sourceLocation);
    captured.onSourceImageReset?.();
    let next: ImageFillState;
    if (/^<img(?:\s|\/?>)/.test(nextRead.expectedTag)) {
      const image = inspectImageFillTag(nextRead.expectedTag);
      captured.onSourceClasses(image.classes);
      next = { target: 'native', src: image.src, fit: image.fit, position: image.imagePosition, repeat: 'no-repeat', description: image.description, preview };
    } else {
      const normalized = inspectImageFillContainerTag(nextRead.expectedTag);
      captured.onSourceClasses(normalized.classes);
      next = { target: 'owned', ...backgroundFillState(normalized.classes), description: normalized.description, preview: normalized.src ? stateRef.current.preview : null };
    }
    // Publish the result to the selection in this same tick: the panel's
    // input (tag, src, alt, classes) and its state agree before any render.
    captured.onSourceConverted?.({ tagName: next.target === 'native' ? 'img' : 'div', classes: next.target === 'native' ? inspectImageFillTag(nextRead.expectedTag).classes : inspectImageFillContainerTag(nextRead.expectedTag).classes, imageSrc: next.target === 'native' ? next.src : null, imageAlt: next.target === 'native' ? next.description : null, imagePreviewDataUrl: next.preview });
    stateRef.current = next; setState(next);
  }, []);
  const execute = useCallback(async (change: FillChange, captured: ImageFillInput, visit: number, origin: ReturnType<typeof captureLocalWriteOrigin>, preview: string | null = null) => {
    const current = () => owner.current.visit === visit;
    if (!current()) return;
    const target = stateRef.current.target;
    // An element another file renders here (a component): the kind switch
    // rewrites THAT file on purpose — a master edit, flagged as such.
    const masterWrite = isCrossFileAtOrigin(origin, captured.sourceLocation.file);
    if (import.meta.env.DEV) console.info('[image-fill] apply', change.type, { target, variant: captured.variant, masterWrite, file: captured.sourceLocation.file, tag: captured.tagName });
    if (target === 'unsupported') throw new Error('Image unavailable');
    // Fill kinds are exclusive (Figma): a colour, a gradient or "no image" on
    // an <img> makes it a plain container (the image leaves the design).
    // When its source refuses the rewrite (an astro <Image> usage, an
    // expression src) the SAME result is painted in place as overrides:
    // src/alt emptied, the fill class + the rendered box added. Never a toast.
    if (target === 'native' && ['color', 'gradient', 'remove'].includes(change.type)) {
      try { await convertSource(change, captured, current, origin, masterWrite, preview); return; }
      catch (error) {
        if (error instanceof FillWriteUnconfirmed) throw error;
        console.warn('[image-fill] source conversion refused; painting in place', error);
        const classes = captured.getCurrentClasses?.() ?? inputRef.current.classes;
        const nextClasses = withBoxClasses(changeBackgroundFill(classes, change), captured.box?.() ?? null);
        if (nextClasses !== classes) captured.onClassesChange(nextClasses);
        captured.onImageAttribute?.('src', ''); captured.onImageAttribute?.('alt', '');
        setState(s => ({ ...s, src: '', description: '', preview: null }));
        return;
      }
    }
    if (target === 'native' && change.type !== 'repeat') {
      if (change.type === 'fit' || change.type === 'position') {
        const classes = captured.getCurrentClasses?.() ?? inputRef.current.classes;
        const nextClasses = changeNativeImageClasses(classes, change);
        if (nextClasses === classes) return;
        captured.onClassesChange(nextClasses);
        setState(s => ({ ...s, [change.type]: change.value }));
        return;
      }
      if (!captured.onImageAttribute) throw new Error('Image attributes cannot be edited here');
      if (change.type === 'replace') { captured.onImageAttribute('src', change.src); setState(s => ({ ...s, src: change.src, preview: null })); }
      else if (change.type === 'description') { captured.onImageAttribute('alt', change.value); setState(s => ({ ...s, description: change.value })); }
      else throw new Error('Unsupported image change'); // colour/gradient/remove left above
      return;
    }
    // Under the hood the element converts (owned description/remove/gradient
    // rewrite the container's source; an image chosen for a container we own
    // makes it an <img> again).
    const structural = target === 'owned' && ['description', 'remove', 'gradient', 'replace'].includes(change.type);
    if (structural) {
      await convertSource(change, captured, current, origin, masterWrite, preview);
    } else {
      if (change.type === 'description') throw new Error('This background is decorative');
      const classes = captured.getCurrentClasses?.() ?? inputRef.current.classes;
      if (target === 'background' && !backgroundFillSupported(classes, inputRef.current.geometry, inputRef.current.computedBackgroundImage)) throw new Error('Background requires its source');
      const nextClasses = changeBackgroundFill(classes, change);
      if (nextClasses === classes) return;
      captured.onClassesChange(nextClasses);
      setState(s => ({ ...s, ...backgroundFillState(nextClasses), ...(['replace', 'remove', 'gradient'].includes(change.type) ? { preview: null } : {}) }));
    }
  }, [convertSource]);
  const run = useCallback(async (change: FillChange, file?: File) => {
    if (pending.current || stateOwner.current !== inputRef.current.ownerId) return;
    const existing = stateRef.current;
    if (!file && (change.type === 'description' && change.value === existing.description || change.type === 'fit' && change.value === existing.fit || change.type === 'position' && change.value === existing.position || change.type === 'replace' && change.src === existing.src || change.type === 'remove' && !existing.src)) return;
    const captured = inputRef.current;
    const visit = owner.current.visit;
    const current = () => owner.current.visit === visit;
    const origin = captureLocalWriteOrigin();
    if (stateRef.current.target === 'unsupported' || stateRef.current.target === 'background' && !backgroundFillSupported(captured.classes, captured.geometry, captured.computedBackgroundImage)) {
      setIssue({ title: 'This image Fill cannot be edited here.', detail: 'Open its source to preserve the image layout and binding.' }); return;
    }
    if (file) {
      const validation = validateImageFile(file);
      if (validation) { setIssue({ title: 'Choose a supported image file.' }); return; }
    }
    pending.current = true; setBusy(true); setPhase(file ? 'uploading' : 'applying'); setIssue(null); retryRef.current = null;
    let uploaded: { src: string; previewUrl: string } | null = null;
    try {
      if (file) {
        uploaded = await uploadLocalAssetFile(captured.projectId, file);
        if (!current()) return;
        change = { type: 'replace', src: uploaded.src };
      }
      if (current()) setPhase('applying');
      await execute(change, captured, visit, origin, uploaded?.previewUrl ?? null);
      if (current() && uploaded) setState(s => ({ ...s, preview: uploaded!.previewUrl }));
    } catch (error) {
      if (!current()) return;
      console.error('[image-fill]', file ? 'upload' : change.type, error);
      if (error instanceof FillWriteUnconfirmed) {
        setIssue({ title: uploaded ? 'Image uploaded. Fill save needs checking.' : 'Fill save needs checking.', detail: 'The source may have changed. Open Source to check the result before editing again.' });
      } else if (uploaded) {
        const saved = uploaded;
        setIssue({ title: "Image uploaded. Fill wasn't changed.", detail: 'Retry applying this image to the same selection.' });
        retryRef.current = async () => {
          if (!current() || pending.current) return;
          pending.current = true; setBusy(true); setPhase('applying');
          try {
            await execute({ type: 'replace', src: saved.src }, captured, visit, origin, saved.previewUrl);
            if (current()) { setIssue(null); retryRef.current = null; setState(s => ({ ...s, preview: saved.previewUrl })); }
          } catch (retryError) {
            if (current() && retryError instanceof FillWriteUnconfirmed) {
              retryRef.current = null;
              setIssue({ title: 'Image uploaded. Fill save needs checking.', detail: 'The source may have changed. Open Source to check the result before editing again.' });
            }
          }
          finally { if (current()) { pending.current = false; setBusy(false); setPhase('idle'); } }
        };
      } else setIssue({ title: file ? "Image upload couldn't finish." : "Fill couldn't be changed.", detail: `${error instanceof Error && error.message ? error.message + '. ' : ''}The current image is unchanged.` });
    } finally { if (current()) { pending.current = false; setBusy(false); setPhase('idle'); } }
  }, [execute]);
  const visibleState = stateOwner.current === input.ownerId ? state : initial(input);
  return { state: visibleState, issue, busy, phase, canRetry: !!retryRef.current, retry: () => retryRef.current?.(), apply: (change: FillChange) => run(change), chooseFile: (file: File) => run({ type: 'replace', src: '' }, file) };
}
