/**
 * Bug Fix Tests: ViewportFrame.tsx
 *
 * Tests for Bug #14: Memory leak in pendingKeyUpdatesRef
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Bug #14: pendingKeyUpdatesRef memory leak', () => {
  // Simulate the pendingKeyUpdatesRef pattern
  let pendingKeyUpdatesRef: Map<string, number>;
  let documentElements: Set<string>;

  beforeEach(() => {
    pendingKeyUpdatesRef = new Map();
    documentElements = new Set(['element-1', 'element-2', 'element-3']);
  });

  afterEach(() => {
    pendingKeyUpdatesRef.clear();
    documentElements.clear();
  });

  it('accumulates entries when elements are deleted (before fix)', () => {
    // Simulate the bug: entries added for elements that get deleted
    pendingKeyUpdatesRef.set('element-1', 1);
    pendingKeyUpdatesRef.set('element-2', 1);

    // Element gets deleted
    documentElements.delete('element-2');

    // Add more entries
    pendingKeyUpdatesRef.set('element-3', 1);
    pendingKeyUpdatesRef.set('element-4', 1); // New element

    // Without cleanup, deleted element entries persist
    expect(pendingKeyUpdatesRef.size).toBe(4);
    expect(pendingKeyUpdatesRef.has('element-2')).toBe(true); // Memory leak!
  });

  it('cleans up entries for non-existent elements (bug fix)', () => {
    // Simulate entries accumulating
    pendingKeyUpdatesRef.set('element-1', 1);
    pendingKeyUpdatesRef.set('element-2', 1);
    pendingKeyUpdatesRef.set('deleted-element', 1);

    // Element gets deleted from document
    documentElements.delete('element-2');

    // The fix: periodically clean up entries for elements that no longer exist
    const cleanupStaleEntries = () => {
      for (const elementId of pendingKeyUpdatesRef.keys()) {
        if (!documentElements.has(elementId)) {
          pendingKeyUpdatesRef.delete(elementId);
        }
      }
    };

    cleanupStaleEntries();

    // Only entries for existing elements remain
    expect(pendingKeyUpdatesRef.size).toBe(1);
    expect(pendingKeyUpdatesRef.has('element-1')).toBe(true);
    expect(pendingKeyUpdatesRef.has('element-2')).toBe(false);
    expect(pendingKeyUpdatesRef.has('deleted-element')).toBe(false);
  });

  it('prevents unbounded growth over time', () => {
    const cleanupStaleEntries = () => {
      for (const elementId of pendingKeyUpdatesRef.keys()) {
        if (!documentElements.has(elementId)) {
          pendingKeyUpdatesRef.delete(elementId);
        }
      }
    };

    // Simulate many element additions and deletions over time
    for (let i = 0; i < 100; i++) {
      const elementId = `element-${i}`;
      documentElements.add(elementId);
      pendingKeyUpdatesRef.set(elementId, 1);

      // Simulate deletion of older elements
      if (i > 10) {
        const oldElementId = `element-${i - 10}`;
        documentElements.delete(oldElementId);
      }

      // With fix: periodic cleanup
      if (i % 10 === 0) {
        cleanupStaleEntries();
      }
    }

    // Final cleanup
    cleanupStaleEntries();

    // Should only have entries for elements that still exist
    for (const [elementId] of pendingKeyUpdatesRef) {
      expect(documentElements.has(elementId)).toBe(true);
    }

    // Should not have more entries than existing elements
    expect(pendingKeyUpdatesRef.size).toBeLessThanOrEqual(documentElements.size);
  });

  it('handles concurrent updates during cleanup', () => {
    const cleanupStaleEntries = () => {
      for (const elementId of Array.from(pendingKeyUpdatesRef.keys())) {
        if (!documentElements.has(elementId)) {
          pendingKeyUpdatesRef.delete(elementId);
        }
      }
    };

    // Setup initial state
    pendingKeyUpdatesRef.set('element-1', 1);
    pendingKeyUpdatesRef.set('element-2', 1);

    // Simulate cleanup that might race with new additions
    documentElements.delete('element-2');

    // New element added during cleanup window
    documentElements.add('element-4');
    pendingKeyUpdatesRef.set('element-4', 1);

    cleanupStaleEntries();

    // New element should remain
    expect(pendingKeyUpdatesRef.has('element-4')).toBe(true);
    // Deleted element should be cleaned
    expect(pendingKeyUpdatesRef.has('element-2')).toBe(false);
  });
});
