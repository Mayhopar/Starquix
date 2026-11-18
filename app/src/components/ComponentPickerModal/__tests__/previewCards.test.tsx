// task-133 Fix C: a LOCAL project's component must never borrow a built-in
// preview PNG. Observed live: the user's own `src/components/Header.astro`
// showed a screenshot of Starquix's own marketing-site header, because the
// picker looked previews up by bare component name.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

// Same stub set as tabGating.test.tsx (SearchField pulls icon assets).
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});

vi.mock('@/utils/iconLibrary', () => ({
  loadLucideIcons: vi.fn().mockResolvedValue({}),
}));

const library = vi.hoisted(() => ({
  builtIn: [] as ScannedComponent[],
  userProject: [] as ScannedComponent[],
}));

vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({
    builtIn: library.builtIn,
    userProject: library.userProject,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [] }),
  layoutToScannedComponent: (l: unknown) => l,
}));

vi.mock('@/context/ThemesLibraryContext', () => ({
  useThemesLibrary: () => ({ themes: [], activeTheme: 'starquix', getThemeComponents: vi.fn() }),
  useActiveLibraryTheme: () => 'starquix',
}));

import { ComponentPickerModal } from '../ComponentPickerModal';

const header = (over: Partial<ScannedComponent>): ScannedComponent => ({
  name: 'Header',
  path: 'library/Header.astro',
  source: 'built-in',
  html: '',
  category: 'Header',
  props: [],
  slots: [],
  dependencies: [],
  ...over,
});

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSelectComponent: vi.fn(),
  onSelectPageTemplate: vi.fn(),
  onSelectIcon: vi.fn(),
};

describe('picker preview cards (task-133 Fix C)', () => {
  it('a local user-project Header shows the placeholder, NOT the built-in PNG', () => {
    library.builtIn = [];
    library.userProject = [
      header({ source: 'user-project', path: 'src/components/Header.astro', category: 'Project' }),
    ];

    render(<ComponentPickerModal {...baseProps} localMode />);

    // The card is there...
    expect(screen.getByTestId('template-item')).toBeTruthy();
    // ...but with no image at all — the grey name placeholder.
    expect(screen.queryByAltText('Header')).toBeNull();
  });

  it('a built-in Header still gets its generated PNG (regression pin)', () => {
    library.builtIn = [header({})];
    library.userProject = [];

    render(<ComponentPickerModal {...baseProps} />);

    const img = screen.getByAltText('Header') as HTMLImageElement;
    expect(img.getAttribute('src')).toBeTruthy();
  });
});
