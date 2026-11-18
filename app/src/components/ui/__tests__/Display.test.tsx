/**
 * ui display primitives — Badge, Swatch, EmptyState, Dropzone, Card, FloatingPanel.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Badge } from '../Badge';
import { Swatch } from '../Swatch';
import { EmptyState } from '../EmptyState';
import { Dropzone } from '../Dropzone';
import { Card } from '../Card';
import { FloatingPanel } from '../FloatingPanel';
import { Skeleton } from '../Skeleton';

describe('ui/Skeleton', () => {
  it('is a pulsing, hidden-from-readers placeholder shaped by its className', () => {
    const { container } = render(<Skeleton className="w-4 h-4 rounded-full" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute('aria-hidden');
    expect(el).toHaveClass('animate-pulse', 'bg-stroke', 'w-4', 'h-4', 'rounded-full');
    expect(el).not.toHaveClass('rounded-inner'); // only the caller's radius: two radius classes would race in the CSS
  });
});

describe('ui/Badge', () => {
  it('variants map to semantic tokens; sizes use micro type scale', () => {
    const { rerender } = render(<Badge variant="error">3 orphaned</Badge>);
    const badge = () => screen.getByText('3 orphaned');
    expect(badge().className).toContain('bg-error-subtle');
    expect(badge().className).toContain('text-2xs');
    rerender(<Badge variant="error" size="sm">3 orphaned</Badge>);
    expect(badge().className).toContain('text-3xs');
  });
});

describe('ui/Swatch', () => {
  it('renders the color over a checkerboard', () => {
    const { container } = render(<Swatch color="rgb(0, 128, 255)" />);
    expect(container.innerHTML).toContain('rgb(0, 128, 255)');
    expect((container.firstElementChild as HTMLElement).className).toContain('border-stroke');
  });
});

describe('ui/EmptyState', () => {
  it('renders title, caption, and action', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No pages yet" caption="Create your first page" action={{ label: 'New page', onClick }} />);
    expect(screen.getByText('No pages yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New page' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('ui/Dropzone', () => {
  it('emits picked files and resets the input', () => {
    const onFiles = vi.fn();
    const { container } = render(
      <Dropzone onFiles={onFiles} accept="image/*">
        Drop image
      </Dropzone>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('drop emits files and clears drag state', () => {
    const onFiles = vi.fn();
    render(<Dropzone onFiles={onFiles}>Zone</Dropzone>);
    const zone = screen.getByRole('button');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('disabled ignores interaction', () => {
    const onFiles = vi.fn();
    render(<Dropzone onFiles={onFiles} disabled>Zone</Dropzone>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ui/Card + ui/FloatingPanel', () => {
  it('Card interactive/selected states', () => {
    const { container, rerender } = render(<Card interactive>c</Card>);
    expect((container.firstElementChild as HTMLElement).className).toContain('cursor-pointer');
    rerender(<Card selected>c</Card>);
    expect((container.firstElementChild as HTMLElement).className).toContain('border-stroke-active');
  });

  it('FloatingPanel uses flyout tokens', () => {
    const { container } = render(<FloatingPanel className="absolute bottom-2">p</FloatingPanel>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('shadow-flyout');
    expect(el.className).toContain('z-flyout');
    expect(el.className).toContain('bottom-2');
  });
});
