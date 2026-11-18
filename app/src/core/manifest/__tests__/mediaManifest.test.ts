/**
 * task-207 D10: Media is the FIRST manifest. This test reads the real
 * template file — if someone edits Media.astro's Props, this is the gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseComponentManifest } from '../parseManifest';
import { MEDIA_MANIFEST } from '../mediaManifest';

const source = readFileSync(
  join(__dirname, '../../../../../preview-template/src/components/Media.astro'),
  'utf-8',
);

describe('Media.astro manifest', () => {
  const { props } = parseComponentManifest(source);
  const get = (n: string) => props.find(p => p.name === n);

  it('items is a growable slot array', () => {
    expect(get('items')?.control).toEqual({ kind: 'slots' });
  });

  it('the four style knobs are numeric px props', () => {
    for (const n of ['gap', 'pad', 'margin', 'radius']) {
      expect(get(n)?.control, n).toEqual({ kind: 'number', unit: 'px' });
    }
  });

  it('class and style never surface as knobs', () => {
    expect(get('class')).toBeUndefined();
    expect(get('style')).toBeUndefined();
  });

  it('the alt array is not an editable control (A6)', () => {
    expect(get('alt')).toBeUndefined();
  });

  /** The editor cannot read this file at runtime, so MediaBlock ships an
   *  inlined copy. This is the ONLY thing keeping the two honest. */
  it('the inlined MEDIA_MANIFEST matches what the real file parses to', () => {
    expect(MEDIA_MANIFEST).toEqual({ props });
  });
});
