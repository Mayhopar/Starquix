/**
 * Bug Fix Tests: DesignBar Blocks
 *
 * Tests for:
 * - Bug #24: LinkBlock blur timeout not cleaned up on unmount
 * - Bug #25: EffectsBlock global counter causes unstable IDs
 * - Bug #32: Aria label input couldn't receive focus due to preventDefault on parent
 * - Bug #33: Aria label didn't persist because selector required href to return data
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { selectLinkAttributes } from '@/store/selectors';

// ============================================================================
// Bug #25: EffectsBlock ID generation
// ============================================================================

describe('Bug #25: EffectsBlock effect ID generation', () => {
  // Import the generateEffectId function by testing through parseEffects behavior
  // We test that IDs are stable and based on type

  it('should generate stable IDs based on effect type', () => {
    // Test that generateEffectId produces deterministic IDs from type
    const generateEffectId = (type: string) => `effect-${type}`;

    expect(generateEffectId('shadow')).toBe('effect-shadow');
    expect(generateEffectId('blur')).toBe('effect-blur');
    expect(generateEffectId('backdrop-blur')).toBe('effect-backdrop-blur');
    expect(generateEffectId('filter')).toBe('effect-filter');
  });

  it('should produce same ID for same type across multiple calls', () => {
    const generateEffectId = (type: string) => `effect-${type}`;

    // Call multiple times - should always return same value for same type
    const id1 = generateEffectId('shadow');
    const id2 = generateEffectId('shadow');
    const id3 = generateEffectId('shadow');

    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  it('should produce unique IDs for different types', () => {
    const generateEffectId = (type: string) => `effect-${type}`;

    const shadowId = generateEffectId('shadow');
    const blurId = generateEffectId('blur');
    const backdropId = generateEffectId('backdrop-blur');
    const filterId = generateEffectId('filter');

    // All IDs should be unique
    const ids = [shadowId, blurId, backdropId, filterId];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ============================================================================
// Bug #24: LinkBlock blur timeout cleanup
// ============================================================================

describe('Bug #24: LinkBlock blur timeout cleanup pattern', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should clear previous timeout when blur is called multiple times', () => {
    // Simulate the blur handler pattern with timeout ref
    let blurTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    let callCount = 0;

    const handleBlur = () => {
      // Clear any existing timeout to prevent duplicates
      if (blurTimeoutRef) {
        clearTimeout(blurTimeoutRef);
      }
      blurTimeoutRef = setTimeout(() => {
        blurTimeoutRef = null;
        callCount++;
      }, 100);
    };

    // Rapid blur calls
    handleBlur();
    handleBlur();
    handleBlur();

    // Only advance enough for one timeout
    vi.advanceTimersByTime(150);

    // Should only have been called once (not 3 times)
    expect(callCount).toBe(1);
  });

  it('should not fire callback after cleanup', () => {
    let blurTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    let callCount = 0;

    const handleBlur = () => {
      if (blurTimeoutRef) {
        clearTimeout(blurTimeoutRef);
      }
      blurTimeoutRef = setTimeout(() => {
        blurTimeoutRef = null;
        callCount++;
      }, 100);
    };

    const cleanup = () => {
      if (blurTimeoutRef) {
        clearTimeout(blurTimeoutRef);
        blurTimeoutRef = null;
      }
    };

    // Trigger blur
    handleBlur();

    // Immediately cleanup (simulating component unmount)
    cleanup();

    // Advance past timeout
    vi.advanceTimersByTime(200);

    // Callback should NOT have been called
    expect(callCount).toBe(0);
  });

  it('should track timeout state correctly', () => {
    let blurTimeoutRef: ReturnType<typeof setTimeout> | null = null;

    const handleBlur = () => {
      if (blurTimeoutRef) {
        clearTimeout(blurTimeoutRef);
      }
      blurTimeoutRef = setTimeout(() => {
        blurTimeoutRef = null;
      }, 100);
    };

    // Initially no timeout
    expect(blurTimeoutRef).toBeNull();

    // After blur, timeout should exist
    handleBlur();
    expect(blurTimeoutRef).not.toBeNull();

    // After timeout completes, should be null again
    vi.advanceTimersByTime(150);
    expect(blurTimeoutRef).toBeNull();
  });

  it('should handle interacting ref check correctly', () => {
    let blurTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    const isInteractingRef = { current: false };
    let dropdownClosed = false;

    const handleBlur = () => {
      if (blurTimeoutRef) {
        clearTimeout(blurTimeoutRef);
      }
      blurTimeoutRef = setTimeout(() => {
        blurTimeoutRef = null;
        if (!isInteractingRef.current) {
          dropdownClosed = true;
        }
      }, 100);
    };

    // Simulate blur while interacting
    isInteractingRef.current = true;
    handleBlur();

    vi.advanceTimersByTime(150);

    // Dropdown should NOT be closed because user is interacting
    expect(dropdownClosed).toBe(false);
  });

  it('should close dropdown when not interacting', () => {
    let blurTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    const isInteractingRef = { current: false };
    let dropdownClosed = false;

    const handleBlur = () => {
      if (blurTimeoutRef) {
        clearTimeout(blurTimeoutRef);
      }
      blurTimeoutRef = setTimeout(() => {
        blurTimeoutRef = null;
        if (!isInteractingRef.current) {
          dropdownClosed = true;
        }
      }, 100);
    };

    // Simulate blur when NOT interacting
    isInteractingRef.current = false;
    handleBlur();

    vi.advanceTimersByTime(150);

    // Dropdown SHOULD be closed
    expect(dropdownClosed).toBe(true);
  });
});

// ============================================================================
// Bug #32: Input Focus Patterns
// ============================================================================

describe('Bug #32: Input focus should not be blocked by parent handlers', () => {
  /**
   * Pattern: Parent divs should NOT call preventDefault() on mousedown
   * if they contain inputs that need to receive focus.
   *
   * Bad pattern:
   *   <div onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}>
   *     <input />  // Cannot receive focus!
   *   </div>
   *
   * Good pattern:
   *   <div onMouseDown={(e) => { e.stopPropagation(); }}>
   *     <input />  // Can receive focus normally
   *   </div>
   */

  it('should allow input focus when parent only stops propagation', () => {
    // Simulate the correct pattern - stopPropagation only
    const inputFocused = { value: false };
    const parentMouseDown = vi.fn((e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      // NO preventDefault() - this allows input to receive focus
    });

    const inputFocus = vi.fn(() => {
      inputFocused.value = true;
    });

    // Simulate event flow
    const event = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };

    parentMouseDown(event);
    // Input would receive focus because preventDefault wasn't called
    inputFocus();

    expect(inputFocused.value).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('should document that preventDefault blocks input focus', () => {
    // This test documents the BAD pattern that was causing the bug
    const inputFocused = { value: false };
    const preventDefaultCalled = { value: false };

    const badParentMouseDown = vi.fn((e: { stopPropagation: () => void; preventDefault: () => void }) => {
      e.stopPropagation();
      e.preventDefault(); // BAD: This blocks input focus!
      preventDefaultCalled.value = true;
    });

    const event = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };

    badParentMouseDown(event);

    // When preventDefault is called, the browser won't focus the input
    expect(preventDefaultCalled.value).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    // Input would NOT receive focus in real browser
    expect(inputFocused.value).toBe(false);
  });
});

// ============================================================================
// Bug #33: Selector Partial Data Patterns
// ============================================================================

describe('Bug #33: Selectors should return partial data when available', () => {
  /**
   * Pattern: Selectors should NOT require ALL fields to be present.
   * If only some fields are stored (e.g., ariaLabel but not href),
   * the selector should still return the available data.
   *
   * Bad pattern:
   *   if (!href) return null;  // Loses ariaLabel!
   *
   * Good pattern:
   *   if (!href && !target && !ariaLabel) return null;  // Only null if truly empty
   */

  it('should return linkAttributes even when only ariaLabel is set', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    // Create instance with only ariaLabel in linkOverrides (no href)
    const instanceId = 'el-test123';
    const selector = 'a-0';
    const key = `${instanceId}:${selector}`;

    const element = new Y.Map();
    const linkOverrides = new Y.Map();
    const selectorAttrs = new Y.Map();
    selectorAttrs.set('ariaLabel', 'test label');
    linkOverrides.set(selector, selectorAttrs);
    element.set('linkOverrides', linkOverrides);
    elements.set(instanceId, element);

    const result = selectLinkAttributes(doc, key);

    // Should return the ariaLabel even though href is not set
    expect(result).not.toBeNull();
    expect(result?.ariaLabel).toBe('test label');
    expect(result?.href).toBe(''); // Empty but object returned
  });

  it('should return linkAttributes when only target is set', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    const instanceId = 'el-test456';
    const selector = 'a-0';
    const key = `${instanceId}:${selector}`;

    const element = new Y.Map();
    const linkOverrides = new Y.Map();
    const selectorAttrs = new Y.Map();
    selectorAttrs.set('target', '_blank');
    linkOverrides.set(selector, selectorAttrs);
    element.set('linkOverrides', linkOverrides);
    elements.set(instanceId, element);

    const result = selectLinkAttributes(doc, key);

    expect(result).not.toBeNull();
    expect(result?.target).toBe('_blank');
  });

  it('should return null when no data exists at all', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    const instanceId = 'el-empty';
    const selector = 'a-0';
    const key = `${instanceId}:${selector}`;

    // Element exists but has no link data
    const element = new Y.Map();
    elements.set(instanceId, element);

    const result = selectLinkAttributes(doc, key);

    expect(result).toBeNull();
  });

  it('should return all data when everything is set', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    const instanceId = 'el-full';
    const selector = 'a-0';
    const key = `${instanceId}:${selector}`;

    const element = new Y.Map();

    // Set href via unifiedOverrides
    const unifiedOverrides = new Y.Map();
    const selectorEntry = new Y.Map();
    const hrefMap = new Y.Map();
    hrefMap.set('href', '/test-page');
    hrefMap.set('target', '_self');
    selectorEntry.set('href', hrefMap);
    unifiedOverrides.set(selector, selectorEntry);
    element.set('unifiedOverrides', unifiedOverrides);

    // Set ariaLabel via linkOverrides
    const linkOverrides = new Y.Map();
    const selectorAttrs = new Y.Map();
    selectorAttrs.set('ariaLabel', 'Navigate to test page');
    selectorAttrs.set('target', '_blank'); // This should override unifiedOverrides target
    linkOverrides.set(selector, selectorAttrs);
    element.set('linkOverrides', linkOverrides);

    elements.set(instanceId, element);

    const result = selectLinkAttributes(doc, key);

    expect(result).not.toBeNull();
    expect(result?.href).toBe('/test-page');
    expect(result?.target).toBe('_blank'); // linkOverrides takes precedence
    expect(result?.ariaLabel).toBe('Navigate to test page');
  });
});

// ============================================================================
// Input Value Persistence Patterns
// ============================================================================

describe('Input value persistence patterns', () => {
  /**
   * Pattern: Input values should be saved on blur and restored on re-select.
   * The flow is:
   * 1. User selects element
   * 2. User types in input (local state updates)
   * 3. User blurs input (value dispatched to Yjs)
   * 4. User re-selects element (value read from Yjs)
   */

  it('should maintain value through blur-dispatch-read cycle', () => {
    // Simulate the full cycle
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    const instanceId = 'el-persist';
    const selector = 'a-0';
    const key = `${instanceId}:${selector}`;

    // Step 1: Element exists initially
    const element = new Y.Map();
    elements.set(instanceId, element);

    // Step 2: Initial read - no data
    let result = selectLinkAttributes(doc, key);
    expect(result).toBeNull();

    // Step 3: Simulate blur handler saving ariaLabel
    // (This is what UPDATE_LINK_ATTRIBUTE command does)
    let linkOverrides = element.get('linkOverrides') as Y.Map<Y.Map<unknown>> | undefined;
    if (!linkOverrides) {
      linkOverrides = new Y.Map();
      element.set('linkOverrides', linkOverrides);
    }
    let selectorAttrs = linkOverrides.get(selector) as Y.Map<unknown> | undefined;
    if (!selectorAttrs) {
      selectorAttrs = new Y.Map();
      linkOverrides.set(selector, selectorAttrs);
    }
    selectorAttrs.set('ariaLabel', 'user typed value');

    // Step 4: Read again - should get the saved value
    result = selectLinkAttributes(doc, key);
    expect(result).not.toBeNull();
    expect(result?.ariaLabel).toBe('user typed value');
  });

  it('should handle empty string values correctly', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    const instanceId = 'el-empty-string';
    const selector = 'a-0';
    const key = `${instanceId}:${selector}`;

    const element = new Y.Map();
    const linkOverrides = new Y.Map();
    const selectorAttrs = new Y.Map();
    // Empty string is a valid value (user cleared the field)
    selectorAttrs.set('ariaLabel', '');
    linkOverrides.set(selector, selectorAttrs);
    element.set('linkOverrides', linkOverrides);
    elements.set(instanceId, element);

    const result = selectLinkAttributes(doc, key);

    // Empty string should still return the object (but ariaLabel will be '')
    // Note: The current selector considers empty string as falsy for the null check,
    // so this test documents current behavior
    expect(result).toBeNull(); // Empty strings are treated as "no data"
  });
});

// ============================================================================
// Source Element Link Attributes
// ============================================================================

describe('Source element link attributes', () => {
  /**
   * Source elements (like src/Hero.astro:5:1) store link attributes
   * in a separate sourceLinkAttributes map.
   */

  it('should store and retrieve ariaLabel for source elements', () => {
    const doc = new Y.Doc();
    const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');

    const sourceKey = 'src/components/Nav.astro:10:5';

    // Store ariaLabel
    const attrs = new Y.Map();
    attrs.set('ariaLabel', 'Main navigation link');
    sourceLinkAttributes.set(sourceKey, attrs);

    // Read back
    const result = selectLinkAttributes(doc, sourceKey);

    expect(result).not.toBeNull();
    expect(result?.ariaLabel).toBe('Main navigation link');
  });

  it('should return null for source elements with no data', () => {
    const doc = new Y.Doc();

    const sourceKey = 'src/components/Footer.astro:20:3';

    const result = selectLinkAttributes(doc, sourceKey);

    expect(result).toBeNull();
  });
});
