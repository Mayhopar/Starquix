// app/src/utils/projectId.test.ts
import { describe, it, expect } from 'vitest';
import { PROJECT_ID_PREFIX, createProjectId, parseProjectId, detectModeFromProjectId } from './projectId';

describe('projectId utilities', () => {
  describe('createProjectId', () => {
    it('should prefix browser IDs', () => {
      expect(createProjectId('browser', '1706000000')).toBe('browser_1706000000');
    });

    it('should not double-prefix already prefixed IDs', () => {
      expect(createProjectId('browser', 'browser_abc123')).toBe('browser_abc123');
    });

    it('should throw error for empty rawId', () => {
      expect(() => createProjectId('browser', '')).toThrow('rawId cannot be empty');
    });
  });

  describe('parseProjectId', () => {
    it('should parse browser prefixed IDs', () => {
      const result = parseProjectId('browser_1706000000');
      expect(result.mode).toBe('browser');
      expect(result.rawId).toBe('1706000000');
    });

    it('treats stale local_ ids as browser mode (local mode removed)', () => {
      expect(parseProjectId('local_/Users/x/site')).toEqual({ mode: 'browser', rawId: 'local_/Users/x/site' });
      expect(detectModeFromProjectId('browser_lf_abc')).toBe('browser');
    });

    it('should treat unprefixed IDs as browser (no cloud)', () => {
      const result = parseProjectId('abc123');
      expect(result.mode).toBe('browser');
      expect(result.rawId).toBe('abc123');
    });

    it('should handle rawId containing underscores', () => {
      // rawId itself can contain underscores - only the prefix matters
      const result = parseProjectId('browser_my_project_with_underscores');
      expect(result.mode).toBe('browser');
      expect(result.rawId).toBe('my_project_with_underscores');
    });
  });

  describe('PREFIX constants', () => {
    it('should have correct prefixes', () => {
      expect(PROJECT_ID_PREFIX.BROWSER).toBe('browser_');
    });

    it('an unknown prefix (e.g. a stale id from the removed cloud runtime) parses as browser', () => {
      const stale = ['cloud', 'abc'].join('_');
      expect((PROJECT_ID_PREFIX as Record<string, string>).CLOUD).toBeUndefined();
      expect(parseProjectId(stale).mode).toBe('browser');
    });
  });
});
