// Availability gating: isAvailable(ctx) entries are excluded from tool
// generation when the predicate returns false (search_stock_images needs a
// Pexels key, generate_image needs an image-capable provider).
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx } from './testCtx';

describe('isAvailable filtering', () => {
  it('hides search_stock_images and generate_image when their providers are missing', () => {
    const tools = generateCommandTools(makeCtx({ availability: { hasPexelsKey: false, hasImageGen: false } }));
    expect(tools.search_stock_images).toBeUndefined();
    expect(tools.generate_image).toBeUndefined();
  });
  it('exposes each one when its provider is configured', () => {
    const pexels = generateCommandTools(makeCtx({ availability: { hasPexelsKey: true, hasImageGen: false } }));
    expect(pexels.search_stock_images).toBeDefined();
    expect(pexels.generate_image).toBeUndefined();
    const gen = generateCommandTools(makeCtx({ availability: { hasPexelsKey: false, hasImageGen: true } }));
    expect(gen.generate_image).toBeDefined();
    expect(gen.search_stock_images).toBeUndefined();
  });
  // No Pexels key = generate_image is the only image source, yet its description said
  // "Prefer search_stock_images; use this only when stock photos cannot match".
  it('generate_image never tells the agent to avoid it when stock search is absent', () => {
    const gen = generateCommandTools(makeCtx({ availability: { hasPexelsKey: false, hasImageGen: true } }));
    expect(gen.generate_image.description).not.toMatch(/use this only when stock/i);
    expect(gen.generate_image.description).toMatch(/otherwise use this for every image/i);
  });
  it('always exposes push_instance_to_source (no runtime gate)', () => {
    const tools = generateCommandTools(makeCtx());
    expect(tools.push_instance_to_source).toBeDefined();
    expect(tools.push_blog_card_to_source).toBeUndefined();
    expect(tools.reset_blog_card).toBeUndefined();
  });
});
