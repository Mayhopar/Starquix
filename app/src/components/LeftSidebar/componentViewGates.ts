/**
 * Local component-view lifecycle gates (task-136/137 state-desync fixes).
 *
 * In local mode a user component opens as a real iframe route
 * (/__sq_component_view/...) WITHOUT touching currentPageId — so every exit
 * path that keys off `currentPageId === COMPONENT_PAGE_ID` (the WC doc-seeded
 * flow) never fires. Symptoms: canvas stuck on the component after switching
 * to the File tab, and Assets appearing to "show the main page" because the
 * still-highlighted component row no-ops on re-click.
 */
import { COMPONENT_EDITOR_PAGE_ID as COMPONENT_PAGE_ID } from '@/store/constants';

/** Switching to the File tab must exit a LOCAL component view even though
 * currentPageId never changed (the WC branch handles COMPONENT_PAGE_ID). */
export function shouldExitLocalComponentView(
  newTab: string,
  activeComponentPath: string | null,
  currentPageId: string | null | undefined,
): boolean {
  return newTab === 'pages' && !!activeComponentPath && currentPageId !== COMPONENT_PAGE_ID;
}

/** Re-clicking the already-active component: user-project components must
 * RE-DISPATCH the view event (idempotent iframe nav, heals any desync);
 * only the WC doc-seeded flow treats it as a no-op. */
export function shouldSkipReselect(
  source: string | undefined,
  activeComponentPath: string | null,
  componentPath: string,
): boolean {
  return source !== 'user-project' && activeComponentPath === componentPath;
}

/** Built-in (system) components have NO editor surface in a local project —
 * the WC doc-seeded flow routes to the guaranteed-404 page
 * (/__sq_missing_page, found live 2026-08-14). Refuse before it starts;
 * the caller toasts the way out (⌘K inserts an owned copy). User components
 * AND user layouts are stamped source 'user-project' and pass. */
export function shouldRefuseBuiltInInLocal(
  localProjectPath: string | null,
  source: string | undefined,
): boolean {
  return !!localProjectPath && source !== 'user-project';
}
