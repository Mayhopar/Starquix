import { expect, it } from 'vitest';
import fs from 'node:fs';
// Finding #15: the Cloudflare sign-in partition (persist:cloudflare) keeps its cookies on disk, OS-encrypted only with
// this fuse. One-way: turning it off again later leaves every user's existing cookie store unreadable.
it('packages the app with cookie encryption on', () => {
  const { build } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(build.electronFuses.enableCookieEncryption).toBe(true);
});
