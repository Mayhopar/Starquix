import * as Y from 'yjs';
import type { EditorCommand } from './types';

export interface ProjectFontEntry {
  source: 'google' | 'custom';
  /** Baked @font-face CSS with sq-asset: URLs (resolved by bridge/export). */
  css: string;
  assetIds: string[];
}

export function isFontCommand(type: string): boolean {
  return type === 'SET_PROJECT_FONT' || type === 'REMOVE_PROJECT_FONT';
}

export function applyFontCommand(doc: Y.Doc, command: EditorCommand): boolean {
  const fonts = doc.getMap('fonts');
  switch (command.type) {
    case 'SET_PROJECT_FONT': {
      fonts.set(command.family, {
        source: command.entry.source, css: command.entry.css, assetIds: command.entry.assetIds,
      });
      return true;
    }
    case 'REMOVE_PROJECT_FONT': {
      if (!fonts.has(command.family)) return false;
      fonts.delete(command.family);
      return true;
    }
    default:
      return false;
  }
}
