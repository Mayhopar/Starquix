/**
 * ui/Button + ui/IconButton — content modes, variants, loading, className merge.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';

describe('ui/Button', () => {
  it('label mode', () => {
    render(<Button label="Save" />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('children legacy alias still works', () => {
    render(<Button>Legacy</Button>);
    expect(screen.getByRole('button', { name: 'Legacy' })).toBeInTheDocument();
  });

  it('icon + label and label + iconRight', () => {
    render(<Button label="Add" icon={<svg data-testid="l" />} iconRight={<svg data-testid="r" />} />);
    expect(screen.getByTestId('l')).toBeInTheDocument();
    expect(screen.getByTestId('r')).toBeInTheDocument();
  });

  it('icon-only is square and carries the aria-label', () => {
    render(<Button iconOnly icon={<svg />} aria-label="Close" size="md" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('size-8');
  });

  // The Figma Buttons page (95:13): geometry per Size × Type, radius `4px` everywhere.
  describe('Figma geometry', () => {
    const cls = (el: React.ReactElement) => { const { unmount } = render(el); const c = screen.getByRole('button').className; unmount(); return c.split(/\s+/); };
    it('every button is 4px round, icon-only too (never a circle)', () => {
      for (const size of ['lg', 'md', 'sm'] as const) {
        expect(cls(<Button size={size} label="A" />)).toContain('rounded-inner');
        const square = cls(<Button size={size} iconOnly icon={<svg />} aria-label="A" />);
        expect(square).toContain('rounded-inner');
        expect(square).not.toContain('rounded-full');
      }
    });
    it('Text · Icon Text · Text Icon paddings and gaps', () => {
      expect(cls(<Button size="lg" label="A" />)).toEqual(expect.arrayContaining(['h-10', 'px-5', 'py-2.5']));
      expect(cls(<Button size="lg" label="A" icon={<svg />} />)).toEqual(expect.arrayContaining(['pl-2.5', 'pr-4', 'gap-2']));
      expect(cls(<Button size="md" label="A" iconRight={<svg />} />)).toEqual(expect.arrayContaining(['pl-4', 'pr-2.5', 'gap-1']));
      expect(cls(<Button size="sm" label="A" icon={<svg />} />)).toEqual(expect.arrayContaining(['h-6', 'pl-2', 'pr-3', 'gap-1']));
      expect(cls(<Button size="sm" label="A" />)).toEqual(expect.arrayContaining(['px-4', 'py-1']));
    });
    it('Icon: 40/32/24 squares padded 10/8/4; Large icons sit in the 20px slot', () => {
      expect(cls(<Button size="lg" iconOnly icon={<svg />} aria-label="A" />)).toEqual(expect.arrayContaining(['size-10', 'p-2.5', 'sq-icon-size-20']));
      expect(cls(<Button size="md" iconOnly icon={<svg />} aria-label="A" />)).toEqual(expect.arrayContaining(['size-8', 'p-2', 'sq-icon-size-16']));
      expect(cls(<Button size="sm" iconOnly icon={<svg />} aria-label="A" />)).toEqual(expect.arrayContaining(['size-6', 'p-1', 'sq-icon-size-16']));
    });
    it('only iconOnly is the square Icon type: text passed as `icon` keeps its width (ZoomChip regression)', () => {
      const c = cls(<Button size="sm" icon={<span>100%</span>} iconRight={<svg />} aria-label="Zoom" />);
      expect(c).not.toContain('size-6');
      expect(c).toEqual(expect.arrayContaining(['h-6', 'px-2']));
    });
    it('Link has no padding: its height is its line (20 Large, 16 otherwise), icon gap 2', () => {
      expect(cls(<Button variant="link" size="lg" label="A" icon={<svg />} />)).toEqual(expect.arrayContaining(['p-0', 'h-5', 'gap-0.5', 'text-sm']));
      expect(cls(<Button variant="link" size="md" label="A" />)).toEqual(expect.arrayContaining(['p-0', 'h-4', 'text-xs']));
    });
    it('Primary disabled is its own Figma recipe (fill 10%, label 40%), not a whole-button fade', () => {
      const c = cls(<Button variant="primary" label="A" disabled />);
      expect(c).toEqual(expect.arrayContaining(['bg-btn-primary-fill-disabled/10', 'text-btn-primary-text-disabled/40']));
      expect(c).not.toContain('opacity-50');
    });
    it('Transparent (ghost): ink label at rest, hover fill at 50%, disabled = its label token', () => {
      expect(cls(<Button variant="ghost" label="A" />)).toEqual(expect.arrayContaining(['text-btn-ghost-text-default', 'hover:bg-btn-ghost-fill-hover/50']));
      const d = cls(<Button variant="ghost" label="A" disabled />);
      expect(d).toContain('text-btn-ghost-text-disabled');
      expect(d).not.toContain('opacity-50');
    });
    it('Plain = the Figma Plain tokens (a dark button in Light, a light one in Dark)', () => {
      expect(cls(<Button variant="plain" label="A" />)).toEqual(expect.arrayContaining(['bg-btn-plain-fill-default', 'text-btn-plain-text-default', 'hover:bg-btn-plain-fill-hover']));
    });
    it('a style with no Figma disabled recipe yet fades as a whole', () => {
      expect(cls(<Button variant="secondary" label="A" disabled />)).toContain('opacity-50');
    });
    it('Outline draws its stroke inside the box (no extra width)', () => {
      const c = cls(<Button variant="outline" label="A" />);
      expect(c).toContain('inset-ring');
      expect(c).not.toContain('border');
    });
  });

  it('danger variant uses btn-danger tokens', () => {
    render(<Button variant="danger" label="Delete" />);
    expect(screen.getByRole('button').className).toContain('bg-btn-danger');
  });

  it('loading shows spinner and disables', () => {
    const onClick = vi.fn();
    render(<Button label="Send" loading onClick={onClick} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('className overrides win via twMerge', () => {
    render(<Button label="Wide" className="px-1" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('px-1');
    expect(btn.className).not.toMatch(/\bpx-5\b/);
  });

  it('active state applies the variant active classes', () => {
    render(<Button variant="secondary" label="On" active />);
    expect(screen.getByRole('button').className).toContain('bg-btn-secondary-fill-hover');
  });
});

describe('ui/IconButton', () => {
  it('sizes: sm 20px, md 24px', () => {
    const { rerender } = render(<IconButton size="sm" aria-label="A"><svg /></IconButton>);
    expect(screen.getByRole('button').className).toContain('w-5 h-5');
    rerender(<IconButton size="md" aria-label="A"><svg /></IconButton>);
    expect(screen.getByRole('button').className).toContain('w-6 h-6');
  });

  it('active uses primary tokens', () => {
    render(<IconButton active aria-label="T"><svg /></IconButton>);
    expect(screen.getByRole('button').className).toContain('bg-btn-primary-fill-default');
  });
});

describe('ui/Button weight', () => {
  // Owner 2026-11-04: a medium (500) label's stem (1.37px at 12px) outweighed the 1px icon strokes beside it; labels are regular 400.
  it('every size and variant draws its label at regular weight', () => {
    for (const size of ['lg', 'md', 'sm'] as const) {
      for (const variant of ['primary', 'secondary', 'outline', 'ghost', 'link', 'danger'] as const) {
        const { unmount } = render(<Button label="Save" size={size} variant={variant} />);
        const cls = screen.getByRole('button', { name: 'Save' }).className;
        expect(cls, `${size} ${variant}`).toContain('font-normal');
        expect(cls, `${size} ${variant}`).not.toContain('font-medium');
        unmount();
      }
    }
  });
});
