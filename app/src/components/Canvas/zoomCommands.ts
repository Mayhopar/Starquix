// Programmatic zoom commands ('sq:zoom-command' window CustomEvent payloads).
// Senders: useKeyboardShortcuts.ts (Cmd+0 / Cmd+± / Shift+1) and ZoomChip.tsx.
// Single listener: Canvas.tsx, which supplies the real ZoomCommandEnv and
// applies results through the SAME ref→rAF→flush path as gesture zoom.

import { fitView, stepScale, zoomAroundPoint, type ViewTransform } from './zoomMath';

export const ZOOM_COMMAND_EVENT = 'sq:zoom-command';

export type ZoomCommandAction = 'in' | 'out' | 'reset' | 'fit';

export interface ZoomCommandEnv {
  getView(): ViewTransform;
  applyView(view: ViewTransform): void;
  getCanvasSize(): { width: number; height: number } | null;
  /** Frame height in CONTENT px (screen px ÷ current scale); null when unmeasurable. */
  getFrameHeight(): number | null;
  viewportWidth: number;
}

export function dispatchZoomCommand(action: ZoomCommandAction): void {
  window.dispatchEvent(new CustomEvent(ZOOM_COMMAND_EVENT, { detail: { action } }));
}

export function executeZoomCommand(action: ZoomCommandAction, env: ZoomCommandEnv): void {
  const size = env.getCanvasSize();
  if (!size) return;
  const view = env.getView();
  const center = { x: size.width / 2, y: size.height / 2 };

  switch (action) {
    case 'in':
      env.applyView(zoomAroundPoint(view, center, stepScale(view.scale, 1)));
      return;
    case 'out':
      env.applyView(zoomAroundPoint(view, center, stepScale(view.scale, -1)));
      return;
    case 'reset':
      // 100% anchored at the canvas centre — keeps what you're looking at.
      // (resetView()'s jump-to-origin stays reserved for page switch / rescue.)
      env.applyView(zoomAroundPoint(view, center, 1));
      return;
    case 'fit':
      env.applyView(fitView({
        canvasWidth: size.width,
        canvasHeight: size.height,
        viewportWidth: env.viewportWidth,
        frameHeight: env.getFrameHeight() ?? 0,
      }));
      return;
  }
}
