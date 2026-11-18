// task-133 Task 5: local mode gates the ⌘K picker to the Components tab only.
// Pages presets and the icon materializer write into starquix's own repo
// (task-147 icon file-leak) — those surfaces must not exist for local projects.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Same stub set as iconsTab.test.tsx (SearchField pulls icon assets).
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});

import { ComponentPickerModal } from '../ComponentPickerModal';

vi.mock('@/utils/iconLibrary', () => ({
  loadLucideIcons: vi.fn().mockResolvedValue({}),
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

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSelectComponent: vi.fn(),
  onSelectPageTemplate: vi.fn(),
  onSelectIcon: vi.fn(),
};

describe('ComponentPickerModal tab gating (task-133)', () => {
  it('localMode renders Components + Icons (icons materialize into the project), never Pages', () => {
    render(<ComponentPickerModal {...baseProps} localMode />);
    expect(screen.getByRole('tab', { name: 'Components' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Pages' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Icons' })).toBeTruthy();
  });

  it('without localMode all three tabs render (regression pin)', () => {
    render(<ComponentPickerModal {...baseProps} />);
    expect(screen.getByRole('tab', { name: 'Components' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Icons' })).toBeTruthy();
  });
});
