import { describe, it, expect } from 'vitest';
import { addDataKeys } from './addDataKeys';

describe('addDataKeys', () => {
  it('adds data-key to elements without one', () => {
    const html = '<div><p>Hello</p></div>';
    const result = addDataKeys(html);
    expect(result).toBe('<div data-key="div-0"><p data-key="p-0">Hello</p></div>');
  });

  it('preserves existing data-key attributes', () => {
    const html = '<div data-key="existing"><p>Hello</p></div>';
    const result = addDataKeys(html);
    expect(result).toContain('data-key="existing"');
    expect(result).toContain('data-key="p-0"');
  });

  it('skips SVG and script tags', () => {
    const html = '<div><svg><path d="M0 0"/></svg><script>alert(1)</script></div>';
    const result = addDataKeys(html);
    expect(result).not.toContain('data-key="svg-');
    expect(result).not.toContain('data-key="path-');
    expect(result).not.toContain('data-key="script-');
  });

  it('handles self-closing tags', () => {
    const html = '<div><img src="a.jpg"/><br/></div>';
    const result = addDataKeys(html);
    expect(result).toContain('data-key="div-0"');
    expect(result).not.toContain('data-key="img-');
    expect(result).not.toContain('data-key="br-');
  });

  it('increments counts for multiple same tags', () => {
    const html = '<div><p>One</p><p>Two</p><p>Three</p></div>';
    const result = addDataKeys(html);
    expect(result).toContain('data-key="p-0"');
    expect(result).toContain('data-key="p-1"');
    expect(result).toContain('data-key="p-2"');
  });
});
