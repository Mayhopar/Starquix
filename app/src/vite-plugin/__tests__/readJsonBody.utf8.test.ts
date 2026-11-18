// @vitest-environment node
// Audit 2026-10-18 (a): `body += chunk` decoded each network chunk on its own,
// so a multi-byte character split across two chunks became U+FFFD — a Cyrillic
// edit then reached source-command with a hash that no longer matched its bytes.
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { ViteDevServer } from 'vite';
import { expect, it } from 'vitest';
import { readJsonBody } from '../../../../preview-template/src/plugins/sq-project-fs-routes.js';
import { createSqServerContext, type SqServerContextDeps } from '../server/context';

const payload = { text: 'Привет, мир' };
function splitRequest(): IncomingMessage {
  const bytes = Buffer.from(JSON.stringify(payload));
  const cut = bytes.indexOf(Buffer.from('П')) + 1; // inside the two-byte 'П'
  return Readable.from([bytes.subarray(0, cut), bytes.subarray(cut)]) as IncomingMessage;
}

it('decodes a character split across request chunks (instance route table)', async () => {
  expect(await readJsonBody(splitRequest())).toEqual(payload);
});

it('decodes a character split across request chunks (editor dev server)', async () => {
  const context = createSqServerContext({ ws: { send() {} } } as unknown as ViteDevServer, {} as SqServerContextDeps);
  expect(await context.readJsonBody(splitRequest())).toEqual(payload);
});
