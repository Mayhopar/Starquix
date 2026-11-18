/** What the Publish and Versions windows share (docs/plans/2026-10-20-publish-sheet-design.md, drawn as the owner's Figma —
 *  docs/plans/2026-10-21-publish-figma-ledger.md): the window shell, the body/footer layout, the destination list with the
 *  picked destination's group, its items (label on top), the footer's confirm and status line, type errors, polling. */
import { Children, createContext, Fragment, useContext, useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon, LinkIcon } from '@/assets/icons';
import { Button, cx, Field, InputGroup, Labeled, Modal, OperationNotice, Row, type RowSlotSpec } from '@/components/ui';
import type { GitError, Host, TypeCheck } from '@/services/git/gitClient';

const POLL_MS = 10_000;
/** Watch this long after a publish / choice / open, then "Check again" — never poll forever. */
/** SEO (task-248, owner D5): a site's live address becomes its `site:` when none is set. Written BEFORE the build where the
 *  address is known up front (Cloudflare, GitHub Pages — owner 2026-11-17), so the publish carries it and the folder stays
 *  clean; a failed write never blocks a publish. */
export const adoptSiteAddress = (url: string | null | undefined): Promise<void> =>
  url ? import('@/store/seo/seoFiles').then((m) => m.ensureSiteAddress(url)).catch(() => {}) : Promise.resolve();
/** Netlify / Vercel name the address only after their first build: adopted once it is live (the next Publish carries it). */
export function useAdoptSiteAddress(liveUrl: string | null | undefined): void {
  useEffect(() => { void adoptSiteAddress(liveUrl); }, [liveUrl]);
}

export const WATCH_MS = 10 * 60_000;
export const stamp = () => `Update site · ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
export const bare = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
/** Opens a page in the user's browser (desktop main hands http(s) window.open to the system browser). */
export const open = (href: string) => { window.open(href, '_blank', 'noopener,noreferrer'); };
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-site';

/** Where a site can live (S5): one line each; `free` = the address it gives (the Address placeholder). GitHub's "code only" is Versions → Back up. */
export type Destination = Exclude<Host, 'github'>;
export const DESTINATIONS: { value: Destination; title: string; free: string; connectUrl?: string }[] = [
  { value: 'cloudflare', title: 'Cloudflare', free: 'workers.dev' },
  { value: 'pages', title: 'GitHub Pages', free: 'github.io' },
  // GitHub case 26: their plain import page (no repo deep-link params).
  { value: 'netlify', title: 'Netlify', free: 'netlify.app', connectUrl: 'https://app.netlify.com/start' },
  { value: 'vercel', title: 'Vercel', free: 'vercel.app', connectUrl: 'https://vercel.com/new' },
];
export const destination = (h: Destination) => DESTINATIONS.find(d => d.value === h)!;
export const isDestination = (h: Host | null | undefined): h is Destination => !!h && h !== 'github';
export type StateBadge = { label: string; variant: 'success' | 'error' | 'warning' | 'info' | 'default' };

/** The window's close, for its footer's Cancel. */
const WindowClose = createContext<(() => void) | null>(null);

/** A window (the Figma window, culture.md): the kit Modal + a 56px header with its name (text-lg medium) only — the
 *  footer's `Cancel` closes it (owner 2026-10-22: no ✕), as do Esc and a click outside. `closeButton` puts the ✕ back for
 *  a window not yet on that recipe (Versions). */
export function Window({ isOpen, onClose, title, closeButton = false, children }: {
  isOpen: boolean; onClose: () => void; title: string; closeButton?: boolean; children: ReactNode;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" className="flex flex-col overflow-hidden">
      <Row title={<span className="text-lg text-text">{title}</span>} hover={false}
        className={cx('shrink-0 pl-4 pr-2 border-b border-stroke', closeButton ? 'py-2' : 'py-3.5')} // 56px either way
        right={closeButton ? [{ type: 'custom', unboxed: true, node: (
          <Button variant="ghost" size="lg" iconOnly aria-label="Close" title="Close" icon={<CloseIcon className="w-4 h-4" />} onClick={onClose} />) }] : undefined} />
      <WindowClose.Provider value={onClose}>{children}</WindowClose.Provider>
    </Modal>
  );
}
/** The footer's Cancel (the Figma window): secondary lg, right before the primary. It closes the window — unless `onClick`
 *  cancels something pending first (a confirm, a repository switch). */
export function Cancel({ onClick, disabled = false }: { onClick?: () => void; disabled?: boolean }) {
  const close = useContext(WindowClose);
  return <Button variant="secondary" size="lg" label="Cancel" disabled={disabled} onClick={onClick ?? close ?? undefined} />;
}
/** A view's footer while its data loads (owner 2026-10-22: "cancel is shown and publish is shown but disabled – so cancel
 *  doesn't jump left"): Cancel and the primary, disabled, already in their loaded places. The primary is a placeholder
 *  like the skeleton rows (aria-hidden): the real one replaces it once the data is in. */
export const LoadingFooter = ({ primary = 'Publish' }: { primary?: string }) => (
  <><Spacer /><Cancel /><Button aria-hidden variant="primary" size="lg" label={primary} disabled /></>
);

/** One view of a window: the body scrolls, the footer stays — the status line (or a question) on the left, the secondary
 *  actions and the one primary on the right, 8px from the edge (lg buttons: a 56px footer). */
export function Pane({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-stroke pl-4 pr-2 py-2 flex items-center gap-2">{footer}</div>}
    </>
  );
}
/** A form in a window body (a sub-view's fields): items 16px apart, on the 16px edge. */
export const Form = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-4 p-4">{children}</div>;
/** A section of a body: its rows (px-2 each) put every label on the window's 16px edge; `rule` = a full-width line above. */
export const Block = ({ children, rule = false }: { children: ReactNode; rule?: boolean }) => (
  <div className={cx('px-2 py-2', rule && 'border-t border-stroke')}>{children}</div>
);
/** Notices under a block's rows, 8px apart (nothing when there are none); `flush` in a group (its gap spaces them). */
export const Notices = ({ children, flush = false }: { children: ReactNode; flush?: boolean }) => (
  Children.toArray(children).length ? <div className={cx('space-y-2', !flush && 'pt-2')}>{children}</div> : null
);
export const Spacer = () => <div className="flex-1" />;
/** A row holding a 24–28px control (or a bordered badge) stays 32px like every other row (culture.md spacing spec). */
export const CONTROL_ROW = 'px-2 h-8 py-0';

/** One option of a pick-one list: the ink radio 8px from its title, the soft highlight on the picked one (owner, 2026-10-18);
 *  on the right a badge (state) or meta text. */
export function ChoiceRow({ title, meta, badge, checked, onPick, label, disabled = false, tooltip, skeleton = false }: {
  title: ReactNode; meta?: string; badge?: StateBadge | null; checked: boolean; onPick: () => void; label: string; disabled?: boolean; tooltip?: string;
  /** The loading state (Row `skeleton`): pass a typical title/meta — their bars take the words' width. */
  skeleton?: boolean;
}) {
  return (
    <Row size="sm" skeleton={skeleton} disabled={disabled} onClick={disabled ? undefined : onPick} title={<span className="text-text">{title}</span>} rightText={meta}
      className={cx('rounded-outer', CONTROL_ROW, checked && 'bg-bg-contrast hover:bg-bg-contrast')} rowProps={tooltip ? { title: tooltip } : undefined}
      left={[{ type: 'radio', checked, onChange: onPick, 'aria-label': label, disabled }]}
      right={badge ? [{ type: 'badge', label: badge.label, variant: badge.variant }] : undefined} />
  );
}

/** The destination list (S1, the Figma option rows): fixed order, 40px rows — the radio on the 16px edge, the name in ink at
 *  48px, the current host's state badge — and the picked one's group right under its row: 48px in, 24px from the right.
 *  `skeleton`: the window's first read is pending — these same rows in the kit's loading state (Row `skeleton`; owner
 *  2026-10-22: "shouldn't be a boutique solution"), no pick, no group. */
export function DestinationList({ skeleton = false, pick, onPick, current = null, badge = null, disabled = false, children }: {
  skeleton?: boolean; pick?: Destination; onPick?: (d: Destination) => void; current?: Host | null; badge?: StateBadge | null;
  disabled?: boolean; children?: ReactNode;
}) {
  return (
    <div role={skeleton ? 'status' : 'radiogroup'} aria-label={skeleton ? 'Loading destinations' : 'Where your site lives'} className="py-2">
      {DESTINATIONS.map(d => (
        <Fragment key={d.value}>
          <Row skeleton={skeleton} disabled={disabled} onClick={disabled ? undefined : () => onPick?.(d.value)} className="px-4"
            title={<span className="font-normal text-text">{d.title}</span>}
            left={[{ type: 'radio', checked: pick === d.value, onChange: () => onPick?.(d.value), 'aria-label': d.title, disabled }]}
            right={d.value === current && badge ? [{ type: 'badge', label: badge.label, variant: badge.variant }] : undefined} />
          {!skeleton && pick === d.value && <div role="group" aria-label={`${d.title} settings`} className="flex flex-col gap-4 pl-12 pr-6 pt-2 pb-4">{children}</div>}
        </Fragment>
      ))}
    </div>
  );
}

const noop = () => {};
/** An item of a window form (the Figma Input): the label on top; a read-only value — or a placeholder — with its icon
 *  actions inside the field (`icons`); text actions after it as outline buttons (`actions`); the helper line under it.
 *  `onOpen`: a click on the field opens its menu (the chevron in `icons` is the keyboard way). */
export function Prop({ label, value, placeholder, icons, actions, caption, testId, tooltip, onOpen, skeleton = false }: {
  label: string; value?: string | null; placeholder?: string | null; icons?: ReactNode; actions?: ReactNode; caption?: string | null;
  testId?: string; tooltip?: string; onOpen?: () => void;
  /** The loading state: the label as a bar of its width over the field's own box (Labeled + Field `skeleton`). */
  skeleton?: boolean;
}) {
  if (skeleton) return <Labeled label={label} skeleton><Field size="lg" skeleton value="" onChange={noop} /></Labeled>;
  const field = value != null || placeholder != null || icons != null;
  return (
    <Labeled label={label} caption={caption} data-testid={testId} title={tooltip}>
      <InputGroup layout="row" gap={2}>
        {field && <Field size="lg" readOnly value={value ?? ''} placeholder={placeholder ?? undefined} onChange={noop} aria-label={label}
          title={tooltip ? undefined : value ?? undefined} onClick={onOpen} trailing={icons} className="flex-1" />}
        {actions}
      </InputGroup>
    </Labeled>
  );
}
/** A row action: a ghost sm button. */
export const act = (label: string, onClick: () => void, o: { disabled?: boolean; loading?: boolean; title?: string } = {}): RowSlotSpec => ({
  type: 'custom', unboxed: true,
  node: <Button variant="ghost" size="sm" label={label} title={o.title} disabled={o.disabled} loading={o.loading} onClick={onClick} />,
});
/** The link icon in an address field: opens the address in the browser. */
export const openIcon = (href: string, label: string) => (
  <Button variant="ghost" size="sm" iconOnly aria-label={label} title={label} icon={<LinkIcon className="w-4 h-4" />} onClick={() => open(href)} />
);

/** The footer asking before an action (Unpublish, Disconnect, Restore, a dirty branch switch): the question, then the verbs. */
export const FooterConfirm = ({ question, actions }: { question: string; actions: ReactNode }) => (
  <><span className="flex-1 min-w-0 text-xs text-text">{question}</span>{actions}</>
);
/** The footer's one status sentence on its left edge; it takes the free width, so the buttons sit right (empty = a spacer). */
export const Status = ({ children }: { children: ReactNode }) => (
  <span className="flex-1 min-w-0 truncate text-xs text-text-secondary" data-testid="unpublished">{children}</span>
);

/** The site's own `astro check` failed (docs/plans/2026-10-20-prepublish-type-check-design.md 19–21): the notice says what
 *  (no paths in a notice), then one row per error — its message, `file:line` on the right, the full location as tooltip. */
export function TypeErrors({ check }: { check: TypeCheck }) {
  const n = check.total;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView?.({ block: 'nearest' }); }, [check]); // the answer to the click: never below the fold
  return (
    <div ref={box}>
      <OperationNotice title="The site's build will fail." detail={n === 1 ? '1 error stops it. Fix it, then publish.' : `${n} errors stop it. Fix them, then publish.`} />
      {check.errors.map((e, i) => (
        <Row key={i} size="sm" className="px-2" hover={false} title={e.message} rightText={`${e.file.split('/').pop()}:${e.line}`}
          rowProps={{ title: `${e.file}:${e.line}:${e.column} ${e.message}` }} />
      ))}
      {n > check.errors.length && <Row size="sm" className="px-2" hover={false} title={`${n - check.errors.length} more`} />}
    </div>
  );
}

export interface Notice { title: string; detail?: string; action?: { label: string; onClick: () => void; busy?: boolean }; links?: { href: string; label: string }[] }
/** Publish into, ledger 31 (docs/plans/2026-10-18-publish-into-existing-repo-design.md): another owner's repo may be an
 *  organization that hasn't approved Starquix. */
export const noAccess = (e: GitError, owner: string, login: string): Notice => (owner && owner !== login
  ? { title: e.message, detail: `If ${owner} is an organization, ask an owner to approve Starquix, or request access.`,
    links: [{ href: 'https://github.com/settings/applications', label: 'Request access' }] }
  : { title: e.message });
export const NoticeView = ({ notice }: { notice: Notice }) => (
  <OperationNotice title={notice.title} detail={notice.detail} action={notice.action} links={notice.links} />
);
/** A row with a spinner: loading, checking. */
export const Busy = ({ label }: { label: string }) => (
  <div role="status"><Row size="sm" className="px-2" hover={false} title={label} left={[{ type: 'spinner' }]} /></div>
);

/** `tick` every 10 s while `active` — the next only once the last settled (a slow answer never piles up calls in main's
 *  project lane); a hidden window asks nothing. */
export function usePoll(active: boolean, tick: () => Promise<unknown>) {
  const latest = useRef(tick);
  useEffect(() => { latest.current = tick; });
  useEffect(() => {
    if (!active) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => { if (alive) timer = setTimeout(() => void (document.hidden ? Promise.resolve() : latest.current()).catch(() => {}).finally(next), POLL_MS); };
    next();
    return () => { alive = false; clearTimeout(timer); };
  }, [active]);
}

/** Reports a running op to the window (its ⋯ waits — one op at a time). */
export function useReportBusy(busy: boolean, onBusy?: (busy: boolean) => void) {
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);
}
