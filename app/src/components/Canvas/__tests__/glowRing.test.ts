// app/src/components/Canvas/__tests__/glowRing.test.ts
// The AI "working" ring. These assertions exist because every one of them was
// a live visual bug the user had to report:
//   - masking the blurred layer sheared the bloom into a hard square edge
//     1.25×spread outside the section ("the stroke is still cropped")
//   - an unclosed clip polygon painted a wedge artifact
//   - blurring a masked band instead washed the glow into the section interior
import { describe, it, expect } from 'vitest';
import { GLOW_CSS, GLOW_LAYERS, GLOW_FILL } from '../glowRing';

describe('GLOW_CSS (ring geometry)', () => {
  it('never masks the layer — a mask clips the blur and shears the bloom', () => {
    expect(GLOW_CSS).not.toContain('mask-composite');
    expect(GLOW_CSS).not.toContain('-webkit-mask');
  });

  it('removes the interior with an even-odd clip whose outer bound clears the widest bloom', () => {
    expect(GLOW_CSS).toContain('clip-path:polygon(evenodd,');
    // Outer boundary 400px out vs the widest blur (l3 = 3 × 20px spread = 60px).
    expect(GLOW_CSS).toContain('-400px -400px');
    // Hole sits at the section border: each layer is --in outside it.
    expect(GLOW_CSS).toContain('calc(-1*var(--in)) calc(-1*var(--in))');
  });

  it('closes both clip loops (an open loop paints a wedge)', () => {
    const poly = GLOW_CSS.slice(GLOW_CSS.indexOf('clip-path:polygon('));
    const pts = poly.slice(0, poly.indexOf(');')).split(',').map(p => p.trim());
    expect(pts.filter(p => p === '-400px -400px')).toHaveLength(2);
    expect(pts.filter(p => p === 'calc(-1*var(--in)) calc(-1*var(--in))')).toHaveLength(2);
  });

  it('keeps the playground layer stack: 3 depths × 2 counter-phases, one gradient', () => {
    expect(GLOW_LAYERS).toHaveLength(6);
    expect(GLOW_LAYERS.filter(l => l.endsWith(' b'))).toHaveLength(3);
    expect(GLOW_CSS.match(/conic-gradient/g)).toHaveLength(1);
    for (const [cls, inset] of [['l1', '-.25'], ['l2', '-.5'], ['l3', '-1.25']] as const) {
      expect(GLOW_CSS).toContain('.sq-ai-glow.' + cls + '{--in:calc(' + inset);
    }
  });

  it('is safe to inline in a <style> tag', () => {
    expect(GLOW_CSS).not.toContain('</style');
    expect(GLOW_FILL).toMatch(/^rgba\(/);
  });
});
