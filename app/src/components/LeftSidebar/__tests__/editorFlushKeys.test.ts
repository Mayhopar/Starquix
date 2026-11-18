/**
 * The 800ms editor auto-flush only schedules a write-back for override sub-maps
 * it watches. Regression pin: attributeOverrides (slot-name editing) must be in
 * the watched set, else only the FIRST edit flushes (via the new-key observer)
 * and subsequent name edits silently wait for a tab/component switch.
 */
import { describe, it, expect } from 'vitest';
import { EDITOR_FLUSH_OVERRIDE_MAP_KEYS } from '../editorFlushKeys';

describe('EDITOR_FLUSH_OVERRIDE_MAP_KEYS', () => {
  it('watches attributeOverrides so slot-name edits auto-flush', () => {
    expect(EDITOR_FLUSH_OVERRIDE_MAP_KEYS).toContain('attributeOverrides');
  });

  it('still watches the core override maps collected by pushOverridesToSource', () => {
    for (const k of ['classOverrides', 'textOverrides', 'imageOverrides', 'linkOverrides']) {
      expect(EDITOR_FLUSH_OVERRIDE_MAP_KEYS).toContain(k);
    }
  });
});
