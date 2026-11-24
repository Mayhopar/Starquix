/**
 * sq-project-fs-routes — THE `/__sq/local/*` route table over sq-project-fs.js.
 *
 * Registered by the sq plugin inside any `astro dev` armed with `bridgeJsPath`:
 * the root is the instance's own root; the request's `path` is ignored. Tests
 * mount the same table on a mock server (`opts.resolveRoot` picks the root).
 *
 * Excludes lifecycle (`pick`, `open`, `status`, `stop`, `stamp-plan`,
 * `unstamp`) — that stays with whoever spawned the process.
 *
 * Request/response shapes are the pre-existing contracts, moved verbatim.
 */
import { createMutationReceipts } from './sq-mutation-receipts.js';
import { withSourceFileLock, withSourceFileLocks } from './sq-file-write-lock.js';
import { writeFileAtomic } from './sq-atomic-write.js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  discoverLocalPages, createLocalPage, deleteLocalPage, restoreLocalPage, renameLocalPage, moveLocalPage,
  resolvePageFilePath, findComponentUsages, importGraph, writeComponentDefaultImage, writeDefaultImageAsset,
  readBinaryBody, createBundledAsset, listLocalAssets, resolveLocalAssetFile, writeLocalAsset, writeLocalContentAsset,
  writeLocalFontFile, mergeLocalFontCss, ensureLocalFontsLink, rebindLocalAsset, rebindToExisting,
  listLocalContentFiles, ensureSqComponent, writeLocalFile,
  ComponentFileError, createComponentFile, renameComponentFile, deleteComponentFile,
  moveComponentToSystemDir, SQ_INSERTABLE_COMPONENTS, assertLayoutName,
  readFolderManifest, writeFolderManifest, localFoldersFile, scanComponents, scanLayouts,
  extractFrontmatter, extractProps, extractSlots,
} from './sq-project-fs.js';

/** Read a JSON request body (same semantics as SqServerContext.readJsonBody).
 *  Bytes are decoded ONCE: a multi-byte character split across two chunks
 *  decoded per chunk became U+FFFD (audit 2026-10-18). */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** Cross-origin by design: the editor (app origin) calls an instance origin
 *  (ephemeral local port). */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  cors(res);
  res.end(JSON.stringify(body));
}

/**
 * Files-truth write-through (Phase 2 Task 2.4): THE file-change journal.
 * Every mutation this instance performs — a project-fs route below, or a
 * bridge write (sq-source-plugin performWrite) — is recorded here BEFORE its
 * response goes out, so the editor can pull `GET /__sq/local/changes?since=`
 * deterministically (no watcher latency) and persist the bytes to Dexie.
 * kind: 'change' (write/create) | 'unlink' (file or whole directory).
 * `epoch` names this journal: an in-process Astro restart builds a new one at
 * seq 0, and a reader holding the old cursor must start over (audit 2026-10-18).
 */
export function createChangeJournal() {
  const entries = [];
  const epoch = randomUUID();
  let seq = 0;
  return {
    record(file, kind = 'change') {
      if (!file) return;
      entries.push({ seq: ++seq, file: String(file).replace(/\\/g, '/'), kind });
      if (entries.length > 5000) entries.splice(0, entries.length - 5000); // ponytail: bounded ring
    },
    since(n) {
      return { epoch, seq, entries: entries.filter((e) => e.seq > n) };
    },
  };
}

const msg = (error) => (error instanceof Error ? error.message : String(error));

function fail(res, error) {
  const status = error instanceof ComponentFileError ? error.status : 500;
  json(res, status, { error: msg(error) });
}

const ASSET_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm',
};

/**
 * @param server  Vite dev server (server.middlewares is used)
 * @param opts.resolveRoot(req, body?) → project root ('' = unknown → 400)
 * @param opts.sqComponentsDir where OUR insertable component templates live
 * @param opts.instanceUrl?(dir) → served origin for public uploads (host only)
 * @param opts.notifyWs?(event) cross-module notification (host only)
 * @param opts.readJsonBody? override (host passes its own; default above)
 */
/** Vite serves public/ only from a set its file watcher fills (5.4: servePublicMiddleware
 *  ⇐ publicFiles ⇐ onFileAddUnlink, after an await): answering an upload before then made
 *  the very next GET 404 and the canvas <img> never retried. Poll our own server (3 s cap,
 *  best effort: a missing address or a failed request answers at once).
 *  On the first miss, hand the watcher the 'add' it may never deliver: on Linux
 *  (per-directory inotify) a public/ subdir the upload created while chokidar's
 *  initial scan was still running is never watched, so the file 404'd for good
 *  (CI, 2026-10-13; macOS's recursive FSEvents has no such window). Same event a
 *  healthy watcher sends — a duplicate is a no-op — and the dir is watched from now on. */
export async function whenServed(server, src, capMs = 3000) {
  const port = server.httpServer?.address?.()?.port;
  if (!port) return;
  let nudged = false;
  for (const end = Date.now() + capMs; Date.now() < end; await new Promise(r => setTimeout(r, 20))) {
    try { if ((await fetch(`http://127.0.0.1:${port}${encodeURI(src)}`, { method: 'HEAD' })).ok) return; } catch { return; }
    if (!nudged && server.watcher && server.config?.publicDir) {
      nudged = true;
      const file = path.join(server.config.publicDir, decodeURI(src));
      server.watcher.add(path.dirname(file));
      server.watcher.emit('add', file);
    }
  }
}

export function registerProjectFsRoutes(server, opts) {
  const { resolveRoot, sqComponentsDir, instanceUrl, notifyWs } = opts;
  const readBody = opts.readJsonBody ?? readJsonBody;
  const notify = (e) => notifyWs?.(e);
  const journal = opts.journal ?? createChangeJournal();
  /** Record the files a mutating route touched, then answer. */
  const changed = (files) => {
    for (const f of files) if (f) journal.record(typeof f === 'string' ? f : f.file, typeof f === 'string' ? 'change' : f.kind);
    opts.announce?.(files.filter(f => typeof f === 'string')); // writer is the signal (sq-source-plugin announceWrites)
  };
  const unlink = (file) => ({ file, kind: 'unlink' });
  const query = (req) => new URL(req.url ?? '', 'http://x').searchParams;
  const receipts = createMutationReceipts(json, resolveRoot, changed);
  const use = (route, handler) => server.middlewares.use(`/__sq/local/${route}`,
    ['asset', 'rebind-asset', 'component-default-image'].includes(route) ? receipts.wrap(route, handler) : handler);
  use('mutation-session', (req, res, next) => {
    if (req.method !== 'GET') return next();
    json(res, 200, { session: receipts.session });
  });

  // Seamless canvas (plan 2026-10-04 Task 1.5): typed-text drafts on disk,
  // <root>/.sq/drafts/<sha1(key)>.json, one file per key (last write wins).
  // A safety net, NOT a project file: never changed() (no journal, no sync),
  // and the desktop wrapper's watcher ignores .sq/drafts/**.
  const DRAFT_MAX_MARKUP = 1024 * 1024;
  const ORPHAN_TTL_MS = 30 * 24 * 3600 * 1000;
  const draftDir = (req) => path.join(resolveRoot(req), '.sq', 'drafts');
  const draftName = (key) => createHash('sha1').update(key, 'utf8').digest('hex') + '.json';
  use('draft', async (req, res, next) => {
    const dir = resolveRoot(req) && draftDir(req);
    if (!dir) return json(res, 400, { error: 'unknown project folder' });
    try {
      if (req.method === 'GET') {
        const orphaned = path.join(dir, 'orphaned');
        if (existsSync(orphaned)) for (const f of readdirSync(orphaned)) {
          const abs = path.join(orphaned, f);
          if (Date.now() - statSync(abs).mtimeMs > ORPHAN_TTL_MS) unlinkSync(abs);
        }
        const drafts = [];
        if (existsSync(dir)) for (const f of readdirSync(dir)) {
          if (!f.endsWith('.json')) continue;
          try { drafts.push(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))); } catch { /* torn or foreign file: skip */ }
        }
        return json(res, 200, { drafts });
      }
      if (req.method === 'DELETE') {
        const key = query(req).get('key');
        if (!key) return json(res, 400, { error: 'missing key' });
        const abs = path.join(dir, draftName(key));
        if (existsSync(abs)) unlinkSync(abs);
        return json(res, 200, { ok: true });
      }
      if (req.method !== 'POST') return next();
      const body = await readBody(req);
      if (query(req).get('orphan') === '1') {
        if (typeof body?.key !== 'string') return json(res, 400, { error: 'missing key' });
        const abs = path.join(dir, draftName(body.key));
        if (existsSync(abs)) {
          mkdirSync(path.join(dir, 'orphaned'), { recursive: true });
          renameSync(abs, path.join(dir, 'orphaned', draftName(body.key).replace('.json', `-${Date.now()}.json`)));
        }
        return json(res, 200, { ok: true });
      }
      const { key, file, sourceVersion, markup, page } = body ?? {};
      if (typeof key !== 'string' || typeof file !== 'string' || typeof page !== 'string' || typeof markup !== 'string'
          || !file.startsWith('src/') || file.split('/').includes('..') || markup.length > DRAFT_MAX_MARKUP) {
        return json(res, 400, { error: 'invalid draft' });
      }
      mkdirSync(dir, { recursive: true });
      const abs = path.join(dir, draftName(key));
      const tmp = `${abs}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ key, file, sourceVersion: typeof sourceVersion === 'string' ? sourceVersion : '', markup, page, updatedAt: Date.now() }));
      renameSync(tmp, abs);
      json(res, 200, { ok: true });
    } catch (error) { json(res, 500, { error: msg(error) }); }
  });

  // Exact one-file CAS: preparation lives durably in the editor, not in this runtime.
  use('source-command', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const p = await readBody(req);
      const hash = source => createHash('sha256').update(source, 'utf8').digest('hex');
      if (Array.isArray(p?.files)) {
        if (typeof p.projectId !== 'string' || !p.projectId || typeof p.commandId !== 'string' || !p.commandId
            || !/^[a-f0-9]{64}$/.test(p.commandDigest) || !p.files.length) {
          return json(res, 400, { status: 'unknown', error: 'Invalid prepared file batch' });
        }
        const root = realpathSync(resolveRoot(req, p));
        const targets = new Set();
        const files = p.files.map(change => {
          if (typeof change.file !== 'string' || !(change.file.startsWith('src/') || (change.file === '.starquix/folders.json' && change.encoding === undefined) || (change.encoding === 'base64' && change.file.startsWith('public/assets/'))) || /[\\\0]/.test(change.file)
              || (change.encoding !== undefined && change.encoding !== 'base64')
              || change.file.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
              || (change.beforeSource !== null && typeof change.beforeSource !== 'string')
              || (change.afterSource !== null && typeof change.afterSource !== 'string')
              || hash(JSON.stringify(change.beforeSource)) !== change.beforeHash
              || hash(JSON.stringify(change.afterSource)) !== change.afterHash) throw new Error('Invalid prepared file state');
          if (change.encoding === 'base64') for (const source of [change.beforeSource, change.afterSource]) {
            if (source !== null && Buffer.from(source, 'base64').toString('base64') !== source) throw new Error('Invalid binary file state');
          }
          let abs = root;
          for (const part of change.file.split('/')) {
            abs = path.join(abs, part);
            try { if (lstatSync(abs).isSymbolicLink()) throw new Error('File batch cannot follow symlinks'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          if (targets.has(abs)) throw new Error('Duplicate file in batch');
          targets.add(abs);
          return { ...change, abs };
        });
        await withSourceFileLocks([...targets], () => {
          // Check every member before changing any. Exact before/after states
          // also permit recovery of a process stopped between file writes.
          const pending = files.filter(change => {
            const current = existsSync(change.abs) ? readFileSync(change.abs).toString(change.encoding ?? 'utf8') : null;
            if (current === change.afterSource) return false;
            if (current !== change.beforeSource) throw new Error('Source differs from prepared baseline');
            return true;
          });
          for (const change of pending) {
            if (change.afterSource === null) unlinkSync(change.abs);
            else {
              mkdirSync(path.dirname(change.abs), { recursive: true });
              // The absent-state check above ran in this same synchronous turn, under the lock.
              writeFileAtomic(change.abs, change.afterSource, change.encoding ?? 'utf8');
            }
            changed([change.afterSource === null ? unlink(change.file) : change.file]);
          }
          json(res, 200, { status: 'written', projectId: p.projectId, commandId: p.commandId, commandDigest: p.commandDigest });
        });
        return;
      }
      if (!p || typeof p.projectId !== 'string' || !p.projectId || typeof p.commandId !== 'string' || !p.commandId
          || typeof p.commandDigest !== 'string' || !/^[a-f0-9]{64}$/.test(p.commandDigest)
          || typeof p.file !== 'string' || !p.file.startsWith('src/') || p.file.includes('\\')
          || p.file.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
          || typeof p.beforeSource !== 'string' || typeof p.afterSource !== 'string'
          || hash(p.beforeSource) !== p.beforeHash || hash(p.afterSource) !== p.afterHash) {
        return json(res, 400, { status: 'unknown', error: 'Invalid prepared source command' });
      }
      const root = realpathSync(resolveRoot(req, p));
      const file = realpathSync(path.resolve(root, p.file));
      if (!file.startsWith(path.join(root, 'src') + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) {
        return json(res, 400, { status: 'unknown', error: 'Source command outside project src' });
      }
      await withSourceFileLock(file, () => {
        const current = readFileSync(file, 'utf8');
        if (current !== p.afterSource && current !== p.beforeSource) {
          return json(res, 409, { status: 'unknown', error: 'Source differs from prepared baseline' });
        }
        if (current !== p.afterSource) {
          // Sync write + journal has no yield between the baseline check and mutation.
          writeFileAtomic(file, p.afterSource);
          changed([p.file]);
        }
        json(res, 200, { status: 'written', projectId: p.projectId, commandId: p.commandId,
          commandDigest: p.commandDigest, afterHash: p.afterHash });
      });
    } catch (error) {
      json(res, 500, { status: 'unknown', error: msg(error) });
    }
  });

  // ── pages ──
  // Read-only resolution through the page lifecycle functions' validation and
  // templates. Its exact absent/existing states become accepted intent, written
  // by source-command file batches — there is no direct page write route.
  use('page-plan', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const p = await readBody(req);
      const root = resolveRoot(req, p);
      let result;
      switch (p.action) {
        case 'create': result = createLocalPage(root, p.name, true, p.projectedPages); break;
        case 'delete': result = deleteLocalPage(root, p.pageId, true, p.projectedPages); break;
        case 'restore': result = restoreLocalPage(root, p.route, p.content, p.file, true, p.projectedPages); break;
        case 'rename': result = renameLocalPage(root, p.pageId, p.name, true, p.projectedPages); break;
        case 'move': result = moveLocalPage(root, p.from, p.to, true, p.projectedPages); break;
        case 'delete-post': {
          const candidates = Object.entries(listLocalContentFiles(root)).filter(([file]) =>
            file.replace(/\.mdx?$/, '') === `src/content/${p.collection}/${p.slug}`);
          if (candidates.length !== 1) throw new Error('Cannot resolve one post file');
          const [file, content] = candidates[0];
          result = { file, content, files: [{ file, beforeSource: content, afterSource: null }] };
          break;
        }
        default: throw new Error('Unknown page lifecycle action');
      }
      json(res, 200, result);
    } catch (error) { json(res, 400, { error: msg(error) }); }
  });
  use('pages', (req, res, next) => {
    if (req.method !== 'GET') return next();
    json(res, 200, { pages: discoverLocalPages(resolveRoot(req)) });
  });

  use('page-source', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    const file = query(req).get('file') ?? '';
    if (!dir || !file || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder or missing file' });
    try {
      const abs = resolvePageFilePath(dir, file);
      if (!existsSync(abs) || !statSync(abs).isFile()) return json(res, 404, { error: 'no such page file' });
      json(res, 200, { content: readFileSync(abs, 'utf8') });
    } catch (error) {
      json(res, 400, { error: msg(error) });
    }
  });

  // ── component usages / default image (task-143) ──
  use('component-usages', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    const file = query(req).get('file') ?? '';
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    json(res, 200, findComponentUsages(dir, file));
  });

  use('component-default-image', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const params = query(req);
    const dir = resolveRoot(req);
    const file = params.get('file') ?? '';
    const imgIndex = Number(params.get('imgIndex')) || 0;
    if (!dir || !file || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder or component' });
    const finish = async (asset) => {
      try {
        const r = await writeComponentDefaultImage(dir, file, imgIndex, asset);
        changed([file, asset || null]);
        json(res, 200, r);
      }
      catch (error) { json(res, 400, { error: msg(error) }); }
    };
    if (params.get('clear')) return finish(null);
    const to = params.get('to');
    if (to) return finish(to);
    const name = params.get('name') ?? '';
    if (!name) return json(res, 400, { error: 'missing name' });
    readBinaryBody(req, res, json, (data) => {
      try { finish(writeDefaultImageAsset(dir, name, data)); }
      catch (error) { json(res, 500, { error: msg(error) }); }
    });
  });

  // ── assets ──
  use('assets', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    json(res, 200, { assets: listLocalAssets(dir) });
  });

  use('asset-file', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    const file = query(req).get('file') ?? '';
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    try {
      const full = resolveLocalAssetFile(dir, file);
      if (!existsSync(full)) return json(res, 404, { error: 'not found' });
      const ext = path.extname(full).slice(1).toLowerCase();
      cors(res);
      res.writeHead(200, { 'Content-Type': ASSET_MIME[ext] ?? 'application/octet-stream' });
      res.end(readFileSync(full));
    } catch (error) {
      json(res, 400, { error: msg(error) });
    }
  });

  // Original library URLs need a create-only path, while uploads keep their
  // unique-name contract. localProxy tracks this mutation and awaits its journal.
  use('bundled-asset', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const dir = resolveRoot(req);
    const file = query(req).get('file') ?? '';
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    readBinaryBody(req, res, json, (data) => {
      try {
        const result = createBundledAsset(dir, file, data);
        if (result.created) changed([result.file]);
        json(res, 200, result);
      } catch (error) { fail(res, error); }
    });
  });

  use('asset', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const params = query(req);
    const dir = resolveRoot(req);
    const name = params.get('name') ?? '';
    if (!dir || !name || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    const postFile = params.get('postFile');
    readBinaryBody(req, res, json, async (data) => {
      try {
        const { src } = postFile
          ? writeLocalContentAsset(dir, postFile, name, data)
          : writeLocalAsset(dir, name, data);
        changed([postFile ? path.posix.normalize(path.posix.join(path.posix.dirname(postFile), src)) : `public${src}`]);
        if (!postFile) await whenServed(server, src);
        const origin = !postFile ? instanceUrl?.(dir) : null;
        json(res, 200, { src, url: origin ? origin + src : src });
      } catch (error) {
        json(res, 500, { error: msg(error) });
      }
    });
  });

  // ── fonts (gap-61) ──
  use('font-file', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const dir = resolveRoot(req);
    const name = query(req).get('name') ?? '';
    if (!dir || !name || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    readBinaryBody(req, res, json, async (data) => {
      try { const r = writeLocalFontFile(dir, name, data); changed([`public${r.src}`]); await whenServed(server, r.src); json(res, 200, r); }
      catch (error) { json(res, 400, { error: msg(error) }); }
    });
  });

  use('font-css', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      const dir = resolveRoot(req, body);
      const { family, css } = body;
      if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
      if (!family || typeof css !== 'string' || !css) return json(res, 400, { error: 'missing family/css' });
      const { file } = await mergeLocalFontCss(dir, family, css);
      const { linked, updatedFiles } = await ensureLocalFontsLink(dir);
      changed([file, ...updatedFiles]);
      json(res, 200, { file, linked, updatedFiles });
    } catch (error) {
      json(res, 400, { error: msg(error) });
    }
  });

  // ── rebind (task-142) ──
  use('rebind-asset', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const params = query(req);
    const dir = resolveRoot(req);
    const old = params.get('old') ?? '';
    const to = params.get('to');
    const name = params.get('name') ?? '';
    if (!dir || !old || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    if (to) {
      try { const r = await rebindToExisting(dir, old, to); changed(r.updatedFiles); json(res, 200, r); }
      catch (error) { json(res, 400, { error: msg(error) }); }
      return;
    }
    if (!name) return json(res, 400, { error: 'missing name' });
    readBinaryBody(req, res, json, async (data) => {
      try { const r = await rebindLocalAsset(dir, old, name, data); changed([r.newAsset, ...r.updatedFiles]); json(res, 200, r); }
      catch (error) { json(res, 400, { error: msg(error) }); }
    });
  });

  // ── content ──
  use('content', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    json(res, 200, { files: listLocalContentFiles(dir) });
  });

  // Generic text write (src/** or public/**) — files-truth features that own
  // a file (variables CSS). Journaled like every other mutation.
  use('write-file', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      const dir = resolveRoot(req, body);
      if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
      const r = await writeLocalFile(dir, body.file, body.content);
      changed([r.file]);
      json(res, 200, r);
    } catch (error) {
      json(res, 400, { error: msg(error) });
    }
  });

  use('ensure-sq-component', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      const dir = resolveRoot(req, body);
      if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
      const r = await ensureSqComponent(dir, body.name, sqComponentsDir);
      if (r.status === 200 && (r.body.created || r.body.upgraded || r.body.extra?.length)) {
        changed([r.body.created || r.body.upgraded ? r.body.file : null, r.body.upgraded ? `${r.body.file}.bak` : null, ...(r.body.extra ?? [])]);
      }
      json(res, r.status, r.body);
    } catch (error) {
      json(res, 400, { error: msg(error) });
    }
  });

  // ── component / layout files ──
  const localRoot = (dir, sub) => {
    if (typeof dir !== 'string' || !dir || !existsSync(dir)) {
      throw new ComponentFileError('unknown project folder', 400);
    }
    return path.join(dir, 'src', sub);
  };

  use('component-create', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      // subDir: ⌘Z of a delete puts the file back in its own folder (#11).
      const created = await createComponentFile(localRoot(resolveRoot(req, body), 'components'), body.name, body.astroContent, body.subDir);
      changed([path.posix.join('src/components', created)]);
      notify('sq:components-changed');
      json(res, 200, { success: true, path: created });
    } catch (error) {
      fail(res, error);
    }
  });

  use('component-rename', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      const dir = resolveRoot(req, body);
      const root = localRoot(dir, 'components');
      const rel = body.componentPath.replace(/^src\/components\//, '');
      // Nothing repoints imports (#11): a rename would leave every importer pointing at a missing file.
      const importers = importGraph(dir).get(path.posix.join('src/components', rel));
      if (importers) throw new ComponentFileError(`Can't rename ${path.posix.basename(rel, '.astro')}: imported by ${importers.join(', ')}`, 409);
      const nextPath = await renameComponentFile(root, rel, body.newName);
      changed([unlink(path.posix.join('src/components', rel)), path.posix.join('src/components', nextPath)]);
      notify('sq:components-changed');
      json(res, 200, { success: true, path: path.posix.join('src/components', nextPath) });
    } catch (error) {
      fail(res, error);
    }
  });

  use('component-promote', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      const rel = body.componentPath.replace(/^src\/components\//, '');
      const nextPath = await moveComponentToSystemDir(
        localRoot(resolveRoot(req, body), 'components'), rel, body.promote !== false, SQ_INSERTABLE_COMPONENTS,
      );
      changed([unlink(path.posix.join('src/components', rel)), path.posix.join('src/components', nextPath)]);
      notify('sq:components-changed');
      json(res, 200, { success: true, path: path.posix.join('src/components', nextPath) });
    } catch (error) {
      fail(res, error);
    }
  });

  use('component-delete', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req);
      const rel = body.componentPath.replace(/^src\/components\//, '');
      const content = await deleteComponentFile(localRoot(resolveRoot(req, body), 'components'), rel);
      changed([unlink(path.posix.join('src/components', rel))]);
      notify('sq:components-changed');
      json(res, 200, { success: true, content });
    } catch (error) {
      fail(res, error);
    }
  });

  // Read-only planning over disk plus the accepted source prefix. The editor
  // journals this complete CAS group before source-command writes any file.
  use('layout-plan', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const body = await readBody(req), root = resolveRoot(req, body);
      if (!root || !existsSync(root)) throw new ComponentFileError('unknown project folder', 400);
      const sources = new Map();
      const walk = relative => {
        const dir = path.join(root, relative);
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || entry.name === 'node_modules') continue;
          const file = `${relative}/${entry.name}`;
          if (entry.isDirectory()) walk(file);
          else if (entry.isFile() && file.endsWith('.astro')) sources.set(file, readFileSync(path.join(root, file), 'utf8'));
        }
      };
      walk('src');
      const projected = body.projectedFiles ?? {};
      for (const [file, source] of Object.entries(projected)) {
        if (!file.startsWith('src/') || /[\\\0]/.test(file)
          || file.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
          || (source !== null && typeof source !== 'string')) throw new ComponentFileError('Invalid projected file', 400);
        if (!file.endsWith('.astro')) continue;
        if (source === null) sources.delete(file); else sources.set(file, source);
      }
      if (body.action === 'list') return json(res, 200, { layouts: [...sources].sort(([a], [b]) => a.localeCompare(b))
        .filter(([file]) => /^src\/layouts\/[^/_][^/]*\.astro$/.test(file)).map(([file, content]) => {
          const frontmatter = extractFrontmatter(content);
          return { name: path.posix.basename(file, '.astro'), path: file.slice('src/layouts/'.length),
            absolutePath: path.join(root, file), props: extractProps(frontmatter), slots: extractSlots(content),
            frontmatter, body: content.replace(/^---[\s\S]*?---\s*/, '').trim() };
        }) });
      const name = assertLayoutName(body.name), layoutFile = `src/layouts/${name}.astro`;
      if (body.action === 'create') {
        if (typeof body.astroContent !== 'string' || !body.astroContent) throw new ComponentFileError('Missing astroContent', 400);
        if ([...sources.keys()].some(file => /^(src\/layouts|src\/components)\//.test(file)
          && path.posix.basename(file).toLowerCase() === `${name}.astro`.toLowerCase())) throw new ComponentFileError('A layout or component with that name already exists', 409);
        const afterSource = body.astroContent.replace(/^[ \t]*import\s+['"](\.[^'"]+\.css)['"];?[ \t]*\r?\n/gm, (line, spec) => {
          const file = path.posix.normalize(path.posix.join('src/layouts', spec));
          const exists = Object.prototype.hasOwnProperty.call(projected, file) ? projected[file] !== null : existsSync(path.join(root, file));
          return exists ? line : '';
        });
        return json(res, 200, { files: [{ file: layoutFile, beforeSource: null, afterSource }] });
      }
      const layoutSource = sources.get(layoutFile);
      if (layoutSource === undefined) throw new ComponentFileError('layout not found', 404);
      const files = [];
      if (body.action === 'inline-delete') {
        const { parse } = await import('@astrojs/compiler');
        const { inlineLayoutIntoImporter } = await import('./sq-inline-layout.js');
        for (const [file, beforeSource] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
          if (file === layoutFile) continue;
          const imports = [...beforeSource.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.astro)['"]/g)]
            .filter(match => match[2].startsWith('.') && path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])) === layoutFile);
          if (!imports.length) continue;
          if (imports.length > 1) throw new ComponentFileError(`${file} imports this layout more than once`, 409);
          const result = await inlineLayoutIntoImporter({ layoutSource, layoutName: imports[0][1], layoutRelDir: 'src/layouts',
            importerSource: beforeSource, importerRelDir: path.posix.dirname(file), parse });
          if ('error' in result) throw new ComponentFileError(`${file} ${result.error}`, 409);
          // Convert the transform's UTF-8 byte provenance to the editor's LF
          // character coordinates, preserving identities without text matching.
          const before = Buffer.from(beforeSource, 'utf8'), after = Buffer.from(result.content, 'utf8');
          const offset = (buffer, end) => buffer.subarray(0, end).toString('utf8').replace(/\r\n/g, '\n').length;
          files.push({ file, beforeSource, afterSource: result.content, preservedSpans: result.preservedSpans.map(region => ({
            beforeStart: offset(before, region.beforeStart), afterStart: offset(after, region.afterStart),
            length: offset(before, region.beforeStart + region.length) - offset(before, region.beforeStart),
          })) });
        }
      } else if (body.action !== 'delete') throw new ComponentFileError('Unknown layout lifecycle action', 400);
      files.push({ file: layoutFile, beforeSource: layoutSource, afterSource: null });
      json(res, 200, { files });
    } catch (error) { fail(res, error); }
  });

  // ── folders manifest ──
  use('folders', async (req, res, next) => {
    try {
      if (req.method === 'GET') {
        const dir = resolveRoot(req);
        if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
        return json(res, 200, await readFolderManifest(localFoldersFile(dir)));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const dir = resolveRoot(req, body);
        if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
        await writeFolderManifest(localFoldersFile(dir), body.manifest);
        changed(['.starquix/folders.json']);
        return json(res, 200, { success: true });
      }
      return next();
    } catch (error) {
      json(res, 500, { error: msg(error) });
    }
  });

  // ── files-truth write-through: the journal + raw file reads ──
  use('changes', (req, res, next) => {
    if (req.method !== 'GET') return next();
    json(res, 200, journal.since(Number(query(req).get('since')) || 0));
  });

  use('file', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    const file = query(req).get('file') ?? '';
    if (!dir || !file || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder or missing file' });
    const abs = path.resolve(dir, file);
    if (!abs.startsWith(path.resolve(dir) + path.sep) || /[\\/](node_modules|\.sq)[\\/]/.test(abs + path.sep)) {
      return json(res, 400, { error: 'path outside the project' });
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      // `probe=1`: the caller is asking "does it exist?" — answer 200 + header
      // so the browser console is not spammed with a red 404 per existence
      // check (every boot probes sq-variables.css / folders.json / a copy).
      if (query(req).get('probe') === '1') {
        cors(res);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Sq-Missing': '1' });
        return res.end();
      }
      return json(res, 404, { error: 'not found' });
    }
    cors(res);
    // X-Sq-Mtime: when these bytes were written — the editor's newest-wins
    // merge compares it with an edit's acceptance (agent multiplayer, ledger B).
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Sq-Mtime': String(Math.round(statSync(abs).mtimeMs)) });
    res.end(readFileSync(abs));
  });

  // ── scans (same payloads as /__sq/scan-*?source=local; the plugin has no
  //    ?source= dispatch so they live under /__sq/local/ — Phase 2 client) ──
  use('scan-components', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    try { json(res, 200, await scanComponents(dir)); }
    catch (error) { json(res, 500, { error: msg(error) }); }
  });

  use('scan-layouts', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const dir = resolveRoot(req);
    if (!dir || !existsSync(dir)) return json(res, 400, { error: 'unknown project folder' });
    try { json(res, 200, await scanLayouts(dir)); }
    catch (error) { json(res, 500, { error: msg(error) }); }
  });
}

/** Host-side root resolution: `?path=` or body.path (task-132 host-disk mode). */
export function rootFromRequest(req, body) {
  if (body && typeof body.path === 'string') return body.path;
  return new URL(req.url ?? '', 'http://x').searchParams.get('path') ?? '';
}
