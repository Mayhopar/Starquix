import { describe, it, expect } from 'vitest';
import themes from '../themes.json';

describe('bundled themes artifact', () => {
  it('has license header and 50+ themes with id/name/markdown', () => {
    expect(themes.license).toBe('MIT');
    expect(themes.source).toContain('VoltAgent/awesome-design-md');
    expect(themes.themes.length).toBeGreaterThan(50);
    for (const t of themes.themes) {
      expect(t.id).toMatch(/^[a-z0-9.-]+$/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.markdown.length).toBeGreaterThan(50);
    }
  });
});
