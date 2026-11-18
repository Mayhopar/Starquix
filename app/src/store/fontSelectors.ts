import * as Y from 'yjs';
import type { ProjectFontEntry } from './fontCommands';

export function selectProjectFonts(doc: Y.Doc): Record<string, ProjectFontEntry> {
  const out: Record<string, ProjectFontEntry> = {};
  doc.getMap('fonts').forEach((value, family) => {
    const v = value as ProjectFontEntry;
    if (v && typeof v.css === 'string') out[family] = { source: v.source, css: v.css, assetIds: v.assetIds ?? [] };
  });
  return out;
}

export function generateFontsCss(fonts: Record<string, ProjectFontEntry>): string {
  return Object.values(fonts).map(f => f.css).join('\n');
}
