/**
 * ContentFieldPicker — field filter regression test
 *
 * Before fix: `filterTypes.includes(f.type) || filterTypes.includes('text')`
 * collapsed to `true` whenever 'text' was requested, so the picker for
 * text/heading elements listed every field type (images, urls, booleans...)
 * instead of only text + date.
 *
 * This test renders the picker with a mixed-type collection and asserts the
 * <option> list contains only fields whose type is in filterTypes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();

type Field = { id: string; name: string; type: string; required: boolean };
let mockBinding: { collectionId: string; bindings: Record<string, string> } | null = null;
let mockCollection: { id: string; name: string; fields: Field[] } | undefined = undefined;

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useEditorDoc: () => ({} as unknown),
  useYjsValue: (fn: (doc: unknown) => unknown) => fn({}),
}));

vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollection: () => mockCollection,
  selectContentCollections: () => (mockCollection ? [mockCollection] : []),
}));

vi.mock('@/store/selectors', () => ({
  selectPostPageBinding: () => null,
}));

vi.mock('@/core/collections/yjsAccessors', () => ({
  readBlogSlotBinding: () => mockBinding,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: { writeContentConfig: vi.fn().mockResolvedValue(undefined) },
}));

import { ContentFieldPicker } from '../ContentFieldPicker';

const mixedFields: Field[] = [
  { id: 'f1', name: 'title', type: 'text', required: true },
  { id: 'f2', name: 'date', type: 'date', required: true },
  { id: 'f3', name: 'description', type: 'text', required: false },
  { id: 'f4', name: 'thumbnail', type: 'image', required: false },
  { id: 'f5', name: 'externalUrl', type: 'url', required: false },
  { id: 'f6', name: 'featured', type: 'boolean', required: false },
  { id: 'f7', name: 'tags', type: 'list', required: false },
];

function setUp() {
  mockBinding = { collectionId: 'col-1', bindings: {} };
  mockCollection = { id: 'col-1', name: 'blog', fields: mixedFields };
}

function optionNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('option'))
    .map(o => o.getAttribute('value') ?? '')
    .filter(v => v && v !== '__new__');
}

describe('ContentFieldPicker — filterTypes', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    mockTakeSnapshot.mockReset();
    setUp();
  });

  it('text+date filter shows only text and date fields (not image/url/boolean/list)', () => {
    const { container } = render(
      <ContentFieldPicker
        elementKey="el-1"
        slotKey="slot-1"
        filterTypes={['text', 'date']}
        autoFieldType="text"
      />
    );
    expect(optionNames(container).sort()).toEqual(['date', 'description', 'title']);
  });

  it('image filter shows only image fields', () => {
    const { container } = render(
      <ContentFieldPicker
        elementKey="el-1"
        slotKey="slot-1"
        filterTypes={['image']}
        autoFieldType="image"
      />
    );
    expect(optionNames(container)).toEqual(['thumbnail']);
  });

  it('url filter shows only url fields', () => {
    const { container } = render(
      <ContentFieldPicker
        elementKey="el-1"
        slotKey="slot-1"
        filterTypes={['url']}
        autoFieldType="url"
      />
    );
    expect(optionNames(container)).toEqual(['externalUrl']);
  });
});
