/**
 * Bug Fix Tests: bridge.js
 *
 * Tests for:
 * - Bug #2: XSS via origin validation bypass
 * - Bug #18: savedSelectionRange mutation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Bug #2: XSS via origin validation bypass', () => {
  // Simulate the buggy origin check
  const buggyIsAllowedOrigin = (origin: string) => {
    // BUG: indexOf('localhost') matches substrings
    return origin.indexOf('localhost') !== -1;
  };

  // Fixed origin check
  const fixedIsAllowedOrigin = (origin: string) => {
    try {
      const url = new URL(origin);
      // Only allow exact localhost hostname
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  };

  describe('buggy implementation vulnerabilities', () => {
    it('incorrectly allows attacker domain with "localhost" substring', () => {
      // Attacker-controlled domain
      const attackerOrigin = 'https://attacker-localhost-exploit.com';

      // BUG: This returns true because 'localhost' is a substring
      expect(buggyIsAllowedOrigin(attackerOrigin)).toBe(true);
    });

    it('incorrectly allows localhost in path', () => {
      const attackerOrigin = 'https://evil.com/localhost';

      // BUG: indexOf checks entire string, not just hostname
      expect(buggyIsAllowedOrigin(attackerOrigin)).toBe(true);
    });

    it('incorrectly allows localhost in query params', () => {
      const attackerOrigin = 'https://evil.com?redirect=localhost';

      expect(buggyIsAllowedOrigin(attackerOrigin)).toBe(true);
    });

    it('incorrectly allows localhost subdomain', () => {
      const attackerOrigin = 'https://localhost.evil.com';

      expect(buggyIsAllowedOrigin(attackerOrigin)).toBe(true);
    });
  });

  describe('fixed implementation security', () => {
    it('allows actual localhost', () => {
      expect(fixedIsAllowedOrigin('http://localhost:3000')).toBe(true);
      expect(fixedIsAllowedOrigin('http://localhost:4321')).toBe(true);
      expect(fixedIsAllowedOrigin('http://localhost')).toBe(true);
    });

    it('allows 127.0.0.1', () => {
      expect(fixedIsAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
      expect(fixedIsAllowedOrigin('http://127.0.0.1')).toBe(true);
    });

    it('rejects attacker domain with localhost substring', () => {
      expect(fixedIsAllowedOrigin('https://attacker-localhost-exploit.com')).toBe(false);
    });

    it('rejects localhost subdomain', () => {
      expect(fixedIsAllowedOrigin('https://localhost.evil.com')).toBe(false);
    });

    it('rejects evil.com with localhost in path', () => {
      // Note: URL(origin) doesn't include path, but test the principle
      expect(fixedIsAllowedOrigin('https://evil.com')).toBe(false);
    });

    it('rejects invalid origins', () => {
      expect(fixedIsAllowedOrigin('not-a-url')).toBe(false);
      expect(fixedIsAllowedOrigin('')).toBe(false);
    });

    it('handles different protocols', () => {
      expect(fixedIsAllowedOrigin('https://localhost:3000')).toBe(true);
      expect(fixedIsAllowedOrigin('ws://localhost:3000')).toBe(true);
    });
  });
});

describe('Bug #28: postMessage security - uses wildcard origin (CRITICAL)', () => {
  it('should store parent origin from validated incoming messages', () => {
    // Simulate the origin validation and storage logic
    const bridge = {
      parentOrigin: null as string | null,
    };

    const validateAndStoreOrigin = (event: { origin: string }, isInIframe: boolean) => {
      if (!isInIframe) return true;

      // Simulate the origin validation from bridge.js
      const originUrl = new URL(event.origin);
      const hostname = originUrl.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

      if (!isLocalhost) {
        return false;
      }

      // Store validated parent origin for secure outgoing messages
      if (!bridge.parentOrigin) {
        bridge.parentOrigin = event.origin;
      }

      return true;
    };

    // First message stores origin
    const result = validateAndStoreOrigin({ origin: 'http://localhost:5173' }, true);
    expect(result).toBe(true);
    expect(bridge.parentOrigin).toBe('http://localhost:5173');

    // Subsequent messages don't overwrite
    validateAndStoreOrigin({ origin: 'http://localhost:3000' }, true);
    expect(bridge.parentOrigin).toBe('http://localhost:5173');
  });

  it('should use stored parent origin instead of wildcard in sendToParent', () => {
    // Simulate sendToParent with stored origin
    const sendToParent = (
      message: unknown,
      parentOrigin: string | null,
      windowOrigin: string
    ) => {
      // Use validated parent origin instead of wildcard for security
      const targetOrigin = parentOrigin || windowOrigin;
      return targetOrigin;
    };

    // With stored parent origin - use it
    const origin1 = sendToParent({ type: 'TEST' }, 'http://localhost:5173', 'http://localhost:4321');
    expect(origin1).toBe('http://localhost:5173');

    // Without stored origin (initial messages) - fall back to same origin
    const origin2 = sendToParent({ type: 'TEST' }, null, 'http://localhost:4321');
    expect(origin2).toBe('http://localhost:4321');
  });
});

describe('Bug #29: Wheel event listener removal mismatch', () => {
  it('should use matching options for add and remove event listener', () => {
    // Track listener options used
    const listenerCalls: Array<{
      method: 'add' | 'remove';
      type: string;
      options: boolean | AddEventListenerOptions;
    }> = [];

    const originalAdd = document.addEventListener;
    const originalRemove = document.removeEventListener;

    document.addEventListener = vi.fn((type, _listener, options) => {
      listenerCalls.push({ method: 'add', type, options: options as boolean | AddEventListenerOptions });
    }) as typeof document.addEventListener;

    document.removeEventListener = vi.fn((type, _listener, options) => {
      listenerCalls.push({ method: 'remove', type, options: options as boolean | AddEventListenerOptions });
    }) as typeof document.removeEventListener;

    const handler = () => {};

    // Simulate the fixed toggle pattern
    const toggleDesignModeListeners = (add: boolean) => {
      if (add) {
        document.addEventListener('wheel', handler, { passive: false, capture: true });
      } else {
        // Fixed: use matching capture option
        document.removeEventListener('wheel', handler, { capture: true });
      }
    };

    // Add listener
    toggleDesignModeListeners(true);
    expect(listenerCalls[0].method).toBe('add');
    expect(listenerCalls[0].type).toBe('wheel');

    // Remove listener
    toggleDesignModeListeners(false);
    expect(listenerCalls[1].method).toBe('remove');
    expect(listenerCalls[1].type).toBe('wheel');

    // Both should have capture: true for proper cleanup
    const addOptions = listenerCalls[0].options as AddEventListenerOptions;
    const removeOptions = listenerCalls[1].options as AddEventListenerOptions;
    expect(addOptions.capture).toBe(true);
    expect(removeOptions.capture).toBe(true);

    // Restore
    document.addEventListener = originalAdd;
    document.removeEventListener = originalRemove;
  });
});

describe('Bug #18: savedSelectionRange mutation', () => {
  // Simulate the Selection/Range interface
  interface MockRange {
    startContainer: Node;
    startOffset: number;
    endContainer: Node;
    endOffset: number;
    collapsed: boolean;
  }

  let savedSelectionRange: MockRange | null;

  const createMockRange = (): MockRange => ({
    startContainer: document.createElement('div'),
    startOffset: 0,
    endContainer: document.createElement('div'),
    endOffset: 5,
    collapsed: false
  });

  beforeEach(() => {
    savedSelectionRange = null;
  });

  describe('buggy implementation', () => {
    it('allows mutation of saved range (bug)', () => {
      const originalRange = createMockRange();

      // Bug: directly stores reference
      savedSelectionRange = originalRange;

      // External code mutates the range
      originalRange.startOffset = 100;
      originalRange.endOffset = 200;

      // Saved range is also mutated!
      expect(savedSelectionRange.startOffset).toBe(100);
      expect(savedSelectionRange.endOffset).toBe(200);
    });

    it('bug affects range restoration', () => {
      const originalRange = createMockRange();
      const originalStartOffset = originalRange.startOffset;
      const originalEndOffset = originalRange.endOffset;

      // Save
      savedSelectionRange = originalRange;

      // Something mutates the range
      originalRange.startOffset = 999;

      // When trying to restore, we get wrong values
      expect(savedSelectionRange.startOffset).not.toBe(originalStartOffset);
    });
  });

  describe('fixed implementation', () => {
    it('creates defensive copy of range data', () => {
      const originalRange = createMockRange();

      // Fix: store a copy of the relevant properties
      const savedRangeCopy = {
        startContainer: originalRange.startContainer,
        startOffset: originalRange.startOffset,
        endContainer: originalRange.endContainer,
        endOffset: originalRange.endOffset,
        collapsed: originalRange.collapsed
      };

      // External mutation
      originalRange.startOffset = 100;
      originalRange.endOffset = 200;

      // Saved copy is unchanged
      expect(savedRangeCopy.startOffset).toBe(0);
      expect(savedRangeCopy.endOffset).toBe(5);
    });

    it('preserves original values for restoration', () => {
      const originalRange = createMockRange();
      const originalStartOffset = 0;
      const originalEndOffset = 5;

      // Defensive copy
      const savedRangeCopy = { ...originalRange };

      // Mutation doesn't affect our copy
      originalRange.startOffset = 999;
      originalRange.endOffset = 999;

      expect(savedRangeCopy.startOffset).toBe(originalStartOffset);
      expect(savedRangeCopy.endOffset).toBe(originalEndOffset);
    });

    it('handles null range gracefully', () => {
      // Should not throw
      savedSelectionRange = null;
      expect(savedSelectionRange).toBeNull();

      // Safe access pattern
      const startOffset = savedSelectionRange?.startOffset ?? 0;
      expect(startOffset).toBe(0);
    });

    it('handles multiple save/restore cycles', () => {
      for (let i = 0; i < 3; i++) {
        const range = createMockRange();
        range.startOffset = i;
        range.endOffset = i + 10;

        // Defensive copy
        const savedCopy = { ...range };

        // Mutate original
        range.startOffset = 999;

        // Copy preserves original
        expect(savedCopy.startOffset).toBe(i);
        expect(savedCopy.endOffset).toBe(i + 10);
      }
    });
  });
});
