import { describe, it, expect } from 'vitest';
import { orderCategories } from '../categoryOrder';

describe('orderCategories', () => {
  it('orders known categories by page anatomy', () => {
    expect(orderCategories(['Footer', 'Pricing', 'Hero', 'Header'])).toEqual([
      'Header', 'Hero', 'Pricing', 'Footer',
    ]);
  });

  it('puts unknown categories after Footer, alphabetical', () => {
    expect(orderCategories(['Zeta', 'Header', 'Pages', 'Footer'])).toEqual([
      'Header', 'Footer', 'Pages', 'Zeta',
    ]);
  });

  it('pins Layouts then Project at the very end', () => {
    expect(orderCategories(['Project', 'Layouts', 'Hero', 'Unknown'])).toEqual([
      'Hero', 'Unknown', 'Layouts', 'Project',
    ]);
  });

  it('handles empty input', () => {
    expect(orderCategories([])).toEqual([]);
  });

  it('places Forms between Embed and Footer (task-115)', () => {
    expect(orderCategories(['Footer', 'Forms', 'Embed', 'Header'])).toEqual([
      'Header', 'Embed', 'Forms', 'Footer',
    ]);
  });
});
