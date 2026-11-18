/**
 * What a component chip DRAWS, and where its upload tiles point.
 *
 * The bug (owner, 2026-08-11: "I upload a photo in the content tab and nothing
 * happens, I keep seeing a placeholder"): the node view drew clickable upload
 * tiles whenever the fetched HTML carried no <img> — which is also the state
 * for a preview that is PENDING, FAILED, or index-desynced. So a
 * <DoubleImage src1 src2 /> that renders two real photos on the page was
 * covered by an empty upload tile, and the click wrote a dead `items=` prop the
 * component never reads.
 *
 * The laws these tests pin:
 *  1. a tile is drawn for slot i ONLY when the component's own source says slot
 *     i is empty — missing HTML is a neutral pending state, never "empty";
 *  2. a render that ACCOUNTS FOR the model wins over the model: the component's
 *     own grid/caption/aspect is the truth about how it looks;
 *  3. the slot model comes from componentMedia and nowhere else, so the tile the
 *     user clicks and the attribute the writer rewrites are the same slot;
 *  4. an <img> is only ever emitted for a src this page can actually load.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Editor } from '@tiptap/core';
import { parsePostBody } from '@/postmodel/postModel';
import { editMediaItem, readMediaSlots } from '../../componentMedia';
import { urlMediaSource } from '../../mediaResolver';
import { postDocToTiptap, postEditorExtensions, componentStorage } from '../schema';

const ORIGIN = 'http://localhost:4399';

function mount(body: string) {
  const original = parsePostBody(body);
  return new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
}

/** Previews are keyed by NODE, exactly as PostBodyEditor keys them. */
function setPreview(editor: Editor, pos: number, html: string) {
  const storage = componentStorage(editor);
  storage.previewFor.set(editor.state.doc.nodeAt(pos)!, html);
  storage.views.forEach(render => render());
}

const tiles = (dom: HTMLElement) => dom.querySelectorAll('.sq-media-placeholder-tile');
const stateOf = (dom: HTMLElement) =>
  Array.from(dom.querySelectorAll('[data-sq-slot-state]')).map(el =>
    el.getAttribute('data-sq-slot-state'),
  );
const chips = (dom: HTMLElement) => dom.querySelectorAll('.sq-slot-chip');
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('no fake tiles when the preview is missing', () => {
  it('a fully-filled component with NO preview yet draws zero upload tiles', () => {
    const editor = mount('<DoubleImage src1="/a.png" src2="/b.png" caption="" />\n\nProse.');
    try {
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      // nothing in previewFor — this is the pending/failed/unmatched state
      expect(tiles(dom)).toHaveLength(0);
      expect(stateOf(dom)).toEqual(['filled', 'filled']);
    } finally {
      editor.destroy();
    }
  });

  it('an unknown origin renders a neutral pending slot that is NOT clickable', () => {
    const editor = mount('<DoubleImage src1="/a.png" src2="/b.png" caption="" />\n\nProse.');
    try {
      const storage = componentStorage(editor);
      const ups: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      // no origin ⇒ a root-relative src cannot be resolved from the editor
      expect(dom.querySelectorAll('img')).toHaveLength(0);
      dom
        .querySelector('[data-sq-slot-state="filled"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(ups).toEqual([]);
    } finally {
      editor.destroy();
    }
  });
});

/**
 * C2 (2026-08-12 review): the preview source existed on the storage but NOTHING
 * assigned it, so every root-relative source resolved to null and a real photo
 * was permanently replaced by the inert "Loading preview…" frame. PostBodyEditor
 * now sets it; this pins the node view's half of that contract. (The field is
 * `storage.media` since the WC byte resolver landed — same contract, and URL
 * resolution is what local and server mode still do.)
 */
describe('the preview origin resolves root-relative sources', () => {
  it('renders the uploaded photo once the origin is known', () => {
    const editor = mount('<Media items={["/uploads/p.png"]} class="col-span-8" />\n\nProse.');
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN);
      componentStorage(editor).views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/uploads/p.png`);
    } finally {
      editor.destroy();
    }
  });
});

/**
 * C4 (2026-08-12 review): the model row REPLACED the real render for as long as
 * any slot was empty, so a user component lost its own grid, caption and aspect
 * ratio — a worse lie than the one being fixed. The render wins; the model only
 * says WHERE a tile still has to be offered.
 */
describe('the real render wins when it accounts for the model', () => {
  it('html with an img per filled slot renders verbatim', () => {
    const editor = mount('<DoubleImage src1="/a.png" src2="/b.png" caption="" />\n\nProse.');
    try {
      setPreview(
        editor,
        0,
        `<figure class="double-image"><img src="${ORIGIN}/a.png"><img src="${ORIGIN}/b.png"><figcaption>Notes.</figcaption></figure>`,
      );
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('figure.double-image')).not.toBeNull();
      expect(dom.querySelectorAll('img')).toHaveLength(2);
      expect(tiles(dom)).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });

  it('a HALF-filled component keeps its own markup AND still offers the empty slot', () => {
    const editor = mount('<DoubleImage src1="/a.png" src2="" caption="Notes." />\n\nProse.');
    try {
      const ups: unknown[] = [];
      componentStorage(editor).onSlotUpload = p => ups.push(p);
      // The component's real render: its grid, its caption, its aspect.
      setPreview(
        editor,
        0,
        `<figure class="double-image"><div class="double-image__grid"><img src="${ORIGIN}/a.png"><img src=""></div><figcaption>Notes.</figcaption></figure>`,
      );
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('figure.double-image')).not.toBeNull();
      expect(dom.querySelector('figcaption')?.textContent).toBe('Notes.');
      // …and the empty slot is still fillable, pointed at ITS index.
      expect(tiles(dom)).toHaveLength(1);
      tiles(dom)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(ups).toEqual([{ pos: 0, index: 1 }]);
    } finally {
      editor.destroy();
    }
  });

  it('a non-media component always renders its html', () => {
    const editor = mount('<CreditWrapper title="Team">\n  <Credit name="x" />\n</CreditWrapper>\n\nProse.');
    try {
      setPreview(editor, 0, '<section class="credit-wrapper"><h4>Team</h4></section>');
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('section.credit-wrapper')).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });
});

describe('optimistic render while the HTML is stale', () => {
  it('a model src with a stale (media-less) preview renders the src itself', () => {
    const editor = mount('<Media items={["/uploads/p.png"]} class="col-span-8" />\n\nProse.');
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN);
      // the previous render of the same component — before the upload landed
      setPreview(editor, 0, '<div class="sq-media"></div>');
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/uploads/p.png`);
      expect(tiles(dom)).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });

  it('a stale render whose slot MARKER is still the placeholder does not win', () => {
    // The exact "nothing happened" frame: Media re-renders its placeholder
    // <button data-sq-media-slot="0"> until Astro catches up. A marker is not
    // media, so the model (which has the upload) wins.
    const editor = mount('<Media items={["/uploads/p.png"]} class="col-span-8" />\n\nProse.');
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN);
      setPreview(
        editor,
        0,
        '<div class="sq-media"><button data-sq-media-slot="0" class="sq-media-placeholder"></button></div>',
      );
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/uploads/p.png`);
      expect(tiles(dom)).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });

  it('an absolute model src needs no origin', () => {
    const editor = mount('<SingleImage src="https://cdn.example.com/p.png" />\n\nProse.');
    try {
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/p.png');
    } finally {
      editor.destroy();
    }
  });
});

/**
 * C5 (2026-08-12 review): `./images/timepad/hero.png` was passed through into
 * an <img src> on the EDITOR page. Astro resolves those through its asset
 * pipeline into a hashed /@fs/… URL — no origin prefix can fetch the written
 * path, so the chip showed a broken image. Real content: every media path in
 * Timepad-Redesign.mdx is written this way.
 */
describe('a src the editor cannot fetch never becomes an <img>', () => {
  it('an Astro-pipeline relative path takes the neutral pending frame', () => {
    const editor = mount('<SingleImage src="./images/timepad/hero.png" alt="x" />\n\nProse.');
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN); // even WITH an origin
      componentStorage(editor).views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelectorAll('img')).toHaveLength(0);
      expect(stateOf(dom)).toEqual(['filled']); // filled, not an upload tile
      expect(tiles(dom)).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });
});

/**
 * F1 (2026-08-12 review) — the render was DISCARDED for components whose media
 * elements are fewer than their filled slots.
 *
 * Coverage was a naive count: `mediaElements >= filledSlots`. One rendered
 * element routinely carries TWO filled slots —
 * fixtures/local-astro-project/src/components/SingleVideo.astro is literally
 * `<video src={src} poster={poster}/>` for a model of [src, poster] — so the
 * check said "this render does not account for the model", threw the real
 * markup away and replaced the component with model tiles. Permanently: the
 * next render says exactly the same thing. Same class for an <img> used as both
 * slots, or a <picture>/<source> set collapsed into one element.
 *
 * The law now: a render with media in it is the component's own output and
 * always wins; empty slots are offered alongside it, never instead of it.
 */
describe('one rendered element may carry two filled slots', () => {
  const VIDEO = '<SingleVideo src="/v.mp4" poster="/p.png" />';
  const VIDEO_HTML =
    '<video class="single-video" src="/v.mp4" poster="/p.png" controls muted playsinline></video>';

  it('the model really does have two slots for one element', () => {
    // If this ever stops being true the test below stops testing anything.
    expect(readMediaSlots(VIDEO)?.names).toEqual(['src', 'poster']);
    expect(readMediaSlots(VIDEO)?.slots).toEqual(['/v.mp4', '/p.png']);
  });

  it('keeps the real <video> instead of replacing it with model tiles', () => {
    const editor = mount(`${VIDEO}\n\nProse.`);
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN);
      setPreview(editor, 0, VIDEO_HTML);
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      // Before the fix: 1 media element < 2 filled slots ⇒ "not covered" ⇒ the
      // component was drawn as a row of model tiles and its poster, controls
      // and class were gone.
      expect(dom.querySelector('video.single-video')).not.toBeNull();
      expect(dom.querySelector('video')?.getAttribute('poster')).toBe('/p.png');
      expect(dom.querySelector('.sq-media-placeholder')).toBeNull();
      expect(tiles(dom)).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });

  it('a render with media is never discarded, however few elements it has', () => {
    // A three-slot component that collapsed its images into one <picture>.
    const editor = mount('<Trio src1="/a.png" src2="/b.png" src3="/c.png" />\n\nProse.');
    try {
      setPreview(editor, 0, '<picture class="trio"><img src="/a.png"></picture>');
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('picture.trio')).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it('but a render with NO media still loses to a filled model (optimistic path)', () => {
    // The half of the old rule that was right: nothing rendered yet, model says
    // there is a photo ⇒ show the photo.
    const editor = mount('<SingleImage src="/uploads/p.png" />\n\nProse.');
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN);
      setPreview(editor, 0, '<figure class="single-image"></figure>');
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/uploads/p.png`);
    } finally {
      editor.destroy();
    }
  });
});

/**
 * F4 (2026-08-12 review) — a filled slot on a marker-less component was a DEAD
 * END. The hover bin and the click-to-replace hang off `data-sq-media-slot`,
 * which only the system Media component emits, so on the owner's own
 * DoubleImage the editor could fill an empty slot and then never change or
 * clear it again.
 *
 * The affordance is anchored to the MODEL index — the same index the writer
 * uses. It is deliberately NOT paired to a position inside the render: which
 * <img> of a user component belongs to which prop is unpublished, and
 * `<V src poster/>` vs `<V poster src/>` order their slots differently while
 * rendering the same two elements, so a positional bin would delete the other
 * photo.
 */
describe('a filled slot is editable on components that publish no markers', () => {
  const DOUBLE = '<DoubleImage src1="/a.png" src2="/b.png" caption="Notes." />';
  const DOUBLE_HTML =
    '<figure class="double-image"><div class="double-image__grid">' +
    '<img src="/a.png"><img src="/b.png"></div><figcaption>Notes.</figcaption></figure>';

  it('offers replace + remove per filled slot, beside the real render', () => {
    const editor = mount(`${DOUBLE}\n\nProse.`);
    try {
      const storage = componentStorage(editor);
      const ups: unknown[] = [];
      const dels: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      storage.onSlotDelete = p => dels.push(p);
      setPreview(editor, 0, DOUBLE_HTML);
      const dom = editor.view.nodeDOM(0) as HTMLElement;

      // The render is untouched — the controls are offered next to it.
      expect(dom.querySelector('figure.double-image')).not.toBeNull();
      expect(dom.querySelectorAll('figure img')).toHaveLength(2);
      expect(chips(dom)).toHaveLength(2);

      click(chips(dom)[1].querySelector('.sq-slot-chip__replace')!);
      click(chips(dom)[1].querySelector('.sq-slot-chip__remove')!);
      expect(ups).toEqual([{ pos: 0, index: 1 }]);
      expect(dels).toEqual([{ pos: 0, index: 1 }]);
    } finally {
      editor.destroy();
    }
  });

  it('names the file in each slot so the user can tell them apart', () => {
    const editor = mount(`${DOUBLE}\n\nProse.`);
    try {
      setPreview(editor, 0, DOUBLE_HTML);
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(Array.from(dom.querySelectorAll('.sq-slot-chip__name')).map(el => el.textContent))
        .toEqual(['a.png', 'b.png']);
    } finally {
      editor.destroy();
    }
  });

  it('covers the two-slots-one-element case as well', () => {
    const editor = mount('<SingleVideo src="/v.mp4" poster="/p.png" />\n\nProse.');
    try {
      const dels: unknown[] = [];
      componentStorage(editor).onSlotDelete = p => dels.push(p);
      setPreview(editor, 0, '<video class="single-video" src="/v.mp4" poster="/p.png"></video>');
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(chips(dom)).toHaveLength(2);
      click(chips(dom)[1].querySelector('.sq-slot-chip__remove')!);
      expect(dels).toEqual([{ pos: 0, index: 1 }]); // the poster, per the MODEL
    } finally {
      editor.destroy();
    }
  });

  it('adds no chips where the render already publishes its slots', () => {
    const editor = mount('<Media items={["/a.png", "/b.png"]} />\n\nProse.');
    try {
      setPreview(
        editor,
        0,
        '<div class="sq-media"><img src="/a.png" data-sq-media-slot="0">' +
          '<img src="/b.png" data-sq-media-slot="1"></div>',
      );
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(chips(dom)).toHaveLength(0);
      expect(dom.querySelectorAll('.sq-slot-bin')).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  });

  it('a filled slot in the OPTIMISTIC render is replaceable and removable too', () => {
    const editor = mount('<Media items={["/uploads/p.png"]} class="col-span-8" />\n\nProse.');
    try {
      const storage = componentStorage(editor);
      const ups: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      storage.media = urlMediaSource(ORIGIN);
      storage.views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelectorAll('.sq-slot-bin')).toHaveLength(1);
      click(dom.querySelector('img')!);
      expect(ups).toEqual([{ pos: 0, index: 0 }]);
    } finally {
      editor.destroy();
    }
  });
});

/**
 * F4, second half: when a render marker disagrees with the model, the MODEL
 * wins. A stale render can carry markers for slots the invocation no longer
 * has, and wiring a writer to one is a wrong-slot write:
 * `editMediaItem('<Media items={["/a.png"]}/>', 1, null)` PADS the array back
 * to two entries, so binning a ghost slot resurrects it.
 */
describe('a render marker outside the model gets no affordance', () => {
  it('ignores markers past the model’s last slot', () => {
    const editor = mount('<Media items={["/a.png"]} />\n\nProse.');
    try {
      const storage = componentStorage(editor);
      const dels: unknown[] = [];
      storage.onSlotDelete = p => dels.push(p);
      // The page still renders the PREVIOUS, two-image version.
      setPreview(
        editor,
        0,
        '<div class="sq-media"><img src="/a.png" data-sq-media-slot="0">' +
          '<img src="/b.png" data-sq-media-slot="1"></div>',
      );
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelectorAll('.sq-slot-bin')).toHaveLength(1);
      click(dom.querySelector('.sq-slot-bin')!);
      expect(dels).toEqual([{ pos: 0, index: 0 }]);
      // …and the ghost gets no writer of its own.
      expect(editMediaItem('<Media items={["/a.png"]} />', 1, null)).toBe(
        '<Media items={["/a.png", null]} />',
      );
    } finally {
      editor.destroy();
    }
  });
});

/**
 * F5 (2026-08-12 review): this file carried a raw 0x00 byte inside the
 * `canonicalize` fallback separator, which makes grep/ripgrep treat the whole
 * module — the one carrying most of the media fix — as binary and skip it. The
 * separator semantics are identical as an escape; the byte is not.
 */
describe('the module stays greppable', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'schema.ts'), 'utf8');

  it('contains no raw NUL byte', () => {
    expect(SOURCE.includes('\u0000')).toBe(false);
  });

  it('keeps the NUL separator, written as an escape', () => {
    expect(SOURCE).toContain('`\\u0000unstringifiable:');
  });
});

describe('slot count comes from the model', () => {
  it('a 2-slot component with one empty slot draws exactly one tile, in place', () => {
    const editor = mount('<DoubleImage src1="/a.png" src2="" caption="" />\n\nProse.');
    try {
      const storage = componentStorage(editor);
      storage.media = urlMediaSource(ORIGIN);
      const ups: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      storage.views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(stateOf(dom)).toEqual(['filled', 'empty']);
      expect(tiles(dom)).toHaveLength(1);
      tiles(dom)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(ups).toEqual([{ pos: 0, index: 1 }]); // the EMPTY slot's own index
    } finally {
      editor.destroy();
    }
  });
});

/**
 * C1 (2026-08-12 review) — DATA LOSS. This file used to carry its own slot
 * parser, which mapped a numbered prop's NUMBER to the slot index and allowed
 * gaps, while componentMedia (the writer) compacts by family appearance. For
 * `<Trio src1 src3/>` the UI drew three tiles [a, EMPTY, c] and the writer's
 * names were [src1, src3] — clicking the empty middle tile called
 * editMediaItem(1), which is src3, and OVERWROTE the third image.
 *
 * `oldSchemaSlots` below is that deleted parser, verbatim in its behaviour, so
 * the divergence stays visible rather than remembered.
 */
describe('one slot model: the tile clicked is the attribute written', () => {
  const TRIO = '<Trio src1="/a.png" src3="/c.png" />';

  /** The deleted schema-local parser: number → index, gaps allowed. */
  function oldSchemaSlots(source: string): (string | null)[] {
    const byIndex = new Map<number, string>();
    for (const m of source.matchAll(/(?<![-\w])(src[1-9]?|poster)\s*=\s*"([^"]*)"/g)) {
      const [, name, value] = m;
      if (name === 'poster') continue;
      byIndex.set(name === 'src' ? 0 : Number(name.slice(3)) - 1, value);
    }
    const count = Math.max(...byIndex.keys()) + 1;
    return Array.from({ length: count }, (_, i) => byIndex.get(i) ?? null);
  }

  it('the OLD pairing offered a tile whose write destroyed a DIFFERENT image', () => {
    const drawn = oldSchemaSlots(TRIO);
    expect(drawn).toEqual(['/a.png', null, '/c.png']); // 3 tiles, middle empty
    const emptyTile = drawn.indexOf(null); // === 1, what the click reported
    // …and slot 1 of the writer is src3, i.e. the third image.
    expect(editMediaItem(TRIO, emptyTile, '/new.png')).toBe(
      '<Trio src1="/a.png" src3="/new.png" />',
    );
  });

  it('the chip now draws exactly the slots the writer can address', () => {
    const editor = mount(`${TRIO}\n\nProse.`);
    try {
      const storage = componentStorage(editor);
      storage.media = urlMediaSource(ORIGIN);
      storage.views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(stateOf(dom)).toEqual(['filled', 'filled']);
      expect(tiles(dom)).toHaveLength(0); // no tile that would destroy /c.png
      // Reader and writer agree, slot for slot.
      expect(readMediaSlots(TRIO)).toEqual({
        shape: 'named',
        slots: ['/a.png', '/c.png'],
        names: ['src1', 'src3'],
        countEditable: false,
      });
    } finally {
      editor.destroy();
    }
  });

  it('poster and src stay in ONE order for the tiles and the writer', () => {
    // The old parser skipped poster entirely, so slot 0 drew the video while
    // the writer's slot 0 was `poster` — the user pointed at one, the write
    // landed on the other.
    const video = '<V poster="/p.png" src="/v.mp4" />';
    expect(oldSchemaSlots(video)).toEqual(['/v.mp4']);
    expect(readMediaSlots(video)?.names).toEqual(['poster', 'src']);
    const editor = mount(`${video}\n\nProse.`);
    try {
      componentStorage(editor).media = urlMediaSource(ORIGIN);
      componentStorage(editor).views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      // Two slots drawn, in the writer's order: poster (img), then the video.
      expect(stateOf(dom)).toEqual(['filled', 'filled']);
      expect(dom.querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/p.png`);
      expect(dom.querySelector('video')?.getAttribute('src')).toBe(`${ORIGIN}/v.mp4`);
    } finally {
      editor.destroy();
    }
  });
});

// Audit 2026-09-30: tiles were click-only divs; the pending frame said nothing visible.
describe('slot controls are real controls', () => {
  it('an empty tile is a native button (keyboard + focus for free) that uploads on activation', () => {
    const editor = mount('<Media items={[null]} />\n\nProse.');
    try {
      const storage = componentStorage(editor);
      const ups: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      const tile = tiles(editor.view.nodeDOM(0) as HTMLElement)[0] as HTMLElement;
      expect(tile.tagName).toBe('BUTTON');
      expect((tile as HTMLButtonElement).type).toBe('button');
      click(tile);
      expect(ups).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
  it('a filled slot this page cannot load yet says "Loading preview…" in text, no inline style', () => {
    // Media publishes slot markers, so its filled-but-unloadable slot takes the pending frame
    const editor = mount('<Media items={["./x.png"]} />\n\nProse.');
    try {
      const pending = (editor.view.nodeDOM(0) as HTMLElement).querySelector('.sq-media-pending') as HTMLElement | null;
      expect(pending?.textContent).toContain('Loading preview…');
      expect(pending?.getAttribute('style')).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});
