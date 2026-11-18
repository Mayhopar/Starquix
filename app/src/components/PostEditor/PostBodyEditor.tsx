import { MEDIA_COUNT_ICONS } from '@/assets/icons/mediaCountIcons';
/**
 * The post body as ONE Tiptap contentEditable — native caret, selection,
 * Enter/Backspace and undo across the whole document. Replaces the
 * PostBodyFrame DOM-splice stack.
 *
 * Ownership: the editor parses the body ONCE at mount and owns the doc for the
 * mount's lifetime (parent keys this by post). Later `body` prop changes are
 * our own writes echoing back — re-seeding from them would rebuild the caret.
 * All disk writes flow through the PostWriteQueue (binding law #2).
 */
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react';
import { EmptyState, OperationNotice } from '@/components/ui';
import { type OperationIssue, mayOfferRecovery } from '@/utils/operationIssue';
import { postWriteIssue, postIssueCopy } from './postWriteIssue';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import {
  bindImport,
  gcUnusedImports,
  parsePostBody,
  type PostBlock,
  type PostDoc,
  type PostFormat,
} from '@/postmodel/postModel';
import { rowBlock, columnBlock } from '@/postmodel/stackOps';
import { markSlash, replaceSentinel } from './slashInsert';
import { StackToolbar, Divider, type StackAction } from './StackToolbar';
import { BlockHandle } from './BlockHandle';
import { SPACE } from '@/core/post/articleTokens';
import { blockAtSelection, selectBlock, applyTextStyle } from './blockCommands';
import { StackColorPopover } from './StackColorPopover';
import { applyAutoText, colorClassOf, variableLookup } from '@/core/stack/stackColor';
import { useOptionalEditorDoc } from '@/store/EditorContext';
import { selectVariableCollections } from '@/store/variableSelectors';
import {
  stackInfoAt, setStackAttrs, swapSlots, toColumn, toRow, moveStack, duplicateStack, deleteStack,
  selectStack, wrapTopLevel, unwrapStack, wrapSelection, isStack, type StackInfo,
} from './stackCommands';
import type { StackRatio, StackWidth } from '@/core/stack/stackClasses';
import type { PostWriteQueue } from '@/postmodel/writeQueue';
import {
  postEditorExtensions,
  setPostFormat,
  postDocToTiptap,
  tiptapToPostDoc,
  normalizeInitialSelection,
  focusBodyBlock,
  componentBodyLines,
  componentStorage,
  setStackColorLookup,
  type PMNode,
} from './tiptap/schema';
import {
  fetchComponentPreviews,
  pairPreviewsToChips,
  type ComponentPreviews,
} from './componentPreview';
import { loadPostViewHtml } from './loadPostViewHtml';
import { SlashMenu, slashItemsFor, LAYOUT_ITEMS, TEXT_ITEMS, type SlashItem } from './SlashMenu';
import { useComponentLibrary } from '@/hooks/useComponentLibrary';
import { ensureSqComponent, componentImportPathFor } from './ensureComponent';
import { WidthModes } from './WidthControl';
import { MediaSlotDialog } from './MediaSlotDialog';
import {
  displayMediaSlots,
  editMediaItem,
  isMediaComponent,
  mediaWriteBlock,
  readMediaSlots,
  setMediaItemCount,
} from './componentMedia';
import {
  PostMediaResolver,
  type MediaByteReader,
} from './mediaResolver';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { agentFlash, agentFlashKey, addAgentFlash, clearAgentFlashMeta, AGENT_FLASH_MS } from './agentFlash';
import type { Node as PMDocNode } from '@tiptap/pm/model';
import { Button, FloatingPanel } from '@/components/ui';
import './PostBodyEditor.css';
import { POST_COLUMN_CLS } from './postEditorLayout';
import { PostFormattingToolbar } from './PostFormattingToolbar';
import { readTextSelectionAnchor, type SelectionAnchor } from './selectionAnchor';
import { postPlaceholder } from './postPlaceholder';

export const FLUSH_DEBOUNCE_MS = 2500;
/** Durable posts: one accepted row per typing pause, not per keystroke. Each
 *  row is a whole-file write (~0.85 s through the instance) and each write
 *  reloads the preview, so per-keystroke rows backed the writer up by minutes.
 *  Leave/unmount/pagehide still flush the pending text immediately. */
export const DURABLE_FLUSH_IDLE_MS = 800;
export const DURABLE_FLUSH_MAX_WAIT_MS = 3000;

/* ------------------------------------------------------------------ */
/* Preview refresh ladder                                              */
/* ------------------------------------------------------------------ */

/**
 * Delay BEFORE each retry, in ms. Astro re-syncs the content collection before
 * the route renders the new body, so a fetch right after a write often returns
 * the PRE-write render. The old ladder was 4 fixed attempts over ~3.6s and then
 * gave up FOREVER — a slower re-render left the pre-write chip on screen as if
 * it were current, which is exactly "I uploaded a photo and nothing happened".
 */
export const PREVIEW_RETRY_DELAYS_MS = [400, 800, 1200, 1800, 2400, 3200];

export const PREVIEW_UNREACHABLE_MESSAGE =
  "Couldn't load the preview from the running site, so the blocks below may be out of date.";
export const PREVIEW_STALE_MESSAGE =
  'Saved — but the site preview never caught up, so the blocks below may still show the previous version.';
/** Shown to the user VERBATIM in an alert, so it is a sentence and not the
 *  internal fragment ("the editor was not ready when the preview arrived") that
 *  used to be rendered as if it were one (2026-08-12 review, F6). */
export const PREVIEW_EDITOR_NOT_READY =
  'The editor was still loading when the site preview arrived, so the blocks below may be out of date.';
/** No preview server yet ⇒ no upload target. Said out loud on the click rather
 *  than left as silence, which is verbatim the owner's report (F3). */
export const UPLOAD_UNAVAILABLE_MESSAGE =
  "Media can't be uploaded until the site preview is running, and it hasn't finished starting. Nothing was changed — try again in a moment.";

/**
 * The preview problem worth putting in front of the user.
 *
 * While the post still has unsaved or in-flight changes, the site render CANNOT
 * match the doc — the editor is a keystroke (or a whole line) ahead of the file
 * the instance rendered — and the pending flush starts its own ladder that will
 * match. Alarming about a state that resolves itself is noise: the "N of M
 * block(s) below couldn't be matched" banner appeared mid-ladder for exactly
 * this and made a correct editor look broken (2026-08-12 review, F6).
 *
 * The mismatch still drives the RETRY (the ladder never stops early on it) —
 * only the user-facing statement is held back.
 */
export function previewProblemToShow(problem: string | null, pendingWrite: boolean): string | null {
  return pendingWrite ? null : problem;
}

/**
 * Memoize on the identity of a ProseMirror doc node.
 *
 * PM nodes are immutable, so a result computed from one is exact for as long as
 * the doc object is the same one — and the preview ladder re-runs `apply` up to
 * 7 times per write, each time re-serializing every block of the document to
 * measure body lines. Same doc, same lines, one serialization.
 */
export function createDocMemo<K extends object, V>(compute: (key: K) => V): (key: K) => V {
  let lastKey: K | null = null;
  let lastValue: V;
  return (key: K): V => {
    if (lastKey !== key) {
      lastValue = compute(key);
      lastKey = key;
    }
    return lastValue;
  };
}

export interface PreviewLadderDeps {
  /** One fetch of the whole post render. null = it could not be reached. */
  fetch: () => Promise<ComponentPreviews | null>;
  /** Paint the render onto the chips. Reports whether the render actually
   *  CHANGED (the success signal after a write) and whether it still lines up
   *  1:1 with the editor's component nodes (previews are addressed by index). */
  apply: (previews: ComponentPreviews) => { changed: boolean; mismatch: string | null };
  /** null clears the notice; a string is shown to the user verbatim. */
  onProblem: (problem: string | null) => void;
}

/**
 * ONE ladder at a time, with an honest ending.
 *
 * Three defects this shape fixes (owner, 2026-08-11):
 *  - two ladders shared ONE timer ref, so a second write silently cancelled the
 *    first ladder's pending attempt AND an in-flight stale fetch could still
 *    land ON TOP of the newer render. Each ladder now owns a generation; the
 *    superseded one's fetches and timers become no-ops.
 *  - the ladder always ran its full budget and then stopped, leaving whatever
 *    it last painted on screen with no statement about whether it was current.
 *    It now STOPS as soon as the write is visible, and SAYS so when it is not.
 *  - a failed fetch (or a preview/component count drift) was swallowed.
 */
export function createPreviewLadder({ fetch: fetchPreviews, apply, onProblem }: PreviewLadderDeps) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let strict = false;

  /** Supersede whatever is in flight — used on unmount and by every refresh. */
  const cancel = (): void => {
    generation += 1;
    running = false;
    strict = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** `expectChange` = a write just landed, so an UNCHANGED render means the
   *  instance has not caught up yet — keep going, and say so if it never does. */
  const refresh = (expectChange = false): void => {
    // A lax refresh must never DOWNGRADE a strict one already in flight. The
    // write queue's own onWritten hook fires a plain refresh right beside the
    // post-write one, and only the strict ladder is watching for the write to
    // actually appear.
    const watchForChange = expectChange || (running && strict);
    cancel();
    const id = generation;
    running = true;
    strict = watchForChange;

    const attempt = (n: number): void => {
      void fetchPreviews().then(previews => {
        if (id !== generation) return; // superseded — never paint stale over new
        let problem: string | null;
        let satisfied = false;
        if (previews === null) {
          problem = PREVIEW_UNREACHABLE_MESSAGE;
        } else {
          const { changed, mismatch } = apply(previews);
          problem = mismatch;
          satisfied = mismatch === null && (!watchForChange || changed);
        }
        if (satisfied) {
          running = false;
          onProblem(null);
          return;
        }
        if (n >= PREVIEW_RETRY_DELAYS_MS.length) {
          running = false;
          onProblem(problem ?? (watchForChange ? PREVIEW_STALE_MESSAGE : null));
          return;
        }
        timer = setTimeout(() => {
          if (id === generation) attempt(n + 1);
        }, PREVIEW_RETRY_DELAYS_MS[n]);
      });
    };

    attempt(0);
  };

  return { refresh, cancel };
}

/**
 * `editMediaItem` refuses when the markup is not ours to rewrite. Closing the
 * dialog on that silence is what made the owner report "nothing happens" — say
 * WHICH case it was instead.
 *
 * The cause comes from `mediaWriteBlock`, the same gate the writer runs, so the
 * sentence can never describe a different refusal than the one that happened.
 * The previous build guessed from the source string and told the user "this
 * component doesn't take media from an items list" for an out-of-range index on
 * a component that plainly does take media.
 */
export function mediaWriteRefusal(
  name: string,
  source: string,
  index: number,
  src: string | null,
): string {
  const tag = `<${name}/>`;
  switch (mediaWriteBlock(source, index, src)) {
    case 'expression':
      return `${tag}'s media is written as code in the .mdx (an expression, not a path), so the editor won't rewrite it. Edit the file directly.`;
    case 'out-of-range':
      return `${tag} declares fewer media slots than this one, so writing here would add a prop the component never reads. Add the prop in the .mdx first.`;
    case 'unsafe-path':
      return `That file path contains a quote or backslash, which would break the .mdx. Rename the file and try again.`;
    case 'no-media':
      return `${tag} carries no media attribute the editor can write, so there is nothing here to fill. Add one in the .mdx (for example src="…").`;
    default:
      // The gate says this write is fine — so the refusal came from somewhere
      // else and we must not invent a cause for it.
      return `${tag} couldn't be updated, and the editor can't tell why. Nothing was written.`;
  }
}

/**
 * The component at `pos`, or null.
 *
 * `doc.nodeAt` THROWS on an out-of-range pos, and a captured pos CAN go out of
 * range — the block it named was deleted while the dialog sat open. Thrown from
 * a node-view callback that is exactly "nothing happens" again, so the range
 * check is part of the fix, not defensive noise.
 */
export function componentNodeAt(doc: PMDocNode, pos: number): PMDocNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node && node.type.name === 'astroComponent' ? node : null;
}

interface ComponentInfo {
  pos: number;
  left: number;
  top: number;
  name: string;
  source: string;
  span: number | 'full' | null;
}

export interface PostBodyEditorHandle {
  /** Current doc as the model sees it — used by frontmatter saves so they ride
   *  the same queue with the freshest body. Null when the body didn't parse. */
  getDoc(): PostDoc | null;
  focusStart(): void;
  /** Refetch component previews (after a successful queue write). Pass
   *  `{ expectChange: true }` when a write just landed: the ladder then keeps
   *  retrying until the new render actually appears instead of stopping on the
   *  first fetch, which is usually still the PRE-write render. */
  refreshPreviews(opts?: { expectChange?: boolean }): void;
  /** Agent multiplayer (owner 2026-11-08, ledger F): show what an outside
   *  writer (an agent) did to this post — only the blocks that differ, outside
   *  undo, the caret kept, the changed blocks flashed. False = not now (IME
   *  composing, a node view has focus): the caller tries again later. */
  applyOutside(doc: PostDoc): boolean;
}


/** `/` Colored section default (Auto text: dark on this light beige). One value, two shapes (PostDoc attrs / PM attrs). */
const COLORED_DEFAULT = { class: 'bg-[#f4f1ea] text-[#111111]', text: 'auto' };
const COLORED_DEFAULT_ATTRS = { cls: COLORED_DEFAULT.class, text: COLORED_DEFAULT.text };
/** P7: Media width modes ↔ the Stack width wrapping it. */
const SPAN_TO_WIDTH: Record<string, StackWidth> = { null: 'reading', 12: 'wide', full: 'edge' };
const WIDTH_TO_SPAN: Record<StackWidth, number | 'full' | null> = { reading: null, wide: 12, edge: 'full' };

export const PostBodyEditor = forwardRef<PostBodyEditorHandle, {
  body: string;
  /** Body line to put the caret on at open (canvas double-click). */
  focusBodyLine?: number;
  format: PostFormat;
  queue: PostWriteQueue;
  frontmatterRef: React.RefObject<Record<string, unknown>>;
  /** Local instance origin — absent = no previews (placeholders render). */
  previewOrigin?: string | null;
  collection: string;
  slug: string;
  /** Post file path (project-relative) — the component import is written
   *  relative to it. Absent = no component inserts. */
  filePath?: string | null;
  /** Upload a file and return the src to write into the MDX. Absent = media
   *  slots are not fillable. */
  onUploadMedia?: (file: File) => Promise<string>;
  previewIframe?: HTMLIFrameElement | null;
  projectId?: string | null;
  /** Capture feedback ownership before an async write starts. */
  onBeginWriteIssue?: () => (issue: OperationIssue | null) => void;
}>(function PostBodyEditor({ body, focusBodyLine, format, queue, frontmatterRef, previewOrigin = null, previewIframe = null, collection, slug, filePath = null, onUploadMedia, projectId = getActiveSaveProjectId(), onBeginWriteIssue }, ref) {
  // Mount-only parse — see module comment.
  const parsed = useMemo(() => {
    try {
      return { doc: parsePostBody(body, format), error: null as string | null };
    } catch (e) {
      return { doc: null, error: e instanceof Error ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const originalRef = useRef<PostDoc | null>(parsed.doc);
  const acceptedBodyRef = useRef<PostDoc | null>(parsed.doc);
  const inputRevision = useRef(0);
  /** The uploader as of NOW. The node-view callbacks are wired once, so they
   *  must not close over the prop as it was at that moment: it arrives late
   *  (the preview server boots) and leaves on a runtime switch. */
  const uploadMediaRef = useRef(onUploadMedia);
  uploadMediaRef.current = onUploadMedia;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingAt = useRef<number | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const projectPath = useLocalProjectPath();
  // Project color variables resolve Stack backgrounds (editor paint + Auto text).
  const ydoc = useOptionalEditorDoc();
  const lookupVar = useMemo(() => variableLookup(ydoc ? selectVariableCollections(ydoc) : []), [ydoc]);
  setStackColorLookup(lookupVar);
  // task-207 D12: the `/` menu IS the sq/ folder — promoting a component is all
  // it takes to make it insertable. No registry to edit.
  const { userProject } = useComponentLibrary();
  const slashItems = useMemo(() => slashItemsFor(userProject), [userProject]);
  /** `path` = child index per depth down to the `/` paragraph; `inStack` hides the layout entries (D3/D8). */
  type SlashState = { left: number; top: number; path: number[]; inStack: boolean; activeIndex: number };
  const [slash, setSlashState] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  const slashId = useId();
  const setSlash = (next: SlashState | null) => { slashRef.current = next; setSlashState(next); };
  const menuItemsFor = (state: SlashState | null): SlashItem[] =>
    format !== 'mdx' ? [...TEXT_ITEMS]
      : state && !state.inStack ? [...TEXT_ITEMS, ...LAYOUT_ITEMS, ...slashItems] : [...TEXT_ITEMS, ...slashItems];
  const [selectedComponent, setSelectedComponent] = useState<ComponentInfo | null>(null);
  // `pos` is captured when the dialog OPENS. The write must land on the block
  // the user clicked, not on whatever the pointer wandered over since.
  const [mediaSlot, setMediaSlot] = useState<{ pos: number; index: number; currentSrc: string } | null>(null);
  /** A model write the editor refused, or a save that rejected — shown, never swallowed. */
  const [writeNotice, setWriteNotice] = useState<string | null>(null);
  const [writeIssue, setWriteIssue] = useState<OperationIssue | null>(null);
  const beginWriteIssue = () => onBeginWriteIssue?.() ?? setWriteIssue;
  // true from the first unflushed keystroke until the queue drains
  const [saving, setSavingState] = useState(false);
  /** The same fact, readable from the ladder's callbacks (which are built once
   *  and never see React state). "Unsaved changes pending" is why a preview
   *  mismatch must not be reported as a problem — see previewProblemToShow. */
  const pendingWriteRef = useRef(false);
  const setSaving = (value: boolean) => {
    pendingWriteRef.current = value;
    setSavingState(value);
  };
  useEffect(() => queue.durable ? queue.subscribeDraftOutcome(outcome => {
    if (outcome.status === 'accepted') acceptedBodyRef.current = structuredClone(outcome.doc);
    else if (acceptedBodyRef.current && !editorRef.current?.isDestroyed) {
      originalRef.current = acceptedBodyRef.current;
      editorRef.current?.commands.setContent(postDocToTiptap(acceptedBodyRef.current) as JSONContent, { emitUpdate: false });
    }
    if (outcome.revision === queue.draftRevision) setSaving(false);
  }) : undefined, [queue]);
  // Hovered component (toolbar shows WITHOUT a click); selection still wins.
  const [hoverComponent, setHoverComponent] = useState<ComponentInfo | null>(null);
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHoverHide = () => {
    if (hoverHideTimer.current) {
      clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  };
  const scheduleHoverHide = () => {
    cancelHoverHide();
    // grace so the pointer can travel from the component onto the toolbar
    hoverHideTimer.current = setTimeout(() => setHoverComponent(null), 250);
  };

  const componentInfoAt = (editor: Editor, pos: number): ComponentInfo | null => {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'astroComponent') return null;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    const rect = dom?.getBoundingClientRect();
    const attrs = node.attrs as { name: string; source: string; span: number | 'full' | null };
    return {
      pos,
      left: (rect ? rect.left + rect.width / 2 : 0) - (wrapper?.left ?? 0),
      top: (rect?.top ?? 0) - (wrapper?.top ?? 0) - 8,
      name: attrs.name,
      source: attrs.source,
      span: attrs.span,
    };
  };
  const [textToolbar, setTextToolbarState] = useState<SelectionAnchor | null>(null);
  const textToolbarRef = useRef<SelectionAnchor | null>(null);
  const setTextToolbar = (next: SelectionAnchor | null) => { textToolbarRef.current = next; setTextToolbarState(next); };
  const updateTextToolbar = (editor: Editor) => setTextToolbar(readTextSelectionAnchor(editor));

  /** The layout the caret is in → its toolbar anchor (wrapper-relative, top-center). */
  const [stackBar, setStackBar] = useState<{ left: number; top: number; info: StackInfo } | null>(null);
  const updateStackBar = (editor: Editor) => {
    const info = stackInfoAt(editor.state);
    if (!info) { setStackBar(null); return; }
    const dom = editor.view.nodeDOM(info.pos) as HTMLElement | null;
    const rect = dom?.getBoundingClientRect();
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    // centered above the layout, like every block toolbar
    const left = (rect ? rect.left + rect.width / 2 : 0) - (wrapper?.left ?? 0);
    const top = (rect?.top ?? 0) - (wrapper?.top ?? 0) - 8;
    // typing inside a layout fires this on every keystroke: re-render only when something changed
    setStackBar(prev => (prev && prev.info.node === info.node && prev.info.pos === info.pos && prev.left === left && prev.top === top ? prev : { info, left, top }));
  };

  const updateSelectedComponent = (editor: Editor) => {
    const selection = editor.state.selection;
    const info =
      selection instanceof NodeSelection && selection.node.type.name === 'astroComponent'
        ? componentInfoAt(editor, selection.from)
        : null;
    setSelectedComponent(info);
    // Deliberately does NOT close an open media dialog: the dialog owns the pos
    // it captured, and a selection change (a click inside the modal, a blur)
    // used to yank it shut mid-upload.
  };

  // The `/` menu shows while the caret sits in a paragraph whose entire text is
  // "/" — typing anything else (or moving away) dismisses it.
  const updateSlash = (editor: Editor) => {
    const { $from, empty } = editor.state.selection;
    if (!empty || $from.depth < 1 || $from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '/') {
      setSlash(null);
      return;
    }
    const coords = editor.view.coordsAtPos($from.pos);
    const path = Array.from({ length: $from.depth }, (_, d) => $from.index(d));
    setSlash({ left: coords.left, top: coords.bottom, path, inStack: $from.depth > 1, activeIndex: slashRef.current?.activeIndex ?? 0 });
  };

  const currentDoc = (): PostDoc | null => {
    const original = originalRef.current;
    const editor = editorRef.current;
    if (!original) return null;
    if (!editor) return original;
    // GC: a deleted component's now-unreferenced import goes with it
    return gcUnusedImports(tiptapToPostDoc(editor.getJSON() as PMNode, original), original);
  };

  const applyOutside = (next: PostDoc): boolean => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || !originalRef.current) return false;
    const active = document.activeElement;
    if (editor.view.composing || (active && active !== editor.view.dom && editor.view.dom.contains(active))) return false; // F12, F13
    const doc = editor.state.doc, target = editor.schema.nodeFromJSON(postDocToTiptap(next));
    let start = 0, endA = doc.childCount, endB = target.childCount;
    while (start < endA && start < endB && doc.child(start).eq(target.child(start))) start++;
    while (endA > start && endB > start && doc.child(endA - 1).eq(target.child(endB - 1))) { endA--; endB--; }
    originalRef.current = next; // the verbatim baseline of every merged block
    if (start === endA && start === endB) return true;
    const at = (node: typeof doc, index: number) => { let pos = 0; for (let i = 0; i < index; i++) pos += node.child(i).nodeSize; return pos; };
    const from = at(doc, start), to = at(doc, endA), slice = target.slice(at(target, start), at(target, endB));
    const caret = editor.state.selection.from, end = from + slice.size;
    // A remote change: not the user's undo step, and not a save of its own.
    const { tr, id } = addAgentFlash(editor.state.tr.replace(from, to, slice).setMeta('addToHistory', false).setMeta('preventUpdate', true), from, end);
    if (caret >= from && caret <= to && end > from) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, end - 1)))); // F11
    editor.view.dispatch(tr);
    setTimeout(() => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(agentFlashKey, clearAgentFlashMeta(id))); }, AGENT_FLASH_MS); // G7
    return true;
  };

  const [previewCss, setPreviewCss] = useState('');
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  /** Signature of the render currently painted on the chips — the ladder's
   *  "did the write actually show up?" comparison. */
  const appliedPreviewSig = useRef<string | null>(null);
  // Props the ladder needs at CALL time (it is built once; props are not).
  const previewSource = useRef({ previewOrigin, previewIframe, collection, slug });
  previewSource.current = { previewOrigin, previewIframe, collection, slug };

  /**
   * THE media resolver for this session — one object, so one object URL per
   * file however many times a chip re-renders, and every one of them revoked on
   * unmount.
   *
   * Bytes arrive after paint, so its callback re-renders both consumers: the
   * node views (chips) and this component (the media dialog's preview).
   *
   * Held in a REF, not rebuilt per render: `main.tsx` runs the app inside
   * `<React.StrictMode>`, whose dev double-mount fires this component's mount
   * cleanup before the real run, and the in-flight read that was already going
   * has to land somewhere that still exists. `release()` is non-terminal for the
   * same reason.
   */
  const [, bumpMedia] = useState(0);
  const mediaRef = useRef<PostMediaResolver | null>(null);
  const mediaResolver = (): PostMediaResolver => {
    if (mediaRef.current === null) {
      mediaRef.current = new PostMediaResolver(() => {
        const ed = editorRef.current;
        if (ed) componentStorage(ed).views.forEach(render => render());
        bumpMedia(n => n + 1);
      });
    }
    return mediaRef.current;
  };

  /**
   * Point the resolver at the preview we are currently showing.
   *
   * WC gets the BYTE reader: its preview origin serves nothing a
   * cross-origin-isolated page may load, so a URL into it renders broken
   * whatever the file is (confirmed live 2026-08-12 — an uploaded photo and a
   * boot-time snapshot file fail identically while the container FS holds valid
   * bytes for both). Local and server mode keep resolving by URL.
   *
   * Called on every ladder tick as well as on an origin change: `configure` is
   * also the retry signal for reads that failed while the FS was still coming up.
   */
  const syncMediaSource = (ed: Editor): void => {
    const origin = previewSource.current.previewOrigin;
    const resolver = mediaResolver();
    resolver.configure(origin, null);
    componentStorage(ed).media = resolver;
  };

  /** The chip nodes in doc order — the k-th is the k-th `component` block of
   *  the PostDoc, which is exactly what `componentBodyLines` measures. */
  const componentNodes = (ed: Editor): PMDocNode[] => {
    const out: PMDocNode[] = [];
    ed.state.doc.descendants(node => {
      if (node.type.name === 'astroComponent') {
        out.push(node);
        return false;
      }
      return true;
    });
    return out;
  };

  /** Body lines for the CURRENT doc, computed once per doc version — the
   *  ladder asks up to 7 times per write and the answer cannot change while the
   *  doc object does not. */
  const bodyLinesOf = useRef<((key: PMDocNode) => number[]) | null>(null);
  // Lazy: useRef EVALUATES its argument on every render and discards it after
  // mount, so `useRef(createDocMemo(...))` built a throwaway memo per render.
  bodyLinesOf.current ??= createDocMemo<PMDocNode, number[]>(() => {
    const doc = currentDoc();
    return doc ? componentBodyLines(doc) : [];
  });

  const applyPreviews = (previews: ComponentPreviews): { changed: boolean; mismatch: string | null } => {
    const ed = editorRef.current;
    // Not ready yet is not "fine" — report it so the ladder keeps trying.
    if (!ed) return { changed: false, mismatch: PREVIEW_EDITOR_NOT_READY };
    // A NUL separator cannot occur inside HTML, so two different renders can
    // never collide on one signature. Written as an ESCAPE: a literal NUL byte
    // in the source makes grep/ripgrep treat this whole file as binary.
    const signature = previews.chunks.map(chunk => chunk.html).join('\u0000');
    const changed = signature !== appliedPreviewSig.current;
    appliedPreviewSig.current = signature;
    const storage = componentStorage(ed);
    // `/uploads/x.png` is never resolved against the EDITOR origin: local and
    // server mode point it at the instance, WC at bytes read from the
    // container. Without this the optimistic path had no URL to use at all and
    // fell back to an inert frame over a photo that had uploaded fine. Re-run
    // per tick on purpose — it is also the retry signal for reads that failed
    // while the preview's filesystem was still coming up.
    syncMediaSource(ed);
    // Pair BY BODY LINE, never by ordinal: the plugin wraps every top-level JSX
    // block — including a raw lowercase <div>, which the editor models as a
    // passthrough and not as a chip — so the two sequences are not the same
    // length and never were. A chip with no match keeps whatever it last
    // painted (or falls back to its own model); it never inherits a neighbour's
    // HTML, and it never shifts anyone else.
    const nodes = componentNodes(ed);
    const lines = bodyLinesOf.current!(ed.state.doc);
    const paired = pairPreviewsToChips(previews.chunks, lines);
    nodes.forEach((node, i) => {
      const html = paired.html[i];
      // Only ASSIGN. Clearing an unmatched chip would blank a correct render
      // every time the doc is a keystroke ahead of the file on disk.
      if (html !== undefined) storage.previewFor.set(node, html);
    });
    // Scoped component CSS travels with the previews — without it a
    // two-image Media stacked instead of laying out in a row.
    setPreviewCss(previews.css);
    storage.views.forEach(render => render());
    // Diagnostics ONLY — the pairing above is already correct without it.
    // Chips this render could not cover are the ladder's "keep retrying, the
    // instance has not caught up" signal.
    const mismatch =
      nodes.length !== lines.length
        ? `The editor lost track of which block is which (${lines.length} measured, ${nodes.length} on screen), so the previews below may be out of date.`
        : paired.mismatch;
    return { changed, mismatch };
  };

  const ladder = useMemo(
    () =>
      createPreviewLadder({
        fetch: () => {
          const { previewOrigin: origin, collection: coll, slug: sl } = previewSource.current;
          if (!origin) return Promise.resolve(null);
          // ONE loader for every runtime: direct fetch first (local/server), and
          // a hidden frame reading the HTML the route posts up when that fails
          // (WC — see loadPostViewHtml for the measurements). The old
          // fetch-through-the-preview-iframe round trip is gone: `fetch()` from
          // inside the WC iframe fails for every URL on the container origin.
          return fetchComponentPreviews(origin, coll, sl, loadPostViewHtml);
        },
        apply: applyPreviews,
        // A mismatch while the post has unsaved changes is EXPECTED, not a
        // problem: the doc is ahead of the file the instance rendered, and the
        // pending flush starts a ladder that will line up.
        onProblem: problem =>
          setPreviewProblem(previewProblemToShow(problem, pendingWriteRef.current)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** `expectChange` = a write just landed; the ladder then keeps going until
   *  the render CHANGES rather than until a fixed budget runs out. */
  const refreshPreviews = (opts: { expectChange?: boolean } = {}) => {
    if (!previewSource.current.previewOrigin) return;
    ladder.refresh(opts.expectChange === true);
  };

  /** Returns the write's promise so callers that need the FILE on disk before
   *  they act (component previews re-render from the real Astro route) can
   *  await it instead of racing the queue. */
  const flush = (): Promise<void> => {
    firstPendingAt.current = null;
    if (queue.durable) queue.holdInput(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const doc = currentDoc();
    if (!doc) {
      setSaving(false);
      return Promise.resolve();
    }
    const reportWriteIssue = beginWriteIssue();
    const revision = ++inputRevision.current;
    const accepted = queue.enqueue(doc, frontmatterRef.current);
    const candidateRevision = queue.draftRevision;
    return accepted.then(() => {
      if (!queue.durable) acceptedBodyRef.current = doc;
      if (queue.size === 0 && timerRef.current === null) { setSaving(false); reportWriteIssue(null); }
    }, error => {
      if (!queue.durable || (inputRevision.current === revision && queue.draftRevision === candidateRevision)) {
        reportWriteIssue(postWriteIssue(error, projectId, collection, slug));
      }
      throw error;
    });
  };

  const scheduleFlush = () => {
    setSaving(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    let delay = FLUSH_DEBOUNCE_MS;
    if (queue.durable) {
      firstPendingAt.current ??= Date.now();
      delay = Math.max(0, Math.min(DURABLE_FLUSH_IDLE_MS, firstPendingAt.current + DURABLE_FLUSH_MAX_WAIT_MS - Date.now()));
      // Barriers (queue.flushNow: post switch, preview, rename) see the held text.
      queue.holdInput(() => { void flushRef.current().catch(() => {}); });
    }
    timerRef.current = setTimeout(() => { void flush().catch(() => {}); }, delay);
  };

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Built once: useEditor only reads `content` at creation, and rebuilding the
  // tree every render re-stringified every opaque inline node for nothing.
  const initialContent = useMemo(
    () => (parsed.doc ? (postDocToTiptap(parsed.doc) as JSONContent) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const editor = useEditor({
    extensions: [...postEditorExtensions, postPlaceholder, agentFlash],
    content: initialContent,
    editable: parsed.doc !== null,
    editorProps: {
      // SPACE = the page's own spacing rules (one source); the pane sets --sq-u by container width in PostBodyEditor.css
      attributes: { class: `sq-post-prose ${SPACE}`, role: 'textbox', 'aria-label': 'Post body', 'aria-multiline': 'true' },
      // The floating bottom toolbar covers ~85px of the pane; keep the caret above it while typing.
      scrollThreshold: { top: 0, right: 0, left: 0, bottom: 120 },
      scrollMargin: { top: 5, right: 5, left: 5, bottom: 120 },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229) return false;
        const active = slashRef.current;
        if (active) {
          if (event.key === 'Escape') { setSlash(null); return true; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const count = menuItemsFor(active).length;
            if (count) setSlash({ ...active, activeIndex: (active.activeIndex + (event.key === 'ArrowDown' ? 1 : count - 1)) % count });
            return true;
          }
          if (event.key === 'Enter') {
            const picked = menuItemsFor(active)[active.activeIndex];
            if (picked && (picked.text || format === 'mdx')) void insertAtSlash(picked, active.path);
            return true;
          }
        }
        // Esc walks outward, like Notion: text → its block → the enclosing layout.
        if (event.key === 'Escape' && editorRef.current) {
          const ed = editorRef.current;
          const sel = ed.state.selection;
          if (!(sel instanceof NodeSelection)) {
            const block = blockAtSelection(ed);
            if (block) return selectBlock(ed, block);
          }
          const info = stackInfoAt(ed.state);
          if (info && !(sel instanceof NodeSelection && sel.from === info.pos)) return selectStack(ed, info);
        }
        if (event.key === 'Tab' && !event.shiftKey && !editorRef.current?.state.selection.empty) {
          const target = document.querySelector<HTMLElement>('[aria-label="Text formatting"] select');
          if (target) { target.focus(); return true; }
        }
        return false;
      },
    },
    onCreate: ({ editor: created }) => normalizeInitialSelection(created),
    onUpdate: ({ editor: updated }) => {
      scheduleFlush();
      updateSlash(updated);
      updateSelectedComponent(updated);
      updateTextToolbar(updated);
      updateStackBar(updated);
    },
    onSelectionUpdate: ({ editor: updated }) => {
      updateSlash(updated);
      updateSelectedComponent(updated);
      updateTextToolbar(updated);
      updateStackBar(updated);
    },
  });
  editorRef.current = editor;

  /**
   * Auto text follows a VARIABLE background (design: recomputed when the post
   * opens). Once per editor: every `text="auto"` stack whose background is a
   * variable/token gets its text class recomputed; a change is one ordinary
   * transaction and saves through the normal path.
   */
  useEffect(() => {
    if (!editor || !ydoc) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (!isStack(node) || node.attrs.text !== 'auto') return true;
      const cls = String(node.attrs.cls ?? '');
      if (/^bg-\[#/.test(colorClassOf(cls, 'bg'))) return true; // a hex never changes
      const next = applyAutoText(cls, lookupVar);
      if (next !== cls) tr.setNodeAttribute(pos, 'cls', next);
      return true;
    });
    if (tr.docChanged) editor.view.dispatch(tr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Opened from post text double-clicked on the canvas: caret on that block.
  useEffect(() => {
    if (editor && focusBodyLine && parsed.doc) focusBodyBlock(editor, parsed.doc, focusBodyLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useImperativeHandle(ref, () => ({ getDoc: currentDoc, refreshPreviews, applyOutside, focusStart: () => { editorRef.current?.commands.focus('start'); } }));
  useEffect(() => {
    if (!editor) return;
    const reposition = () => {
      if (textToolbarRef.current) updateTextToolbar(editor);
      if (slashRef.current) updateSlash(editor);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    if (slash && format === 'mdx' && menuItemsFor(slash).length) {
      editor.view.dom.setAttribute('aria-controls', slashId);
      editor.view.dom.setAttribute('aria-activedescendant', `${slashId}-${slash.activeIndex}`);
    } else {
      editor.view.dom.removeAttribute('aria-controls');
      editor.view.dom.removeAttribute('aria-activedescendant');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, slash, slashId, format, slashItems.length]);

  /**
   * Write attrs onto the component at `pos` — the pos the CALLER captured, not
   * whatever is hovered or selected now. The preview chip is the REAL Astro
   * render of the file, so it can only pick this up AFTER the write lands:
   * refresh once the queue drains, and say so if the save itself rejects.
   *
   * Returns null when the edit went into the doc, else the reason it did not.
   * The ProseMirror transaction is CHECKED: `chain().run()` returns false when
   * the command could not apply (a pos that is no longer a node boundary, a
   * doc that moved under a captured pos), and reporting success on that is a
   * silent no-op with a save queued behind it (2026-08-12 review).
   */
  const updateComponentAttrsAt = (
    pos: number,
    attrs: { span?: number | 'full' | null; source?: string },
  ): string | null => {
    const ed = editorRef.current;
    if (!ed) return 'The editor is still loading — try again in a moment.';
    const node = componentNodeAt(ed.state.doc, pos);
    if (!node) return 'That block is no longer in the post, so nothing was written.';
    // Only a real change can make the render differ; without this a no-op edit
    // would end the ladder on the honest-but-wrong "preview never caught up".
    const changesRender =
      (attrs.source !== undefined && attrs.source !== String(node.attrs.source ?? '')) ||
      (attrs.span !== undefined && attrs.span !== node.attrs.span);
    const applied = ed.chain().setNodeSelection(pos).updateAttributes('astroComponent', attrs).run();
    if (!applied) return "The editor couldn't apply that change to the block, so nothing was written.";
    void flush()
      .then(() => refreshPreviews({ expectChange: changesRender }))
      .catch(() => {}); // flush already reported through its captured episode
    return null;
  };

  /**
   * Write ONE media slot of the component at `pos`. Returns null when the write
   * happened, else the honest reason it did NOT — every caller SAYS that reason
   * rather than closing on silence (owner: "nothing happens").
   */
  const writeMediaSlot = (pos: number, index: number, src: string | null): string | null => {
    const ed = editorRef.current;
    if (!ed) return 'The editor is still loading — try again in a moment.';
    const node = componentNodeAt(ed.state.doc, pos);
    if (!node) return 'That block is no longer in the post, so nothing was written.';
    const source = String(node.attrs.source ?? '');
    const next = editMediaItem(source, index, src);
    if (next == null) {
      return mediaWriteRefusal(String(node.attrs.name ?? 'component'), source, index, src);
    }
    // Its refusal is this function's refusal — the caller must never be told a
    // write happened because the model edit was legal.
    return updateComponentAttrsAt(pos, { source: next });
  };

  /** Colored section default (Auto text is computed once colors land — Task 3). */

  /** The node at a child-index path, and its document position. */
  const nodeAtPath = (editor: Editor, path: number[]): { node: PMDocNode; pos: number } | null => {
    let node: PMDocNode = editor.state.doc;
    let pos = 0;
    for (const [d, i] of path.entries()) {
      if (i >= node.childCount) return null;
      pos += d === 0 ? 0 : 1;
      for (let k = 0; k < i; k++) pos += node.child(k).nodeSize;
      node = node.child(i);
    }
    return { node, pos };
  };

  /** Put the caret in the first empty paragraph of the top-level block at `index` (a new layout's first slot). */
  const focusInto = (editor: Editor, index: number) => {
    let offset = 0;
    for (let i = 0; i < index && i < editor.state.doc.childCount; i++) offset += editor.state.doc.child(i).nodeSize;
    const block = editor.state.doc.maybeChild(index);
    if (!block) return;
    let target = -1;
    block.descendants((n, pos) => {
      if (target < 0 && n.isTextblock) target = offset + 1 + pos + 1;
      return target < 0;
    });
    if (target >= 0) editor.chain().setTextSelection(TextSelection.near(editor.state.doc.resolve(target)).from).focus().run();
  };

  const insertAtSlash = async (item: SlashItem, path: number[]) => {
    setSlash(null);
    const original = originalRef.current;
    const editor = editorRef.current;
    if (!editor) return;
    const at = nodeAtPath(editor, path);
    const slashNode = at?.node;
    if (!at || slashNode?.type.name !== 'paragraph' || slashNode.textContent !== '/') return;
    if (item.text) {
      // A writing block: the `/` paragraph becomes it, in place (any format).
      if (item.text === 'custom') {
        // An empty Custom code box in place of the `/` paragraph. Its view focuses itself, so
        // no chain().focus() here (that command schedules a view.focus() which takes the focus
        // back); nothing is written until the box has source that compiles.
        editor.chain().insertContentAt({ from: at.pos, to: at.pos + slashNode.nodeSize }, { type: 'passthrough', attrs: { source: '', nodeType: 'mdxJsxFlowElement' } }).run();
        return;
      }
      const chain = editor.chain().focus().deleteRange({ from: at.pos + 1, to: at.pos + 2 }).setTextSelection(at.pos + 1);
      if (item.text === 'hr') chain.setHorizontalRule();
      else if (item.text === 'code') chain.setCodeBlock();
      else applyTextStyle(editor, chain, item.text);
      chain.run();
      return;
    }
    // projectPath is null in WC on purpose — ensureSqComponent's WC branch
    // resolves the component from the container instead of the host FS.
    if (!original || !filePath || format !== 'mdx') return;
    // The component files must exist BEFORE the imports are written — an
    // unimported or missing component blanks the page rather than degrading.
    const needs = item.layout ? ['Stack', ...(item.layout === 'text-image' ? ['Media'] : [])] : [item.component];
    const got = await Promise.all(needs.map(name => ensureSqComponent(projectPath, name).catch(() => null)));
    if (got.some(f => !f)) { setWriteNotice('The component could not be prepared. Your paragraph is still here.'); return; }
    const files = Object.fromEntries(needs.map((name, i) => [name, got[i]!]));
    if (editor.isDestroyed || nodeAtPath(editor, path)?.node !== slashNode) return;
    let current = tiptapToPostDoc(markSlash(editor.getJSON() as PMNode, path), original);
    const bind = (name: string) => {
      const r = bindImport(current, name, componentImportPathFor(filePath, files[name]));
      current = r.doc;
      return r.localName;
    };
    let block: PostBlock;
    if (item.layout === 'colored') block = columnBlock(bind('Stack'), COLORED_DEFAULT);
    else if (item.layout) {
      const stackName = bind('Stack');
      block = rowBlock(stackName, item.layout, item.layout === 'text-image' ? bind('Media') : undefined);
    } else {
      const name = bind(item.component);
      // Media inserts with its own contract (an empty slot + the default
      // measure; inside a layout the slot IS the measure). A promoted
      // component gets a bare tag: its own prop defaults apply, and B4 only
      // writes a value once the user edits one.
      const source = item.component === 'Media'
        ? `<${name} items={[null]}${path.length > 1 ? '' : ' class="col-span-8"'} />`
        : `<${name} />`;
      block = { kind: 'component', name, source, span: null, raw: '', dirty: true, gapBefore: '\n\n' };
    }
    const next = replaceSentinel(current, [block]);
    if (!next) return;
    // The new layout: the first still-empty stack at/after where `/` sat
    // (imports added above it only shift it down).
    const landed = () => {
      if (!item.layout || editor.isDestroyed) return;
      const doc = editor.state.doc;
      for (let i = Math.max(0, path[0] - 1); i < doc.childCount; i++) {
        const n = doc.child(i);
        if (isStack(n) && n.textContent === '') { focusInto(editor, i); return; }
      }
    };
    if (queue.durable) {
      // Keep this local draft in the editor so subsequent typing includes the
      // insertion. The shared flush owns acceptance and latest-only rollback;
      // its accepted body stays unchanged until the transaction commits.
      originalRef.current = next;
      editor.commands.setContent(postDocToTiptap(next) as JSONContent, { emitUpdate: false });
      landed();
      setSaving(true);
      void flush().then(() => {
        if (!editor.isDestroyed) refreshPreviews({ expectChange: true });
      }).catch(() => {}); // flush reports through the captured input revision
      return;
    }
    // The model op is the edit; the editor re-seeds from it and becomes the new
    // matching baseline. Write immediately — the placeholder should turn into a
    // real preview as soon as the instance re-renders.
    const reportWriteIssue = beginWriteIssue();
    void queue
      .enqueue(next, frontmatterRef.current)
      // A new component changes the render AND the component count — the ladder
      // retries until the chip for it exists instead of leaving a placeholder.
      .then(() => {
        if (editor.isDestroyed) return;
        originalRef.current = next; acceptedBodyRef.current = next;
        editor.commands.setContent(postDocToTiptap(next) as JSONContent, { emitUpdate: false });
        landed();
        refreshPreviews({ expectChange: true });
      })
      .catch(e =>
        reportWriteIssue(postWriteIssue(e, projectId, collection, slug)),
      );
  };

  /**
   * The preview ORIGIN, and the first fetch that depends on it.
   *
   * It routinely arrives AFTER the node views mount: in WC the container URL
   * only exists once the dev server has booted, and a slow local spawn does the
   * same. Assigning it once at mount left those chips with a null origin
   * forever — every `/uploads/x.png` unresolvable, the permanent grey "Loading
   * preview…" frame, and no fetch ever retried because the mount refresh had
   * already returned early on the missing origin (2026-08-12 review, F2).
   *
   * So the transition itself is the trigger: re-seed the node views AND re-run
   * the ladder whenever the origin (or the iframe WC proxies its fetches
   * through) changes. `refreshPreviews` is a no-op while there is no origin.
   */
  useEffect(() => {
    if (!editor) return;
    syncMediaSource(editor);
    componentStorage(editor).views.forEach(render => render());
    refreshPreviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, previewOrigin, previewIframe]);

  /** Whether an upload is possible AT ALL, told to the node views so a tile
   *  that cannot be filled says why instead of looking live (F3). Uploading
   *  becomes possible mid-session (the preview server finishes booting), so
   *  this follows the prop rather than being read once. */
  useEffect(() => { if (editor) setPostFormat(editor, format); }, [editor, format]);

  useEffect(() => {
    if (!editor) return;
    const storage = componentStorage(editor);
    storage.uploadBlockedReason = onUploadMedia ? null : UPLOAD_UNAVAILABLE_MESSAGE;
    storage.views.forEach(render => render());
  }, [editor, onUploadMedia]);

  // Node-view events: hover shows the toolbar, an empty tile click opens the
  // upload dialog for that slot.
  useEffect(() => {
    if (!editor) return;
    const storage = componentStorage(editor);
    storage.onHover = payload => {
      if (!payload) {
        scheduleHoverHide();
        return;
      }
      cancelHoverHide();
      setHoverComponent(componentInfoAt(editor, payload.pos));
    };
    storage.onSlotDelete = ({ pos, index }) => {
      // Writes immediately and refreshes when the write lands; a refusal is
      // stated rather than swallowed by a bare `return`.
      setWriteNotice(writeMediaSlot(pos, index, null));
    };
    storage.onSlotUpload = ({ pos, index }) => {
      // No uploader (no running preview server) ⇒ the dialog cannot open, so
      // the click must SAY that. It used to open nothing and report nothing:
      // the tile looked live, and clicking it was the owner's "nothing
      // happens" in its purest form (F3).
      if (!uploadMediaRef.current) {
        setWriteNotice(UPLOAD_UNAVAILABLE_MESSAGE);
        return;
      }
      const node = componentNodeAt(editor.state.doc, pos);
      if (!node) {
        setWriteNotice('That block is no longer in the post, so there is nothing to fill.');
        return;
      }
      editor.commands.setNodeSelection(pos);
      // Same read the tiles were drawn from and the writer will use.
      const slots = displayMediaSlots(String(node.attrs.source ?? ''));
      setWriteNotice(null);
      // pos is captured HERE — a later hover cannot redirect the write.
      setMediaSlot({ pos, index, currentSrc: slots?.[index] ?? '' });
    };
    return () => {
      storage.onHover = null;
      storage.onSlotDelete = null;
      storage.onSlotUpload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Leaving the tab and unmounting (post switch / editor close) both flush the
  // pending debounce directly — no iframe hop, no flush-on-leave race.
  useEffect(() => {
    const onPageHide = () => { if (pendingWriteRef.current) void flushRef.current().catch(() => {}); };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      ladder.cancel();
      // Every object URL this session minted dies with it — the chips that
      // held them are going away in the same teardown. The resolver itself
      // survives: StrictMode runs this cleanup once before the real mount.
      mediaRef.current?.release();
      if (pendingWriteRef.current) void flushRef.current().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (parsed.error !== null) {
    return (
      <EmptyState
        title="This post body can't be edited"
        caption="Open the file in your editor to correct its syntax. Property edits keep the original body unchanged."
      />
    );
  }

  // Selection wins over hover; hover alone is enough to act on a component.
  // Selection owns the toolbar. Hover previews a component's toolbar only when
  // no layout toolbar is up — hovering the image inside a layout used to swap
  // the layout toolbar out (and close its open color/⋯ popovers).
  const activeComponent = selectedComponent ?? (stackBar ? null : hoverComponent);

  /** Layout toolbar → one Tiptap transaction each (⌘Z undoes it), then save. */
  const onStackAction = (action: StackAction) => {
    const ed = editorRef.current;
    const info = ed ? stackInfoAt(ed.state) : null;
    if (!ed || !info) return;
    const done = (() => {
      switch (action.type) {
        case 'direction': return action.direction === info.direction ? false : action.direction === 'row' ? toRow(ed, info) : toColumn(ed, info);
        case 'ratio': return setStackAttrs(ed, info, { ratio: action.ratio });
        case 'swap': return swapSlots(ed, info);
        case 'width': return setStackAttrs(ed, info, { width: action.width });
        case 'move': return moveStack(ed, info, action.dir);
        case 'duplicate': return duplicateStack(ed, info);
        case 'remove-color': return setStackAttrs(ed, info, { cls: '', text: '' });
        case 'delete': return deleteStack(ed, info);
      }
    })();
    if (done) void flush().catch(() => {});
  };

  /**
   * P7: a Media's width is a Stack around it (published width no longer
   * depends on editor-only CSS). Top-level Media → wrapped in a column of that
   * width; a Media alone in an uncolored column → the column's width changes,
   * and back to the text measure unwraps it. Inside a layout the slot IS the
   * measure, so no width control there.
   */
  const mediaWidthHost = (pos: number): { kind: 'top' } | { kind: 'sole'; info: StackInfo } | { kind: 'nested' } => {
    const ed = editorRef.current;
    if (!ed) return { kind: 'nested' };
    const $pos = ed.state.doc.resolve(pos);
    if ($pos.depth === 0) return { kind: 'top' };
    const parent = $pos.parent;
    if ($pos.depth === 1 && parent.type.name === 'stackColumn' && parent.childCount === 1 && !parent.attrs.cls) {
      return { kind: 'sole', info: { pos: $pos.before(1), node: parent, direction: 'column', nested: false } };
    }
    return { kind: 'nested' };
  };
  const setMediaWidth = async (pos: number, span: number | 'full' | null) => {
    const ed = editorRef.current;
    const host = mediaWidthHost(pos);
    const width = SPAN_TO_WIDTH[String(span)] ?? 'reading';
    if (!ed || host.kind === 'nested') return;
    if (host.kind === 'sole') {
      if (width === 'reading') unwrapStack(ed, host.info); else setStackAttrs(ed, host.info, { width });
      void flush().catch(() => {});
      return;
    }
    if (width === 'reading') { updateComponentAttrs({ span: null }); return; }
    let file: string | null = null;
    try { file = filePath ? await ensureSqComponent(projectPath, 'Stack') : null; } catch { file = null; }
    if (!file || !filePath || ed.isDestroyed) { setWriteNotice('The layout could not be prepared, so the width was not changed.'); return; }
    const node = ed.state.doc.nodeAt(pos);
    if (node?.type.name !== 'astroComponent') return;
    // the old col-span wrapper (if any) is replaced by the Stack
    ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, 'span', null));
    if (wrapTopLevel(ed, pos, { width }, `import Stack from '${componentImportPathFor(filePath, file)}';`)) void flush().catch(() => {});
  };
  /** Formatting toolbar → Color (D7): wrap/grow a colored section, then open its colors. */
  const [colorSignal, setColorSignal] = useState(0);
  const groupColor = async () => {
    const ed = editorRef.current;
    if (!ed || !filePath) return;
    const { from, to } = ed.state.selection;
    const info = stackInfoAt(ed.state);
    // Entirely inside one column already → that section's colors.
    if (info && info.direction === 'column' && from > info.pos && to < info.pos + info.node.nodeSize) {
      selectStack(ed, info);
      setTextToolbar(null);
      setColorSignal(n => n + 1);
      return;
    }
    let file: string | null = null;
    try { file = await ensureSqComponent(projectPath, 'Stack'); } catch { file = null; }
    if (!file || ed.isDestroyed) { setWriteNotice('The layout could not be prepared, so nothing was grouped.'); return; }
    if (wrapSelection(ed, COLORED_DEFAULT_ATTRS, `import Stack from '${componentImportPathFor(filePath, file)}';`) === null) return;
    setTextToolbar(null);
    setColorSignal(n => n + 1);
    void flush().catch(() => {});
  };
  const mediaHost = activeComponent ? mediaWidthHost(activeComponent.pos) : null;
  const mediaSpan = mediaHost?.kind === 'sole'
    ? WIDTH_TO_SPAN[(mediaHost.info.node.attrs.width as StackWidth) ?? 'reading']
    : activeComponent?.span ?? null;

  // Toolbar edits act on the hovered-or-selected component; media writes do NOT
  // (they use the pos captured when the dialog opened).
  const updateComponentAttrs = (attrs: { span?: number | 'full' | null; source?: string }) => {
    if (!activeComponent) return;
    // A refused edit says so; a successful one clears any earlier refusal.
    setWriteNotice(updateComponentAttrsAt(activeComponent.pos, attrs));
  };

  // The 1/2/3 row SETS the slot count, and only the array shape has a count to
  // set: a named-shape component's slots are fixed by its own markup, so
  // setMediaItemCount returns null for it. Showing the buttons anyway made
  // every click a silent no-op — the same "nothing happens" the owner reported,
  // one layer up. `countEditable` is the writer's own answer to that question.
  const mediaRead = activeComponent ? readMediaSlots(activeComponent.source) : null;
  const mediaSlots = activeComponent ? displayMediaSlots(activeComponent.source) : null;
  const showMediaRow = Boolean(activeComponent && onUploadMedia && mediaRead?.countEditable);
  const showMediaWidth = Boolean(activeComponent && isMediaComponent(activeComponent.source) && mediaHost?.kind !== 'nested');

  return (
    <div
      ref={wrapperRef}
      className={`sq-post-editor relative ${POST_COLUMN_CLS}`}
      data-sq-post-editor-dirty={saving || undefined}
    >
      {previewCss !== '' && <style data-sq-preview-css>{previewCss}</style>}
      {writeIssue && <OperationNotice {...postIssueCopy(writeIssue)} action={mayOfferRecovery(writeIssue) ? {
        label: 'Retry save', onClick: () => { void flush().catch(() => {}); },
      } : undefined} />}
      {writeNotice !== null && <OperationNotice urgency="assertive" title={writeNotice}
        action={{ label: 'Dismiss', onClick: () => setWriteNotice(null) }} />}
      {previewProblem !== null && <OperationNotice urgency="assertive"
        title="Some block previews are unavailable."
        detail="The blocks may show an earlier version. Refresh to check the preview again."
        action={{ label: 'Refresh', onClick: () => refreshPreviews() }} />}
      <EditorContent editor={editor} />
      <BlockHandle editor={editor} wrapperRef={wrapperRef} onChanged={() => void flush().catch(() => {})} />
      {editor && <PostFormattingToolbar editor={editor} anchor={textToolbar} onClose={() => setTextToolbar(null)}
        onColor={format === 'mdx' ? () => void groupColor() : undefined} />}
      {activeComponent && (showMediaWidth || showMediaRow) && (
        <div onMouseEnter={cancelHoverHide} onMouseLeave={scheduleHoverHide}>
          {/* ONE toolbar: width modes · count modes. Slots are edited on the
              component itself (empty tile = upload, hover bin = delete). */}
          <FloatingPanel
            className="absolute flex items-center gap-0.5 p-1"
            style={{ left: activeComponent.left, top: activeComponent.top, transform: 'translate(-50%, -100%)' }}
            onMouseDown={e => e.preventDefault()}
          >
            {showMediaWidth && (
              <>
                <WidthModes span={mediaSpan} onChange={span => void setMediaWidth(activeComponent.pos, span)} />
                {showMediaRow && <Divider />}
              </>
            )}
            {showMediaRow &&
              ([1, 2, 3] as const).map(count => (
                <Button
                  key={count}
                  size="sm"
                  variant="ghost"
                  iconOnly
                  active={Math.max(1, (mediaSlots ?? []).length) === count}
                  aria-label={`${count} item${count > 1 ? 's' : ''}`}
                  title={`${count} item${count > 1 ? 's' : ''}`}
                  onClick={() => {
                    if (!activeComponent) return;
                    const next = setMediaItemCount(activeComponent.source, count);
                    // The row only shows when the count IS editable, so a null
                    // here means the source changed under us — say so instead
                    // of swallowing it.
                    if (next == null) {
                      setWriteNotice(
                        `<${activeComponent.name}/> decides its own number of media, so the editor can't change it here.`,
                      );
                      return;
                    }
                    updateComponentAttrs({ source: next });
                  }}
                >
                  {(() => { const Icon = MEDIA_COUNT_ICONS[count - 1]; return <Icon className="w-4 h-4" />; })()}
                </Button>
              ))}
          </FloatingPanel>
        </div>
      )}
      {stackBar && !activeComponent && (
        <FloatingPanel
          className="absolute flex items-center gap-0.5 p-1"
          style={{ left: stackBar.left, top: stackBar.top, transform: 'translate(-50%, -100%)' }}
          onMouseDown={e => e.preventDefault()}
        >
          <StackToolbar
            direction={stackBar.info.direction}
            ratio={(stackBar.info.node.attrs.ratio as StackRatio) ?? '1:1'}
            width={(stackBar.info.node.attrs.width as StackWidth) ?? 'reading'}
            nested={stackBar.info.nested}
            canRow={!(stackBar.info.direction === 'column' && stackBar.info.node.content.content.some(c => c.type.name === 'stackRow'))}
            colored={Boolean(stackBar.info.node.attrs.cls)}
            colorControl={
              <StackColorPopover
                cls={String(stackBar.info.node.attrs.cls ?? '')}
                textAuto={stackBar.info.node.attrs.text === 'auto'}
                lookupVar={lookupVar}
                openSignal={colorSignal}
                onChange={(cls, auto) => {
                  const ed = editorRef.current;
                  const info = ed ? stackInfoAt(ed.state) : null;
                  if (!ed || !info) return;
                  const hasBg = Boolean(colorClassOf(cls, 'bg'));
                  if (setStackAttrs(ed, info, { cls, text: auto && hasBg ? 'auto' : '' })) void flush().catch(() => {});
                }}
              />
            }
            onAction={onStackAction}
          />
        </FloatingPanel>
      )}
      {mediaSlot && onUploadMedia && (
        <MediaSlotDialog
          // Display URL only — writes keep the raw path. The resolver returns
          // null for a path this page cannot load at all (a `./images/x.png`
          // that Astro resolves through its asset pipeline) or cannot load YET
          // (WC, bytes still being read), and the dialog then shows its empty
          // state rather than a broken image claiming the slot is broken. The
          // resolver's callback re-renders this component when they land.
          currentSrc={mediaResolver().urlFor(mediaSlot.currentSrc) ?? ''}
          onUpload={onUploadMedia}
          onClose={() => setMediaSlot(null)}
          // Both write to the pos CAPTURED AT OPEN and hand the dialog a reason
          // on refusal, so it can stay open instead of vanishing on silence.
          onPick={src => writeMediaSlot(mediaSlot.pos, mediaSlot.index, src)}
          onClear={
            mediaSlot.currentSrc
              ? () => writeMediaSlot(mediaSlot.pos, mediaSlot.index, null)
              : null
          }
        />
      )}
      {slash && (
        <SlashMenu
          items={menuItemsFor(slash)}
          activeIndex={slash.activeIndex}
          listId={slashId}
          left={slash.left}
          top={slash.top}
          disabledReason={format === 'mdx' ? null : 'Layouts and components need an .mdx post.'}
          onDismiss={() => setSlash(null)}
          onActivate={index => setSlash({ ...slash, activeIndex: index })}
          onPick={item => void insertAtSlash(item, slash.path)}
        />
      )}
    </div>
  );
});
