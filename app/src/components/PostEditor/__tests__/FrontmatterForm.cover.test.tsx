/**
 * Owner report 2026-09-10: "when I go to the post itself that has an image
 * there's no image". The writing surface renders only the MDX body, so the
 * post's frontmatter image (the cover the site's own post page shows) never
 * appeared — only as a 20px thumb inside a collapsed Properties row. The form
 * now renders the first image-typed property with a value as the cover.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/core/collections/content-ops', () => ({ contentOps: { updatePost: vi.fn() } }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
vi.mock('../usePostPropertyImage', () => ({
  usePostPropertyImage: (value: string) => ({ url: value ? `blob:resolved/${value}` : null, unavailable: false }),
}));

import { FrontmatterForm } from '../FrontmatterForm';
import type { CollectionField } from '@/core/collections/types';

const FIELDS: CollectionField[] = [
  { id: 'f-title', name: 'title', type: 'text', required: true },
  { id: 'f-image', name: 'image', type: 'image', required: false },
];

function mount(frontmatter: Record<string, unknown>) {
  render(<FrontmatterForm frontmatter={frontmatter} fields={FIELDS} collectionId={null} postFile="src/content/works/lol.mdx" projectPath="wc://p" onChange={() => {}} onBlur={() => {}} />);
}

describe('FrontmatterForm — cover image', () => {
  it('renders the image property as the post cover', () => {
    mount({ title: 'lol', image: './images/uploads/cover.png' });
    const cover = document.querySelector('img[data-sq-post-cover]') as HTMLImageElement | null;
    expect(cover?.getAttribute('src')).toBe('blob:resolved/./images/uploads/cover.png');
  });

  it('renders no cover when no image property has a value', () => {
    mount({ title: 'lol', image: '' });
    expect(document.querySelector('img[data-sq-post-cover]')).toBeNull();
    expect(screen.getByPlaceholderText('Title')).toBeTruthy();
  });
});
