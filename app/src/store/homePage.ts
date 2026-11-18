// src/store/homePage.ts
// SET_HOME_PAGE touches two arbitrary pages. Await the accepted revision
// containing both flag changes before reporting success.
// Shared by PagesContext.setHomePage (UI) and the AI set_home_page tool.

import type * as Y from 'yjs';
import { selectHomePageId } from './selectors';

export interface SetHomePageArgs {
  doc: Y.Doc;
  /** Must durably accept the command before resolving. */
  dispatch: import('./durableDispatch').EditorDispatch;
  takeSnapshot: () => void;
  pageId: string;
}

export async function setHomePageAndPersist(args: SetHomePageArgs): Promise<{ ok: boolean; changed: boolean }> {
  const { doc, dispatch, takeSnapshot, pageId } = args;
  const previousHomeId = selectHomePageId(doc);
  if (previousHomeId === pageId) return { ok: true, changed: false };

  takeSnapshot();
  const applied = await dispatch({ type: 'SET_HOME_PAGE', pageId });
  if (applied === false) return { ok: false, changed: false };

  return { ok: true, changed: true };
}
