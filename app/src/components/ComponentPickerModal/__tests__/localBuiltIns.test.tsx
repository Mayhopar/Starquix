// Materialize-on-insert reachability (gaps 11/36): in LOCAL mode the ⌘K
// picker lists the built-in library alongside the user's own components —
// picking a built-in flows through onSelectComponent into Editor's
// handleSelectComponent, whose local branch materializes it into the
// project's src/components/. The user's own components stay primary
// (their manifest/category placement is untouched).
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { db } from '@/db';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { addRootAt, insertTemplateComponents } from '@/store/pageTemplateInsert';
import { emptyClassData } from '@/store/types';
import * as storage from '@/services/durableEdits/store';

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

const comp = (over: Partial<ScannedComponent>): ScannedComponent => ({
  name: 'Navbar',
  path: 'library/Navbar.astro',
  source: 'built-in',
  html: '<nav/>',
  category: 'Header',
  props: [],
  slots: [],
  dependencies: [],
  ...over,
});

const builtInHero = comp({});
const ownComponent = comp({
  name: 'Own',
  path: 'src/components/Own.astro',
  source: 'user-project',
  category: 'Project',
});

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSelectComponent: vi.fn(),
  onSelectPageTemplate: vi.fn(),
  onSelectIcon: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  library.builtIn = [builtInHero];
  library.userProject = [ownComponent];
});
afterEach(() => vi.restoreAllMocks());

describe('picker acceptance failure', () => {
  it.each(['component', 'template'])('keeps the %s picker usable and surfaces rejected storage', async kind => {
    await db.delete(); await db.open();
    const doc = createEditorDoc(); doc.getMap('meta').set('projectId', 'picker-storage');
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-a', name: 'Home', rootElementIds: [], children: [] } });
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const add = () => addRootAt(doc, { type: 'ADD_ELEMENT', element: {
      id: 'el-new', pageId: 'page-a', parentId: null, index: 0, type: 'frame', classes: emptyClassData(),
    } }, 'page-a', 'el-new', 0);
    const template = async () => { await insertTemplateComponents({ doc, pageId: 'page-a', components: [builtInHero], generateId: () => 'el-new' }); };
    render(<ComponentPickerModal {...baseProps} onSelectComponent={add} onSelectPageTemplate={template} />);
    if (kind === 'template') fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    const card = screen.getAllByTestId(kind === 'template' ? 'page-template-item' : 'template-item')[0];
    fireEvent.click(card);
    expect(baseProps.onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/quota/i);
    expect(doc.getMap('elements').size).toBe(0);
    fireEvent.click(card);
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
    expect(doc.getMap('elements').has('el-new')).toBe(true);
  });
});

describe('⌘K picker lists built-ins in local mode (gaps 11/36)', () => {
  it('shows the built-in category alongside the user project category', () => {
    render(<ComponentPickerModal {...baseProps} localMode />);

    // Both left-column categories exist: the built-in anatomy folder AND the
    // user's own — neither hides the other.
    expect(screen.getByText('Header')).toBeTruthy();
    expect(screen.getByText('Project')).toBeTruthy();
  });

  it('picking a built-in fires onSelectComponent with the built-in entry', () => {
    render(<ComponentPickerModal {...baseProps} localMode />);

    // First category (Hero, anatomy order) is active — its card is rendered.
    const card = screen.getByTestId('template-item');
    fireEvent.click(card);

    expect(baseProps.onSelectComponent).toHaveBeenCalledTimes(1);
    expect(baseProps.onSelectComponent).toHaveBeenCalledWith(builtInHero);
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
