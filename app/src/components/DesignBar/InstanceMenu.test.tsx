import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InstanceMenu } from './InstanceMenu';

/**
 * CONTRACT (owner 2026-11-10: "Good ux is when you can delete anything AND UNDO!", culture.md Law 6) — supersedes the
 * 2026-08-03 confirmation gate: Push and Reset run on the click and ⌘Z takes either back (the local Push is one undo
 * step via store/localPushUndo.ts; Reset always was). No dialog of any kind, never `window.confirm`; a disabled item
 * or an in-flight push still does nothing at all.
 */
describe('InstanceMenu — Push / Reset act at once (⌘Z undoes), never a dialog', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { confirmSpy = vi.spyOn(window, 'confirm'); });
  afterEach(() => { confirmSpy.mockRestore(); });

  const renderMenu = (over: Partial<React.ComponentProps<typeof InstanceMenu>> = {}) => {
    const onPush = vi.fn();
    const onReset = vi.fn();
    const onGoToSource = vi.fn();
    render(<InstanceMenu canPush isPushing={false} onPush={onPush} canReset onReset={onReset} onGoToSource={onGoToSource} {...over} />);
    fireEvent.click(screen.getByTitle('Component options'));
    return { onPush, onReset, onGoToSource };
  };

  it('push runs once on the click — no dialog, never window.confirm', () => {
    const { onPush } = renderMenu();
    fireEvent.click(screen.getByText('Push changes to source'));
    expect(onPush).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('reset runs once on the click — no dialog; Go to source too', () => {
    const { onReset, onGoToSource } = renderMenu();
    fireEvent.click(screen.getByText('Reset to master'));
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTitle('Component options')); // re-open (menu closes on click)
    fireEvent.click(screen.getByText('Go to source'));
    expect(onGoToSource).toHaveBeenCalledOnce();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('disabled push item (canPush=false): no push', () => {
    const { onPush } = renderMenu({ canPush: false });
    fireEvent.click(screen.getByText('Push changes to source'));
    expect(onPush).not.toHaveBeenCalled();
  });

  it('in-flight push (isPushing): no double push', () => {
    const { onPush } = renderMenu({ isPushing: true });
    fireEvent.click(screen.getByText('Pushing...'));
    expect(onPush).not.toHaveBeenCalled();
  });
});
