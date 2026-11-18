import { db } from '@/db';

/** The project's ⌘K theme lives in the per-project theme table under a reserved row (no schema change). */
const rowId = (projectId: string) => `${projectId}:@active`;

export async function readProjectLibraryTheme(projectId: string): Promise<string | undefined> {
  return (await db.projectThemes.get(rowId(projectId)))?.themeId;
}

export async function saveProjectLibraryTheme(projectId: string, theme: string): Promise<void> {
  await db.projectThemes.put({ id: rowId(projectId), projectId, themeId: theme, enabled: true });
}
