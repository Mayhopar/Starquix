/**
 * PageLayoutBlock Tests
 *
 * Page-context block (nothing selected): shows the current page layout name and
 * an input per declared layout prop bound to page.layoutProps. Layout actions
 * (Detach / Edit source) moved to the selected-layout header's LayoutMenu. Prop
 * commits go through SET_PAGE_LAYOUT with takeSnapshot() first.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockMutate = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/utils/mutateLayoutProp', () => ({ mutateLayoutProp: (...a: unknown[]) => mockMutate(...a) }));
let mockLayout: { layoutName: string | null; layoutProps: Record<string, string> } = {
  layoutName: null,
  layoutProps: {},
};
let mockLayouts: Array<{ name: string; props: Array<{ name: string; type: string; required: boolean; defaultValue?: string }> }> = [];

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: (selector: unknown) => (typeof selector === 'function' ? mockLayout : mockLayout),
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: mockLayouts, isLoading: false, error: null, refresh: vi.fn() }),
}));

// Import LAST so mocks are wired up first
import { PageLayoutBlock } from './PageLayoutBlock';

beforeEach(() => {
  mockDispatch.mockClear();
  mockTakeSnapshot.mockClear();
  mockMutate.mockClear();
  mockLayout = { layoutName: null, layoutProps: {} };
  mockLayouts = [];
});

describe('PageLayoutBlock', () => {
  it('renders nothing when the page has no layout', () => {
    const { container } = render(<PageLayoutBlock pageId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a Field per declared non-reserved prop, populated from layoutProps', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: { variant: 'Hello' } };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'variant', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    // The layout name lives in the selected-layout header now, not in this block.
    expect(screen.getByLabelText('variant')).toHaveValue('Hello');
  });

  it('renders no prop Field for reserved-only layouts but still shows the Add row', () => {
    mockLayout = { layoutName: 'Layout', layoutProps: {} };
    mockLayouts = [{ name: 'Layout', props: [{ name: 'title', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    // title is SEO-reserved → no Field for it
    expect(screen.queryByLabelText('title')).toBeNull();
    // ...but the Add-property row always shows when a layout is selected
    expect(screen.getByLabelText('New property name')).toBeInTheDocument();
  });

  it('commits a changed prop via SET_PAGE_LAYOUT with merged props + takeSnapshot', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: { variant: 'Hello' } };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'variant', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    const input = screen.getByLabelText('variant');
    fireEvent.change(input, { target: { value: 'Updated' } });
    fireEvent.blur(input);

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_PAGE_LAYOUT',
      pageId: 'p1',
      layoutName: 'Marketing',
      layoutProps: { variant: 'Updated' },
    });
  });

  it('does not dispatch when a prop is unchanged', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: { variant: 'Hello' } };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'variant', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    fireEvent.blur(screen.getByLabelText('variant'));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does not render inputs for reserved (seo-owned) props', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: {} };
    mockLayouts = [{ name: 'Marketing', props: [
      { name: 'title', type: 'string', required: false },
      { name: 'variant', type: 'string', required: false },
    ] }];
    render(<PageLayoutBlock pageId="p1" />);
    expect(screen.queryByLabelText('title')).toBeNull();
    expect(screen.getByLabelText('variant')).toBeInTheDocument();
  });

  it('renders only prop inputs — no Detach / Edit source buttons (those moved to the header LayoutMenu)', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: { variant: 'Hello' } };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'variant', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    expect(screen.queryByRole('button', { name: /detach/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit layout source/i })).toBeNull();
    expect(screen.getByLabelText('variant')).toBeInTheDocument();
  });

  it('renders an Add property control and creates a prop via mutateLayoutProp', async () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: {} };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'heading', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    const add = screen.getByLabelText('New property name');
    fireEvent.change(add, { target: { value: 'cta' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith('Marketing', 'add', 'cta');
  });

  it('rejects a reserved name without calling the server', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: {} };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'heading', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    const add = screen.getByLabelText('New property name');
    fireEvent.change(add, { target: { value: 'title' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('deletes a prop via mutateLayoutProp', () => {
    mockLayout = { layoutName: 'Marketing', layoutProps: { heading: 'Hi' } };
    mockLayouts = [{ name: 'Marketing', props: [{ name: 'heading', type: 'string', required: false }] }];
    render(<PageLayoutBlock pageId="p1" />);
    fireEvent.click(screen.getByTitle('Delete property heading'));
    expect(mockMutate).toHaveBeenCalledWith('Marketing', 'remove', 'heading');
  });
});
