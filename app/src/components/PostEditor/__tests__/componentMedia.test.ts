import { describe, it, expect } from 'vitest';
import { editMediaItem, parseMediaItems } from '../componentMedia';

describe('editMediaItem', () => {
  it('replaces one entry and copies every other attribute verbatim (alt survives)', () => {
    const source = '<Media items={["a.png", null]} alt={["first", "second"]} class="col-span-8" />';
    expect(editMediaItem(source, 1, 'b.png')).toBe(
      '<Media items={["a.png", "b.png"]} alt={["first", "second"]} class="col-span-8" />',
    );
  });

  it('grows the array when the index is past the end', () => {
    expect(editMediaItem('<Media items={["a.png"]} />', 2, 'c.png')).toBe(
      '<Media items={["a.png", null, "c.png"]} />',
    );
  });

  it('adds the items attribute right after the tag when missing', () => {
    expect(editMediaItem('<Media class="col-span-8" />', 0, 'a.png')).toBe(
      '<Media items={["a.png"]} class="col-span-8" />',
    );
  });

  it('clears an entry to null', () => {
    expect(editMediaItem('<Media items={["a.png"]} />', 0, null)).toBe('<Media items={[null]} />');
  });

  it('refuses an items array holding an expression', () => {
    expect(editMediaItem('<Media items={[cover]} />', 0, 'a.png')).toBeNull();
    expect(parseMediaItems('<Media items={[cover]} />')).toBeNull();
  });

  it('refuses non-component markup', () => {
    expect(editMediaItem('plain prose', 0, 'a.png')).toBeNull();
  });
});

// Owner, 2026-08-10: "text is text bro it's in the center. only images can be
// setup to be full width or not" — the width control is a media affordance.
import { isMediaComponent } from '../componentMedia';

describe('isMediaComponent', () => {
  it('true for media-bearing markup', () => {
    expect(isMediaComponent('<Media items={[null]} class="col-span-8" />')).toBe(true);
    expect(isMediaComponent('<SingleImage src="./x.png" alt="a" />')).toBe(true);
    expect(isMediaComponent('<DoubleImage src1="./a.png" src2="./b.png" />')).toBe(true);
    expect(isMediaComponent('<SingleVideo src="./t.mp4" poster="./p.png" />')).toBe(true);
  });

  it('false for text-ish components — they keep the centered measure', () => {
    expect(isMediaComponent('<CreditWrapper title="Team">\n  <Credit role="x" name="y" />\n</CreditWrapper>')).toBe(false);
    expect(isMediaComponent('<Quote author="someone">Words.</Quote>')).toBe(false);
  });
});

// Layout modes: 1 / 2 / 3 media pieces as first-class modes (no "+").
import { setMediaItemCount } from '../componentMedia';

describe('setMediaItemCount', () => {
  it('grows with null placeholders, keeping existing entries', () => {
    expect(setMediaItemCount('<Media items={["a.png"]} />', 3)).toBe(
      '<Media items={["a.png", null, null]} />',
    );
  });

  it('shrinks keeping the first entries', () => {
    expect(setMediaItemCount('<Media items={["a.png", "b.png", null]} />', 1)).toBe(
      '<Media items={["a.png"]} />',
    );
  });

  it('adds the attribute when missing', () => {
    expect(setMediaItemCount('<Media class="col-span-8" />', 2)).toBe(
      '<Media items={[null, null]} class="col-span-8" />',
    );
  });

  it('refuses expressions', () => {
    expect(setMediaItemCount('<Media items={[cover]} />', 2)).toBeNull();
  });
});
