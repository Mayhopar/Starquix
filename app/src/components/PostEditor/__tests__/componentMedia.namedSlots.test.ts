/**
 * Regression: "when i upload photo in content tab in media component nothing
 * happens, i keep seeing a placeholder" (owner, 2026-08-11).
 *
 * The writer injected a brand-new `items={[…]}` onto components that declare
 * NAMED media props (DoubleImage's src1/src2, SingleImage's src). The .mdx
 * changed on disk, the component never read `items`, so the render was
 * byte-identical and the placeholder was permanent.
 *
 * The model now reads the shape from the invocation: array (`items`) or named
 * attributes, and refuses (null) when neither is recognizable — parse and write
 * come from the SAME read, so a tile the writer cannot fill never opens.
 */
import { describe, it, expect } from 'vitest';
import {
  displayMediaSlots,
  editMediaItem,
  isMediaComponent,
  isMediaPropName,
  mediaWriteBlock,
  parseMediaItems,
  previewUrlFor,
  readMediaSlots,
  setMediaItemCount,
} from '../componentMedia';

describe('named media props (src / src1..3 / poster)', () => {
  const double = '<DoubleImage src1="./a.png" src2="./b.png" alt={["one", "two"]} class="col-span-8" />';

  it('writes the NAMED attribute and never invents an items array', () => {
    expect(editMediaItem(double, 1, '/uploads/new.png')).toBe(
      '<DoubleImage src1="./a.png" src2="/uploads/new.png" alt={["one", "two"]} class="col-span-8" />',
    );
  });

  it('slot 0 is src1 when the numbered family exists', () => {
    expect(editMediaItem(double, 0, '/uploads/new.png')).toBe(
      '<DoubleImage src1="/uploads/new.png" src2="./b.png" alt={["one", "two"]} class="col-span-8" />',
    );
  });

  it('the OWNER-REPORTED invocation, verbatim from the fixture post', () => {
    // fixtures/local-astro-project/src/content/works/untitled-1786224810096.mdx
    // — DoubleImage.astro destructures { src1, src2, alt1, alt2, caption } and
    // renders <img src={resolveAsset(src1)} />: an items array is DEAD there.
    const src =
      '<DoubleImage src1="/uploads/55445954468_822ed2e16a_k-1.jpg" src2="./images/misc/blank.png" caption="" />';
    expect(readMediaSlots(src)?.slots).toEqual([
      '/uploads/55445954468_822ed2e16a_k-1.jpg',
      './images/misc/blank.png',
    ]);
    expect(editMediaItem(src, 1, '/uploads/test-photo.png')).toBe(
      '<DoubleImage src1="/uploads/55445954468_822ed2e16a_k-1.jpg" src2="/uploads/test-photo.png" caption="" />',
    );
  });

  it('orders the family by its NUMBER, not by source order', () => {
    const src = '<DoubleImage src2="./b.png" src1="./a.png" />';
    expect(readMediaSlots(src)).toEqual({
      shape: 'named',
      slots: ['./a.png', './b.png'],
      names: ['src1', 'src2'],
      countEditable: false,
    });
    expect(editMediaItem(src, 0, '/x.png')).toBe('<DoubleImage src2="./b.png" src1="/x.png" />');
  });

  it('a lone src is slot 0', () => {
    expect(editMediaItem('<SingleImage src="./x.png" alt="a" />', 0, '/y.png')).toBe(
      '<SingleImage src="/y.png" alt="a" />',
    );
  });

  it('poster is its own slot, after src', () => {
    const video = '<SingleVideo src="./t.mp4" poster="./p.png" />';
    expect(readMediaSlots(video)?.names).toEqual(['src', 'poster']);
    expect(editMediaItem(video, 1, '/p2.png')).toBe('<SingleVideo src="./t.mp4" poster="/p2.png" />');
  });

  it('exposes the slot COUNT and the per-slot src the tiles need', () => {
    // Before: parseMediaItems returned [] here, so a 2-slot component drew ONE
    // tile whose upload wrote a dead items array.
    expect(parseMediaItems(double)).toEqual(['./a.png', './b.png']);
    expect(readMediaSlots(double)?.countEditable).toBe(false);
  });

  it('reports an unset named slot as empty, and clearing keeps the slot', () => {
    const emptied = editMediaItem(double, 1, null);
    expect(emptied).toBe(
      '<DoubleImage src1="./a.png" src2="" alt={["one", "two"]} class="col-span-8" />',
    );
    // The attribute survives, so the tile stays and can be re-filled.
    expect(parseMediaItems(emptied!)).toEqual(['./a.png', null]);
  });

  it('refuses an index past the declared slots rather than inventing src3', () => {
    expect(editMediaItem(double, 2, '/c.png')).toBeNull();
  });

  it('refuses when a media attribute is an expression', () => {
    const src = '<SingleImage src={cover} alt="a" />';
    expect(readMediaSlots(src)).toBeNull();
    expect(parseMediaItems(src)).toBeNull();
    expect(editMediaItem(src, 0, '/x.png')).toBeNull();
  });

  it('refuses a path holding a quote instead of emitting broken markup', () => {
    expect(editMediaItem(double, 0, '/up/a"b.png')).toBeNull();
  });

  it('never reads or rewrites a CHILD component attribute', () => {
    const nested = '<CreditWrapper title="Team">\n  <Credit src="./c.png" name="y" />\n</CreditWrapper>';
    expect(readMediaSlots(nested)).toBeNull();
    expect(editMediaItem(nested, 0, '/x.png')).toBeNull();
  });

  it('the slot COUNT control is array-shape only', () => {
    expect(setMediaItemCount(double, 3)).toBeNull();
    expect(setMediaItemCount('<SingleImage src="./x.png" />', 2)).toBeNull();
  });
});

describe('components with no editable media surface', () => {
  it('reports not-editable rather than guessing', () => {
    for (const src of [
      '<Credit role="x" name="y" />',
      '<Portrait />', // bare promoted tag: props are declared, none written yet
      '<Quote author="someone">Words.</Quote>',
    ]) {
      expect(readMediaSlots(src)).toBeNull();
      expect(parseMediaItems(src)).toBeNull();
      expect(editMediaItem(src, 0, '/x.png')).toBeNull();
      expect(setMediaItemCount(src, 2)).toBeNull();
    }
  });
});

describe('array shape is untouched', () => {
  it('keeps items semantics, and the count stays editable', () => {
    expect(readMediaSlots('<Media items={["a.png", null]} class="col-span-8" />')).toEqual({
      shape: 'items',
      slots: ['a.png', null],
      names: [],
      countEditable: true,
    });
    // The system Media component is the one component allowed to GAIN items.
    expect(readMediaSlots('<Media class="col-span-8" />')).toEqual({
      shape: 'items',
      slots: [],
      names: [],
      countEditable: true,
    });
  });

  it('items wins when a component carries both shapes', () => {
    const src = '<Media items={["a.png"]} poster="./p.png" />';
    expect(readMediaSlots(src)?.shape).toBe('items');
    expect(editMediaItem(src, 0, '/b.png')).toBe('<Media items={["/b.png"]} poster="./p.png" />');
  });
});

describe('isMediaPropName reuses the manifest parser', () => {
  it('agrees with core/manifest on slot names', () => {
    for (const n of ['src', 'src1', 'poster', 'image', 'thumbnail', 'cover', 'video2']) {
      expect(isMediaPropName(n)).toBe(true);
    }
    for (const n of ['alt', 'title', 'items', 'class', 'srcset', 'data-src', '']) {
      expect(isMediaPropName(n)).toBe(false);
    }
  });
});

/**
 * C8 (2026-08-12 review): `isMediaComponent` matched a hardcoded
 * `items|src|src1|poster`, so a `src2`-only or `image=`-only invocation got NO
 * media affordance at all — a component plainly holding media, treated as if it
 * held none, which is the reported bug's own shape. It now asks the same name
 * authority `readMediaSlots` does, and reads the ROOT tag only.
 */
describe('isMediaComponent', () => {
  it('was blind to media props outside the old hardcoded four', () => {
    const OLD = (s: string) => /\b(items|src|src1|poster)\s*=/.test(s);
    for (const src of [
      '<Gallery src2="/b.png" />',
      '<Hero image="/h.png" />',
      '<Card thumbnail="/t.png" />',
    ]) {
      expect(OLD(src)).toBe(false);
      expect(isMediaComponent(src)).toBe(true);
    }
  });

  it('stays true for media the editor cannot rewrite — width is a class edit', () => {
    expect(readMediaSlots('<Media items={photos} />')).toBeNull();
    expect(isMediaComponent('<Media items={photos} />')).toBe(true);
    expect(isMediaComponent('<SingleImage src={hero} />')).toBe(true);
  });

  it('never reads a CHILD component’s attribute as the wrapper’s', () => {
    // The old regex scanned the whole string, so a text-ish wrapper inherited
    // its child's media and drew a width control it has no use for.
    const nested = '<CreditWrapper title="Team">\n  <Credit src="./c.png" name="y" />\n</CreditWrapper>';
    expect(isMediaComponent(nested)).toBe(false);
    expect(isMediaComponent('<Quote author="someone">Words.</Quote>')).toBe(false);
  });
});

/**
 * C5 (2026-08-12 review): a relative path was passed straight into an <img src>
 * on the EDITOR page, where it 404s — Astro resolves those through its asset
 * pipeline into a hashed /@fs/… URL nothing here can reconstruct. Real content:
 * Timepad-Redesign.mdx writes every media path this way.
 */
describe('previewUrlFor', () => {
  const ORIGIN = 'http://localhost:4399';

  it('has NO url for an Astro-pipeline relative path, with or without an origin', () => {
    expect(previewUrlFor('./images/timepad/hero.png', ORIGIN)).toBeNull();
    expect(previewUrlFor('./images/misc/blank.png', null)).toBeNull();
    expect(previewUrlFor('../a.png', ORIGIN)).toBeNull();
    expect(previewUrlFor('images/a.png', ORIGIN)).toBeNull();
  });

  it('resolves a root-relative path against the instance, never the editor', () => {
    expect(previewUrlFor('/uploads/p.png', ORIGIN)).toBe(`${ORIGIN}/uploads/p.png`);
    expect(previewUrlFor('/uploads/p.png', `${ORIGIN}/`)).toBe(`${ORIGIN}/uploads/p.png`);
    expect(previewUrlFor('/uploads/p.png', null)).toBeNull();
  });

  it('passes an absolute url through untouched', () => {
    expect(previewUrlFor('https://cdn.example.com/p.png', null)).toBe('https://cdn.example.com/p.png');
    expect(previewUrlFor('//cdn.example.com/p.png', ORIGIN)).toBe('//cdn.example.com/p.png');
    expect(previewUrlFor('data:image/png;base64,AA', null)).toBe('data:image/png;base64,AA');
  });

  it('has no url for an empty or missing src', () => {
    expect(previewUrlFor('', ORIGIN)).toBeNull();
    expect(previewUrlFor(null, ORIGIN)).toBeNull();
  });
});

describe('displayMediaSlots', () => {
  it('offers the ONE slot a bare <Media/> renders by default', () => {
    // Media.astro: `count = Math.max(items.length, 1)`, and editMediaItem(…,0,…)
    // grows the array — so the tile that opens is a tile the writer can fill.
    expect(readMediaSlots('<Media class="col-span-8" />')?.slots).toEqual([]);
    expect(displayMediaSlots('<Media class="col-span-8" />')).toEqual([null]);
    expect(displayMediaSlots('<Media items={[]} />')).toEqual([null]);
    expect(editMediaItem('<Media class="col-span-8" />', 0, '/a.png')).toBe(
      '<Media items={["/a.png"]} class="col-span-8" />',
    );
  });

  it('is otherwise exactly the writer’s slots', () => {
    const src = '<DoubleImage src1="/a.png" src2="" />';
    expect(displayMediaSlots(src)).toEqual(readMediaSlots(src)!.slots);
    expect(displayMediaSlots('<Credit name="x" />')).toBeNull();
  });
});

/**
 * The writer's own gate, so the UI's explanation can never describe a different
 * refusal than the one that happened.
 */
describe('mediaWriteBlock', () => {
  const NAMED = '<DoubleImage src1="/a.png" src2="/b.png" />';

  it('names the cause, and editMediaItem refuses exactly when it does', () => {
    const cases: Array<[string, number, string | null, string | null]> = [
      [NAMED, 1, '/ok.png', null],
      [NAMED, 2, '/ok.png', 'out-of-range'],
      [NAMED, -1, '/ok.png', 'out-of-range'],
      [NAMED, 0, '/a"b.png', 'unsafe-path'],
      ['<SingleImage src={hero} />', 0, '/x.png', 'expression'],
      ['<Media items={photos} />', 0, '/x.png', 'expression'],
      ['<Credit role="x" name="y" />', 0, '/x.png', 'no-media'],
      ['<Media items={[null]} />', 0, '/x.png', null],
    ];
    for (const [source, index, src, expected] of cases) {
      expect([source, index, mediaWriteBlock(source, index, src)]).toEqual([source, index, expected]);
      expect(editMediaItem(source, index, src) === null).toBe(expected !== null);
    }
  });

  it('refuses a quote in the ARRAY shape too — it would break the .mdx the same way', () => {
    // Previously only the named shape was guarded, so `items={["a"b"]}` shipped
    // as broken JSX and the whole post stopped rendering.
    expect(mediaWriteBlock('<Media items={[null]} />', 0, '/a"b.png')).toBe('unsafe-path');
    expect(editMediaItem('<Media items={[null]} />', 0, '/a"b.png')).toBeNull();
  });
});
