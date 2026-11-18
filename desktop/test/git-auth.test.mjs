import { expect, it } from 'vitest';
import { CLIENT_ID, createAuth } from '../src/git/auth.mjs';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function memoryStore() { let v = null; return { read: async () => v, write: async b => { v = b; }, clear: async () => { v = null; }, peek: () => v }; }
const crypto = { encrypt: s => Buffer.from(`enc:${s}`), decrypt: b => b.toString().slice(4) };
const DEVICE = { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5 };
function scripted(polls) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: init?.body && JSON.parse(init.body), headers: init?.headers });
    if (url.endsWith('/login/device/code')) return json(DEVICE);
    if (url.endsWith('/login/oauth/access_token')) return json(polls.shift());
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

it('start → code + url; poll handles authorization_pending, slow_down, then stores the token', async () => {
  const store = memoryStore(); const sleeps = [];
  const { fetch, calls } = scripted([{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'tok' }]);
  const auth = createAuth({ fetch, store, crypto, clientId: 'cid', sleep: async ms => { sleeps.push(ms); } });
  const s = await auth.start();
  expect(s).toMatchObject({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' });
  await s.done;
  expect(sleeps).toEqual([5000, 5000, 10000]);
  expect(calls[0].body).toEqual({ client_id: 'cid', scope: 'repo workflow' });
  expect(store.peek().toString()).toBe('enc:tok'); // never plaintext
  expect(await auth.token()).toBe('tok');
});

it('expired_token / access_denied reject with codes "expired" / "denied"', async () => {
  for (const [error, code] of [['expired_token', 'expired'], ['access_denied', 'denied']]) {
    const auth = createAuth({ fetch: scripted([{ error }]).fetch, store: memoryStore(), crypto, clientId: 'cid', sleep: async () => {} });
    await expect((await auth.start()).done).rejects.toMatchObject({ code });
  }
});

it('cancel stops polling with code "cancelled"', async () => {
  const auth = createAuth({ fetch: scripted([{ error: 'authorization_pending' }]).fetch, store: memoryStore(), crypto, clientId: 'cid',
    sleep: async () => { auth.cancel(); } });
  await expect((await auth.start()).done).rejects.toMatchObject({ code: 'cancelled' });
});

it('without a client id, sign-in is refused with code "not-configured"', async () => {
  const auth = createAuth({ fetch: async () => { throw new Error('no network expected'); }, store: memoryStore(), crypto, clientId: '' });
  await expect(auth.start()).rejects.toMatchObject({ code: 'not-configured' });
});

it('ships a client id, so a packaged build (no env) can sign in', () => {
  expect(CLIENT_ID).toBeTruthy();
});

it('token() returns null when nothing stored; signOut clears', async () => {
  const store = memoryStore();
  const auth = createAuth({ fetch: async () => {}, store, crypto, clientId: 'cid' });
  expect(await auth.token()).toBe(null);
  await store.write(crypto.encrypt('t'));
  await auth.signOut();
  expect(await auth.token()).toBe(null);
});

it('user() calls GET /user with the token; 401 clears the token and rejects code "signed-out"', async () => {
  const store = memoryStore(); await store.write(crypto.encrypt('t'));
  let seen;
  const ok = createAuth({ store, crypto, clientId: 'cid', fetch: async (url, init) => { seen = { url, init };
    return json({ login: 'oleg', name: null, email: null, avatar_url: 'a', id: 7 }); } });
  expect(await ok.user()).toEqual({ login: 'oleg', name: null, email: null, avatarUrl: 'a', id: 7 });
  expect(seen.url).toBe('https://api.github.com/user');
  expect(seen.init.headers.authorization).toBe('Bearer t');
  const bad = createAuth({ store, crypto, clientId: 'cid', fetch: async () => json({}, 401) });
  await expect(bad.user()).rejects.toMatchObject({ code: 'signed-out' });
  expect(await bad.token()).toBe(null);
});

it('commitAuthor: signed in uses the GitHub identity (noreply fallback), signed out is Starquix', async () => {
  const { commitAuthor } = await import('../src/git/auth.mjs');
  expect(commitAuthor(null)).toEqual({ name: 'Starquix', email: 'noreply@starquix.app' });
  expect(commitAuthor({ login: 'oleg', name: null, email: null, id: 7 })).toEqual({ name: 'oleg', email: '7+oleg@users.noreply.github.com' });
  expect(commitAuthor({ login: 'oleg', name: 'Oleg', email: 'o@x', id: 7 })).toEqual({ name: 'Oleg', email: 'o@x' });
});
