/**
 * ui/Row — THE list atom. Covers: typed slots (box sizes, propagation stop,
 * showOnHover markup), expand controlled/uncontrolled, depth indent, hover
 * attr, className override via twMerge, legacy alias props.
 */
import React from 'react';
import { vi } from 'vitest';

// svg?react imports resolve to data-URL strings under vitest — stub all icons.
// (Proxy mocks need then→undefined + has trap; see task-065 notes.)
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});

import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Row } from '../Row';
import { renderSlot } from '../Slot';

describe('ui/Row', () => {
  it('renders title, caption, rightText', () => {
    render(<Row title="Hero" caption="section" rightText="12px" />);
    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('section')).toBeInTheDocument();
    expect(screen.getByText('12px')).toBeInTheDocument();
  });

  it('typed slot controls stop propagation to the row onClick', () => {
    const onRowClick = vi.fn();
    const onToggle = vi.fn();
    render(
      <Row
        title="Page"
        onClick={onRowClick}
        left={[{ type: 'chevron', expanded: false, onToggle }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('toggle slot flips value without firing row onClick', () => {
    const onRowClick = vi.fn();
    const onChange = vi.fn();
    render(
      <Row title="Visible" onClick={onRowClick} right={[{ type: 'toggle', value: false, onChange, 'aria-label': 'Visibility' }]} />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Visibility' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('checkbox slot reports checked state', () => {
    const onChange = vi.fn();
    render(<Row title="Sel" left={[{ type: 'checkbox', checked: false, onChange, 'aria-label': 'Select' }]} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('radio slot is the Figma Radiobutton (no platform tint): a 16px filled circle, checked = an 8px dot; reports the pick', () => {
    const onChange = vi.fn();
    render(<Row title="Opt" left={[{ type: 'radio', checked: false, onChange, 'aria-label': 'Opt' }]} />);
    const radio = screen.getByRole('radio', { name: 'Opt' });
    expect(radio).toHaveClass('appearance-none', 'w-4', 'h-4', 'rounded-full', 'bg-input-fill', 'border-stroke-darker', 'peer');
    expect(radio.className).not.toContain('accent-accent');
    expect(radio.nextElementSibling).toHaveClass('inset-1', 'bg-text-muted', 'peer-checked:opacity-100'); // the dot
    fireEvent.click(radio);
    expect(onChange).toHaveBeenCalled();
  });

  it('choice → label: sm radio/checkbox 8px (owner 2026-10-20: "so close to text"); md radio 16px (Figma window rows)', () => {
    render(<>
      <Row size="sm" title="Opt" left={[{ type: 'radio', checked: false, onChange: vi.fn(), 'aria-label': 'Opt' }]} />
      <Row size="sm" title="Box" left={[{ type: 'checkbox', checked: false, onChange: vi.fn(), 'aria-label': 'Box' }]} />
      <Row size="md" title="Big" left={[{ type: 'radio', checked: false, onChange: vi.fn(), 'aria-label': 'Big' }]} />
    </>);
    expect(screen.getByRole('checkbox', { name: 'Box' }).parentElement).toHaveClass('w-3.5', 'mr-1'); // 14px + 4px + the 4px title gap
    expect(screen.getByRole('radio', { name: 'Opt' }).parentElement).toHaveClass('w-4', 'mr-1'); // 16px + 4px + 4px
    expect(screen.getByRole('radio', { name: 'Big' }).parentElement).toHaveClass('w-4', 'mr-2.5'); // 16px + 10px + the 6px title gap
  });

  it('skeleton = the loading state of the same row: slots keep their box, words become bars of their own width, nothing works or is read', () => {
    const onClick = vi.fn();
    const { container } = render(<Row size="md" skeleton onClick={onClick} title={<span className="text-text">GitHub Pages</span>} caption="Live"
      left={[{ type: 'radio', checked: true, onChange: vi.fn(), 'aria-label': 'Pick' }]}
      right={[{ type: 'toggle', value: true, onChange: vi.fn() }, { type: 'custom', unboxed: true, showOnHover: true, node: <span>hover action</span> }]} />);
    expect(screen.queryByRole('radio')).toBeNull(); // no controls, only their shapes
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('hover action')).toBeNull(); // hover actions don't exist yet
    const shapes = [...container.querySelectorAll('.animate-pulse')];
    expect(shapes[0]).toHaveClass('w-4', 'h-4', 'rounded-full', 'mr-2.5'); // the md radio's own box: label lands at the same 16px
    expect(shapes.some(el => el.classList.contains('w-7'))).toBe(true); // the toggle's 28px pill
    const words = screen.getByText('GitHub Pages').parentElement!; // the real words, transparent, on the bar
    expect(words).toHaveClass('text-transparent', 'animate-pulse', 'h-3');
    expect(words.parentElement).toHaveClass('h-5'); // centered in the md title's 20px line
    const row = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('skeleton: a custom slot draws the loading shape it declares (its control has no known size), else nothing', () => {
    const { container } = render(<Row size="sm" skeleton title="Branch"
      right={[{ type: 'custom', node: <select aria-label="Branch" />, skeleton: 'w-44 h-6 rounded-inner' }, { type: 'custom', node: <span>plain</span> }]} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('plain')).toBeNull();
    expect(container.querySelector('.animate-pulse.w-44.h-6')).not.toBeNull();
  });

  it('hidden slots reserve no space — omitted spec renders nothing on that side', () => {
    const { container } = render(<Row title="Bare" />);
    // No left container rendered at all
    expect(container.querySelectorAll('.w-4.h-4').length).toBe(0);
  });

  it('expandable uncontrolled: starts expanded (legacy default), click collapses', () => {
    render(
      <Row title="Section" expandable>
        <div>content</div>
      </Row>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Section'));
    expect(screen.queryByText('content')).toBeNull();
  });

  it('expandable controlled: reflects prop, reports via onExpandChange', () => {
    const onExpandChange = vi.fn();
    const { rerender } = render(
      <Row title="Section" expandable expanded={false} onExpandChange={onExpandChange}>
        <div>content</div>
      </Row>,
    );
    expect(screen.queryByText('content')).toBeNull();
    fireEvent.click(screen.getByText('Section'));
    expect(onExpandChange).toHaveBeenCalledWith(true);
    rerender(
      <Row title="Section" expandable expanded onExpandChange={onExpandChange}>
        <div>content</div>
      </Row>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('depth indents by 8 + depth*20 px', () => {
    const { container } = render(<Row title="Nested" depth={2} />);
    const rowEl = container.querySelector('[style]') as HTMLElement;
    expect(rowEl.style.paddingLeft).toBe('48px');
  });

  it('hover={false} suppresses the hover highlight class', () => {
    const { container } = render(<Row title="Header" onClick={() => {}} hover={false} />);
    expect(container.innerHTML).not.toContain('hover:bg-bg-hover');
  });

  it('className overrides built-ins via twMerge (pl-0 beats pl-1)', () => {
    const { container } = render(<Row title="Custom" className="pl-0" />);
    const rowEl = container.firstElementChild!.firstElementChild as HTMLElement;
    expect(rowEl.className).toContain('pl-0');
    expect(rowEl.className).not.toMatch(/\bpl-1\b/);
  });

  it('showOnHover right slots are marked hover-visible', () => {
    const { container } = render(
      <Row title="Asset" right={[{ type: 'custom', node: <button aria-label="Delete" />, showOnHover: true }]} />,
    );
    expect(container.innerHTML).toContain('group-hover/row:');
  });

  it('legacy leftIcons/rightIcons ReactNodes render as-is and stop propagation', () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    render(
      <Row
        title="Legacy"
        onClick={onRowClick}
        rightIcons={<button aria-label="Act" onClick={onAction} />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(onAction).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('selected row gets bg-bg-selected', () => {
    const { container } = render(<Row title="Sel" selected />);
    expect(container.innerHTML).toContain('bg-bg-selected');
  });


  it('rowProps spreads data-* attrs onto the inner row div', () => {
    const { container } = render(
      <Row title="T" rowProps={{ 'data-testid': 'layer-item', 'data-element-id': 'e1' } as never} />,
    );
    const el = container.querySelector('[data-testid="layer-item"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-element-id')).toBe('e1');
    expect(el.className).toContain('flex items-center');
  });

  it('disabled row ignores clicks', () => {
    const onClick = vi.fn();
    render(<Row title="Off" disabled onClick={onClick} />);
    fireEvent.click(screen.getByText('Off'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ui/Slot', () => {
  it('uses a 16×16 icon carrier for both row sizes', () => {
    const { container: md } = render(<>{renderSlot({ type: 'icon', icon: <svg /> }, 'md')}</>);
    const { container: sm } = render(<>{renderSlot({ type: 'icon', icon: <svg /> }, 'sm')}</>);
    expect((md.firstElementChild as HTMLElement).className).toContain('w-4 h-4');
    expect((sm.firstElementChild as HTMLElement).className).toContain('w-4 h-4');
  });

  it('custom escape hatch still gets the bounding box unless unboxed', () => {
    const { container } = render(<>{renderSlot({ type: 'custom', node: <em>x</em> }, 'md')}</>);
    expect((container.firstElementChild as HTMLElement).className).toContain('w-4 h-4');
    const { container: unboxed } = render(
      <>{renderSlot({ type: 'custom', node: <em>x</em>, unboxed: true }, 'md')}</>,
    );
    expect((unboxed.firstElementChild as HTMLElement).className).not.toContain('w-4');
  });

  it('swatch slot renders the color', () => {
    const { container } = render(<>{renderSlot({ type: 'swatch', color: 'rgb(255, 0, 0)' }, 'md')}</>);
    expect(container.innerHTML).toContain('rgb(255, 0, 0)');
  });

  it('spinner slot renders a status role', () => {
    render(<>{renderSlot({ type: 'spinner' }, 'md')}</>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('ui/Row title weight', () => {
  // Owner 2026-11-04: layer titles are regular 400 (a medium stem outweighed the 1px icon strokes beside it).
  it('draws the title at regular weight in both sizes, selected or not', () => {
    for (const size of ['md', 'sm'] as const) {
      for (const selected of [false, true]) {
        const { unmount } = render(<Row title="Hero" size={size} selected={selected} />);
        const cls = screen.getByText('Hero').className;
        expect(cls, `${size} selected=${selected}`).toContain('font-normal');
        expect(cls, `${size} selected=${selected}`).not.toContain('font-medium');
        unmount();
      }
    }
  });
});
