/**
 * Tests for file write queue functionality.
 * These tests verify that concurrent writes to the same file are serialized.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('File Write Queue Concept', () => {
  // Fake time: these tests are about ORDER. On real timers the 5 ms write beat
  // the 10 ms one only while the worker never paused >5 ms between starting the
  // two (a GC or a busy machine did, ~1 run in 1000 — the gate went red on it).
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const settle = async <T>(pending: Promise<T>): Promise<T> => { await vi.runAllTimersAsync(); return pending; };

  /**
   * This test demonstrates the race condition that the queue prevents.
   * Without queuing, concurrent read-modify-write operations lose data.
   */
  it('should demonstrate Last Write Wins problem without queue', async () => {
    let fileContent = 'original';
    const writes: string[] = [];

    // Simulate two concurrent read-modify-write operations
    const op1 = async () => {
      const content = fileContent; // Read: "original"
      await new Promise(r => setTimeout(r, 10)); // Simulate async delay
      fileContent = content + '-A'; // Write: "original-A"
      writes.push('A');
    };

    const op2 = async () => {
      const content = fileContent; // Read: "original" (same as op1!)
      await new Promise(r => setTimeout(r, 5)); // Faster than op1
      fileContent = content + '-B'; // Write: "original-B" - OVERWRITES A's changes!
      writes.push('B');
    };

    // Run both concurrently
    await settle(Promise.all([op1(), op2()]));

    // B finishes first, then A overwrites it - we lose B's changes!
    // Expected with proper queuing: "original-A-B" or "original-B-A"
    // Actual without queuing: "original-A" (B's changes lost)
    expect(fileContent).toBe('original-A');
    expect(writes).toEqual(['B', 'A']);
  });

  it('should serialize writes with a queue', async () => {
    let fileContent = 'original';
    const writes: string[] = [];

    // Simple queue implementation
    let currentQueue = Promise.resolve();
    const queueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
      const newQueue = currentQueue.then(operation);
      currentQueue = newQueue.then(() => {}).catch(() => {});
      return newQueue;
    };

    const op1 = () => queueWrite(async () => {
      const content = fileContent;
      await new Promise(r => setTimeout(r, 10));
      fileContent = content + '-A';
      writes.push('A');
    });

    const op2 = () => queueWrite(async () => {
      const content = fileContent;
      await new Promise(r => setTimeout(r, 5));
      fileContent = content + '-B';
      writes.push('B');
    });

    // Run both - they will be serialized by the queue
    await settle(Promise.all([op1(), op2()]));

    // With queue: A runs first, then B reads A's result
    expect(fileContent).toBe('original-A-B');
    expect(writes).toEqual(['A', 'B']);
  });

  it('should allow parallel writes to different files', async () => {
    const files: Record<string, string> = {
      'file1.txt': 'content1',
      'file2.txt': 'content2',
    };
    const writes: string[] = [];

    // Per-file queue
    const queues = new Map<string, Promise<void>>();
    const queueWrite = async <T>(filePath: string, operation: () => Promise<T>): Promise<T> => {
      const currentQueue = queues.get(filePath) ?? Promise.resolve();
      const newQueue = currentQueue.catch(() => {}).then(operation);
      queues.set(filePath, newQueue.then(() => {}).catch(() => {}));
      return newQueue;
    };

    const op1 = () => queueWrite('file1.txt', async () => {
      await new Promise(r => setTimeout(r, 20));
      files['file1.txt'] += '-modified1';
      writes.push('file1');
    });

    const op2 = () => queueWrite('file2.txt', async () => {
      await new Promise(r => setTimeout(r, 5));
      files['file2.txt'] += '-modified2';
      writes.push('file2');
    });

    const start = Date.now();
    await settle(Promise.all([op1(), op2()]));
    const elapsed = Date.now() - start;

    // File2 should finish first (only 5ms delay) - parallel execution
    expect(writes[0]).toBe('file2');
    expect(writes[1]).toBe('file1');

    // Total time is 20ms (parallel), not 25ms (sequential)
    expect(elapsed).toBe(20);

    // Both files modified correctly
    expect(files['file1.txt']).toBe('content1-modified1');
    expect(files['file2.txt']).toBe('content2-modified2');
  });

  it('should handle errors without blocking subsequent writes', async () => {
    let fileContent = 'original';

    let currentQueue = Promise.resolve();
    const queueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
      const newQueue = currentQueue.catch(() => {}).then(operation);
      currentQueue = newQueue.then(() => {}).catch(() => {});
      return newQueue;
    };

    // First operation fails
    const op1 = () => queueWrite(async () => {
      throw new Error('Write failed');
    });

    // Second operation should still run
    const op2 = () => queueWrite(async () => {
      fileContent = 'modified';
    });

    // Run both
    await expect(op1()).rejects.toThrow('Write failed');
    await op2();

    // Second operation should have succeeded despite first failure
    expect(fileContent).toBe('modified');
  });
});
