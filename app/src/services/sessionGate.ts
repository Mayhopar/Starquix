/**
 * Web demo session gate (starquix-cloud web-demo/DESIGN.md security #9): the modal a visitor passes before the demo
 * starts a container for them, and again when a session reaches its time cap. Plain DOM, owned by the web demo bridge
 * (webDesktop.ts), so the React editor needs no demo-only branches. Cloudflare Turnstile runs inside it; the token goes
 * back to the bridge, which begins the session with the Worker.
 */
export type GateReason = 'required' | 'ended';
export interface GatePrompt { reason: GateReason; minutes: number; siteKey: string; message?: string }
export interface SessionGate {
  /** Show the gate (or update it with `message`) and resolve with a Turnstile token. */
  prompt(p: GatePrompt): Promise<string>;
  close(): void;
}

interface Turnstile { render(el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'error-callback'?: () => void; theme?: string }): string; reset(id: string): void; remove(id: string): void }
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  return loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = TURNSTILE_SRC; s.async = true;
    s.onload = () => { const t = (window as unknown as { turnstile?: Turnstile }).turnstile; if (t) resolve(t); else reject(new Error('Turnstile did not load')); };
    s.onerror = () => { loading = null; reject(new Error('Turnstile did not load')); };
    document.head.appendChild(s);
  });
}

const COPY: Record<GateReason, { title: string; body: (m: number) => string }> = {
  required: { title: 'Try Starquix in your browser',
    body: m => `A demo session lasts ${m} minutes. Your projects are saved in this browser only; download the app to keep them for good.` },
  ended: { title: 'Your demo session ended',
    body: m => `Sessions last ${m} minutes. Your projects are still saved in this browser: start a new session to keep editing.` },
};

export function createSessionGate(doc: Document = document): SessionGate {
  let root: HTMLElement | null = null; let widget: string | null = null; let turnstile: Turnstile | null = null;
  let pending: ((token: string) => void) | null = null;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag); e.setAttribute('style', style); if (text) e.textContent = text; return e;
  };
  return {
    prompt({ reason, minutes, siteKey, message }) {
      root?.remove(); if (widget && turnstile) turnstile.remove(widget); widget = null;
      root = el('div', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font:14px/1.45 system-ui,sans-serif');
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('data-testid', 'demo-session-gate');
      const card = el('div', 'background:var(--color-bg,#fff);color:var(--color-text,#111);border-radius:12px;padding:24px;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,.25)');
      card.append(el('h2', 'margin:0 0 8px;font-size:18px;font-weight:600', COPY[reason].title), el('p', 'margin:0 0 16px', COPY[reason].body(minutes)));
      if (message) { const m = el('p', 'margin:0 0 16px;color:#c0392b', message); m.setAttribute('role', 'alert'); card.append(m); }
      const slot = el('div', 'min-height:65px'); card.append(slot);
      root.append(card); doc.body.append(root);
      return new Promise<string>((resolve, reject) => {
        pending = resolve;
        loadTurnstile().then(t => {
          turnstile = t;
          widget = t.render(slot, { sitekey: siteKey, callback: token => { pending?.(token); pending = null; },
            'error-callback': () => { if (widget) t.reset(widget); } });
        }, error => { slot.textContent = 'The browser check could not load. Check your connection and reload.'; reject(error); });
      });
    },
    close() { if (widget && turnstile) turnstile.remove(widget); widget = null; root?.remove(); root = null; pending = null; },
  };
}
