// Regression (owner 2026-09-13): a hot update re-ran a context module and minted a second context → "needs to recover".
import { describe, it, expect } from 'vitest';
import { stableContext } from '../stableContext';

describe('stableContext', () => {
  it('returns the same context object for the same name across module re-executions', () => {
    const first = stableContext<number | null>('Test.Counter', null);
    expect(stableContext<number | null>('Test.Counter', null)).toBe(first);
    expect(stableContext('Test.Other', null)).not.toBe(first);
  });
});
