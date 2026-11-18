/**
 * Parity regression (gap: MediaBlock/SystemComponentBlock read-only on a
 * doc-bound post page): DesignBar's goToPostTarget doc-post-page branch required
 * `effectiveTagName === 'article'`, which a Media/sq-component child never is —
 * so the unit blocks always received `postTarget === null` and rendered
 * read-only even with a valid rehype write range. A unit selection inside the
 * rendered post body targets the SAME previewed post.
 */
import { describe, it, expect } from 'vitest';
import { docPostPageTarget } from '../postTarget';

const base = { collectionName: 'works', previewPostSlug: 'timepad' };

describe('docPostPageTarget', () => {
  it('article post root targets the previewed post (pre-existing behavior)', () => {
    expect(docPostPageTarget({ ...base, effectiveTagName: 'article', isUnitSelection: false }))
      .toEqual({ collection: 'works', slug: 'timepad' });
  });

  it('a Media/sq-component unit selection targets the same post (was article-only)', () => {
    expect(docPostPageTarget({ ...base, effectiveTagName: 'img', isUnitSelection: true }))
      .toEqual({ collection: 'works', slug: 'timepad' });
    expect(docPostPageTarget({ ...base, effectiveTagName: 'div', isUnitSelection: true }))
      .toEqual({ collection: 'works', slug: 'timepad' });
  });

  it('a plain non-unit selection still does not target the post', () => {
    expect(docPostPageTarget({ ...base, effectiveTagName: 'div', isUnitSelection: false }))
      .toBeNull();
  });

  it('no post-page binding or no previewed post → null', () => {
    expect(docPostPageTarget({ collectionName: null, previewPostSlug: 'timepad', effectiveTagName: 'article', isUnitSelection: true }))
      .toBeNull();
    expect(docPostPageTarget({ collectionName: 'works', previewPostSlug: null, effectiveTagName: 'article', isUnitSelection: true }))
      .toBeNull();
  });
});
