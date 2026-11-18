import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as icons from '../index';
import { renderSlot } from '@/components/ui/Slot';

const directory = resolve(process.cwd(), 'src/assets/icons');
describe('editor icon contract', () => {
  it('keeps every asset on the shared grid and safe to repeat in one document', () => {
    const invalid = readdirSync(directory).filter(name => name.endsWith('.svg')).filter(name => {
      const svg = new DOMParser().parseFromString(readFileSync(resolve(directory, name), 'utf8'), 'image/svg+xml');
      const root = svg.documentElement;
      return root.getAttribute('viewBox') !== '0 0 16 16'
        || !root.hasAttribute('data-sq-icon')
        || svg.querySelector('parsererror, [id], [clip-path], [filter], text, image') !== null
        || [...root.children].map(c => c.getAttribute('class')).join() !== 'sq-g16,sq-g24'
        || root.getAttribute('stroke-width') !== '1';
    });
    expect(invalid).toEqual([]);
  });

  // Strokes AND fill edges sit on the HALF-pixel lattice (multiples of .5): at 2x a 1px stroke centred there covers whole
  // device pixels, and the lattice contains the icon centre (8 / 10), so symmetric art stays symmetric (a k+.5 lattice
  // cannot: a 1px line on 8.5 is off-centre, which made a + with a 6px arm above and a 5px arm below).
  // Drawings: .sq-g16 = 1 unit per px; .sq-g24 = the 20px art, scaled .8 so 1 unit is 1px again.
  // Only STRAIGHT horizontal/vertical segments and rect edges are held to the lattice: diagonals, curves, arcs and circles
  // keep their drawn geometry (snapping every vertex made chevrons lopsided and gears coarse).
  it('keeps every straight stroke and rect/fill edge on the half-pixel lattice in both drawings', () => {
    const off: string[] = [];
    const bad = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-6;
    for (const name of readdirSync(directory).filter(n => n.endsWith('.svg'))) {
      const root = new DOMParser().parseFromString(readFileSync(resolve(directory, name), 'utf8'), 'image/svg+xml').documentElement;
      for (const el of root.querySelectorAll('path, rect, circle')) {
        const tag = el.tagName;
        const flag = (what: string) => off.push(`${name}: <${tag}> ${what} ${el.getAttribute('d') ?? ''}`);
        if (tag === 'rect') {
          const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(k => Number(el.getAttribute(k)));
          if ([x, x + w, y, y + h].some(bad)) flag('rect edge');
        } else if (tag === 'path') {
          const d = el.getAttribute('d')!;
          if (/[a-z]/.test(d)) off.push(`${name}: relative path commands`);
          let cx = 0, cy = 0, sx = 0, sy = 0;
          const seg = (nx: number, ny: number) => {
            if (nx === cx && ny === cy) return; // zero-length closing line is not a stroke
            if (nx === cx && bad(nx)) flag(`vertical at x=${nx}`);
            if (ny === cy && bad(ny)) flag(`horizontal at y=${ny}`);
            cx = nx; cy = ny;
          };
          for (const [, c, a] of d.matchAll(/([MLHVCAZ])([^MLHVCAZ]*)/g)) {
            const v = (a.match(/-?\d*\.?\d+/g) ?? []).map(Number);
            if (c === 'M') { cx = sx = v[0]; cy = sy = v[1]; }
            else if (c === 'L') seg(v[0], v[1]);
            else if (c === 'H') seg(v[0], cy);
            else if (c === 'V') seg(cx, v[0]);
            else if (c === 'C') { cx = v[4]; cy = v[5]; }
            else if (c === 'A') { cx = v[5]; cy = v[6]; }
            else if (c === 'Z') seg(sx, sy);
          }
        }
      }
    }
    expect(off).toEqual([]);
  });

  // Pixel-level evenness (measured on the real app at 2x): a round cap leaves a dim end pixel on every stroke and a round
  // join chips every right-angle corner, so rectilinear strokes use square caps + miter joins with ALL vertices on the
  // lattice (ends/corners cover whole pixels), and parallel 45deg strokes share one anti-alias phase (x-y / x+y a multiple of .5).
  it('draws rectilinear strokes with whole-pixel ends and corners, and 45deg diagonals on one phase', () => {
    const off: string[] = [];
    const bad = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-6;
    const NOT_45 = new Set(['history']); // clock hand: drawn at 36.9deg in the source, 45deg only after its x lock
    for (const name of readdirSync(directory).filter(n => n.endsWith('.svg'))) {
      const root = new DOMParser().parseFromString(readFileSync(resolve(directory, name), 'utf8'), 'image/svg+xml').documentElement;
      for (const el of root.querySelectorAll('rect')) {
        const stroked = (el.closest('[fill]')?.getAttribute('fill') ?? 'none') === 'none';
        if (!stroked) continue;
        if (el.getAttribute('stroke-linejoin') !== 'miter') off.push(`${name}: stroked rect without miter join`);
        if (el.hasAttribute('rx') && Number(el.getAttribute('rx')) <= 0.5) off.push(`${name}: rx<=.5 only chips the corner pixel`);
      }
      for (const el of root.querySelectorAll('path')) {
        const d = el.getAttribute('d')!;
        let cx = 0, cy = 0, sx = 0, sy = 0; const pts: number[][] = []; let rectilinear = true;
        for (const [, c, a] of d.matchAll(/([MLHVCAZ])([^MLHVCAZ]*)/g)) {
          const v = (a.match(/-?\d*\.?\d+/g) ?? []).map(Number); let nx = cx, ny = cy;
          if (c === 'M') { nx = sx = v[0]; ny = sy = v[1]; } else if (c === 'L') { nx = v[0]; ny = v[1]; } else if (c === 'H') nx = v[0]; else if (c === 'V') ny = v[0];
          else if (c === 'C') { nx = v[4]; ny = v[5]; } else if (c === 'A') { nx = v[5]; ny = v[6]; } else if (c === 'Z') { nx = sx; ny = sy; }
          if (c === 'C' || c === 'A' || ((c === 'L' || c === 'Z') && nx !== cx && ny !== cy)) rectilinear = false;
          if (c === 'L' || c === 'Z') {
            const dx = nx - cx, dy = ny - cy;
            if (!NOT_45.has(name.replace('.svg', '')) && Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6 && Math.abs(dx) >= 1.5) {
              const k = dx * dy > 0 ? cx - cy : cx + cy;
              if (Math.abs(k * 2 - Math.round(k * 2)) > 1e-6) off.push(`${name}: 45deg diagonal off the shared phase (${k}) ${d}`);
            }
          }
          if (c === 'M' || c === 'L' || c === 'H' || c === 'V' || c === 'Z') pts.push([nx, ny]);
          cx = nx; cy = ny;
        }
        const strokeOnly = (el.closest('[fill]')?.getAttribute('fill') ?? 'none') === 'none' && !el.hasAttribute('fill');
        if (rectilinear && strokeOnly && (el.getAttribute('stroke-linecap') !== 'square' || el.getAttribute('stroke-linejoin') !== 'miter')) off.push(`${name}: rectilinear stroke without square caps + miter joins ${d}`);
        if (el.getAttribute('stroke-linecap') === 'square' && el.getAttribute('stroke-linejoin') === 'miter' && pts.some(([x, y]) => bad(x) || bad(y))) off.push(`${name}: rectilinear path with a vertex off the lattice ${d}`);
      }
    }
    expect(off).toEqual([]);
  });

  // BALANCE: a + whose arms differ by a pixel stops reading as a +, a T's bar must be even about its stem, and a sun's rays
  // must match. The art is centred on 8 (g16) / 10 (g24); every straight segment of these icons must have its mirror image
  // in the same drawing. (Measured over ALL 187 icons against the originals by rendering + flipping: 0 regressions.)
  it('keeps mirror-symmetric icons exactly balanced in both drawings', () => {
    const SYM: Record<string, string> = {
      plus: 'xy', 'plus-large': 'xy', minus: 'xy', close: 'xy', sun: 'xy', instance: 'xy',
      type: 'x', text: 'x', 'layer-text': 'x', 'chevron-down': 'x', 'chevron-up': 'x', 'chevron-down-big': 'x', 'chevron-up-big': 'x',
      'arrow-up': 'x', 'arrow-down': 'x', 'arrow-left': 'y', 'arrow-right': 'y', link: 'xy', 'layer-link': 'xy', 'chevron-tree': 'x', 'chevron-right': 'x',
    };
    const off: string[] = [];
    const key = (a: number[], b: number[]) => [a, b].map(p => p.map(v => v.toFixed(4)).join(',')).sort().join('|');
    for (const [name, axes] of Object.entries(SYM)) {
      const root = new DOMParser().parseFromString(readFileSync(resolve(directory, `${name}.svg`), 'utf8'), 'image/svg+xml').documentElement;
      for (const [g, C] of [['sq-g16', 8], ['sq-g24', 10]] as const) {
        const segs = new Set<string>();
        for (const el of root.querySelectorAll(`.${g} path`)) {
          if (el.closest('[transform*="rotate"]')) continue; // chevron-up/right = the same path inside a rotate() group
          let cx = 0, cy = 0, sx = 0, sy = 0;
          for (const [, c, a] of el.getAttribute('d')!.matchAll(/([MLHVCAZ])([^MLHVCAZ]*)/g)) {
            const v = (a.match(/-?\d*\.?\d+/g) ?? []).map(Number); let nx = cx, ny = cy;
            if (c === 'M') { nx = sx = v[0]; ny = sy = v[1]; } else if (c === 'L') { nx = v[0]; ny = v[1]; } else if (c === 'H') nx = v[0]; else if (c === 'V') ny = v[0]; else if (c === 'Z') { nx = sx; ny = sy; }
            else if (c === 'C') { nx = v[4]; ny = v[5]; } else if (c === 'A') { nx = v[5]; ny = v[6]; }
            if (c !== 'M' && c !== 'C' && c !== 'A' && (nx !== cx || ny !== cy)) segs.add(key([cx, cy], [nx, ny]));
            cx = nx; cy = ny;
          }
        }
        for (const ax of axes) {
          for (const k of segs) {
            const [p, q] = k.split('|').map(t => t.split(',').map(Number));
            const m = (pt: number[]) => ax === 'x' ? [2 * C - pt[0], pt[1]] : [pt[0], 2 * C - pt[1]];
            if (!segs.has(key(m(p), m(q)))) off.push(`${name} ${g}: segment ${k} has no mirror about ${ax === 'x' ? 'x' : 'y'}=${C}`);
          }
        }
        for (const c of root.querySelectorAll(`.${g} circle`)) {
          if (Number(c.getAttribute('cx')) !== C || Number(c.getAttribute('cy')) !== C) off.push(`${name} ${g}: circle off centre`);
        }
      }
    }
    expect(off).toEqual([]);
  });

  // Owner 2026-11-04: the chevrons were "way too small" next to the rest of the set (7px wide in the 16 drawing). They are
  // 10px wide (12 in the 20 drawing) so they match the others by optical weight; every one is the same downward path.
  it('draws chevrons at the size of the set, and the link icon as the chain-link metaphor', () => {
    const read = (n: string) => new DOMParser().parseFromString(readFileSync(resolve(directory, `${n}.svg`), 'utf8'), 'image/svg+xml').documentElement;
    for (const name of ['chevron-down', 'chevron-up', 'chevron-right', 'chevron-tree', 'chevron-down-big', 'chevron-up-big']) {
      for (const [g, min] of [['sq-g16', 10], ['sq-g24', 12]] as const) {
        const d = read(name).querySelector(`.${g} path`)!.getAttribute('d')!;
        const p = [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
        expect(p[2][0] - p[0][0], `${name} ${g} width`).toBeGreaterThanOrEqual(min);
      }
    }
    // chain link = two open capsules (a semicircle each, facing each other) with a bar through the gap
    for (const name of ['link', 'layer-link']) {
      for (const g of ['sq-g16', 'sq-g24']) {
        const ds = [...read(name).querySelectorAll(`.${g} path`)].map(e => e.getAttribute('d')!);
        expect(ds.join('').match(/A/g)?.length, `${name} ${g} arcs`).toBe(2);
        expect(ds.some(d => /^M[\d.]+ [\d.]+H[\d.]+$/.test(d)), `${name} ${g} bar`).toBe(true);
      }
    }
  });

  // Regression: snapping EVERY vertex to the lattice moved chevron apexes off their arms' midpoint (lopsided) and the gear
  // hub off the gear's centre. Diagonal/curve geometry must keep the drawn symmetry in both drawings.
  it('keeps diagonal and curve geometry symmetric (chevrons, gear hub)', () => {
    const read = (n: string) => new DOMParser().parseFromString(readFileSync(resolve(directory, `${n}.svg`), 'utf8'), 'image/svg+xml').documentElement;
    for (const name of ['chevron-down', 'chevron-up', 'chevron-right']) {
      for (const g of ['sq-g16', 'sq-g24']) {
        const d = read(name).querySelector(`.${g} path`)!.getAttribute('d')!;
        const p = [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
        expect(p.length, `${name} ${g}`).toBe(3);
        // every chevron is the same downward path inside a rotate() group, so the apex is mid-way in x
        expect(p[1][0], `${name} ${g} apex`).toBeCloseTo((p[0][0] + p[2][0]) / 2, 6);
      }
    }
    const gear = read('gear');
    expect(['cx', 'cy', 'r'].map(a => gear.querySelector('.sq-g16 circle')!.getAttribute(a))).toEqual(['8', '8', '2']);
    expect(['cx', 'cy', 'r'].map(a => gear.querySelector('.sq-g24 circle')!.getAttribute(a))).toEqual(['10', '10', '2.5']);
  });
  it('preserves SVG sizing, color, accessible labels and event props for every export', () => {
    for (const Icon of Object.values(icons)) {
      const { container, unmount } = render(<Icon width={24} height={24} className="test-icon" aria-label="Action" data-testid="icon" />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('width')).toBe('24');
      expect(svg.getAttribute('height')).toBe('24');
      expect(svg.getAttribute('aria-label')).toBe('Action');
      expect(svg.getAttribute('class')).toBe('test-icon');
      unmount();
    }
  });
});

describe('1px strokes and the drawing that matches the rendered size', () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement('style');
    const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
    style.textContent = css.slice(css.indexOf('/* Editor icons:'));
    document.head.append(style);
  });
  afterEach(() => style.remove());
  const shown = (svg: SVGElement) => ['.sq-g16', '.sq-g24'].map(q => getComputedStyle(svg.querySelector(q)!).display !== 'none' ? q.slice(1) : '').filter(Boolean).join();

  it.each([
    ['w-4 h-4', '16px', '0px', 'sq-g16'],
    ['w-6 h-6', '24px', '2px', 'sq-g24'],
    ['', '24px', '2px', 'sq-g24'],
  ])('size %s: %s box, %s padding, draws %s at 1px', (className, width, padding, drawing) => {
    const { container } = render(<icons.PlusIcon className={className} />);
    const svg = container.querySelector('svg')!;
    const computed = getComputedStyle(svg);
    expect(computed.width).toBe(width);
    expect(computed.height).toBe(width);
    expect(computed.boxSizing).toBe('border-box');
    expect(computed.padding).toBe(padding);
    expect(computed.strokeWidth).toBe('1px');
    expect(shown(svg)).toBe(drawing);
  });

  it('keeps layers at 16px inside a normal Row carrier and draws the 16 drawing', () => {
    const { container } = render(<>{renderSlot({ type: 'icon', iconSize: 16, icon: <icons.PlusIcon className="w-4 h-4" /> }, 'md')}</>);
    const svg = container.querySelector('svg')!;
    expect(getComputedStyle(svg).width).toBe('16px');
    expect(getComputedStyle(svg).padding).toBe('0px');
    expect(shown(svg)).toBe('sq-g16');
  });

  it('centers 20px artwork inside a 24px Row icon box and draws the 24 drawing', () => {
    const { container } = render(<>{renderSlot({ type: 'icon', iconSize: 24, icon: <icons.PlusIcon className="w-4 h-4" /> })}</>);
    const svg = container.querySelector('svg')!;
    const computed = getComputedStyle(svg);
    expect(computed.width).toBe('24px');
    expect(computed.height).toBe('24px');
    expect(computed.boxSizing).toBe('border-box');
    expect(computed.padding).toBe('2px');
    expect(shown(svg)).toBe('sq-g24');
  });

  it.each([['sm', '16px', 'sq-g16'], ['md', '16px', 'sq-g16']] as const)('uses the %s Row icon size independently of the carrier', (size, width, drawing) => {
    const { container } = render(<>{renderSlot({ type: 'icon', icon: <icons.PlusIcon className="w-6 h-6" /> }, size)}</>);
    const svg = container.querySelector('svg')!;
    expect(getComputedStyle(svg).width).toBe(width);
    expect(shown(svg)).toBe(drawing);
  });
});
