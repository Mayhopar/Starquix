import { describe, it, expect } from 'vitest';
import { reduceSaveStatus, type SaveStatus } from '../editorSaveStatus';
import type { PushResult } from '@/utils/pushOverridesToSource';

const ok = (skipped: PushResult['skipped'] = []): PushResult =>
  ({ astroSource: 'a.astro', skipped, appliedTotal: 1 });

describe('reduceSaveStatus', () => {
  it('EDIT from any state → dirty', () => {
    const states: SaveStatus[] = [
      { state: 'idle' }, { state: 'saving' }, { state: 'saved', at: 1 },
      { state: 'error', message: 'x' },
    ];
    for (const s of states) {
      expect(reduceSaveStatus(s, { type: 'EDIT' })).toEqual({ state: 'dirty' });
    }
  });

  it('dirty → FLUSH_START → saving → FLUSH_SUCCESS(clean) → saved', () => {
    let s = reduceSaveStatus({ state: 'dirty' }, { type: 'FLUSH_START' });
    expect(s.state).toBe('saving');
    s = reduceSaveStatus(s, { type: 'FLUSH_SUCCESS', result: ok() });
    expect(s.state).toBe('saved');
  });

  it('FLUSH_SUCCESS with skips → saved-with-skips carrying the list', () => {
    const skipped = [{ source: 'a.astro', category: 'classes' as const, selector: 'h1-9', reason: 'unresolved' as const }];
    const s = reduceSaveStatus({ state: 'saving' }, { type: 'FLUSH_SUCCESS', result: ok(skipped) });
    expect(s).toMatchObject({ state: 'saved-with-skips', skipped });
  });

  it('RACE: late FLUSH_SUCCESS must not clobber dirty (edit arrived mid-flight)', () => {
    // saving → EDIT → dirty; then the stale flush resolves
    const dirty = reduceSaveStatus({ state: 'saving' }, { type: 'EDIT' });
    expect(reduceSaveStatus(dirty, { type: 'FLUSH_SUCCESS', result: ok() })).toEqual({ state: 'dirty' });
    expect(reduceSaveStatus(dirty, { type: 'FLUSH_ERROR', message: 'x' })).toEqual({ state: 'dirty' });
  });

  it('FLUSH_START only transitions from dirty (component-switch flush with nothing pending stays put)', () => {
    expect(reduceSaveStatus({ state: 'idle' }, { type: 'FLUSH_START' })).toEqual({ state: 'idle' });
    expect(reduceSaveStatus({ state: 'saved', at: 1 }, { type: 'FLUSH_START' })).toEqual({ state: 'saved', at: 1 });
  });

  it('FLUSH_ERROR while saving → error; RESET → idle', () => {
    expect(reduceSaveStatus({ state: 'saving' }, { type: 'FLUSH_ERROR', message: 'boom' }))
      .toEqual({ state: 'error', message: 'boom' });
    expect(reduceSaveStatus({ state: 'error', message: 'boom' }, { type: 'RESET' }))
      .toEqual({ state: 'idle' });
  });
});
