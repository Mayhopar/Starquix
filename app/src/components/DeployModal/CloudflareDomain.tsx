/**
 * Get a domain (desktop, Cloudflare): OUR search box + price + Buy. Cloudflare's Registrar registers it on the user's
 * account and charges their payment method; main re-checks the price the user saw (never re-quotes). Every state and
 * error below is a ledger case in docs/plans/2026-10-16-cloudflare-one-click-design.md (49–57, 64, C8/C9).
 */
import { useState } from 'react';
import { Button, Row, SearchField } from '@/components/ui';
import { parseGitError, type CloudflareAccount, type DomainRow, type GitClient, type GitError, type GitErrorCode } from '@/services/git/gitClient';
import { Block, CONTROL_ROW, Notices, NoticeView, open, Pane, type Notice } from './publishParts';

/** C9 — OWNER DECISION: false = the API's explicit opt-in (unticked); true = Cloudflare's dashboard default. */
export const AUTO_RENEW_DEFAULT = false;
const money = (price: string, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(price));
export const dash = (account: string, page: string) => `https://dash.cloudflare.com/${account}/${page}`;
const priceOf = (r: DomainRow) => (r.renewal && r.renewal !== r.price
  ? `${money(r.price!, r.currency)} first year, then ${money(r.renewal, r.currency)}/year` : `${money(r.price!, r.currency)}/year`);

interface Props {
  client: GitClient; account: CloudflareAccount;
  /** A purchase started or a domain was taken over: the parent re-reads the status (it shows the domain's setup). */
  onDone: () => void;
  /** Back to the live view (it re-reads: a purchase may have landed meanwhile — review 3a). */
  onBack: () => void;
}

/** A sub-view of the Publish window (docs/plans/2026-10-20-publish-sheet-design.md case 23): the footer's Back leaves it. */
export function CloudflareDomain({ client, account, onDone, onBack }: Props) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DomainRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'search' or the domain being bought
  const [error, setError] = useState<GitError | null>(null);
  const [changed, setChanged] = useState(false); // ledger 52: a price moved
  const [autoRenew, setAutoRenew] = useState(AUTO_RENEW_DEFAULT);

  async function search() {
    if (!q.trim() || busy) return; // ledger 50: an empty query sends nothing
    setBusy('search'); setError(null); setChanged(false);
    try { setRows(await client.cloudflareSearch(q)); } catch (e) { setError(parseGitError(e)); setRows(null); } finally { setBusy(null); }
  }
  async function take(row: DomainRow) {
    if (busy) return; // ledger 34: one purchase at a time
    setBusy(row.name); setError(null);
    try {
      // C8: a domain already theirs goes without a price — main never buys without one.
      await (row.kind === 'owned' ? client.cloudflareDomain(row.name)
        : client.cloudflareDomain(row.name, { price: row.price!, currency: row.currency!, autoRenew }));
      onDone();
    } catch (e) {
      const g = parseGitError(e);
      const update = (next: Partial<DomainRow>) => setRows(rs => rs?.map(r => (r.name === row.name ? { ...r, ...next } : r)) ?? rs);
      if (g.code === 'price-changed') { update({ price: g.extra.price, currency: g.extra.currency }); setChanged(true); } // nothing charged
      else if (g.code === 'domain-taken') update({ kind: 'taken' });
      else setError(g);
    } finally { setBusy(null); }
  }

  const billing = { href: dash(account.id, 'billing/payment-info'), label: 'Open billing' };
  const settings = { href: dash(account.id, 'domains/registrations'), label: 'Open domain settings' };
  const NOTICE: Partial<Record<GitErrorCode, Notice>> = { // ledger 57: curated, never Cloudflare's answer
    'no-contact': { title: 'Add your contact details on Cloudflare first.', detail: 'Domain registrations need a default contact and the registration agreement.', links: [settings] },
    'no-payment': { title: 'Add a payment method on Cloudflare first.', links: [billing] },
    'registrar-refused': { title: "Cloudflare didn't complete the purchase.", detail: 'Check your payment method and contact details on Cloudflare, then try again.', links: [billing, settings] },
    offline: { title: "You're offline.", detail: 'Buying a domain needs a connection.' },
    'rate-limited': { title: 'Cloudflare is busy.', detail: 'Try again in a minute.' },
    cloudflare: { title: "Cloudflare didn't accept this.", detail: 'Try again in a minute.', links: [{ href: 'https://dash.cloudflare.com/', label: 'Open Cloudflare' }] },
    'cloudflare-signed-out': { title: 'Connect Cloudflare again.', action: { label: 'Connect Cloudflare', onClick: () => { setError(null); void client.cloudflareConnect().catch(e => setError(parseGitError(e))); } } },
  };
  const inline = error?.code === 'invalid-domain' ? 'Use letters, numbers and dashes — no accents or symbols.' : null;
  const notice = error && !inline && (NOTICE[error.code] ?? { title: "That didn't work.", detail: error.message });

  const actionOf = (r: DomainRow) => { // one primary per view: Buy is secondary (a list can offer several)
    if (r.kind === 'buy') return <Button variant="secondary" size="sm" label={`Buy ${money(r.price!, r.currency)}`} loading={busy === r.name} disabled={!!busy} onClick={() => void take(r)} />;
    if (r.kind === 'owned') return <Button variant="ghost" size="sm" label="Use it" loading={busy === r.name} disabled={!!busy} onClick={() => void take(r)} />;
    if (r.kind === 'dashboard') return <Button variant="ghost" size="sm" label="Buy on Cloudflare" onClick={() => open(dash(account.id, 'registrar/register'))} />; // premium / not via the API
    if (r.kind === 'inactive') return <Button variant="ghost" size="sm" label="Finish on Cloudflare" onClick={() => open(dash(account.id, r.name))} />; // nameservers not switched yet
    return null;
  };
  const captionOf = (r: DomainRow) => (r.kind === 'buy' ? priceOf(r)
    : r.kind === 'owned' ? 'Already in your Cloudflare account' : r.kind === 'inactive' ? 'In your Cloudflare account, not active yet'
    : r.kind === 'taken' ? 'Taken'
    : r.kind === 'dashboard' ? 'Premium or not sold through Starquix' : 'Not available');
  const buyable = rows?.some(r => r.kind === 'buy');

  return (
    <Pane footer={<Button variant="ghost" size="lg" label="Back" disabled={!!busy && busy !== 'search'} onClick={onBack} />}>
      <Block>
        <div className="flex items-center gap-2">
          <SearchField value={q} onChange={v => { setQ(v); if (inline) setError(null); }} placeholder="yourname.com" aria-label="Domain name"
            autoFocus className="flex-1" onKeyDown={e => { if (e.key === 'Enter') void search(); }} />
          <Button variant="secondary" size="sm" label="Search" loading={busy === 'search'} disabled={!!busy} onClick={() => void search()} />
        </div>
        <Notices>{inline && <NoticeView notice={{ title: inline }} />}</Notices>
      </Block>
      {(rows || notice) && (
        <Block rule>
          {rows && !rows.length && <Row size="sm" className="px-2" hover={false} title="No domains found. Try another name." />}
          {rows?.map(r => {
            const action = actionOf(r);
            return <Row key={r.name} title={r.name} rightText={captionOf(r)} size="sm" className={CONTROL_ROW} hover={false}
              right={action ? [{ type: 'custom', unboxed: true, node: action }] : undefined} />;
          })}
          {buyable && (
            <Row title="Renew every year" size="sm" className="px-2" hover={false}
              rowProps={{ title: autoRenew ? 'Cloudflare renews it every year at the renewal price.' : 'The domain expires after a year unless you renew it on Cloudflare.' }}
              left={[{ type: 'checkbox', checked: autoRenew, onChange: setAutoRenew, 'aria-label': 'Renew automatically every year' }]} />
          )}
          {(buyable || changed) && ( // the one meta line of the view
            <div className="px-2 pt-1 text-2xs text-text-secondary">{changed ? 'The price changed. ' : ''}Charged to your Cloudflare payment method. Non-refundable.</div>
          )}
          <Notices>{notice && <NoticeView notice={notice} />}</Notices>
        </Block>
      )}
    </Pane>
  );
}
