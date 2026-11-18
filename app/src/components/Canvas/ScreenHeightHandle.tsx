import { useRef, useState } from 'react';

/** Min screen height chrome (owner 2026-10-08): taller content hugs, so
 * nothing here ever sits over content.
 * - A grab bar just BELOW the artboard's bottom edge drags the min height,
 *   starting from the edge (`bottom`), so pulling down always grows the frame.
 *   Dragging up into content cannot shrink the frame: the saved min is kept and
 *   the readout (the real frame height) stops counting.
 * - A side caption outside the right edge marks where the screen ends.
 * Lives inside the scaled artboard: sizes are counter-scaled by the LIVE
 * --sq-inv-scale (Canvas writes it with every transform; the React `scale`
 * lags ~150ms mid-gesture) and the drag delta is divided by scale.
 */
export function ScreenHeightHandle({ height, bottom, content, width, scale, caption, onChange }: {
  height: number; bottom: number; content: number; width: number; scale: number; caption: string;
  onChange: (height: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const contentRef = useRef(content);
  contentRef.current = content;
  const inv = 'var(--sq-inv-scale, 1)';
  const px = (n: number) => `calc(${n}px * ${inv})`;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startY = e.clientY;
    const start = bottom;
    const startMin = height;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      // A release we never got a pointerup for (owner 2026-10-08: the bar kept
      // following the mouse) — no button held means the drag is over.
      if ((ev.buttons & 1) === 0) { up(); return; }
      const dragged = start + (ev.clientY - startY) / scale;
      const c = contentRef.current;
      // Below the content the edge cannot follow: keep the saved min (never
      // above the content, so a short page still shrinks to it).
      onChange(dragged >= c ? dragged : Math.min(startMin, c));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', up);
      setDragging(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', up);
  };

  const active = dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';
  return (
    <>
      <div
        className="absolute left-full z-overlay pointer-events-none flex items-center gap-1.5 text-2xs text-text-muted tabular-nums whitespace-nowrap"
        style={{ top: height, transform: `translateY(-50%) scale(${inv})`, transformOrigin: 'left center' }}
        data-testid="screen-height-caption"
      >
        <div className="w-3 h-px bg-stroke-darker" />
        {caption}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Screen height"
        aria-valuenow={Math.round(height)}
        onPointerDown={onPointerDown}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="group absolute left-0 right-0 z-overlay cursor-ns-resize"
        style={{ top: bottom, height: px(16) }}
        data-testid="screen-height-handle"
      >
        <div className={`absolute left-0 right-0 top-0 bg-stroke-darker transition-opacity ${active}`} style={{ height: px(1) }} />
        <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) scale(${inv})` }}>
          <div className={`h-1 w-8 rounded-full transition-colors ${dragging ? 'bg-text-muted' : 'bg-stroke-darker group-hover:bg-text-muted'}`} />
        </div>
        <div
          className={`absolute left-1/2 top-full px-1.5 py-0.5 rounded-inner bg-bg border border-stroke shadow-flyout text-2xs text-text-secondary tabular-nums whitespace-nowrap transition-opacity ${active}`}
          style={{ transform: `translate(-50%, 0) scale(${inv})`, transformOrigin: 'top center' }}
        >
          {width} × {Math.round(bottom)}
        </div>
      </div>
    </>
  );
}
