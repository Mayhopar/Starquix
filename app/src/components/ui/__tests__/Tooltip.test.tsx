/**
 * ui/Tooltip — hover after a delay; keyboard focus (focus-visible) at once, with the trigger described by the tip
 * (finding #39: the hint was mouse-only and never reached a screen reader).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '../Tooltip';

describe('ui/Tooltip', () => {
  it('keyboard focus shows the tip at once and describes the trigger with it; focus leaving hides it', async () => {
    const user = userEvent.setup();
    render(<><Tooltip content="Back up now"><button>icon</button></Tooltip><button>next</button></>);
    await user.tab();
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Back up now');
    expect(screen.getByRole('button', { name: 'icon' }).getAttribute('aria-describedby')).toBe(tip.id);
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'icon' }).hasAttribute('aria-describedby')).toBe(false);
  });

  it('a mouse click focus does not pop it at once; hovering shows it after the delay', async () => {
    const user = userEvent.setup();
    render(<Tooltip content="Back up now"><button>icon</button></Tooltip>);
    await user.click(screen.getByRole('button', { name: 'icon' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip', {}, { timeout: 1000 })).toBeTruthy();
  });
});
