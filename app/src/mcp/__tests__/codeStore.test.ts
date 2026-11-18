import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStoredCode, setStoredCode, mcpCodeKey, adoptCodeFromUrl, takePendingCode, PENDING_CODE_KEY } from '../codeStore';

describe('mcp codeStore', () => {
  beforeEach(() => localStorage.clear());
  it('is per project', () => {
    setStoredCode('browser_a', 'CODE-A');
    expect(getStoredCode('browser_a')).toBe('CODE-A');
    expect(getStoredCode('browser_b')).toBeNull();
    expect(localStorage.getItem(mcpCodeKey('browser_a'))).toBe('CODE-A');
  });

  it('adoptCodeFromUrl parks ?mcp= as pending and strips it from the URL', () => {
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    expect(adoptCodeFromUrl({ search: '?x=1&mcp=ABC-DEF', pathname: '/editor/browser_a', hash: '' })).toBe('ABC-DEF');
    expect(localStorage.getItem(PENDING_CODE_KEY)).toBe('ABC-DEF');
    expect(replace.mock.calls[0]?.[2]).toBe('/editor/browser_a?x=1');
    expect(adoptCodeFromUrl({ search: '', pathname: '/', hash: '' })).toBeNull();
    replace.mockRestore();
  });
  it('the next editor adopts the pending code as its own, once', () => {
    localStorage.setItem(PENDING_CODE_KEY, 'PEND');
    expect(takePendingCode('browser_a')).toBe('PEND');
    expect(getStoredCode('browser_a')).toBe('PEND');
    expect(localStorage.getItem(PENDING_CODE_KEY)).toBeNull();
    expect(takePendingCode('browser_b')).toBeNull();
  });
});
