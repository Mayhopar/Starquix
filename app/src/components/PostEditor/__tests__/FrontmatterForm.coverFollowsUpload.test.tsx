/**
 * Owner rule 2026-09-12: "Remove this rule that first uploaded photo is the
 * photo that becomes a cover and make it primary rule that photo uploaded into
 * attributes is the one that is on the card cover." The attribute the user
 * uploads into becomes the card's image field (bindLocalCardImageField) and the
 * post's cover preview follows it; on open the preview shows the field the card
 * is bound to, not the first image-typed property.
 */
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ bind: vi.fn(), read: vi.fn() }));
vi.mock('@/components/Editor/localFieldBind', () => ({ bindLocalCardImageField: (...a: unknown[]) => mocks.bind(...a), readLocalCardImageField: (...a: unknown[]) => mocks.read(...a) }));
vi.mock('@/core/collections/content-ops', () => ({ readRequiredLocalFields: async () => [], contentOps: { updatePost: vi.fn() } }));
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
  { id: 'f-photo', name: 'photo', type: 'image', required: false },
];
const cover = () => (document.querySelector('img[data-sq-post-cover]') as HTMLImageElement | null)?.getAttribute('src') ?? null;

function mount(initial: Record<string, unknown>, upload = async () => '/uploads/second.png') {
  function Form() {
    const [value, setValue] = useState(initial);
    return <FrontmatterForm frontmatter={value} fields={FIELDS} collectionId={null} localCollection="blog" postFile="src/content/blog/a.mdx" projectPath="wc://p"
      onChange={next => setValue(next as typeof initial)} onBlur={async () => true} onUploadMedia={upload} />;
  }
  return render(<Form />);
}
async function dropOn(field: string) {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  await act(async () => fireEvent.drop(screen.getByText(/Drop an image/i), {
    dataTransfer: { files: [new File(['x'], 'x.png', { type: 'image/png' })], types: ['Files'] },
  }));
}

beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(null); mocks.bind.mockResolvedValue({ ok: true }); });

describe('FrontmatterForm — the uploaded-into attribute is the cover', () => {
  it('uploading into a second image attribute makes it the cover and rebinds the card to it', async () => {
    mount({ title: 'lol', image: '/uploads/first.png', photo: '' });
    expect(cover()).toBe('blob:resolved//uploads/first.png');
    await dropOn('photo');
    expect(mocks.bind).toHaveBeenCalledWith('photo');
    expect(cover()).toBe('blob:resolved//uploads/second.png');
  });

  it('on open the cover is the field the card is bound to, not the first image-typed property', async () => {
    mocks.read.mockResolvedValue('photo');
    mount({ title: 'lol', image: '/uploads/first.png', photo: '/uploads/card.png' });
    await act(async () => { await Promise.resolve(); });
    expect(cover()).toBe('blob:resolved//uploads/card.png');
  });

  it('without a card binding the first image-typed property with a value stays the cover', async () => {
    mount({ title: 'lol', image: '', photo: '/uploads/only.png' });
    await act(async () => { await Promise.resolve(); });
    expect(cover()).toBe('blob:resolved//uploads/only.png');
    expect(mocks.bind).not.toHaveBeenCalled();
  });
});
