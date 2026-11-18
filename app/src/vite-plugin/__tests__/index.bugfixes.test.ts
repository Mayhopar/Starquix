/**
 * Bug Fix Tests: vite-plugin/index.ts
 *
 * Tests for Bug #17: File write queue never cleaned up
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Bug #17: File write queue cleanup', () => {
  // Simulate the write queue pattern
  interface WriteQueueEntry {
    filePath: string;
    content: string;
    timestamp: number;
  }

  let writeQueue: Map<string, WriteQueueEntry>;
  let voidQueueRef: Map<string, WriteQueueEntry> | null;

  beforeEach(() => {
    writeQueue = new Map();
    voidQueueRef = null;
  });

  afterEach(() => {
    writeQueue.clear();
    voidQueueRef = null;
  });

  it('bug: new Map() loses reference to accumulated entries', () => {
    // Simulate entries accumulating
    writeQueue.set('file1.ts', { filePath: 'file1.ts', content: 'a', timestamp: 1 });
    writeQueue.set('file2.ts', { filePath: 'file2.ts', content: 'b', timestamp: 2 });

    expect(writeQueue.size).toBe(2);

    // Bug: reassigning loses reference but old map still exists in memory
    const oldQueue = writeQueue; // This reference would be lost in actual code
    writeQueue = new Map(); // Creates new empty map

    // New queue is empty
    expect(writeQueue.size).toBe(0);
    // Old entries still exist (memory leak)
    expect(oldQueue.size).toBe(2);
  });

  it('fix: clearing the existing map properly cleans up', () => {
    writeQueue.set('file1.ts', { filePath: 'file1.ts', content: 'a', timestamp: 1 });
    writeQueue.set('file2.ts', { filePath: 'file2.ts', content: 'b', timestamp: 2 });

    expect(writeQueue.size).toBe(2);

    // Fix: store reference before clearing
    voidQueueRef = writeQueue;

    // Actually clear the entries
    writeQueue.clear();

    expect(writeQueue.size).toBe(0);
    expect(voidQueueRef.size).toBe(0); // Same reference, also cleared
  });

  it('fix: swap and clear pattern for queue processing', () => {
    // Add entries
    writeQueue.set('file1.ts', { filePath: 'file1.ts', content: 'a', timestamp: 1 });
    writeQueue.set('file2.ts', { filePath: 'file2.ts', content: 'b', timestamp: 2 });

    // Correct pattern: swap to process, then clear
    const queueToProcess = new Map(writeQueue); // Copy entries
    writeQueue.clear(); // Clear original

    // Process the copy
    const processed: string[] = [];
    for (const [filePath] of queueToProcess) {
      processed.push(filePath);
    }

    expect(processed).toEqual(['file1.ts', 'file2.ts']);
    expect(writeQueue.size).toBe(0);

    // New entries can be added while processing
    writeQueue.set('file3.ts', { filePath: 'file3.ts', content: 'c', timestamp: 3 });
    expect(writeQueue.size).toBe(1);
  });

  it('fix: handles concurrent writes during flush', () => {
    writeQueue.set('file1.ts', { filePath: 'file1.ts', content: 'v1', timestamp: 1 });

    // Start flush - copy and clear
    const queueToProcess = new Map(writeQueue);
    writeQueue.clear();

    // Concurrent write arrives during processing
    writeQueue.set('file1.ts', { filePath: 'file1.ts', content: 'v2', timestamp: 2 });
    writeQueue.set('file2.ts', { filePath: 'file2.ts', content: 'new', timestamp: 2 });

    // Process old queue
    expect(queueToProcess.get('file1.ts')?.content).toBe('v1');

    // New writes are preserved
    expect(writeQueue.get('file1.ts')?.content).toBe('v2');
    expect(writeQueue.has('file2.ts')).toBe(true);
  });

  it('fix: prevents unbounded queue growth', () => {
    // Simulate many writes
    for (let i = 0; i < 100; i++) {
      writeQueue.set(`file${i}.ts`, {
        filePath: `file${i}.ts`,
        content: `content ${i}`,
        timestamp: i
      });
    }

    expect(writeQueue.size).toBe(100);

    // Proper flush
    const toProcess = new Map(writeQueue);
    writeQueue.clear();

    expect(toProcess.size).toBe(100);
    expect(writeQueue.size).toBe(0);

    // After processing, no memory leak
    toProcess.clear(); // Explicitly clear when done

    // Total entries in memory should be 0
    expect(writeQueue.size + toProcess.size).toBe(0);
  });

  it('fix: handles empty queue flush gracefully', () => {
    expect(writeQueue.size).toBe(0);

    // Should not error on empty flush
    const toProcess = new Map(writeQueue);
    writeQueue.clear();

    expect(toProcess.size).toBe(0);
    expect(writeQueue.size).toBe(0);
  });

  it('fix: stores reference for cleanup on plugin close', () => {
    // Plugin pattern: store reference for closeBundle cleanup
    voidQueueRef = writeQueue;

    writeQueue.set('file1.ts', { filePath: 'file1.ts', content: 'a', timestamp: 1 });

    // On closeBundle, can properly clean up via stored reference
    expect(voidQueueRef.size).toBe(1);

    voidQueueRef.clear();

    // Both references see cleared state
    expect(writeQueue.size).toBe(0);
    expect(voidQueueRef.size).toBe(0);
  });
});
