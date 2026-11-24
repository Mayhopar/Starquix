/**
 * ui overlays — Popover (controlled + uncontrolled), Menu/MenuItem, Modal
 * sizes/escape, Tabs, SegmentedControl.
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
import { useRef } from 'react';
import { Popover } from '../Popover';
import { Menu, MenuItem } from '../Menu';
import { Modal } from '../Modal';
import { Tabs } from '../Tabs';
import { SegmentedControl } from '../SegmentedControl';

function ControlledHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref}>trigger</button>
      <Popover isOpen={open} onClose={onClose} triggerRef={ref}>
        <div>popover content</div>
      </Popover>
    </>
  );
}

describe('ui/Popover', () => {
  it('controlled: renders to body when open, hides when closed', () => {
    const { rerender } = render(<ControlledHost open={false} onClose={() => {}} />);
    expect(screen.queryByText('popover content')).toBeNull();
    rerender(<ControlledHost open onClose={() => {}} />);
    expect(screen.getByText('popover content')).toBeInTheDocument();
  });

  it('controlled: Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<ControlledHost open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it.each(['composing', 'ime-keycode', 'handled'] as const)('leaves %s Escape with its local owner', mode => {
    const onClose = vi.fn();
    render(<ControlledHost open onClose={onClose} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: mode === 'composing', keyCode: mode === 'ime-keycode' ? 229 : 0 });
    if (mode === 'handled') event.preventDefault();
    document.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets a field consume Escape before closing its popover', () => {
    const handled = vi.fn();
    render(<Popover trigger={<button>field popup</button>}><input aria-label="Local draft" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); handled(); } }} /></Popover>);
    fireEvent.click(screen.getByRole('button', { name: 'field popup' }));
    const field = screen.getByRole('textbox', { name: 'Local draft' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(handled).toHaveBeenCalledTimes(1);
    expect(field).toBeInTheDocument();
  });

  it('keeps the existing nested-popover close behavior without leaking Escape to window', () => {
    const globalEscape = vi.fn();
    window.addEventListener('keydown', globalEscape);
    try {
      render(<Popover trigger={<button>outer</button>}><Popover trigger={<button>inner</button>}><span>inner content</span></Popover></Popover>);
      fireEvent.click(screen.getByRole('button', { name: 'outer' }));
      fireEvent.click(screen.getByRole('button', { name: 'inner' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('inner content')).toBeNull();
      expect(screen.queryByRole('button', { name: 'inner' })).toBeNull();
      expect(globalEscape).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', globalEscape); }
  });

  it('a mousedown inside a NESTED popover never closes its parent (color swatch picked nothing — owner report 2026-09-29)', () => {
    const picked = vi.fn();
    render(<Popover trigger={<button>outer</button>}><Popover trigger={<button>inner</button>}><button onClick={picked}>swatch</button></Popover></Popover>);
    fireEvent.click(screen.getByRole('button', { name: 'outer' }));
    fireEvent.click(screen.getByRole('button', { name: 'inner' }));
    const swatch = screen.getByRole('button', { name: 'swatch' });
    fireEvent.mouseDown(swatch);
    fireEvent.click(swatch);
    expect(picked).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'inner' })).toBeInTheDocument(); // the parent stayed open
    fireEvent.mouseDown(document.body); // a real outside click still closes both
    expect(screen.queryByRole('button', { name: 'inner' })).toBeNull();
  });

  it('uncontrolled: trigger click toggles', () => {
    render(
      <Popover trigger={<button>open me</button>}>
        <div>drop content</div>
      </Popover>,
    );
    expect(screen.queryByText('drop content')).toBeNull();
    fireEvent.click(screen.getByText('open me'));
    expect(screen.getByText('drop content')).toBeInTheDocument();
  });

  // ⌘\ hides the sidebars under an open flyout: with its control gone it has nowhere to sit.
  it('closes when its trigger leaves the layout, and stays while the trigger is laid out', () => {
    const onClose = vi.fn();
    render(<ControlledHost open onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'trigger' });
    trigger.checkVisibility = () => true;
    fireEvent(window, new Event('resize'));
    expect(onClose).not.toHaveBeenCalled();
    trigger.checkVisibility = () => false; // display: none on it or on an ancestor
    fireEvent(window, new Event('resize'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses flyout tokens', () => {
    render(<ControlledHost open onClose={() => {}} />);
    const panel = screen.getByText('popover content').parentElement!.parentElement!;
    expect(panel.className).toContain('shadow-flyout');
    expect(panel.className).toContain('z-flyout');
  });
});

describe('ui/Menu', () => {
  it('MenuItem fires onSelect; danger styles applied; disabled blocks', () => {
    const onSelect = vi.fn();
    render(
      <>
        <MenuItem label="Rename" onSelect={onSelect} />
        <MenuItem label="Delete" danger onSelect={() => {}} />
        <MenuItem label="Locked" disabled onSelect={onSelect} />
      </>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('text-error');
    const locked = screen.getByRole('menuitem', { name: 'Locked' });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(locked);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('Menu renders items via uncontrolled Popover trigger', () => {
    render(
      <Menu trigger={<button>menu</button>}>
        <MenuItem label="One" onSelect={() => {}} />
      </Menu>,
    );
    fireEvent.click(screen.getByText('menu'));
    expect(screen.getByRole('menuitem', { name: 'One' })).toBeInTheDocument();
  });
});

describe('ui/Modal', () => {
  it('renders when open with modal tokens; Escape closes', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <Modal isOpen onClose={onClose} size="md">
        <div>modal body</div>
      </Modal>,
    );
    expect(screen.getByText('modal body')).toBeInTheDocument();
    expect(container.innerHTML).toContain('z-modal');
    expect(container.innerHTML).toContain('shadow-modal');
    expect(container.innerHTML).toContain('w-[560px]');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    rerender(
      <Modal isOpen={false} onClose={onClose}>
        <div>modal body</div>
      </Modal>,
    );
    expect(screen.queryByText('modal body')).toBeNull();
  });
});

function MenuInModal({ onClose, onSelect }: { onClose: () => void; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(true);
  return (
    <Modal isOpen onClose={onClose} size="md">
      <button ref={ref}>more</button>
      <Menu isOpen={open} onClose={() => setOpen(false)} triggerRef={ref}>
        <MenuItem label="Sign out" onSelect={onSelect} />
      </Menu>
    </Modal>
  );
}

describe('ui/Modal + a Menu inside it (versions-publish UX case 22)', () => {
  it('the menu stacks above the modal; its clicks are inside the modal; Escape closes the menu first', () => {
    const onClose = vi.fn(); const onSelect = vi.fn();
    render(<MenuInModal onClose={onClose} onSelect={onSelect} />);
    const item = screen.getByRole('menuitem', { name: 'Sign out' });
    expect((item.closest('.fixed') as HTMLElement).style.zIndex).toBe('calc(var(--z-modal) + 1)');
    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ui/Tabs', () => {
  it('marks active tab and fires onChange', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
        value="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('ui/SegmentedControl', () => {
  it('selects flat segments', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]}
        value="x"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Y'));
    expect(onChange).toHaveBeenCalledWith('y');
  });

  it('size lg = 32px, the height of a window field (Field size="lg"); md stays 28px', () => {
    render(<>
      <SegmentedControl options={[{ value: 'a', label: 'A' }]} value="a" onChange={vi.fn()} />
      <SegmentedControl size="lg" options={[{ value: 'b', label: 'B' }]} value="b" onChange={vi.fn()} />
    </>);
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('h-6'); // + the 2px frame = 28px
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('h-7'); // + the 2px frame = 32px
  });

  it('is an input: the track paints the input fill (never the dark Bg Contrast well); the picked segment = Secondary fill', () => {
    render(<SegmentedControl options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} value="a" onChange={vi.fn()} />);
    const picked = screen.getByRole('button', { name: 'A' });
    expect(picked.parentElement).toHaveClass('bg-input-fill');
    expect(picked.parentElement).not.toHaveClass('bg-bg-contrast');
    expect(picked).toHaveClass('bg-btn-secondary-fill-default', 'text-btn-secondary-text-default');
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('bg-transparent');
  });

  it('dropdown segment opens a menu and selects a sub-option', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'more', label: 'More', dropdown: [{ value: 'grid', label: 'Grid' }] },
        ]}
        value="auto"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid' }));
    expect(onChange).toHaveBeenCalledWith('grid');
  });
});

// Audit 2026-09-30: the post editor's `/` menu ran under the fixed footer bar.
describe('ui/Popover — fixed bottom chrome', () => {
  it('reads --sq-chrome-bottom, caps its height above it and flips a bottom placement that would land under it', async () => {
    const { chromeBottom } = await import('../Popover');
    document.documentElement.style.setProperty('--sq-chrome-bottom', '60px');
    expect(chromeBottom()).toBe(60);
    const Harness = () => {
      const ref = useRef<HTMLButtonElement>(null);
      return <><button ref={ref}>t</button><Popover isOpen onClose={() => {}} triggerRef={ref} placement="bottom-start"><div>menu</div></Popover></>;
    };
    render(<Harness />);
    const panel = screen.getByText('menu').closest('.fixed') as HTMLElement;
    expect(panel.style.maxHeight).toContain('var(--sq-chrome-bottom, 0px)');
    document.documentElement.style.removeProperty('--sq-chrome-bottom');
    expect(chromeBottom()).toBe(0);
  });
});
