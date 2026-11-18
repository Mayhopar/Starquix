import { describe, it, expect } from 'vitest';
import type { ScannedComponent } from './useComponentLibrary';

describe('ScannedComponent shape', () => {
  it('allows the optional pageTemplate field', () => {
    const c: ScannedComponent = {
      name: 'BlogPost',
      path: 'library/BlogPost.astro',
      source: 'built-in',
      html: '',
      category: 'Pages',
      props: [],
      slots: ['default'],
      dependencies: [],
      pageTemplate: 'blog-post',
    };
    expect(c.pageTemplate).toBe('blog-post');
  });
});
