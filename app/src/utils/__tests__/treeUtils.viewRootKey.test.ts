import { describe, it, expect } from 'vitest';
import { viewRootKey } from '../treeUtils';
import type { ScannedElement } from '@/context/SelectionContext';

const el = (key: string, parentKey: string | null, tagName = 'div'): ScannedElement => ({
  key, parentKey, tagName, classes: '', rect: { top: 0, left: 0, width: 0, height: 0 },
  sourceLocation: { file: key.split(':')[0], line: 1, column: 1 },
} as unknown as ScannedElement);

describe('viewRootKey — the one predicate for a master file\'s root', () => {
  it('prefers the scanned layout <body> when it belongs to the viewed file', () => {
    const els = [el('src/layouts/Main.astro:20:2', null, 'body'), el('src/components/Header.astro:3:1', 'src/layouts/Main.astro:20:2')];
    expect(viewRootKey('src/layouts/Main.astro', els)).toBe('src/layouts/Main.astro:20:2');
  });
  it('falls back to the file\'s first top-level element, then its first element', () => {
    const els = [el('src/components/Main.astro:9:3', 'src/components/Main.astro:7:1'), el('src/components/Main.astro:7:1', null)];
    expect(viewRootKey('src/components/Main.astro', els)).toBe('src/components/Main.astro:7:1');
    expect(viewRootKey('src/components/Main.astro', [els[0]])).toBe('src/components/Main.astro:9:3');
  });
  it('is null with no viewed file or no element of that file', () => {
    expect(viewRootKey(null, [el('src/components/Main.astro:7:1', null)])).toBeNull();
    expect(viewRootKey('src/components/Other.astro', [el('src/components/Main.astro:7:1', null)])).toBeNull();
  });
});
