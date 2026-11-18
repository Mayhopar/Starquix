import { normalizeLocalRoute } from './previewSrc';
import { LOCAL_PAGE_ARRIVAL_TIMEOUT_MS } from '@/utils/localPageSync';

const documentUrl = (href: string): string => { const url = new URL(href); url.hash = ''; return url.href; };
const routeOf = (href: string): string => normalizeLocalRoute(new URL(href).pathname);
/** As long as a page may take to arrive. */
const LEFT_PAGE_MS = LOCAL_PAGE_ARRIVAL_TIMEOUT_MS;

/** Current-document replies and editor page intent have separate identities.
 * Only an explicit, known-page adoption can echo a confirmed native document;
 * attribute parking is not evidence of adoption. Scans never select pages. */
export class LocalNavigationSync {
  private generation = 0;
  private sequence = 0;
  private project: string | null = null;
  private desired: string | null = null;
  private expected: string | null = null;
  private confirmed: { href: string; source: Window; id: string } | null = null;
  private adoption: { href: string; id: string } | null = null;
  private pending: { requestId: string; generation: number; source: Window; origin: string } | null = null;
  /** Routes the editor navigated to and left before they committed. Chromium
   *  does not cancel those navigations and either commit order happens (live
   *  2026-11-10: /blog then /about 77 ms apart → /blog committed, /about never
   *  did; a 2.5 s /slow then /about → /about committed, then /slow replaced
   *  it). A commit of one is stale — never a native link click — and is
   *  flagged (once: the entry is consumed) for the frame to be re-sent. */
  private left = new Map<string, number>();
  private stray = false;
  /** The current intent's page has committed (or was adopted already there). */
  private arrived = false;

  intent(project: string, href: string): boolean {
    const desired = href === 'about:blank' ? null : documentUrl(href);
    if (this.project === project && this.desired === desired) return false;
    const adopted = this.project === project && desired !== null &&
      this.adoption?.href === desired && this.adoption.id === this.confirmed?.id;
    if (this.project !== project) this.left.clear();
    else if (this.desired && !this.arrived) this.left.set(routeOf(this.desired), Date.now());
    if (desired) this.left.delete(routeOf(desired));
    this.generation++;
    this.pending = null;
    this.project = project;
    this.desired = desired;
    this.expected = adopted ? null : desired;
    this.adoption = null;
    this.stray = false;
    this.arrived = adopted;
    if (!adopted) this.confirmed = null;
    return !adopted;
  }

  /** Called before the editor's sole page owner adopts a resolved known page. */
  adopt(route: string): void {
    if (this.confirmed) this.adoption = {
      href: new URL(route, this.confirmed.href).href,
      id: this.confirmed.id,
    };
  }

  confirmedDocument(project: string, href: string, source: Window | null): string | null {
    if (href === 'about:blank' || this.project !== project || !this.confirmed || this.confirmed.source !== source) return null;
    const desired = documentUrl(href);
    if (desired !== this.desired && !(this.adoption?.href === desired && this.adoption.id === this.confirmed.id)) return null;
    return this.confirmed.href;
  }

  awaitingNativeDocument(project: string, href: string, source: Window | null): boolean {
    return href !== 'about:blank' && this.project === project && documentUrl(href) === this.desired &&
      this.expected === null && this.pending?.source === source && this.pending.generation === this.generation;
  }

  currentDocument(project: string, href: string, source: Window | null): string {
    if (href === 'about:blank') return href;
    const current = this.confirmedDocument(project, href, source) ??
      (this.project === project && documentUrl(href) === this.desired ? this.expected : null);
    if (!current) return href;
    const url = new URL(current);
    url.hash = new URL(href).hash;
    return url.href;
  }

  /** Was the last rejected document a page the editor had left? (Consumed by the read.) */
  takeStrayDocument(): boolean { const stray = this.stray; this.stray = false; return stray; }

  invalidate(): void { this.generation++; this.pending = null; this.confirmed = null; this.adoption = null; }

  navigate(href: string | null): void {
    this.invalidate();
    this.expected = href && href !== 'about:blank' ? documentUrl(href) : this.desired;
  }

  request(source: Window): { requestId: string } | null {
    if (!this.desired) return null;
    this.invalidate();
    const requestId = `local-route-${this.generation}-${++this.sequence}`;
    this.pending = { requestId, generation: this.generation, source, origin: new URL(this.desired).origin };
    return { requestId };
  }

  accept(source: Window, payload: { requestId?: string; href?: string } | null, messageOrigin: string): string | null {
    const pending = this.pending;
    if (!pending || source !== pending.source || messageOrigin !== pending.origin || payload?.requestId !== pending.requestId || pending.generation !== this.generation) return null;
    this.pending = null;
    try {
      if (typeof payload.href !== 'string') return null;
      const href = documentUrl(payload.href);
      if (new URL(href).origin !== pending.origin) return null;
      const leftAt = this.left.get(routeOf(href));
      if (leftAt !== undefined) {
        this.left.delete(routeOf(href));
        if (Date.now() - leftAt < LEFT_PAGE_MS && this.desired && routeOf(this.desired) !== routeOf(href)) { this.stray = true; return null; }
      }
      if (this.expected !== null && href !== this.expected) return null;
      this.expected = null;
      this.confirmed = { href, source, id: pending.requestId };
      if (this.desired && routeOf(this.desired) === routeOf(href)) this.arrived = true;
      return href;
    } catch { return null; }
  }
}
