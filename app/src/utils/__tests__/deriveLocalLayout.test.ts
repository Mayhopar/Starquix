/**
 * deriveLocalLayout — local mode recovers the layout wrapper identity the DOM
 * scan flattened away (docs/plans/2026-08-23-local-layout-layers-nesting.md).
 */
import { describe, it, expect } from 'vitest';
import { deriveLocalLayout } from '../treeUtils';
import type { ScannedElement } from '@/context/SelectionContext';

const el = (over: Partial<ScannedElement>): ScannedElement =>
  ({ key: 'k', tagName: 'div', classes: '', parentKey: null, hasSourceTracking: true, ...over }) as ScannedElement;

describe('deriveLocalLayout', () => {
  it('finds the layout from a defining sourceLocation in src/layouts/', () => {
    const out = deriveLocalLayout([
      el({ key: 'src/components/Header.astro:6:1', sourceLocation: { file: 'src/components/Header.astro', line: 6, column: 1 } }),
      el({ key: 'src/layouts/Main.astro:12:2', sourceLocation: { file: 'src/layouts/Main.astro', line: 12, column: 2 } }),
    ]);
    expect(out).toEqual({ name: 'Main', file: 'src/layouts/Main.astro' });
  });

  it('finds the layout from a usageLocation (component instantiated BY the layout)', () => {
    const out = deriveLocalLayout([
      el({
        key: 'src/components/Header.astro:6:1',
        sourceLocation: { file: 'src/components/Header.astro', line: 6, column: 1 },
        usageLocation: { file: 'src/layouts/Base.astro', line: 4, column: 1 },
      }),
    ]);
    expect(out).toEqual({ name: 'Base', file: 'src/layouts/Base.astro' });
  });

  it('returns null when nothing points at src/layouts/', () => {
    const out = deriveLocalLayout([
      el({ key: 'src/pages/index.astro:3:1', sourceLocation: { file: 'src/pages/index.astro', line: 3, column: 1 } }),
      el({ key: 'src/components/Card.astro:2:1', sourceLocation: { file: 'src/components/Card.astro', line: 2, column: 1 } }),
    ]);
    expect(out).toBeNull();
  });

  it('ignores nested/lookalike paths (only src/layouts/<Name>.astro matches)', () => {
    const out = deriveLocalLayout([
      el({ key: 'a', sourceLocation: { file: 'src/components/layouts/Fake.astro', line: 1, column: 1 } }),
      el({ key: 'b', sourceLocation: { file: 'src/layouts/sub/Nested.astro', line: 1, column: 1 } }),
    ]);
    expect(out).toBeNull();
  });
});
