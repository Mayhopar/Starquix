/**
 * Tiptap schema + PostDoc ↔ Tiptap JSON adapters.
 *
 * The editor doc is OUTPUT-ONLY toward source (binding law #4): serialization
 * always goes Tiptap JSON → PostDoc → serializePostDoc, and untouched blocks
 * are matched back to their original PostDoc block (in order) so they emit
 * their verbatim source slice. A block is "untouched" when its canonical
 * markdown equals the original's — matching is content-based, so caret moves,
 * selections and re-renders never dirty anything.
 */
import type { PassthroughDisplay, PostFormat } from '@/postmodel/postModel';
import { customCodeView, isRawElement } from './customCodeView';
import { Node, type Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMDocNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { displayMediaSlots } from '../componentMedia';
import { NO_PREVIEW_MEDIA, retargetMedia, type MediaSource } from '../mediaResolver';
import type { RootContent, PhrasingContent, BlockContent, ListItem } from 'mdast';
import {
  stringifyBlockMdast,
  walkBlockLines,
  isEsmBlock,
  type PostBlock,
  type PostDoc,
  type EditableKind,
  type StackAttrs,
  type StackBlock,
} from '@/postmodel/postModel';
import { ROW_BASE, ROW_RATIO, type StackRatio, type StackWidth } from '@/core/stack/stackClasses';
import { colorClassOf, resolveColorClass } from '@/core/stack/stackColor';

/* ------------------------------------------------------------------ */
/* Tiptap node extensions                                              */
/* ------------------------------------------------------------------ */

/** Opaque block construct (ESM, expressions, fences, raw HTML, footnote defs…).
 *  Selectable + deletable as a unit; never editable. */
export const Passthrough = Node.create({
  name: 'passthrough',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    // display: what to draw for a code block / table, from the post model's parse (never serialized)
    return { source: { default: '' }, nodeType: { default: 'html' }, display: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'pre[data-sq-passthrough]' }];
  },
  renderHTML({ node }) {
    return [
      'pre',
      { 'data-sq-passthrough': node.attrs.nodeType as string, class: 'sq-passthrough' },
      String(node.attrs.source),
    ];
  },
  // The writing view shows what the page shows (owner 2026-09-30): a code
  // block without its fences, a divider as the page's dots, a table as a
  // table. Display only — the atom's `source` is untouched and round-trips.
  // Everything else keeps the verbatim-source <pre> (renderHTML above).
  // The post's source format, set by PostBodyEditor — what a Custom code edit must compile as.
  addStorage() {
    return { format: 'mdx' as PostFormat };
  },
  addNodeView() {
    // Raw HTML/JSX elements are the writer's own code: an editable box (Custom code).
    return ({ node, editor, getPos }) => isRawElement(node.attrs.nodeType)
      ? customCodeView(node, editor, getPos as () => number | undefined, () => (editor.storage as unknown as { passthrough: { format: PostFormat } }).passthrough.format)
      : { dom: passthroughDom(String(node.attrs.nodeType), String(node.attrs.source), node.attrs.display as PassthroughDisplay | null) };
  },
});

/** Tell the Custom code boxes which format their source must compile as. */
export function setPostFormat(editor: Editor, format: PostFormat): void {
  (editor.storage as unknown as { passthrough: { format: PostFormat } }).passthrough.format = format;
}

/**
 * Display DOM for a passthrough block; textContent only (never HTML from the
 * source). `display` comes from the post model's own parse (code value without
 * fences, table cell texts) — no second markdown parser here.
 */
export function passthroughDom(nodeType: string, source: string, display: PassthroughDisplay | null = null): HTMLElement {
  const mark = <T extends HTMLElement>(el: T): T => {
    el.dataset.sqPassthrough = nodeType;
    el.classList.add('sq-passthrough');
    el.contentEditable = 'false';
    return el;
  };
  if (nodeType === 'thematicBreak') return mark(document.createElement('hr'));
  if (display && 'code' in display) {
    const pre = mark(document.createElement('pre'));
    pre.classList.add('sq-code');
    const code = document.createElement('code');
    code.textContent = display.code;
    pre.append(code);
    return pre;
  }
  if (display && 'rows' in display && display.rows.length) {
    const table = mark(document.createElement('table'));
    const head = table.createTHead().insertRow();
    for (const c of display.rows[0]) { const th = document.createElement('th'); th.textContent = c; head.append(th); }
    const body = table.createTBody();
    for (const r of display.rows.slice(1)) { const tr = body.insertRow(); for (const c of r) tr.insertCell().textContent = c; }
    return table;
  }
  const pre = mark(document.createElement('pre'));
  pre.textContent = source;
  return pre;
}

/** THE accessor for the astroComponent storage — the double-cast lives once. */
export function componentStorage(editor: Editor): AstroComponentStorage {
  return (editor.storage as unknown as { astroComponent: AstroComponentStorage }).astroComponent;
}

const IMAGE_GLYPH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

export interface AstroComponentStorage {
  /**
   * The rendered HTML of a component chip, keyed BY THE NODE ITSELF.
   *
   * Not an ordinal-indexed array: ProseMirror nodes are immutable and shared
   * across doc versions, so an untouched chip keeps its identity (and therefore
   * its render) through edits that move it, while a chip whose `source` just
   * changed becomes a NEW node — automatically losing a render that no longer
   * describes it. Ordinals did neither: deleting a block above a chip silently
   * handed it its neighbour's HTML. PostBodyEditor fills this by matching
   * `data-sq-body-line`, never by counting.
   */
  previewFor: WeakMap<PMDocNode, string>;
  /**
   * How a media path becomes a URL THIS page can load — the one seam the
   * runtimes differ at, set by PostBodyEditor (see `../mediaResolver`).
   *
   * Local/server resolve `/uploads/x.png` against the preview instance's own
   * origin. WC cannot: its preview origin serves nothing a cross-origin-isolated
   * page may load, so there the same path resolves to a `blob:` URL built from
   * container bytes — asynchronously, which is why `urlFor` may answer null and
   * the slot renders a neutral pending frame rather than a lie in either
   * direction. Default = no preview yet, nothing root-relative is loadable.
   */
  media: MediaSource;
  /** live node-view re-render callbacks */
  views: Set<() => void>;
  /** pointer entered (payload) / left (null) a component — drives the hover toolbar */
  onHover: ((payload: { pos: number } | null) => void) | null;
  /** the bin on a filled media slot was clicked — clear that slot */
  onSlotDelete: ((payload: { pos: number; index: number }) => void) | null;
  /** a slot was clicked — open the media dialog for it (empty = fill it, filled
   *  = replace it) */
  onSlotUpload: ((payload: { pos: number; index: number }) => void) | null;
  /**
   * Why an upload cannot happen right now (no running preview server yet), or
   * null when it can. Set by PostBodyEditor from the presence of its
   * `onUploadMedia` prop.
   *
   * The tile stays CLICKABLE and the click still reports — the editor answers
   * with this sentence instead of doing nothing. A tile that opens nothing and
   * says nothing is verbatim the owner's report ("nothing happens"), and before
   * a preview server exists that is exactly what an upload tile was
   * (2026-08-12 review, F3).
   */
  uploadBlockedReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Body lines — the join key between the render and the chips          */
/* ------------------------------------------------------------------ */

/**
 * The 1-based BODY line each component block starts on, in doc order — the same
 * number sq-source-plugin stamps as `data-sq-body-line` (body-relative, i.e.
 * line 1 is the first line after the frontmatter fence, which is exactly what
 * `parseFrontmatter` hands the editor as `body`).
 *
 * Measured by running the REAL serializer over each block, so it cannot drift
 * from what the write queue puts on disk (a col-span-wrapped component reports
 * the wrapper `<div>`'s line, which is also what the plugin stamps, because the
 * div is the top-level node it wraps).
 *
 * The k-th entry belongs to the k-th `astroComponent` node in the editor:
 * `tiptapToPostDoc` maps every PM node to exactly one block in order, and
 * `kind: 'component'` blocks come from nothing else.
 */
export function componentBodyLines(doc: PostDoc): number[] {
  // Depth-first like ProseMirror's descendants, so a Media inside a Stack
  // slot pairs with the plugin's stamp on that nested line.
  const lines: number[] = [];
  walkBlockLines(doc, (block, line) => { if (block.kind === 'component') lines.push(line); });
  return lines;
}

/* ------------------------------------------------------------------ */
/* The media MODEL of a component invocation                           */
/* ------------------------------------------------------------------ */

/**
 * The slot model comes from `componentMedia.displayMediaSlots` and NOWHERE
 * else. This file used to carry its own parser, and the two disagreed about
 * which attribute backs slot i — the tiles drew one mapping while the writer
 * used another, so clicking the empty middle tile of `<Trio src1 src3/>`
 * overwrote the third image. One read, one write, one truth.
 */

const VIDEO_RE = /\.(mp4|webm|mov)(\?|$)/i;
const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'IFRAME']);

/** Inspect a render without painting it — the model may still win. */

/**
 * Markers this render publishes, keyed by slot — and RECONCILED with the model,
 * which is the only index authority. A marker outside the model's slot range is
 * a stale render's ghost (the invocation shrank from 3 media to 1 and the page
 * has not caught up); feeding its index to the writer would grow the array back
 * — `editMediaItem(source, 1, null)` on `items={["a"]}` pads to
 * `items={["a", null]}` — so a ghost marker decides nothing and gets no
 * affordance (2026-08-12 review, F4).
 */
function slotMarkers(root: ParentNode, slots: (string | null)[]): Map<number, Element> {
  const markers = new Map<number, Element>();
  for (const el of root.querySelectorAll('[data-sq-media-slot]')) {
    const i = Number(el.getAttribute('data-sq-media-slot'));
    if (Number.isInteger(i) && i >= 0 && i < slots.length && !markers.has(i)) markers.set(i, el);
  }
  return markers;
}

/**
 * May this render be painted as it is, or does the MODEL still know something
 * the render does not?
 *
 * Two readings, in order of authority:
 *  - the component publishes per-slot markers (`data-sq-media-slot`, which the
 *    system Media component emits on both its media and its empty placeholder):
 *    slot i is covered iff its marker is a media element. This is the case the
 *    optimistic path exists for: right after an upload,
 *    `<Media items={["/uploads/p.png"]}/>` still renders its placeholder BUTTON
 *    carrying slot marker 0 — a marker, but not media, so the model wins and
 *    the new photo shows immediately instead of the placeholder the owner
 *    reported.
 *  - no markers (EVERY user component): nothing in the render says which slot
 *    any element belongs to, so a per-slot check is impossible and counting is
 *    a lie. ONE element routinely carries TWO filled slots —
 *    `fixtures/local-astro-project/src/components/SingleVideo.astro` renders a
 *    single `<video src={src} poster={poster}/>` for a model of [src, poster] —
 *    and the old `mediaElements >= filledSlots` count therefore declared that
 *    real render "not covering", threw the markup away and replaced the
 *    component with model tiles permanently (2026-08-12 review, F1). Same class
 *    for an <img> used as both slots, or a <picture>/<source> set collapsed to
 *    one element.
 *
 * So: a render with media in it is the component's own output and always wins;
 * empty slots are offered ALONGSIDE it (see `renderHtml`), never instead of it.
 * Only a render with no media at all is rejected, and only when the model says
 * something should be showing — which is the optimistic post-upload path again.
 */
function renderCoversModel(root: ParentNode, slots: (string | null)[]): boolean {
  const markers = slotMarkers(root, slots);
  if (markers.size > 0) {
    return slots.every((src, i) => {
      if (src == null) return true;
      const marker = markers.get(i);
      return marker != null && MEDIA_TAGS.has(marker.tagName);
    });
  }
  if (root.querySelectorAll('img, video, iframe').length > 0) return true;
  return slots.every(src => src == null);
}

/** `./images/timepad/hero.png` → `hero.png`, for the slot chip's label. */
function mediaLabel(src: string, index: number): string {
  const name = src.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
  return name || `Media ${index + 1}`;
}

/** Astro component block. The node view renders the REAL Astro output for this
 *  component (fetched from SqPostView); placeholder until previews arrive. */
export const AstroComponent = Node.create({
  name: 'astroComponent',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: '' }, source: { default: '' }, span: { default: null } };
  },
  addStorage(): AstroComponentStorage {
    return {
      previewFor: new WeakMap(),
      media: NO_PREVIEW_MEDIA,
      views: new Set(),
      onHover: null,
      onSlotDelete: null,
      onSlotUpload: null,
      uploadBlockedReason: null,
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-sq-component]' }];
  },
  renderHTML({ node }) {
    return [
      'div',
      { 'data-sq-component': node.attrs.name as string, 'data-sq-block': 'component', class: 'sq-component-placeholder' },
      `<${node.attrs.name as string} />`,
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'sq-component-preview';
      // the page's spacing rules (articleTokens SPACE) treat a component block by this stamp, as on the page
      dom.dataset.sqBlock = 'component';
      dom.dataset.sqComponent = String(node.attrs.name);
      dom.contentEditable = 'false';
      // The span must read IMMEDIATELY in the editor (owner, 2026-08-10) —
      // Default (8) = the text measure; 12 / full = the wide / full lines, centered.
      // A span attr change recreates the node view, so this stays current.
      {
        const raw = node.attrs.span as number | 'full' | null;
        // The page's alignment lines (articleTokens BODY LEGACY_SPAN): 12 =
        // the wide line, full = the viewport, anything else = the text line.
        // Clamped to the writing pane (a cqw container) — never under the sidebar.
        const w = raw === 'full' ? '100cqw' : Number(raw) === 12 ? 'min(64rem, 100cqw - 48px)' : 'min(100%, 100cqw)';
        dom.style.width = w;
        dom.style.marginLeft = `calc((100% - ${w}) / 2)`;
        dom.dataset.sqPreviewWidth = w; // readable where CSS min()/cqw is not (tests)
      }
      // Clicking the rendered preview must select THIS atom. Without it the
      // prior selection silently survives the click — found live: Backspace
      // after clicking a preview deleted the initially-selected imports block.
      dom.addEventListener('mousedown', event => {
        event.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos === 'number') editor.chain().setNodeSelection(pos).focus().run();
      });
      // Hover shows the width/media toolbar without needing a click first.
      const storage = componentStorage(editor);
      const wireSlotUpload = (el: Element, index: number) => {
        el.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') storage.onSlotUpload?.({ pos, index });
        });
      };
      dom.addEventListener('mouseenter', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos === 'number') storage.onHover?.({ pos });
      });
      dom.addEventListener('mouseleave', () => storage.onHover?.(null));
      /** hover-bin on a filled slot; `wrap` takes the media's place in the grid */
      const wireBin = (wrap: HTMLElement, slot: number) => {
        const bin = document.createElement('button');
        bin.type = 'button';
        bin.className = 'sq-slot-bin';
        bin.title = 'Remove media';
        bin.setAttribute('aria-label', `Remove media ${slot + 1}`);
        bin.innerHTML =
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 2.5h3M5.5 4.5l.5 9h4l.5-9M6.8 7v4M9.2 7v4"/></svg>';
        bin.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        bin.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') storage.onSlotDelete?.({ pos, index: slot });
        });
        wrap.appendChild(bin);
      };

      /** An upload tile for slot `i`. Empty tiles ARE the upload affordance
       *  (owner's original spec) — click opens the dialog for THIS index, and
       *  the index is the model's, so the writer fills the slot pointed at.
       *
       *  When uploading is impossible (no preview server yet) the tile SAYS so
       *  — as a tooltip here, and as a notice when clicked. It never sits there
       *  looking live and doing nothing (2026-08-12 review, F3). */
      const uploadTile = (i: number): HTMLElement => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'sq-media-placeholder-tile';
        tile.dataset.sqSlotState = 'empty';
        tile.dataset.sqSlotIndex = String(i);
        tile.innerHTML = IMAGE_GLYPH_SVG;
        const blocked = storage.uploadBlockedReason;
        if (blocked !== null) {
          tile.dataset.sqSlotBlocked = '';
          tile.title = blocked;
          tile.setAttribute('aria-disabled', 'true');
        } else {
          tile.title = `Add media ${i + 1}`;
        }
        wireSlotUpload(tile, i);
        return tile;
      };

      /**
       * The replace/remove control for a FILLED slot the render published no
       * marker for.
       *
       * Every user component is in that position: the hover bin and the
       * click-to-replace hang off `data-sq-media-slot`, which only the system
       * Media component emits. So on the owner's own DoubleImage the editor
       * could fill an empty slot and then never change or clear it again — a
       * one-way surface (2026-08-12 review, F4).
       *
       * Anchored to the MODEL index, never to a position inside the render:
       * which <img> of a user component's markup belongs to which prop is
       * unknowable (nothing publishes it), and pairing them by document order
       * is how a bin ends up deleting the other photo — `<V src poster/>` and
       * `<V poster src/>` order their slots differently while rendering the
       * same two elements.
       */
      const filledChip = (i: number, src: string): HTMLElement => {
        const chip = document.createElement('div');
        chip.className = 'sq-slot-chip';
        chip.dataset.sqSlotState = 'filled';
        chip.dataset.sqSlotIndex = String(i);

        const replace = document.createElement('button');
        replace.type = 'button';
        replace.className = 'sq-slot-chip__replace';
        replace.title = `Replace media ${i + 1}`;
        replace.setAttribute('aria-label', `Replace media ${i + 1}`);
        const glyph = document.createElement('span');
        glyph.className = 'sq-slot-chip__glyph';
        glyph.innerHTML = IMAGE_GLYPH_SVG;
        const name = document.createElement('span');
        name.className = 'sq-slot-chip__name';
        // textContent, never innerHTML: this string is a path out of the user's
        // own .mdx and must never be parsed as markup.
        name.textContent = mediaLabel(src, i);
        replace.append(glyph, name);
        replace.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        wireSlotUpload(replace, i);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'sq-slot-chip__remove';
        remove.title = 'Remove media';
        remove.setAttribute('aria-label', `Remove media ${i + 1}`);
        remove.innerHTML =
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 2.5h3M5.5 4.5l.5 9h4l.5-9M6.8 7v4M9.2 7v4"/></svg>';
        remove.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        remove.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') storage.onSlotDelete?.({ pos, index: i });
        });

        chip.append(replace, remove);
        return chip;
      };

      /** Model-driven render — used ONLY when this chip has no render that
       *  accounts for its model (pending, failed, or a render made before the
       *  last upload). Filled + loadable → the source itself (optimistic).
       *  Filled but not loadable from the editor (a `./images/x.png` Astro
       *  resolves through its asset pipeline, a root-relative path before the
       *  origin is known, or — in WC — bytes still being read out of the
       *  container FS) → a neutral, NON-clickable pending frame; an <img>
       *  pointed at a URL this page cannot fetch would just render broken.
       *  Empty → the upload tile. */
      const renderModelSlots = (slots: (string | null)[]) => {
        dom.classList.remove('sq-component-placeholder');
        const row = document.createElement('div');
        row.className = 'sq-media-placeholder';
        slots.forEach((src, i) => {
          if (src == null) {
            row.appendChild(uploadTile(i));
            return;
          }
          // A filled slot carries its state (and its bin) on the WRAPPER, so
          // there is exactly one `data-sq-slot-state` element per slot however
          // the inside is drawn.
          const wrap = document.createElement('span');
          wrap.className = 'sq-slot-wrap';
          wrap.style.flex = '1';
          wrap.dataset.sqSlotState = 'filled';
          wrap.dataset.sqSlotIndex = String(i);
          const url = storage.media.urlFor(src);
          if (url) {
            const media = document.createElement(VIDEO_RE.test(src) ? 'video' : 'img');
            media.setAttribute('src', url);
            if (media instanceof HTMLVideoElement) {
              media.muted = true;
              media.autoplay = true;
              media.loop = true;
              media.playsInline = true;
            }
            wrap.appendChild(media);
            wireSlotUpload(media, i); // clicking the photo replaces it
          } else {
            // The model says FILLED but this page cannot load the path — never
            // offer an upload here. A muted, inert frame reads as "waiting on
            // the preview", not "empty". The bin below still works, so the slot
            // is never a dead end.
            const pending = document.createElement('div');
            pending.className = 'sq-media-pending';
            pending.innerHTML = IMAGE_GLYPH_SVG;
            const note = document.createElement('span');
            note.textContent = 'Loading preview…';
            pending.appendChild(note);
            wrap.appendChild(pending);
          }
          wireBin(wrap, i);
          row.appendChild(wrap);
        });
        dom.replaceChildren(row);
      };

      /** Paint the REAL Astro render, then make its slots actionable. */
      const renderHtml = (slots: (string | null)[] | null) => {
        // dom already holds the parsed render — see the single parse at the
        // call site. Parsing the same string twice per chip per ladder tick was
        // pure waste.
        dom.classList.remove('sq-component-placeholder');
        // The render's media URLs point at the preview INSTANCE. In WC that
        // origin serves nothing this cross-origin-isolated page may load, so
        // every one of them renders as a broken image however valid the file is
        // (owner, 2026-08-12; confirmed live — boot-time container files fail
        // identically). Byte mode re-points them at blob: URLs; URL mode leaves
        // the render exactly as fetched.
        if (storage.media.readsBytes) retargetMedia(dom, storage.media);
        // A marker only counts when the MODEL has that slot: an index the model
        // does not know is a stale render's ghost, and wiring a writer to it is
        // a wrong-slot write waiting to happen. `slots === null` = the writer
        // refuses this invocation entirely, so nothing here may open either.
        const marked = new Set<number>();
        const inModel = (i: number) =>
          slots != null && Number.isInteger(i) && i >= 0 && i < slots.length;
        // Each FILLED slot gets its own hover bin (owner: "hover on images
        // with a bin icon") and click-to-replace. The img is wrapped so the bin
        // can anchor to it; the wrapper takes the img's place in the grid.
        dom.querySelectorAll('img[data-sq-media-slot], video[data-sq-media-slot]').forEach(el => {
          const slot = Number(el.getAttribute('data-sq-media-slot'));
          if (!inModel(slot)) return;
          marked.add(slot);
          const wrap = document.createElement('span');
          wrap.className = 'sq-slot-wrap';
          el.replaceWith(wrap);
          wrap.appendChild(el);
          wireBin(wrap, slot);
          wireSlotUpload(el, slot); // clicking the photo replaces it
        });
        // EMPTY slots in a mixed render (some uploaded, some not): make them
        // read and act like upload tiles — after a bin-delete the slot must
        // stay uploadable (owner, 2026-08-10).
        dom.querySelectorAll('[data-sq-media-slot]:not(img):not(video)').forEach(el => {
          const slot = Number(el.getAttribute('data-sq-media-slot'));
          if (!inModel(slot)) return;
          marked.add(slot);
          el.classList.add('sq-slot-empty');
          // Only draw our glyph into an EMPTY placeholder — the user owns
          // this component and may have put their own artwork in it.
          if (!el.innerHTML.trim()) el.innerHTML = IMAGE_GLYPH_SVG;
          if (storage.uploadBlockedReason !== null) {
            (el as HTMLElement).title = storage.uploadBlockedReason;
            el.setAttribute('aria-disabled', 'true');
          }
          wireSlotUpload(el, slot);
        });
        // Slots the render published no marker for. A user component publishes
        // NONE, so this is its whole editing surface — offered BESIDE the real
        // render, never instead of it: the component's grid, caption and aspect
        // ratio are the truth about how it looks, and throwing them away
        // because a slot is empty (or because one <video> carries two slots) is
        // a worse lie than the one being fixed.
        const unmarked = (slots ?? []).map((_, i) => i).filter(i => !marked.has(i));
        const empty = unmarked.filter(i => slots![i] == null);
        const filled = unmarked.filter(i => slots![i] != null);
        if (empty.length > 0) {
          const row = document.createElement('div');
          row.className = 'sq-media-placeholder sq-media-placeholder--below';
          for (const i of empty) row.appendChild(uploadTile(i));
          dom.appendChild(row);
        }
        if (filled.length > 0) {
          // Replace/remove for slots whose photo IS on the page but is not
          // addressable in its own markup (F4) — without this the surface is
          // one-way: fill once, never change.
          const strip = document.createElement('div');
          strip.className = 'sq-slot-strip';
          strip.setAttribute('role', 'group');
          strip.setAttribute('aria-label', 'Media slots');
          for (const i of filled) strip.appendChild(filledChip(i, slots![i]!));
          dom.appendChild(strip);
        }
      };

      /**
       * The node as it exists in the CURRENT doc.
       *
       * Not the closure's `node`: ProseMirror reuses a node view whenever the
       * new node has the same markup, so after `setContent` (component insert)
       * the doc holds a fresh, equal node object while this closure still
       * points at the old one. Keying the preview map on a node nobody looks up
       * again would have frozen the chip on whatever it last painted.
       */
      const currentNode = (): PMDocNode => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        const doc = editor.state.doc;
        // nodeAt THROWS on an out-of-range pos, and a pos CAN go out of range
        // between a delete and the view teardown that follows it.
        if (typeof pos !== 'number' || pos < 0 || pos >= doc.content.size) return node;
        const at = doc.nodeAt(pos);
        return at && at.type.name === 'astroComponent' ? at : node;
      };

      const render = () => {
        // THIS node's render — looked up by node identity, never by an ordinal
        // (see AstroComponentStorage.previewFor).
        const self = currentNode();
        const html = storage.previewFor.get(self);
        const source = String(self.attrs.source ?? '');
        // THE MODEL, never the fetched HTML, decides what a slot HOLDS. A
        // missing preview means pending/failed/unmatched — it is NOT evidence
        // that the component is empty, and drawing upload tiles for it lied
        // about components that render fine (owner, 2026-08-11: "nothing
        // happens, I keep seeing a placeholder"). But a render that DOES
        // account for the model is the truth about how the component looks,
        // and always wins over a row of model tiles.
        const slots = displayMediaSlots(source);
        // `slots === null` = not a media component, so there is no model to
        // check the render against and the render is simply the truth.
        if (html) {
          // Parse ONCE, into the live node, then judge coverage on it. If the
          // render does not account for the model we fall through and
          // renderModelSlots replaces the children anyway.
          dom.innerHTML = html;
          if (slots === null || renderCoversModel(dom, slots)) {
            renderHtml(slots);
            return;
          }
        }
        if (slots) {
          renderModelSlots(slots);
          return;
        }
        if (!dom.innerHTML) {
          // non-media placeholder until the first fetch lands; stale HTML is
          // kept while a refetch is in flight (no blink)
          dom.classList.add('sq-component-placeholder');
          dom.textContent = `<${String(self.attrs.name)} />`;
        }
      };
      render();
      storage.views.add(render);
      return {
        dom,
        destroy() {
          storage.views.delete(render);
        },
      };
    };
  },
});

/** Inline construct the editor doesn't model (footnote refs, inline expressions,
 *  link/image references…). Carries its mdast verbatim; renders as its markdown. */
export const InlineOpaque = Node.create({
  name: 'inlineOpaque',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { mdast: { default: 'null' }, label: { default: '' }, block: { default: false } };
  },
  parseHTML() {
    return [{ tag: 'span[data-sq-inline-opaque]' }];
  },
  renderHTML({ node }) {
    return [
      'span',
      { 'data-sq-inline-opaque': '', class: 'sq-inline-opaque' },
      String(node.attrs.label),
    ];
  },
});

/**
 * A doc that STARTS with an atom (imports, usually) gets a NodeSelection on it
 * as Tiptap's initial selection — so the first stray Backspace after opening
 * deleted the whole import block (found live). Park the caret at the first
 * text position instead.
 */
export function normalizeInitialSelection(editor: Editor): void {
  const { state, view } = editor;
  if (!(state.selection instanceof NodeSelection)) return;
  // TextSelection.near(0) still lands on the atom; walk to the first textblock.
  let pos = -1;
  state.doc.descendants((node, nodePos) => {
    if (pos >= 0) return false;
    if (node.isTextblock) {
      pos = nodePos + 1;
      return false;
    }
    return true;
  });
  if (pos < 0) return; // all-atom doc — nothing better to select
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/**
 * Caret into the top-level block whose body lines hold `line` — the
 * `data-sq-body-line` of post text double-clicked on the canvas — scrolled
 * into view. The k-th top-level node IS the k-th PostDoc block
 * (`tiptapToPostDoc` maps 1:1); a line between blocks matches nothing.
 */
export function focusBodyBlock(editor: Editor, doc: PostDoc, line: number): void {
  let index = -1;
  walkBlockLines(doc, (block, start, end) => {
    const i = doc.blocks.indexOf(block);
    if (i < 0 || line < start || line > end) return false;
    index = i;
    return true;
  });
  if (index < 0 || index >= editor.state.doc.childCount) return;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(pos + 1))).scrollIntoView());
  view.focus();
}

/* ------------------------------------------------------------------ */
/* Editorial layouts (task-242)                                         */
/* ------------------------------------------------------------------ */

/** Blocks a slot / column may hold (never a stack inside a slot — D3). */
const FLOW = 'paragraph|heading|blockquote|bulletList|orderedList|codeBlock|horizontalRule|passthrough|astroComponent';

/**
 * Editor-only width preview (P5), clamped to the writing pane: the pane is a
 * size container (.sq-post-writing-area), so `cqw` = its width — a wide/edge
 * layout can never slide under the sidebar (seen live 2026-09-28). Wide =
 * the page's wide line (64rem content), edge = the whole pane; the insets
 * live in PostBodyEditor.css.
 */
const WIDTH_CSS: Record<StackWidth, string | null> = {
  reading: null,
  // = Stack.astro TOP_WIDTH.wide: a 64rem content box + one 24px gutter each side
  wide: 'min(67rem, 100cqw)',
  edge: '100cqw',
};

const stackAttrsSpec = () => ({
  /** local JSX name (the import binding) */
  name: { default: 'Stack' },
  width: { default: 'reading' },
  cls: { default: '' },
  /** verbatim `text` attr ('auto' = editor-computed text color) */
  text: { default: '' },
});

/**
 * How the editor resolves a project color variable — set by PostBodyEditor
 * from the project's variables. ponytail: module-level, one editor at a time;
 * a per-editor storage slot if two post editors ever mount together.
 */
let colorLookup: (name: string) => string | null = () => null;
export function setStackColorLookup(fn: (name: string) => string | null): void { colorLookup = fn; }

/** Editor-only paint of the Tailwind color classes (the page renders the classes). */
function stackColorStyle(cls: string): string {
  const bg = resolveColorClass(colorClassOf(cls, 'bg'), colorLookup);
  const fg = resolveColorClass(colorClassOf(cls, 'text'), colorLookup);
  return `${bg ? `background-color:${bg};` : ''}${fg ? `color:${fg};` : ''}`;
}

function stackDomAttrs(node: PMDocNode, direction: 'row' | 'column'): Record<string, string> {
  const width = (node.attrs.width as StackWidth) ?? 'reading';
  const w = WIDTH_CSS[width] ?? null;
  const attrs: Record<string, string> = {
    'data-sq-stack': direction,
    'data-sq-width': width,
    ...(node.attrs.cls ? { 'data-sq-colored': '' } : {}),
    class: `sq-stack${direction === 'row' ? ` ${ROW_BASE} ${ROW_RATIO[node.attrs.ratio as StackRatio] ?? ROW_RATIO['1:1']}` : ''}`,
  };
  const style = `${w ? `width:calc(${w});margin-left:calc((100% - (${w})) / 2);margin-right:0;` : ''}${node.attrs.cls ? stackColorStyle(String(node.attrs.cls)) : ''}`;
  if (style) attrs.style = style;
  return attrs;
}

export const StackSlot = Node.create({
  name: 'stackSlot',
  content: `(${FLOW})+`,
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-sq-stack-slot]' }];
  },
  renderHTML() {
    return ['div', { 'data-sq-stack-slot': '', class: 'sq-stack-slot' }, 0];
  },
});

export const StackRow = Node.create({
  name: 'stackRow',
  group: 'block',
  content: 'stackSlot stackSlot',
  defining: true,
  isolating: true,
  addAttributes() {
    return { ...stackAttrsSpec(), ratio: { default: '1:1' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-sq-stack="row"]' }];
  },
  renderHTML({ node }) {
    return ['div', stackDomAttrs(node, 'row'), 0];
  },
});

export const StackColumn = Node.create({
  name: 'stackColumn',
  group: 'block',
  content: `(${FLOW}|stackRow)+`,
  defining: true,
  isolating: true,
  addAttributes() {
    return stackAttrsSpec();
  },
  parseHTML() {
    return [{ tag: 'div[data-sq-stack="column"]' }];
  },
  renderHTML({ node }) {
    return ['div', stackDomAttrs(node, 'column'), 0];
  },
});

export const postEditorExtensions = [
  // underline has no markdown form — writing it out would corrupt the body
  StarterKit.configure({ underline: false }),
  Passthrough,
  AstroComponent,
  InlineOpaque,
  StackSlot,
  StackRow,
  StackColumn,
];

/* ------------------------------------------------------------------ */
/* JSON shapes                                                         */
/* ------------------------------------------------------------------ */

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

/* ------------------------------------------------------------------ */
/* mdast → PM                                                          */
/* ------------------------------------------------------------------ */

function stripPositions<T>(node: T): T {
  return JSON.parse(
    JSON.stringify(node, (key, value) => (key === 'position' ? undefined : value)),
  ) as T;
}

function inlineLabel(node: PhrasingContent): string {
  try {
    return stringifyBlockMdast({ type: 'paragraph', children: [node] });
  } catch {
    return '[?]';
  }
}

function opaqueInline(node: PhrasingContent | RootContent, block = false): PMNode {
  return {
    type: 'inlineOpaque',
    attrs: {
      mdast: JSON.stringify(stripPositions(node)),
      label: block
        ? stringifyBlockMdast(node as RootContent)
        : inlineLabel(node as PhrasingContent),
      block,
    },
  };
}

function inlineToPM(nodes: PhrasingContent[], marks: PMMark[]): PMNode[] {
  const out: PMNode[] = [];
  const withMarks = (extra: PMMark[]) => [...marks, ...extra];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        // Soft line wraps are spaces semantically; a literal \n fed to
        // ProseMirror comes back as a hardBreak, which serializes as a real
        // <br> ("  \n") — found live on the Timepad fixture.
        if (n.value)
          out.push({
            type: 'text',
            text: n.value.replace(/\n/g, ' '),
            ...(marks.length ? { marks } : {}),
          });
        break;
      case 'strong':
        out.push(...inlineToPM(n.children, withMarks([{ type: 'bold' }])));
        break;
      case 'emphasis':
        out.push(...inlineToPM(n.children, withMarks([{ type: 'italic' }])));
        break;
      case 'delete':
        out.push(...inlineToPM(n.children, withMarks([{ type: 'strike' }])));
        break;
      case 'inlineCode':
        out.push({ type: 'text', text: n.value, marks: withMarks([{ type: 'code' }]) });
        break;
      case 'link':
        out.push(
          ...inlineToPM(
            n.children,
            withMarks([{ type: 'link', attrs: { href: n.url, ...(n.title ? { title: n.title } : {}) } }]),
          ),
        );
        break;
      case 'break':
        out.push({ type: 'hardBreak' });
        break;
      default:
        out.push(opaqueInline(n));
    }
  }
  return out;
}

function listItemToPM(item: ListItem): PMNode {
  const content = item.children.length
    ? item.children.map(blockToPM)
    : [{ type: 'paragraph' } as PMNode];
  return { type: 'listItem', content };
}

function blockToPM(node: RootContent): PMNode {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: inlineToPM(node.children, []) };
    case 'heading':
      return { type: 'heading', attrs: { level: node.depth }, content: inlineToPM(node.children, []) };
    case 'blockquote':
      return { type: 'blockquote', content: node.children.map(blockToPM) };
    case 'list':
      return {
        type: node.ordered ? 'orderedList' : 'bulletList',
        ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
        content: node.children.map(listItemToPM),
      };
    default:
      // a non-editable construct nested inside an editable block (e.g. a fence
      // inside a blockquote) — carried opaquely, unwrapped again on the way out
      return { type: 'paragraph', content: [opaqueInline(node, true)] };
  }
}

const EMPTY_PARAGRAPH: PMNode = { type: 'paragraph' };

function stackToPM(block: StackBlock): PMNode {
  const attrs: Record<string, unknown> = {
    name: block.name,
    width: block.attrs.width ?? 'reading',
    cls: block.attrs.class ?? '',
    text: block.attrs.text ?? '',
  };
  const kids = (blocks: PostBlock[]) => (blocks.length ? blocks.map(blockToPMNode) : [EMPTY_PARAGRAPH]);
  if (block.direction === 'row') {
    return {
      type: 'stackRow',
      attrs: { ...attrs, ratio: block.attrs.ratio ?? '1:1' },
      content: [0, 1].map(i => ({ type: 'stackSlot', content: kids(block.slots[i] ?? []) })),
    };
  }
  return { type: 'stackColumn', attrs, content: kids(block.slots[0] ?? []) };
}

function blockToPMNode(block: PostBlock): PMNode {
  if (block.kind === 'passthrough') {
    return { type: 'passthrough', attrs: { source: block.source, nodeType: block.nodeType, display: block.display ?? null } };
  }
  if (block.kind === 'component') {
    return {
      type: 'astroComponent',
      attrs: { name: block.name, source: block.source, span: block.span },
    };
  }
  if (block.kind === 'stack') return stackToPM(block);
  return blockToPM(block.mdast);
}

export function postDocToTiptap(doc: PostDoc): PMNode {
  return { type: 'doc', content: doc.blocks.map(blockToPMNode) };
}

/* ------------------------------------------------------------------ */
/* PM → mdast                                                          */
/* ------------------------------------------------------------------ */

function markOfType(marks: PMMark[] | undefined, type: string): PMMark | undefined {
  return marks?.find((m) => m.type === type);
}

function pmInlineToMdast(content: PMNode[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const n of content) {
    if (n.type === 'hardBreak') {
      out.push({ type: 'break' });
      continue;
    }
    if (n.type === 'inlineOpaque') {
      out.push(JSON.parse(String(n.attrs?.mdast)) as PhrasingContent);
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    let node: PhrasingContent = markOfType(n.marks, 'code')
      ? { type: 'inlineCode', value: n.text }
      : { type: 'text', value: n.text };
    if (markOfType(n.marks, 'strike')) node = { type: 'delete', children: [node] };
    if (markOfType(n.marks, 'italic')) node = { type: 'emphasis', children: [node] };
    if (markOfType(n.marks, 'bold')) node = { type: 'strong', children: [node] };
    const link = markOfType(n.marks, 'link');
    if (link) {
      node = {
        type: 'link',
        url: String(link.attrs?.href ?? ''),
        title: link.attrs?.title != null ? String(link.attrs.title) : null,
        children: [node],
      };
    }
    out.push(node);
  }
  return out;
}

function pmBlockToMdast(n: PMNode): RootContent {
  switch (n.type) {
    case 'paragraph': {
      const content = n.content ?? [];
      if (content.length === 1 && content[0].type === 'inlineOpaque' && content[0].attrs?.block) {
        return JSON.parse(String(content[0].attrs.mdast)) as RootContent;
      }
      return { type: 'paragraph', children: pmInlineToMdast(content) };
    }
    case 'heading':
      return {
        type: 'heading',
        depth: Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6,
        children: pmInlineToMdast(n.content ?? []),
      };
    case 'blockquote':
      return { type: 'blockquote', children: (n.content ?? []).map(pmBlockToMdast) as BlockContent[] };
    case 'bulletList':
    case 'orderedList':
      return {
        type: 'list',
        ordered: n.type === 'orderedList',
        ...(n.type === 'orderedList' ? { start: Number(n.attrs?.start ?? 1) } : {}),
        spread: false,
        children: (n.content ?? []).map(
          (li): ListItem => ({
            type: 'listItem',
            spread: false,
            children: (li.content ?? []).map(pmBlockToMdast) as BlockContent[],
          }),
        ),
      };
    case 'codeBlock': {
      const value = (n.content ?? []).map((c) => c.text ?? '').join('');
      const language = n.attrs?.language ? String(n.attrs.language) : null;
      return { type: 'code', lang: language, value };
    }
    case 'horizontalRule':
      return { type: 'thematicBreak' };
    default:
      return { type: 'paragraph', children: pmInlineToMdast(n.content ?? []) };
  }
}

/* ------------------------------------------------------------------ */
/* Tiptap JSON → PostDoc (order-preserving match against the original)  */
/* ------------------------------------------------------------------ */

const PM_EDITABLE_KIND: Record<string, EditableKind> = {
  paragraph: 'paragraph',
  heading: 'heading',
  blockquote: 'blockquote',
  bulletList: 'list',
  orderedList: 'list',
};

/** Canonical form used ONLY for untouched-detection. Spread and soft line
 *  wraps are normalized so a block that merely round-tripped through PM
 *  (which sees wraps as spaces) doesn't read as edited. */
function canonicalize(node: RootContent): string {
  const clone = stripPositions(node) as RootContent & { spread?: boolean };
  const normalize = (n: { type?: string; spread?: boolean; value?: string; children?: unknown[] }) => {
    if (n.type === 'list' || n.type === 'listItem') n.spread = false;
    if (n.type === 'text' && typeof n.value === 'string') n.value = n.value.replace(/\n/g, ' ');
    for (const child of n.children ?? []) normalize(child as { type?: string });
  };
  normalize(clone);
  try {
    return stringifyBlockMdast(clone);
  } catch {
    return `\u0000unstringifiable:${JSON.stringify(clone)}`;
  }
}

const STACK_PM = new Set(['stackRow', 'stackColumn']);

/** The PostDoc attrs a PM stack node carries. */
function pmStackAttrs(pm: PMNode): StackAttrs {
  const a = pm.attrs ?? {};
  const out: StackAttrs = {};
  if (pm.type === 'stackRow' && a.ratio && a.ratio !== '1:1') out.ratio = a.ratio as StackAttrs['ratio'];
  if (a.width && a.width !== 'reading') out.width = a.width as StackAttrs['width'];
  if (a.cls) out.class = String(a.cls);
  if (a.text) out.text = String(a.text);
  return out;
}

const sameAttrs = (a: StackAttrs, b: StackAttrs) =>
  (a.ratio ?? '1:1') === (b.ratio ?? '1:1') && (a.width ?? 'reading') === (b.width ?? 'reading')
  && (a.class ?? '') === (b.class ?? '') && (a.text ?? '') === (b.text ?? '');

const pmSlots = (pm: PMNode): PMNode[][] =>
  pm.type === 'stackRow' ? (pm.content ?? []).map(slot => slot.content ?? []) : [pm.content ?? []];

function freshBlock(pm: PMNode): PostBlock {
  if (STACK_PM.has(pm.type)) {
    return {
      kind: 'stack',
      name: String(pm.attrs?.name ?? 'Stack'),
      direction: pm.type === 'stackRow' ? 'row' : 'column',
      attrs: pmStackAttrs(pm),
      slots: pmSlots(pm).map(slot => matchBlocks(slot, [], true)),
      head: '', between: '', tail: '',
      dirty: true,
      gapBefore: '\n\n',
    };
  }
  if (pm.type === 'passthrough') {
    return {
      kind: 'passthrough',
      source: String(pm.attrs?.source ?? ''),
      nodeType: String(pm.attrs?.nodeType ?? 'html'),
      gapBefore: '\n\n',
    };
  }
  if (pm.type === 'astroComponent') {
    return {
      kind: 'component',
      name: String(pm.attrs?.name ?? ''),
      source: String(pm.attrs?.source ?? ''),
      span: pm.attrs?.span == null ? null : pm.attrs.span === 'full' ? 'full' : Number(pm.attrs.span),
      raw: '',
      dirty: true,
      gapBefore: '\n\n',
    };
  }
  const mdast = pmBlockToMdast(pm);
  const kind = PM_EDITABLE_KIND[pm.type];
  if (kind) return { kind, mdast, source: '', dirty: true, gapBefore: '\n\n' };
  // codeBlock / horizontalRule typed in the editor → passthrough on disk
  return {
    kind: 'passthrough',
    source: stringifyBlockMdast(mdast),
    nodeType: mdast.type,
    gapBefore: '\n\n',
  };
}

// original block lists are immutable between component inserts — cache their
// canonical forms across flushes (currentDoc runs on every debounce tick).
const CANONICAL_CACHE = new WeakMap<PostBlock[], Map<number, string>>();

/** How many PM nodes of `pm` find an order-preserving match in `orig` (cheap probe for slot swaps). */
function matchCount(pm: PMNode[], orig: PostBlock[]): number {
  return matchBlocks(pm, orig, true, true).length;
}

/**
 * Tiptap nodes → PostDoc blocks, order-preserving match against the original
 * sibling list: an untouched node reuses its original block (verbatim bytes +
 * gap). Recursive for stacks: a PM stack matches the next original stack of
 * the same direction; its children match inside it.
 *
 * `inSlot` = the list sits right after an open tag, so a fresh first child
 * needs a blank line (top level: nothing).
 * `countOnly` = return only the matched blocks (matchCount's probe).
 */
function matchBlocks(content: PMNode[], orig: PostBlock[], inSlot: boolean, countOnly = false): PostBlock[] {
  let origCanonical = CANONICAL_CACHE.get(orig);
  if (!origCanonical) {
    origCanonical = new Map<number, string>();
    CANONICAL_CACHE.set(orig, origCanonical);
  }
  const canonicalOf = (k: number): string => {
    let c = origCanonical!.get(k);
    if (c === undefined) {
      const block = orig[k];
      c = 'mdast' in block ? canonicalize(block.mdast) : '';
      origCanonical!.set(k, c);
    }
    return c;
  };

  const blocks: PostBlock[] = [];
  const matchedIndex: number[] = [];
  let j = 0;

  for (const pm of content) {
    // Markdown cannot represent an empty paragraph at ANY position — they are
    // pure editor affordance (StarterKit's trailing node after a last atom, a
    // just-pressed Enter, an empty slot's placeholder) and serialized as stray
    // blank lines. Never disable trailingNode instead: a doc ending in an atom
    // would strand the caret.
    if (pm.type === 'paragraph' && !pm.content?.length) continue;
    // Same for a Custom code box nothing was typed into yet (`/` just made it).
    if (pm.type === 'passthrough' && isRawElement(pm.attrs?.nodeType) && !String(pm.attrs?.source ?? '').trim()) continue;
    const kind = PM_EDITABLE_KIND[pm.type];
    const pmCanonical = kind ? canonicalize(pmBlockToMdast(pm)) : null;
    let matched = -1;
    for (let k = j; k < orig.length; k++) {
      const o = orig[k];
      if (pm.type === 'passthrough' && o.kind === 'passthrough') {
        if (String(pm.attrs?.source ?? '') === o.source) { matched = k; break; }
      } else if (pm.type === 'astroComponent' && o.kind === 'component') {
        const span = pm.attrs?.span == null ? null : pm.attrs.span === 'full' ? 'full' as const : Number(pm.attrs.span);
        if (String(pm.attrs?.source ?? '') === o.source && span === o.span) { matched = k; break; }
      } else if (STACK_PM.has(pm.type) && o.kind === 'stack') {
        if (o.direction === (pm.type === 'stackRow' ? 'row' : 'column')) { matched = k; break; }
      } else if (kind && o.kind === kind) {
        if (pmCanonical === canonicalOf(k)) { matched = k; break; }
      }
    }
    if (matched >= 0) {
      const o = orig[matched];
      blocks.push(o.kind === 'stack' && !countOnly ? matchStack(pm, o) : { ...o });
      matchedIndex.push(matched);
      j = matched + 1;
    } else if (!countOnly) {
      blocks.push(freshBlock(pm));
      matchedIndex.push(-1);
    }
  }
  if (countOnly) return blocks;

  // Gap policy: untouched neighbors keep their original gap byte-for-byte; any
  // new/edited boundary gets the canonical separator (blank line; single \n
  // between consecutive ESM blocks).
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) {
      if (matchedIndex[0] !== 0) blocks[0] = { ...blocks[0], gapBefore: inSlot ? '\n\n' : '' };
      continue;
    }
    if (matchedIndex[i] >= 0 && matchedIndex[i - 1] >= 0) continue; // original gap kept
    const gap = isEsmBlock(blocks[i]) && isEsmBlock(blocks[i - 1]) ? '\n' : '\n\n';
    blocks[i] = { ...blocks[i], gapBefore: gap };
  }
  return blocks;
}

/** A PM stack matched to an original stack: reuse the verbatim frame unless it changed. */
function matchStack(pm: PMNode, o: StackBlock): StackBlock {
  const attrs = pmStackAttrs(pm);
  const pmKids = pmSlots(pm);
  let origSlots = o.slots;
  let swapped = false;
  if (o.direction === 'row' && pmKids.length === 2) {
    const straight = matchCount(pmKids[0], o.slots[0]) + matchCount(pmKids[1], o.slots[1]);
    // every node already matched in place (the typing case) → no swap to probe
    if (straight < pmKids[0].length + pmKids[1].length) {
      const crossed = matchCount(pmKids[0], o.slots[1]) + matchCount(pmKids[1], o.slots[0]);
      if (crossed > straight) { origSlots = [o.slots[1], o.slots[0]]; swapped = true; }
    }
  }
  const slots = pmKids.map((kids, i) => matchBlocks(kids, origSlots[i] ?? [], true));
  // A slot turning empty ↔ filled changes where the verbatim frame's blank
  // lines sit — regenerate rather than risk `text\n</div>` (not valid MDX).
  const emptiness = slots.some((sl, i) => (sl.length === 0) !== ((origSlots[i] ?? []).length === 0));
  const name = String(pm.attrs?.name ?? o.name);
  const dirty = o.dirty || swapped || emptiness || name !== o.name || !sameAttrs(attrs, o.attrs);
  return { ...o, name, attrs, slots, dirty };
}

export function tiptapToPostDoc(json: PMNode, original: PostDoc): PostDoc {
  const blocks = matchBlocks(json.content ?? [], original.blocks, false);

  // A body that was empty on open has no trailing newline to preserve; give
  // typed content a conventional EOF newline.
  const trailing =
    original.blocks.length === 0 && original.trailing === '' && blocks.length > 0
      ? '\n'
      : original.trailing;

  return {
    blocks,
    eol: original.eol,
    trailing,
  };
}
