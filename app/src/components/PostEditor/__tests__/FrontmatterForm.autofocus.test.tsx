/**
 * New-post polish: a freshly created post opens with an empty title, and the
 * user landed here to type one — the Title textarea auto-focuses on first
 * mount. A post that already has a title must NOT get its focus stolen.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/collections/content-ops', () => ({ contentOps: { updatePost: vi.fn() } }));
vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(),
  useEditorDoc: () => ({}),
  useYjsValue: () => [],
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
  useOptionalUndoContext: () => null,
}));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));

import { FrontmatterForm } from '../FrontmatterForm';
import type { CollectionField } from '@/core/collections/types';

const FIELDS: CollectionField[] = [
  { id: 'f-title', name: 'title', type: 'text', required: true },
];

function mount(frontmatter: Record<string, unknown>) {
  render(
    <FrontmatterForm
      frontmatter={frontmatter}
      fields={FIELDS}
      collectionId={null}
      onChange={() => {}}
      onBlur={() => {}}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('FrontmatterForm — title autofocus', () => {
  it('focuses the Title textarea when the title is empty on first mount', () => {
    mount({});
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'));
  });

  it('does not steal focus when a title already exists', () => {
    mount({ title: 'Hello' });
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Title'));
  });
});
