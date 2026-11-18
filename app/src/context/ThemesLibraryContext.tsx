/**
 * Themes Library Context
 *
 * Uploaded themes (IndexedDB) and the open project's ⌘K theme (docs/plans/2026-11-08-theme-selector-design.md).
 */

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { db } from '@/db';
import type { DBTheme, DBThemeComponent } from '@/db/types';
import { processThemeZip } from '@/services/ThemeProcessor';
import { readProjectLibraryTheme, saveProjectLibraryTheme } from '@/services/projectLibraryTheme';
import { DEFAULT_LIBRARY_THEME, resolveProjectTheme, uploadThemeId } from '@/utils/libraryThemes';
import { stableContext } from '@/utils/stableContext';

// ============================================================================
// Public Types
// ============================================================================

export interface ThemeListItem {
  _id: string;
  name: string;
  slug: string;
  componentCount: number;
  createdAt: string;
}

export interface ThemeComponent {
  id: string;
  name: string;
  path: string;
  html: string;
  source: string;
  dependencies: string[];
}

// ============================================================================
// Helpers — DB → Public type conversion
// ============================================================================

function dbThemeToListItem(t: DBTheme): ThemeListItem {
  return {
    _id: t.id,
    name: t.name,
    slug: t.slug,
    componentCount: t.componentCount,
    createdAt: t.createdAt.toISOString(),
  };
}

function dbComponentToPublic(c: DBThemeComponent): ThemeComponent {
  return {
    id: c.id,
    name: c.name,
    path: c.path,
    html: c.html,
    source: c.source,
    dependencies: c.dependencies,
  };
}

function slugify(text: string): string {
  const result = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return result || 'theme';
}

// ============================================================================
// Context
// ============================================================================

export interface ThemesLibraryContextValue {
  /** Uploaded themes (every project sees the same list). */
  themes: ThemeListItem[];
  /** The open project's ⌘K theme: a built-in id or `upload:<themeId>` (utils/libraryThemes.ts). */
  activeTheme: string;
  /** Stores the ZIP as a theme and returns its id (processThemeZip's checks throw). */
  uploadNewTheme: (name: string, file: File) => Promise<string>;
  /** Deletes an upload; projects using it move to Starquix. Returns its ⌘Z: every removed or moved row back. */
  deleteTheme: (themeId: string) => Promise<() => Promise<void>>;
  /** Saves the project's theme. */
  setActiveTheme: (theme: string) => Promise<void>;
  getThemeComponents: (themeId: string) => Promise<ThemeComponent[]>;
}

const ThemesLibraryContext = stableContext<ThemesLibraryContextValue | null>('ThemesLibraryContext', null);

/** Mounted per project (Editor: inside `<EditorProvider key={projectId}>`), so a load always belongs to this project. */
export const ThemesLibraryProvider: React.FC<{ projectId?: string; children: React.ReactNode }> = ({ projectId, children }) => {
  const [themes, setThemes] = useState<ThemeListItem[]>([]);
  const [activeTheme, setActiveThemeState] = useState<string>(DEFAULT_LIBRARY_THEME);

  const readThemes = useCallback(async () => {
    setThemes((await db.themes.toArray()).map(dbThemeToListItem));
  }, []);

  // Uploads from earlier sessions are listed too (⌘K's theme menu and category source).
  useEffect(() => { readThemes().catch((err) => console.error('Failed to load themes:', err)); }, [readThemes]);

  // The project's theme: no record = a pre-theme project (Classic); a dead id is repaired to Starquix.
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const [saved, uploaded] = await Promise.all([readProjectLibraryTheme(projectId), db.themes.toCollection().primaryKeys()]);
      const theme = resolveProjectTheme(saved, new Set(uploaded.map(String)));
      setActiveThemeState(theme);
      if (saved !== undefined && theme !== saved) await saveProjectLibraryTheme(projectId, theme);
    })().catch((err) => console.error('Failed to load the project theme:', err)); // unreadable: Starquix, nothing written
  }, [projectId]);

  const uploadNewTheme = useCallback(async (name: string, file: File): Promise<string> => {
    const processed = await processThemeZip(file);
    const now = new Date();
    const themeId = crypto.randomUUID();
    await db.transaction('rw', [db.themes, db.themeComponents, db.themeFiles], async () => {
      await db.themes.put({
        id: themeId, name, slug: slugify(name), componentCount: processed.components.length, createdAt: now, updatedAt: now,
      });
      for (const comp of processed.components) {
        await db.themeComponents.put({
          id: `${themeId}:${comp.name}`, themeId, name: comp.name, path: comp.path, html: comp.html,
          source: comp.source, dependencies: comp.dependencies,
        });
      }
      for (const f of processed.files) {
        await db.themeFiles.put({ id: `${themeId}:${f.path}`, themeId, path: f.path, content: f.content, isText: f.isText });
      }
    });
    await readThemes();
    return themeId;
  }, [readThemes]);

  const deleteTheme = useCallback(async (themeId: string) => {
    const tables = [db.themes, db.themeComponents, db.themeFiles, db.projectThemes];
    // The rows this delete removes or moves, read inside its transaction: the ⌘Z puts exactly these back.
    const [theme, components, files, projectRows] = await db.transaction('rw', tables, async () => {
      const rows = await Promise.all([
        db.themes.get(themeId),
        db.themeComponents.where('themeId').equals(themeId).toArray(),
        db.themeFiles.where('themeId').equals(themeId).toArray(),
        db.projectThemes.where('themeId').anyOf([themeId, uploadThemeId(themeId)]).toArray(),
      ]);
      await db.themes.delete(themeId);
      await db.themeComponents.where('themeId').equals(themeId).delete();
      await db.themeFiles.where('themeId').equals(themeId).delete();
      await db.projectThemes.where('themeId').equals(themeId).delete(); // pre-picker "enabled" rows: no orphans
      // Projects using it fall back to Starquix (not "no record", which would read as Classic).
      await db.projectThemes.where('themeId').equals(uploadThemeId(themeId)).modify({ themeId: DEFAULT_LIBRARY_THEME });
      return rows;
    });
    setThemes((prev) => prev.filter((t) => t._id !== themeId));
    setActiveThemeState((prev) => (prev === uploadThemeId(themeId) ? DEFAULT_LIBRARY_THEME : prev));
    return async () => {
      await db.transaction('rw', tables, async () => {
        if (theme) await db.themes.put(theme);
        await db.themeComponents.bulkPut(components);
        await db.themeFiles.bulkPut(files);
        for (const row of projectRows) {
          // A project moved to Starquix by the delete goes back — unless it picked another theme since.
          const now = row.themeId === uploadThemeId(themeId) ? await db.projectThemes.get(row.id) : undefined;
          if (!now || now.themeId === DEFAULT_LIBRARY_THEME) await db.projectThemes.put(row);
        }
      });
      await readThemes();
      if (projectId && await readProjectLibraryTheme(projectId) === uploadThemeId(themeId)) setActiveThemeState(uploadThemeId(themeId));
    };
  }, [projectId, readThemes]);

  const setActiveTheme = useCallback(async (theme: string) => {
    if (projectId) await saveProjectLibraryTheme(projectId, theme);
    setActiveThemeState(theme);
  }, [projectId]);

  const getThemeComponents = useCallback(async (themeId: string) =>
    (await db.themeComponents.where('themeId').equals(themeId).toArray()).map(dbComponentToPublic), []);

  const value = useMemo<ThemesLibraryContextValue>(
    () => ({ themes, activeTheme, uploadNewTheme, deleteTheme, setActiveTheme, getThemeComponents }),
    [themes, activeTheme, uploadNewTheme, deleteTheme, setActiveTheme, getThemeComponents],
  );

  return <ThemesLibraryContext.Provider value={value}>{children}</ThemesLibraryContext.Provider>;
};

// ============================================================================
// Hooks
// ============================================================================

export const useThemesLibrary = (): ThemesLibraryContextValue => {
  const context = useContext(ThemesLibraryContext);
  if (!context) throw new Error('useThemesLibrary must be used within a ThemesLibraryProvider');
  return context;
};

/** The project's ⌘K theme; outside the provider (tests, non-editor pages) the default. */
export const useActiveLibraryTheme = (): string =>
  useContext(ThemesLibraryContext)?.activeTheme ?? DEFAULT_LIBRARY_THEME;
