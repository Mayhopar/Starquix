import { describe, it, expect, vi } from 'vitest';
import { executeZoomCommand, ZOOM_COMMAND_EVENT, type ZoomCommandEnv } from '../zoomCommands';
import { fitView, stepScale } from '../zoomMath';
import type { ViewTransform } from '../zoomMath';

function makeEnv(overrides: Partial<ZoomCommandEnv> = {}): ZoomCommandEnv & { applyView: ReturnType<typeof vi.fn> } {
  return {
    getView: () => ({ scale: 1, x: 0, y: 0 }),
    applyView: vi.fn(),
    getCanvasSize: () => ({ width: 1200, height: 800 }),
    getFrameHeight: () => 2000,
    viewportWidth: 1024,
    ...overrides,
  } as ZoomCommandEnv & { applyView: ReturnType<typeof vi.fn> };
}

describe('executeZoomCommand', () => {
  it('exports the event name used by senders and the Canvas listener', () => {
    expect(ZOOM_COMMAND_EVENT).toBe('sq:zoom-command');
  });

  it('"in" steps to the next level anchored at the canvas centre', () => {
    const env = makeEnv();
    executeZoomCommand('in', env);
    const view = env.applyView.mock.calls[0][0] as ViewTransform;
    expect(view.scale).toBe(stepScale(1, 1)); // 1.25
    // centre anchor (600, 400) stays fixed: content point under it maps back
    expect((600 - 0) / 1 * view.scale + view.x).toBeCloseTo(600, 6);
    expect((400 - 0) / 1 * view.scale + view.y).toBeCloseTo(400, 6);
  });

  it('"out" steps to the previous level', () => {
    const env = makeEnv();
    executeZoomCommand('out', env);
    expect((env.applyView.mock.calls[0][0] as ViewTransform).scale).toBe(0.75);
  });

  it('"reset" zooms to exactly 1 anchored at the centre (not origin)', () => {
    const env = makeEnv({ getView: () => ({ scale: 2, x: -300, y: -100 }) });
    executeZoomCommand('reset', env);
    const view = env.applyView.mock.calls[0][0] as ViewTransform;
    expect(view.scale).toBe(1);
    // anchor invariance at centre (600, 400)
    expect((600 - -300) / 2 * 1 + view.x).toBeCloseTo(600, 6);
    expect((400 - -100) / 2 * 1 + view.y).toBeCloseTo(400, 6);
  });

  it('"fit" applies fitView with measured frame height', () => {
    const env = makeEnv();
    executeZoomCommand('fit', env);
    expect(env.applyView.mock.calls[0][0]).toEqual(
      fitView({ canvasWidth: 1200, canvasHeight: 800, viewportWidth: 1024, frameHeight: 2000 }),
    );
  });

  it('"fit" falls back to width-only when frame height is unmeasurable', () => {
    const env = makeEnv({ getFrameHeight: () => null });
    executeZoomCommand('fit', env);
    expect(env.applyView.mock.calls[0][0]).toEqual(
      fitView({ canvasWidth: 1200, canvasHeight: 800, viewportWidth: 1024, frameHeight: 0 }),
    );
  });

  it('no-ops when the canvas size is unavailable', () => {
    const env = makeEnv({ getCanvasSize: () => null });
    executeZoomCommand('in', env);
    expect(env.applyView).not.toHaveBeenCalled();
  });
});
