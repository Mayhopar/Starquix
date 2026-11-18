import { describe, it, expect } from 'vitest';
import { footerOutlinePath } from '../footerOutline';

const commands = (d: string) => d.replace(/[^A-Za-z]/g, '');
const numbers = (d: string) => d.split(/[A-Za-z\s]+/).filter(Boolean).map(Number);
const bar = { w: 130, h: 38 };

describe('footer outline', () => {
  it('emits the SAME command sequence for the T and the bare pill, so CSS can morph one into the other', () => {
    const t = footerOutlinePath({ bar, panel: { w: 339, h: 46 } });
    const ai = footerOutlinePath({ bar, panel: { w: 560, h: 160, squareTopLeft: true } });
    const pill = footerOutlinePath({ bar: { w: 68, h: 38 }, panel: null });
    expect(commands(t)).toBe(commands(pill));
    expect(commands(ai)).toBe(commands(pill));
    expect(numbers(t)).toHaveLength(numbers(pill).length);
  });

  it('runs on the centre of the old 1px borders: panel 339×46 over a 130×38 bar', () => {
    const xs: number[] = [], ys: number[] = [];
    numbers(footerOutlinePath({ bar, panel: { w: 339, h: 46 } })).forEach((v, i) => (i % 2 ? ys : xs).push(v));
    expect(Math.max(...xs)).toBe(169);   // 339/2 - 0.5
    expect(Math.min(...xs)).toBe(-169);
    expect(Math.max(...ys)).toBe(-0.5);  // bar bottom border
    expect(Math.min(...ys)).toBe(-82.5); // 38 + 46 - 1 (overlap) - 0.5
  });

  it('the bare bar is a pill with 12px corners', () => {
    const d = footerOutlinePath({ bar: { w: 68, h: 38 }, panel: null });
    expect(d.startsWith('M 0 -37.5 L 21.5 -37.5 C')).toBe(true); // 33.5 - 12
  });

  it('the AI chat docks its tab strip on a square top-left corner', () => {
    const d = footerOutlinePath({ bar, panel: { w: 560, h: 160, squareTopLeft: true } });
    expect(d.trim().endsWith('L -279.5 -196.5 C -279.5 -196.5 -279.5 -196.5 -279.5 -196.5 Z')).toBe(true);
  });
});
