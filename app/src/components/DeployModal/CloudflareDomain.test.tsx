// Get a domain — our search box + price + Buy (docs/plans/2026-10-16-cloudflare-one-click-design.md, ledger 49–57, 64, C8/C9).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : Stub), has: () => true });
});
vi.mock('@/services/desktopDriver', () => ({ desktopDriver: {} }));
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitProjectFiles: vi.fn() }));

import { CloudflareDomain } from './CloudflareDomain';
import { GitError, type DomainRow, type GitClient } from '@/services/git/gitClient';

let browser: ReturnType<typeof vi.spyOn>;
beforeEach(() => { browser = vi.spyOn(window, 'open').mockImplementation(() => null); });
afterEach(() => { browser.mockRestore(); });
/** A page button opens its page in the browser. */
const opens = (name: string) => { fireEvent.click(screen.getByRole('button', { name })); return browser.mock.calls.at(-1)?.[0]; };

const ROWS: DomainRow[] = [
  { name: 'bakery.com', kind: 'buy', price: '10.44', renewal: '10.44', currency: 'USD' },
  { name: 'bakery.dev', kind: 'buy', price: '12.20', renewal: '14.00', currency: 'USD' },
  { name: 'bakery.net', kind: 'taken' },
  { name: 'bakery.ai', kind: 'dashboard' },
  { name: 'bakery.xyz', kind: 'unavailable' },
];
function fake(over: Record<string, unknown> = {}) {
  const c = { cloudflareSearch: vi.fn(async () => ROWS), cloudflareDomain: vi.fn(async () => ({ state: 'succeeded' })), ...over };
  return c as unknown as GitClient & Record<string, ReturnType<typeof vi.fn>>;
}
function open(client: GitClient, props: { onDone?: () => void; onBack?: () => void } = {}) {
  return render(<CloudflareDomain client={client} account={{ id: 'acc1', name: 'Mine' }}
    onDone={props.onDone ?? (() => {})} onBack={props.onBack ?? (() => {})} />);
}
const search = async (q = 'bakery') => {
  fireEvent.change(screen.getByLabelText('Domain name'), { target: { value: q } });
  fireEvent.keyDown(screen.getByLabelText('Domain name'), { key: 'Enter' });
};

describe('CloudflareDomain', () => {
  it('50/51. Enter searches; rows show the yearly price, renewal when it differs, Taken / Buy on Cloudflare / Not available', async () => {
    const c = fake(); open(c);
    await search();
    expect(c.cloudflareSearch).toHaveBeenCalledWith('bakery');
    expect(await screen.findByText('bakery.com')).toBeTruthy();
    expect(screen.getByText('$10.44/year')).toBeTruthy();
    expect(screen.getByText('$12.20 first year, then $14.00/year')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy $10.44' })).toBeTruthy();
    expect(screen.getByText('Taken')).toBeTruthy();
    expect(opens('Buy on Cloudflare')).toBe('https://dash.cloudflare.com/acc1/registrar/register');
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.getByText('Charged to your Cloudflare payment method. Non-refundable.')).toBeTruthy();
  });

  it('50. an empty query sends nothing; accents/symbols → the inline rule, no request kept', async () => {
    const c = fake({ cloudflareSearch: vi.fn(async () => { throw new GitError('invalid-domain', 'x'); }) }); open(c);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(c.cloudflareSearch).not.toHaveBeenCalled();
    await search('bäckerei');
    expect(await screen.findByText('Use letters, numbers and dashes — no accents or symbols.')).toBeTruthy();
  });

  it('C8/C9. Buy sends the shown price; auto-renew is off unless ticked; success → onDone', async () => {
    const onDone = vi.fn();
    const c = fake(); open(c, { onDone });
    await search();
    const renew = await screen.findByRole('checkbox', { name: 'Renew automatically every year' }) as HTMLInputElement;
    expect(renew.checked).toBe(false);
    expect(screen.getByTitle('The domain expires after a year unless you renew it on Cloudflare.')).toBeTruthy();
    fireEvent.click(renew);
    expect(await screen.findByTitle('Cloudflare renews it every year at the renewal price.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Buy $12.20' }));
    await waitFor(() => expect(c.cloudflareDomain).toHaveBeenCalledWith('bakery.dev', { price: '12.20', currency: 'USD', autoRenew: true }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('52. the price changed → the button carries the new price (no charge happened); the next click sends it', async () => {
    const c = fake({ cloudflareDomain: vi.fn()
      .mockRejectedValueOnce(new GitError('price-changed', 'x', { price: '11.00', currency: 'USD' }))
      .mockResolvedValue({ state: 'succeeded' }) });
    open(c);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    expect(await screen.findByText(/^The price changed\. /)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $11.00' }));
    await waitFor(() => expect(c.cloudflareDomain).toHaveBeenLastCalledWith('bakery.com', { price: '11.00', currency: 'USD', autoRenew: false }));
  });

  it('52. taken meanwhile → the row says Taken, no notice', async () => {
    const c = fake({ cloudflareDomain: vi.fn(async () => { throw new GitError('domain-taken', 'x'); }) }); open(c);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Buy $10.44' })).toBeNull());
    expect(screen.getAllByText('Taken')).toHaveLength(2);
  });

  it('64. a domain already in the account → Use it (no price: never a purchase)', async () => {
    const c = fake({ cloudflareSearch: vi.fn(async () => [{ name: 'bakery.com', kind: 'owned' }]) }); open(c);
    await search('bakery.com');
    expect(await screen.findByText('Already in your Cloudflare account')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(c.cloudflareDomain).toHaveBeenCalledWith('bakery.com'));
  });

  it('57. no contact / no payment / anything else → curated notices with the right Cloudflare pages, never the raw answer', async () => {
    const c = fake({ cloudflareDomain: vi.fn()
      .mockRejectedValueOnce(new GitError('no-contact', 'raw'))
      .mockRejectedValueOnce(new GitError('no-payment', 'raw'))
      .mockRejectedValueOnce(new GitError('registrar-refused', 'raw')) });
    open(c);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    expect(await screen.findByText('Add your contact details on Cloudflare first.')).toBeTruthy();
    expect(opens('Open domain settings')).toBe('https://dash.cloudflare.com/acc1/domains/registrations');
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    expect(await screen.findByText('Add a payment method on Cloudflare first.')).toBeTruthy();
    expect(opens('Open billing')).toBe('https://dash.cloudflare.com/acc1/billing/payment-info');
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    expect(await screen.findByText("Cloudflare didn't complete the purchase.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open billing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open domain settings' })).toBeTruthy();
    expect(screen.queryByText('raw')).toBeNull();
  });

  it('34. while one purchase runs every Buy is disabled (no double charge from a double click)', async () => {
    let release!: () => void;
    const c = fake({ cloudflareDomain: vi.fn(() => new Promise(r => { release = () => r({ state: 'succeeded' }); })) }); open(c);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Buy $12.20' }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Buy $12.20' }));
    expect(c.cloudflareDomain).toHaveBeenCalledTimes(1);
    release();
  });

  it('ux 17. Back → onBack; a purchase in flight keeps Back disabled (money, ledger 34)', async () => {
    const onBack = vi.fn();
    let release!: () => void;
    const c = fake({ cloudflareDomain: vi.fn(() => new Promise(r => { release = () => r({ state: 'succeeded' }); })) });
    open(c, { onBack });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy $10.44' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true));
    release();
  });

  it('review 5. a zone in the account that is not active yet → finish adding it on Cloudflare (never Use it)', async () => {
    const c = fake({ cloudflareSearch: vi.fn(async () => [{ name: 'bakery.com', kind: 'inactive' }]) }); open(c);
    await search('bakery.com');
    expect(await screen.findByText('In your Cloudflare account, not active yet')).toBeTruthy();
    expect(opens('Finish on Cloudflare')).toBe('https://dash.cloudflare.com/acc1/bakery.com');
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull();
  });
});

