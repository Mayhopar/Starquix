import { afterEach, describe, expect, it } from 'vitest';
import { createSessionGate } from '../sessionGate';

// Turnstile itself never loads under jsdom (no network): these cover the modal around it.
describe('session gate', () => {
  afterEach(() => { document.body.innerHTML = ''; document.head.querySelectorAll('script').forEach(s => s.remove()); });
  const dialog = () => document.querySelector('[data-testid="demo-session-gate"]');

  it('asks for a first session with the session length, as a modal dialog, and loads Turnstile', () => {
    const gate = createSessionGate();
    void gate.prompt({ reason: 'required', minutes: 20, siteKey: 'k' }).catch(() => {});
    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.textContent).toContain('Try Starquix in your browser');
    expect(dialog()?.textContent).toContain('lasts 20 minutes');
    expect(document.head.querySelector('script')?.getAttribute('src')).toContain('challenges.cloudflare.com/turnstile');
  });

  it('says the session ended, shows why a new one was refused, and replaces itself on the next prompt', () => {
    const gate = createSessionGate();
    void gate.prompt({ reason: 'ended', minutes: 20, siteKey: 'k' }).catch(() => {});
    void gate.prompt({ reason: 'ended', minutes: 20, siteKey: 'k', message: 'The demo is full. Try again in a minute.' }).catch(() => {});
    expect(document.querySelectorAll('[data-testid="demo-session-gate"]')).toHaveLength(1);
    expect(dialog()?.textContent).toContain('Your demo session ended');
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('The demo is full. Try again in a minute.');
  });

  it('closes', () => {
    const gate = createSessionGate();
    void gate.prompt({ reason: 'required', minutes: 20, siteKey: 'k' }).catch(() => {});
    gate.close();
    expect(dialog()).toBeNull();
  });
});
