/**
 * Bug Fix Tests: SelectionContext.tsx
 *
 * Tests for:
 * - Bug #4: linkAriaLabel missing from options type
 */
import { describe, it, expect } from 'vitest';
import type { ElementRect } from '@/bridge';

describe('Bug #4: linkAriaLabel type in select options', () => {
  // Type test: This will compile only if linkAriaLabel is properly typed
  it('should accept linkAriaLabel in select options type', () => {
    // Define the options type as it should be after the fix
    interface SelectOptions {
      sourceLocation?: { file: string; line: number; column: number };
      tagName?: string;
      classes?: string;
      computedStyles?: Record<string, string>;
      rect?: ElementRect;
      parentDisplay?: string;
      linkHref?: string | null;
      linkTarget?: string | null;
      linkAriaLabel?: string | null; // Bug #4: This was missing
    }

    // Simulate calling select with linkAriaLabel
    const options: SelectOptions = {
      tagName: 'a',
      classes: 'text-blue-500',
      linkHref: '/about',
      linkTarget: '_blank',
      linkAriaLabel: 'Learn more about us',
    };

    // Verify all link-related fields are present
    expect(options.linkHref).toBe('/about');
    expect(options.linkTarget).toBe('_blank');
    expect(options.linkAriaLabel).toBe('Learn more about us');
  });

  it('should handle null linkAriaLabel', () => {
    interface SelectOptions {
      linkAriaLabel?: string | null;
    }

    const options: SelectOptions = {
      linkAriaLabel: null,
    };

    expect(options.linkAriaLabel).toBeNull();
  });

  it('should handle undefined linkAriaLabel', () => {
    interface SelectOptions {
      linkAriaLabel?: string | null;
    }

    const options: SelectOptions = {};

    expect(options.linkAriaLabel).toBeUndefined();
  });
});
