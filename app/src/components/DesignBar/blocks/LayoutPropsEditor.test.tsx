import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockMutate = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/utils/mutateLayoutProp', () => ({ mutateLayoutProp: (...a: unknown[]) => mockMutate(...a) }));

import { LayoutPropsEditor } from './LayoutPropsEditor';

const PROPS = [{ name: 'heading', type: 'string', required: false }];

beforeEach(() => { mockMutate.mockClear(); });

describe('LayoutPropsEditor', () => {
  it('page mode: renders a value Field per prop seeded from values', () => {
    render(<LayoutPropsEditor layoutName="Marketing" propDefs={PROPS} mode="page" values={{ heading: 'Hi' }} onCommitValue={vi.fn()} />);
    expect(screen.getByLabelText('heading')).toHaveValue('Hi');
  });

  it('page mode: commits a value on blur', () => {
    const onCommitValue = vi.fn();
    render(<LayoutPropsEditor layoutName="Marketing" propDefs={PROPS} mode="page" values={{ heading: 'Hi' }} onCommitValue={onCommitValue} />);
    const input = screen.getByLabelText('heading');
    fireEvent.change(input, { target: { value: 'Bye' } });
    fireEvent.blur(input);
    expect(onCommitValue).toHaveBeenCalledWith('heading', 'Bye');
  });

  it('editor mode: renders NO value Field, but shows the prop name + delete', () => {
    render(<LayoutPropsEditor layoutName="Marketing" propDefs={PROPS} mode="editor" />);
    expect(screen.queryByLabelText('heading')).toBeNull();
    expect(screen.getByText('heading')).toBeInTheDocument();
    expect(screen.getByTitle('Delete property heading')).toBeInTheDocument();
  });

  it('deletes a prop via mutateLayoutProp', () => {
    render(<LayoutPropsEditor layoutName="Marketing" propDefs={PROPS} mode="editor" />);
    fireEvent.click(screen.getByTitle('Delete property heading'));
    expect(mockMutate).toHaveBeenCalledWith('Marketing', 'remove', 'heading');
  });

  it('adds a prop via mutateLayoutProp on Enter', () => {
    render(<LayoutPropsEditor layoutName="Marketing" propDefs={PROPS} mode="editor" />);
    const add = screen.getByLabelText('New property name');
    fireEvent.change(add, { target: { value: 'cta' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith('Marketing', 'add', 'cta');
  });

  it('rejects a reserved name without calling the server', () => {
    render(<LayoutPropsEditor layoutName="Marketing" propDefs={PROPS} mode="editor" />);
    const add = screen.getByLabelText('New property name');
    fireEvent.change(add, { target: { value: 'title' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
