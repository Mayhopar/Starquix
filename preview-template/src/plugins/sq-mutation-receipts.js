/** Opt-in image-operation receipts. Never evict: a missing receipt after a
 * runtime restart must fail its epoch check, never become another upload. */
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

const LIMIT = 25 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = dir => existsSync(dir) ? readdirSync(dir).sort() : [];
/** Complete footprint of these routes: unique uploads only CREATE a new name;
 * defaults rewrite one component; rebind rewrites the same content extensions
 * as repointContentRefs. No unrelated asset bytes are read. */
function footprint(root, route, url) {
  const q = new URL(url, 'http://x').searchParams;
  const files = [];
  const digestFile = file => {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('receipt path outside project');
    files.push([file, existsSync(abs) ? hash(readFileSync(abs)) : null]);
  };
  let destination;
  if (route === 'asset') {
    const post = q.get('postFile');
    const collection = post ? path.relative(path.resolve(root, 'src/content'), path.resolve(root, post)).split(path.sep)[0] : null;
    destination = post ? `src/content/${collection}/images/uploads` : 'public/uploads';
  } else if (route === 'component-default-image') {
    digestFile(q.get('file') ?? ''); destination = 'src/assets/sq-defaults';
  } else {
    destination = path.dirname(q.get('old') ?? '');
    const walk = dir => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) throw new Error('Cannot verify a symlinked image-write footprint');
        if (stat.isDirectory()) walk(full);
        else if (/\.(mdx?|markdown|ya?ml|json)$/i.test(name)) digestFile(path.relative(root, full));
      }
    };
    walk(path.join(root, 'src/content'));
  }
  const absDest = path.resolve(root, destination);
  if (!absDest.startsWith(path.resolve(root) + path.sep)) throw new Error('receipt destination outside project');
  return { destination, names: names(absDest), files };
}
const fileHash = (root, file) => existsSync(path.join(root, file)) ? hash(readFileSync(path.join(root, file))) : null;
function changes(root, before, after) {
  const delta = [];
  const beforeFiles = new Map(before.files);
  for (const [file, digest] of after.files) if (beforeFiles.get(file) !== digest) delta.push([file, beforeFiles.get(file) ?? null, digest]);
  for (const name of after.names) if (!before.names.includes(name)) {
    const file = path.join(after.destination, name);
    delta.push([file, null, fileHash(root, file)]);
  }
  for (const name of before.names) if (!after.names.includes(name)) throw new Error('Unexpected asset removal during image operation');
  return delta;
}
const matches = (root, delta, side) => delta.every(change => fileHash(root, change[0]) === change[side]);

export function createMutationReceipts(json, resolveRoot, recordChanges) {
  const session = randomUUID();
  const receipts = new Map();
  const reply = (res, result) => { res.statusCode = result.status; for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v); res.end(result.body); };
  return {
    session,
    wrap(route, handler) {
      return async (req, res, next) => {
        const id = req.headers['x-sq-mutation-id'];
        if (!id || req.method !== 'POST') return handler(req, res, next);
        if (req.headers['x-sq-mutation-session'] !== session) return json(res, 409, { error: 'Image receipt session expired. Reconcile the original operation before retrying.' });
        try {
          const chunks = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > LIMIT) {
              // No handler has run. Do not waive a prior outcome for a reused ID.
              if (!receipts.has(id)) res.setHeader('x-sq-mutation-outcome', 'no-write');
              return json(res, 413, { error: 'asset too large' });
            }
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks);
          const identity = `${route}:${req.url}:${hash(bytes)}`;
          const old = receipts.get(id);
          if (old && old.identity !== identity) return json(res, 409, { error: 'Image receipt does not match this operation' });
          if (old) {
            const wasPending = !old.settled;
            const result = await old.done;
            if (wasPending) return reply(res, result);
            // A failed attempt can run again only if it changed nothing, or
            // its complete footprint has been restored by the owner/user.
            if (result.status < 400) {
              if (old.delta === null || !matches(old.root, old.delta, 2)) return json(res, 409, { error: 'Acknowledged image bytes changed. Reconcile the original operation before retrying.' });
              return reply(res, result);
            }
            if (old.delta === null || !matches(old.root, old.delta, 1)) return reply(res, result);
          }
          const root = resolveRoot(req);
          const before = footprint(root, route, req.url);
          let finish;
          const entry = { identity, root, delta: null, settled: false, done: new Promise(r => { finish = r; }) };
          receipts.set(id, entry);
          const end = res.end.bind(res);
          res.end = (body) => {
            try { entry.delta = changes(root, before, footprint(root, route, req.url)); } catch { /* unknown stays blocked */ }
            if (res.statusCode >= 400) {
              // Failed partial writes are still file truth, and must enter the journal.
              if (entry.delta?.length === 0) res.setHeader('x-sq-mutation-outcome', 'no-write');
              if (entry.delta?.length) recordChanges(entry.delta.map(change => change[0]));
              if (entry.delta === null || entry.delta.length > 0) {
                const data = JSON.parse(String(body));
                body = JSON.stringify({ ...data, error: `${data.error}. Image write may be partial; restore the affected files before retrying this operation.` });
              }
            }
            // Store before sending: a lost response never loses the outcome.
            entry.settled = true;
            finish({ status: res.statusCode, headers: res.getHeaders(), body });
            return end(body);
          };
          const input = new PassThrough();
          Object.assign(input, { method: req.method, url: req.url, headers: req.headers });
          handler(input, res, next);
          input.end(bytes);
        } catch (error) {
          json(res, 500, { error: `Cannot verify image operation: ${error instanceof Error ? error.message : String(error)}` });
        }
      };
    },
  };
}
