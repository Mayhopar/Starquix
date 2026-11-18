// task-133 Task 5: post-insert pending selection — one-shot, exact-line-only
// match against the next scan that covers the inserted file.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLocalPendingSelection,
  peekLocalPendingSelection,
  clearLocalPendingSelection,
  resolveLocalPendingMatch,
  getSelectionEpoch,
  noteSelectionChanged,
} from '../localPendingSelection';

const FILE = 'src/pages/index.astro';

describe('localPendingSelection store', () => {
  beforeEach(() => clearLocalPendingSelection());

  it('set → peek returns the predicted prefix; clear empties it', () => {
    setLocalPendingSelection(FILE, 12);
    expect(peekLocalPendingSelection()).toEqual({ file: FILE, predicted: `${FILE}:12:` });
    clearLocalPendingSelection();
    expect(peekLocalPendingSelection()).toBeNull();
  });

  // e2e A2 2026-11-10: the user's newer selection wins over a gesture's pending.
  it('a gesture whose selection changed before its write landed sets no pending, and never clears a newer one', () => {
    const epoch = getSelectionEpoch();
    setLocalPendingSelection(FILE, 3, epoch);
    expect(peekLocalPendingSelection()).toMatchObject({ predicted: `${FILE}:3:` });
    noteSelectionChanged();
    expect(peekLocalPendingSelection()).toBeNull(); // re-selected past: gone for every reader
    setLocalPendingSelection(FILE, 7, getSelectionEpoch()); // a newer gesture
    setLocalPendingSelection(FILE, 12, epoch);              // the older one lands late
    expect(peekLocalPendingSelection()).toMatchObject({ predicted: `${FILE}:7:` });
    setLocalPendingSelection(FILE, 20); // no epoch: never stale (callers without a gesture)
    noteSelectionChanged();
    expect(peekLocalPendingSelection()).toMatchObject({ predicted: `${FILE}:20:` });
  });
});

describe('resolveLocalPendingMatch', () => {
  const pending = { file: FILE, predicted: `${FILE}:12:` };

  it('matches the exact-line key when the scan covers the file', () => {
    const keys = [`${FILE}:3:1`, `${FILE}:12:5`, 'src/components/Hero.astro:2:1'];
    expect(resolveLocalPendingMatch(pending, keys)).toEqual({ key: `${FILE}:12:5`, consumed: true });
  });

  it('does NOT fuzz to ±1 lines — a shifted sibling must not be selected (carry-forward b)', () => {
    const keys = [`${FILE}:11:1`, `${FILE}:13:1`];
    expect(resolveLocalPendingMatch(pending, keys)).toEqual({ key: null, consumed: true });
  });

  it('skips instance-suffixed keys at the exact line', () => {
    const keys = [`${FILE}:12:5#1`, `${FILE}:3:1`];
    expect(resolveLocalPendingMatch(pending, keys)).toEqual({ key: null, consumed: true });
  });

  it('is not consumed by a scan that does not cover the file', () => {
    const keys = ['src/pages/about.astro:12:5', 'other-key'];
    expect(resolveLocalPendingMatch(pending, keys)).toEqual({ key: null, consumed: false });
  });

  it('consumes (match or not) on the first scan covering the file — no sticky pending', () => {
    // File present but nothing at line 12 (component emitted no data-sq-source).
    const keys = [`${FILE}:3:1`, `${FILE}:40:2`];
    expect(resolveLocalPendingMatch(pending, keys)).toEqual({ key: null, consumed: true });
  });
});
