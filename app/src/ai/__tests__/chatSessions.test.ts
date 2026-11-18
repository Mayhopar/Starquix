/** Browser-tab close logic for AI chat sessions (AIContext). */
import { describe, it, expect } from 'vitest';
import { nextActiveAfterClose } from '../AIContext';

describe('nextActiveAfterClose', () => {
  const ids = ['a', 'b', 'c'];

  it('closing the active tab activates the right neighbor', () => {
    expect(nextActiveAfterClose(ids, 'b', 'b')).toBe('c');
  });

  it('closing the active last tab activates the left neighbor', () => {
    expect(nextActiveAfterClose(ids, 'c', 'c')).toBe('b');
  });

  it('closing an inactive tab keeps the active one', () => {
    expect(nextActiveAfterClose(ids, 'a', 'c')).toBe('a');
  });

  it('closing the only tab returns null (caller creates a fresh one)', () => {
    expect(nextActiveAfterClose(['a'], 'a', 'a')).toBeNull();
  });
});
