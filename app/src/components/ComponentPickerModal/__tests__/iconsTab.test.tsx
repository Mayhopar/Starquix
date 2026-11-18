// task-106: ⌘K Icons tab — renders grid, search filters, click reports (name, svg).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// svg?react imports resolve to data-URL strings under vitest — stub all icons
// (SearchField pulls SearchIcon/CloseIcon; same Proxy pattern as ui/__tests__).
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});

import { ComponentPickerModal } from '../ComponentPickerModal';

vi.mock('@/utils/iconLibrary', () => ({
  loadLucideIcons: vi.fn().mockResolvedValue({
    ArrowRight: '<svg data-icon="arrow-right"></svg>',
    ArrowLeft: '<svg data-icon="arrow-left"></svg>',
    House: '<svg data-icon="house"></svg>',
  }),
}));

vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [] }),
  layoutToScannedComponent: (l: unknown) => l,
}));

vi.mock('@/context/ThemesLibraryContext', () => ({
  useThemesLibrary: () => ({ themes: [], activeTheme: 'starquix' }),
  useActiveLibraryTheme: () => 'starquix',
}));

const onSelectIcon = vi.fn();
const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSelectComponent: vi.fn(),
  onSelectPageTemplate: vi.fn(),
  onSelectIcon,
};

describe('ComponentPickerModal Icons tab', () => {
  beforeEach(() => onSelectIcon.mockClear());

  it('renders the icon grid after lazy load', async () => {
    render(<ComponentPickerModal {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await waitFor(() => expect(screen.getByTestId('icon-ArrowRight')).toBeTruthy());
    expect(screen.getByTestId('icon-House')).toBeTruthy();
  });

  it('search filters icons by name substring', async () => {
    render(<ComponentPickerModal {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await waitFor(() => expect(screen.getByTestId('icon-ArrowRight')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Search icons...'), { target: { value: 'house' } });
    expect(screen.queryByTestId('icon-ArrowRight')).toBeNull();
    expect(screen.getByTestId('icon-House')).toBeTruthy();
  });

  it('click calls onSelectIcon with (name, svg)', async () => {
    render(<ComponentPickerModal {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await waitFor(() => expect(screen.getByTestId('icon-ArrowRight')).toBeTruthy());
    fireEvent.click(screen.getByTestId('icon-ArrowRight'));
    expect(onSelectIcon).toHaveBeenCalledWith('ArrowRight', '<svg data-icon="arrow-right"></svg>');
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});

describe('icon search normalization', () => {
  it('kebab-case query matches PascalCase icon names', async () => {
    render(<ComponentPickerModal {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await waitFor(() => expect(screen.getByTestId('icon-ArrowRight')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Search icons...'), { target: { value: 'arrow-right' } });
    expect(screen.getByTestId('icon-ArrowRight')).toBeTruthy();
    expect(screen.queryByTestId('icon-House')).toBeNull();
  });
});
