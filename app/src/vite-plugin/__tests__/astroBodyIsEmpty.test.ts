import { describe, it, expect } from 'vitest';
import { astroBodyIsEmpty } from '../ast-updater';

describe('astroBodyIsEmpty', () => {
  it('returns true when an Astro file with frontmatter has a whitespace-only body', () => {
    const content = `---
import Foo from './Foo.astro';
---

`;
    expect(astroBodyIsEmpty(content)).toBe(true);
  });

  it('returns true when there is no frontmatter and only whitespace', () => {
    expect(astroBodyIsEmpty('   \n\t\n')).toBe(true);
    expect(astroBodyIsEmpty('')).toBe(true);
  });

  it('returns false when frontmatter is present and body has any tag', () => {
    const content = `---
import Foo from './Foo.astro';
---

<section>hi</section>
`;
    expect(astroBodyIsEmpty(content)).toBe(false);
  });

  it('returns false when there is no frontmatter and body has content', () => {
    expect(astroBodyIsEmpty('<div>hi</div>')).toBe(false);
  });

  it('returns true for a file with only the frontmatter delimiters and nothing else', () => {
    expect(astroBodyIsEmpty('---\n---\n')).toBe(true);
  });

  it('handles CRLF line endings the same as LF', () => {
    const content = `---\r\nimport Foo from './Foo.astro';\r\n---\r\n\r\n`;
    expect(astroBodyIsEmpty(content)).toBe(true);
  });

  it('does not treat HTML comments as body content (a file of only comments is effectively empty)', () => {
    // Intentional choice: an Astro file whose only body is `<!-- ... -->`
    // would still leave the component unrenderable. Treat as empty.
    const content = `---
---
<!-- placeholder -->
`;
    expect(astroBodyIsEmpty(content)).toBe(true);
  });
});
