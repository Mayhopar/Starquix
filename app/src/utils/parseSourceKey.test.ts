// src/utils/parseSourceKey.test.ts
import { describe, it, expect } from 'vitest';
import { parseSourceKey } from './parseSourceKey';

describe('parseSourceKey', () => {
  it('should parse legacy format id:1:1', () => {
    const result = parseSourceKey('comp-001:1:1');
    expect(result.type).toBe('legacy');
    if (result.type === 'legacy') {
      expect(result.key).toBe('comp-001:1:1');
    }
  });

  it('should parse legacy format file:line:column', () => {
    const result = parseSourceKey('Hero.astro:5:1');
    expect(result.type).toBe('legacy');
  });

  it('should parse instance format instanceId:childId', () => {
    const result = parseSourceKey('instance-001:hero-h1');
    expect(result.type).toBe('instance');
    if (result.type === 'instance') {
      expect(result.instanceId).toBe('instance-001');
      expect(result.childId).toBe('hero-h1');
    }
  });
});
