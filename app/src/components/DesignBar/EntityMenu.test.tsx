import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntityMenu } from './EntityMenu';

describe('EntityMenu', () => {
  it('renders each item label after opening the menu', () => {
    render(<EntityMenu items={[
      { label: 'Push changes to source', onClick: vi.fn() },
      { label: 'Reset to master', onClick: vi.fn() },
    ]} />);
    fireEvent.click(screen.getByTitle('Options'));
    expect(screen.getByText('Push changes to source')).toBeInTheDocument();
    expect(screen.getByText('Reset to master')).toBeInTheDocument();
  });

  it('fires onClick and closes the popover for an enabled item', () => {
    const onClick = vi.fn();
    render(<EntityMenu items={[{ label: 'Go to source', onClick }]} />);
    fireEvent.click(screen.getByTitle('Options'));
    fireEvent.click(screen.getByText('Go to source'));
    expect(onClick).toHaveBeenCalledOnce();
    // popover closed → item no longer in the DOM
    expect(screen.queryByText('Go to source')).toBeNull();
  });

  it('does not fire onClick for a disabled (enabled:false) item', () => {
    const onClick = vi.fn();
    render(<EntityMenu items={[{ label: 'Push changes to source', enabled: false, onClick }]} />);
    fireEvent.click(screen.getByTitle('Options'));
    // ui/MenuItem wraps the label in a span — assert on the role=menuitem row.
    const item = screen.getByText('Push changes to source').closest('[role="menuitem"]')!;
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the danger style to a danger item', () => {
    render(<EntityMenu items={[{ label: 'Delete layout + content…', danger: true, onClick: vi.fn() }]} />);
    fireEvent.click(screen.getByTitle('Options'));
    expect(screen.getByText('Delete layout + content…').closest('[role="menuitem"]')!.className).toMatch(/text-error/);
  });

  it('honors a custom trigger title', () => {
    render(<EntityMenu title="Layout options" items={[{ label: 'x', onClick: vi.fn() }]} />);
    expect(screen.getByTitle('Layout options')).toBeInTheDocument();
  });
});
