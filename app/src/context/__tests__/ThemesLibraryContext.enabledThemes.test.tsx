import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { db } from '@/db';

vi.mock('@/services/ThemeProcessor', () => ({
  processThemeZip: vi.fn(),
  ThemeZipError: class extends Error {},
}));

import { ThemesLibraryProvider, useThemesLibrary } from '../ThemesLibraryContext';

let api: ReturnType<typeof useThemesLibrary>;
function Probe() {
  api = useThemesLibrary();
  return (
    <>
      <div data-testid="active">{api.activeTheme}</div>
      <div data-testid="themes">{api.themes.map((t) => t.name).join(',')}</div>
    </>
  );
}
const mount = (projectId: string) =>
  render(<ThemesLibraryProvider projectId={projectId}><Probe /></ThemesLibraryProvider>);
const row = (projectId: string) => db.projectThemes.get(`${projectId}:@active`);
const putTheme = (id: string, name: string) => {
  const now = new Date();
  return db.themes.put({ id, name, slug: name, componentCount: 2, createdAt: now, updatedAt: now });
};

describe('ThemesLibraryProvider — the project theme (⌘K)', () => {
  beforeEach(async () => {
    await Promise.all([db.themes.clear(), db.projectThemes.clear()]);
  });

  it('a project with no saved theme (from before themes) opens on Classic, without writing', async () => {
    mount('p1');
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('classic'));
    expect(await row('p1')).toBeUndefined();
  });

  it('uploads from earlier sessions are listed, and a saved upload is the active theme', async () => {
    await putTheme('t1', 'import-basic');
    await db.projectThemes.put({ id: 'p1:@active', projectId: 'p1', themeId: 'upload:t1', enabled: true });
    mount('p1');
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('upload:t1'));
    expect(screen.getByTestId('themes').textContent).toBe('import-basic');
  });

  it('a saved upload that no longer exists falls back to Starquix and is repaired', async () => {
    await db.projectThemes.put({ id: 'p1:@active', projectId: 'p1', themeId: 'upload:gone', enabled: true });
    mount('p1');
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('starquix'));
    await waitFor(async () => expect((await row('p1'))?.themeId).toBe('starquix'));
  });

  it('setActiveTheme saves the pick; deleting the active upload moves the project to Starquix', async () => {
    await putTheme('t1', 'kit');
    mount('p1');
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('classic'));
    await act(() => api.setActiveTheme('upload:t1'));
    expect(screen.getByTestId('active').textContent).toBe('upload:t1');
    expect((await row('p1'))?.themeId).toBe('upload:t1');
    await act(() => api.deleteTheme('t1'));
    expect(screen.getByTestId('active').textContent).toBe('starquix');
    expect((await row('p1'))?.themeId).toBe('starquix');
  });

  // Owner 2026-11-10: delete anything AND undo — the ⌘Z deleteTheme hands back restores every row it removed or moved.
  it('the delete returns its ⌘Z: the upload, its components and files, and every project using it come back', async () => {
    await putTheme('t1', 'kit');
    await db.themeComponents.put({ id: 't1:Hero', themeId: 't1', name: 'Hero', path: 'Hero.astro', html: '<h1/>', source: '', dependencies: [] } as never);
    await db.themeFiles.put({ id: 't1:a.css', themeId: 't1', path: 'a.css', content: 'a', isText: true } as never);
    mount('p1');
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('classic'));
    await act(() => api.setActiveTheme('upload:t1'));
    let undo!: () => Promise<void>;
    await act(async () => { undo = await api.deleteTheme('t1'); });
    expect(await db.themes.get('t1')).toBeUndefined();
    await act(() => undo());
    expect(screen.getByTestId('themes').textContent).toBe('kit');
    expect(screen.getByTestId('active').textContent).toBe('upload:t1');
    expect((await row('p1'))?.themeId).toBe('upload:t1');
    expect(await db.themeComponents.get('t1:Hero')).toBeTruthy();
    expect(await db.themeFiles.get('t1:a.css')).toBeTruthy();
  });
});
