import { describe, it, expect } from 'vitest';
import catalog from '../fontCatalog.json';

describe('fontCatalog.json', () => {
  it('has 1000+ families each with name, category, weights', () => {
    expect(catalog.families.length).toBeGreaterThan(1000);
    for (const f of catalog.families.slice(0, 50)) {
      expect(typeof f.f).toBe('string');
      expect(typeof f.c).toBe('string');
      expect(f.w.length).toBeGreaterThan(0);
    }
  });
  it('every curated family exists in the catalog', () => {
    const names = new Set(catalog.families.map((f: { f: string }) => f.f));
    for (const name of catalog.curated) expect(names.has(name), name).toBe(true);
  });
});
