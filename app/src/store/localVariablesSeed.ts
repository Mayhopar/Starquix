/**
 * Files-truth / local variables (Phase 3.2, live-found gap 2026-08-28): the
 * session doc is disposable, so the Variables panel forgot its collection on
 * reopen while `src/styles/sq-variables.css` (the REAL file) kept it. On open,
 * parse that file back into ONE collection — the same parseCSS the Code view
 * uses on generateCollectionsCSS output (proven round-trip).
 */
import * as Y from 'yjs';
import { applyCommand } from './commands';
import { parseCSS } from '@/core/variables/cssParser';
import { createDefaultCollection } from '@/core/variables/types';
import { VARIABLES_CSS_FILE } from '@/services/localVariablesCss';
import { db } from '@/db';
import { projectFileId } from '@/db/projectFiles';

async function readLocalVariablesCss(projectId: string): Promise<string | null> {
  try {
    const row = await db.projectFiles.get(projectFileId(projectId, VARIABLES_CSS_FILE));
    return row ? new TextDecoder().decode(row.content) : null;
  } catch {
    return null;
  }
}

/** Returns the seeded collection, or null when there was nothing to seed. */
export async function seedLocalVariables(doc: Y.Doc, projectId: string) {
  // Idempotent: a doc that already holds variables (HMR re-load, a second
  // hydrate) must not gain a duplicate collection.
  const existing = doc.getMap('variableCollections');
  let hasVars = false;
  existing.forEach((c) => { const v = (c instanceof Y.Map ? c.get('variables') : (c as { variables?: unknown[] })?.variables) as { length?: number } | undefined; if (v && (v as { length: number }).length > 0) hasVars = true; });
  if (hasVars) return null;
  const css = await readLocalVariablesCss(projectId);
  if (!css || !css.includes('--')) return null;
  const collection = parseCSS(css, createDefaultCollection());
  if (collection.variables.length === 0) return null;
  collection.name = 'Variables';
  applyCommand(doc, { type: 'ADD_VARIABLE_COLLECTION', collection });
  return collection;
}
