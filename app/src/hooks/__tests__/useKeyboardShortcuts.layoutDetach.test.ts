import { describe, it, expect } from 'vitest';
import { layoutDeleteAction } from '../useKeyboardShortcuts';

describe('layoutDeleteAction', () => {
  it('returns detach for the Layout root key (layoutchrome-<pageId>)', () => {
    expect(layoutDeleteAction('layoutchrome-page-1')).toEqual({ type: 'detach' });
  });
  it('returns null for a chrome/slot child key (a normal element)', () => {
    expect(layoutDeleteAction('layoutchrome-page-1:slot-0')).toBeNull();
  });
  it('returns null for a normal element key', () => {
    expect(layoutDeleteAction('el-123:section-0')).toBeNull();
  });
  it('returns null for null/undefined', () => {
    expect(layoutDeleteAction(null)).toBeNull();
    expect(layoutDeleteAction(undefined)).toBeNull();
  });
});
