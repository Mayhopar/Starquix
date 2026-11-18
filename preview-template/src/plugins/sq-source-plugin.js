/**
 * SQ Source Plugin for Starquix
 * Handles class updates via WebSocket from the editor.
 *
 * task-132: when spawned inside a USER's Astro project (local mode, options
 * carry a bridgeJsPath), it additionally tags every compiled .astro file with
 * data-sq-source keys (shared tagger, sq-tagging.js), serves the generated
 * bridge.js from our repo, and injects its <script> into served HTML. All of
 * that is OFF without the option — behavior without it stays byte-identical.
 */
import { asciiAttributeName, openingTagAttributes, normalizeImageFillSource } from './sq-image-fill.js';
import { readFile } from 'fs/promises';
import { readFileSync, existsSync, statSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { transformCompiledOutput } from './sq-tagging.js';
import { registerProjectFsRoutes, createChangeJournal } from './sq-project-fs-routes.js';

import { findOpeningBracket, calculateOffset, extractOpeningTag, classTokens, resolvePartialLiteral, tailSuppliesSeparator, replaceOrAddClassAttribute, updateClassAttribute, stripMediaOwnedAttrs, swapElementTag, swapElementTagWithUndo, resolveElementSpan, lineNumberAt, lineIndentAt, dedentBlockLines, spliceBlockAt, structuralSpliceOffset, assertInsideEndAllowed, assertTargetSpanSafe, countTopLevelRoots, scanTopLevelElements, templateStartOffset, findPageBodyAnchor, assertNoStamp, appendToPageBody, insertMarkupAtLocation, assertSpanBalanced, computeRemovalRegion, columnNumberAt, isSoleTemplateRoot, assertRootRemovalAllowed, removeElementAtLocation, restoreSourceAtLocation, moveElement, restoreRegionAtLocation, findFrontmatterFences, addImportToFrontmatter, removeImportFromFrontmatter, escapeRegex, replaceOrAddAttribute, updateImageAttribute, findClosingTagStart, updateTextContent } from './sq-source-transforms.js';
export { findOpeningBracket, calculateOffset, extractOpeningTag, classTokens, resolvePartialLiteral, tailSuppliesSeparator, replaceOrAddClassAttribute, updateClassAttribute, stripMediaOwnedAttrs, swapElementTag, swapElementTagWithUndo, resolveElementSpan, lineNumberAt, lineIndentAt, dedentBlockLines, spliceBlockAt, structuralSpliceOffset, assertInsideEndAllowed, assertTargetSpanSafe, countTopLevelRoots, scanTopLevelElements, templateStartOffset, findPageBodyAnchor, assertNoStamp, appendToPageBody, insertMarkupAtLocation, assertSpanBalanced, computeRemovalRegion, columnNumberAt, isSoleTemplateRoot, assertRootRemovalAllowed, removeElementAtLocation, restoreSourceAtLocation, moveElement, restoreRegionAtLocation, findFrontmatterFences, addImportToFrontmatter, removeImportFromFrontmatter, escapeRegex, replaceOrAddAttribute, updateImageAttribute, findClosingTagStart, updateTextContent } from './sq-source-transforms.js';


/**
 * Stamp markdown/MDX-authored elements with the SOURCE RANGE they came from.
 *
 * The in-page editor needs to know which lines of the .mdx a paragraph is, so a
 * write can replace exactly those lines. `data-sq-body-*` are BODY-relative
 * because the editor works on the body; the file line is also stamped for the
 * existing source-key machinery.
 *
 * THE TRAP, measured 2026-08-07: Astro's content loader hands remark the
 * frontmatter-STRIPPED body, so every position is short by the frontmatter's
 * line count (`## What shipped` on file line 30 arrived as 18). Recover the
 * offset by locating the body inside the raw file — and search only AFTER the
 * frontmatter fence, because frontmatter routinely quotes the body's opening
 * and a hit there makes the offset too small. A wrong offset writes into the
 * wrong lines of a real file, silently.
 */
export function sqRehypeSource() {
  return (tree, file) => {
    const abs = file.path || file.history?.[0] || '';
    const rel = path.relative(file.cwd || process.cwd(), abs).split(path.sep).join('/'); // POSIX key on Windows too
    if (!rel || rel.startsWith('..')) return;
    let lineOffset = 0;
    let bodyOffset = 0;
    try {
      const raw = readFileSync(abs, 'utf-8');
      const fence = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const bodyStart = fence ? fence[0].length : 0;
      const at = raw.indexOf(String(file.value).slice(0, 200), bodyStart);
      lineOffset = raw.slice(0, at < 0 ? bodyStart : at).split('\n').length - 1;
      // task-206: positions arrive BODY-relative after an HMR recompile but
      // FILE-absolute on a cold compile (the frontmatter strip runs at a
      // different stage). Detect exactly: relative positions are bounded by
      // the body's line count, so a max end line beyond it proves absolute —
      // then every body stamp shifts back by the fence's line count.
      // Ceiling: a file-absolute tree whose content ends within the body's
      // line budget (≥ fenceLines trailing blank body lines) evades detection
      // and keeps absolute stamps — rare enough to accept.
      const fenceLines = bodyStart ? raw.slice(0, bodyStart).split('\n').length - 1 : 0;
      if (fenceLines > 0) {
        const bodyLineCount = raw.slice(bodyStart).split('\n').length;
        // The root's position envelops all children — full pre-walk only
        // when the root carries none (runs per HMR recompile, keep it cheap).
        let maxEnd = tree.position?.end?.line || 0;
        if (!maxEnd) {
          const scan = (n) => {
            if (n.position?.end?.line > maxEnd) maxEnd = n.position.end.line;
            for (const c of n.children || []) scan(c);
          };
          scan(tree);
        }
        if (maxEnd > bodyLineCount) bodyOffset = fenceLines;
      }
    } catch { /* unreadable → stamp body-relative; better than not stamping */ }
    const walk = (node) => {
      if (node.type === 'element' && node.position?.start?.line) {
        const { start, end } = node.position;
        node.properties = node.properties || {};
        // - bodyOffset + lineOffset is identity in the absolute case (both
        //   equal fenceLines) and the measured fence shift in the relative one.
        node.properties.dataSqSource = `${rel}:${start.line - bodyOffset + lineOffset}:${start.column}`;
        node.properties.dataSqBodyLine = String(start.line - bodyOffset);
        if (end?.line) node.properties.dataSqBodyEnd = String(end.line - bodyOffset);
      }
      // A COMPONENT invocation (<Media …/>) also needs its body range: the
      // editor writes the invocation's own attributes (its `class`, its `items`
      // array), and the rendered element's data-sq-source points at the
      // component's FILE — editing that would change every instance.
      //
      // The stamp rides as JSX attributes, which reach the component as PROPS,
      // so only a component that forwards its rest props onto its root element
      // surfaces them (ours does). `data-sq-block="component"` keeps this out of
      // the TEXT-editing path: it is a block to select, not to type in.
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        node.position?.start?.line &&
        node.name
      ) {
        const { start, end } = node.position;
        node.attributes = node.attributes || [];
        const has = (name) => node.attributes.some(a => a.name === name);
        const add = (name, value) => {
          if (!has(name)) node.attributes.push({ type: 'mdxJsxAttribute', name, value });
        };
        add('data-sq-block', 'component');
        add('data-sq-body-line', String(start.line - bodyOffset));
        if (end?.line) add('data-sq-body-end', String(end.line - bodyOffset));
      }
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
    // Which post produced this page, stated once, ALWAYS. The stamps above only
    // land on markdown-authored elements, so a post whose body is nothing but
    // an import and a component (exactly what the `/` menu creates) carried no
    // trace of itself, and the editor could not tell which page renders it.
    //
    // An empty `hidden` <span>, appended LAST. A comment was the first choice —
    // no layout, no cascade, no :first-child risk — but MDX's compiler DROPS
    // hast comments: measured on live astro dev bytes, zero comments survived to
    // the page. An element does survive. Last, not first, because :first-child
    // is far likelier to exist in a user's CSS than :last-child, and `hidden`
    // keeps it out of layout entirely. Dev/local-only: this plugin is registered
    // by the local wrapper config alone.
    tree.children.push({
      type: 'element',
      tagName: 'span',
      properties: { hidden: true, dataSqPost: rel },
      children: [],
    });

    /**
     * Give every TOP-LEVEL component invocation a stamped wrapper element.
     *
     * The attribute stamp above rides as a JSX attribute, so it reaches the DOM
     * only for a component that spreads its rest props onto its root — ours
     * does, the user's almost never do. That made a user's <SingleImage/> a
     * block the editor could not see at all: it was absent from
     * postBlockBoxes(), so a click below it resolved to "before the first known
     * block" and a new paragraph was written at line 0 — it appeared in the
     * right place, then jumped to the top of the post on re-render (owner,
     * 2026-08-09). The width control was unreachable for the same reason.
     *
     * A wrapper does not depend on the component's cooperation, and it is also
     * exactly where columnSpan.ts already expects the col-span-* classes to
     * live. Top level only: nested invocations are the component's business.
     */
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];
      if (node.type !== 'mdxJsxFlowElement' || !node.name) continue;
      const start = node.position?.start?.line;
      if (!start) continue;
      tree.children[i] = {
        type: 'element',
        tagName: 'div',
        properties: {
          dataSqBlock: 'component',
          dataSqBodyLine: String(start - bodyOffset),
          dataSqBodyEnd: String((node.position.end?.line ?? start) - bodyOffset),
        },
        children: [node],
      };
    }
  };
}

/** Attribute of the per-post marker span sqRehypeSource emits. Read by the
 *  editor to confirm which page renders a post — never by anything at runtime. */
export const POST_MARKER_ATTR = 'data-sq-post';

/** Vite module id of the local-mode write-bridge senders (see loadWriteBridgeSource). */
export const WRITE_BRIDGE_ID = '/sq-local-write-bridge.js';

/** task-140: unresolved media fill renders the placeholder. */
const MEDIA_PLACEHOLDER_STYLE =
  `<style>[data-sq-media='true']{background:#e2e8f0 url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201200%20800%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22%23e2e8f0%22%2F%3E%3Ccircle%20cx%3D%22880%22%20cy%3D%22235%22%20r%3D%2272%22%20fill%3D%22%2394a3b8%22%2F%3E%3Cpath%20d%3D%22M96%20640%20L478%20288%20L780%20640%20Z%22%20fill%3D%22%23cbd5e1%22%2F%3E%3Cpath%20d%3D%22M570%20640%20L834%20394%20L1104%20640%20Z%22%20fill%3D%22%2394a3b8%22%2F%3E%3C%2Fsvg%3E") center / cover no-repeat;min-height:4rem}</style>`;

/**
 * Paint-hold (seamless canvas A4/A5): every same-origin document change in the
 * canvas — page switch, link click, the bridge's boundary — keeps the old frame
 * on screen until the new document's first frame: a cross-document view
 * transition with no animation. Without it Chromium shows ONE blank frame between
 * the new document's commit and its first paint (log-proven 2026-11-10). Typed,
 * so a site's own view transitions (astro:transitions) keep their animations.
 */
const PAINT_HOLD_STYLE =
  '<style>@view-transition{navigation:auto;types:sq-hold}' +
  'html:active-view-transition-type(sq-hold)::view-transition-group(*),' +
  'html:active-view-transition-type(sq-hold)::view-transition-old(*),' +
  'html:active-view-transition-type(sq-hold)::view-transition-new(*){animation:none}</style>';

/**
 * Everything the local runtime needs that the served page cannot provide
 * itself: the media placeholder style, the paint-hold, the `__SQ_LOCAL_MODE__`
 * marker the bridge gates placement identity on, and the write-bridge senders.
 *
 * Deliberately does NOT include the `bridge.js` <script> — see
 * armLocalRuntimeHtml.
 */
const LOCAL_RUNTIME =
  `${MEDIA_PLACEHOLDER_STYLE}${PAINT_HOLD_STYLE}<script>window.__SQ_LOCAL_MODE__=true</script>` +
  `<script type="module" src="${WRITE_BRIDGE_ID}"></script>`;

const BRIDGE_TAG = '<script src="/scripts/bridge.js"></script>';

/**
 * Arm the local runtime on a served HTML page.
 *
 * The two halves are injected INDEPENDENTLY, and that separation is the whole
 * point of this function (regression 2026-08-04):
 *
 *   - `bridge.js` is deduped, because a page whose layout already carries
 *     `<script src="/scripts/bridge.js">` (every layout copied from
 *     preview-template does) would otherwise load the bridge twice.
 *   - `LOCAL_RUNTIME` is injected ALWAYS, because nothing in a user project
 *     can supply it.
 *
 * They used to share one guard, so a single hand-written `<script
 * src="/scripts/bridge.js">` anywhere in the page silently disarmed local
 * mode: `window.__SQ_LOCAL_MODE__` stayed undefined, so `resolvePlacement()`
 * returned '' and EVERY element key lost its placement segment — one page's
 * class edit repainted every other page and the master view — and
 * `window.__SQ_WRITE_*` never existed, so Push wrote nothing, with no toast.
 * Proven on real `astro dev` bytes: with the tag, 0 occurrences of
 * `__SQ_LOCAL_MODE__` in the response; without it, 1.
 */
export function armLocalRuntimeHtml(html) {
  if (typeof html !== 'string') return html;
  // Idempotent: the middleware must never double-arm a page.
  let payload = html.includes('__SQ_LOCAL_MODE__') ? '' : LOCAL_RUNTIME;
  if (!html.includes('/scripts/bridge.js')) payload += BRIDGE_TAG;
  if (!payload) return html;
  return html.includes('</head>')
    ? html.replace('</head>', `${payload}</head>`)
    : payload + html;
}

/**
 * Seamless canvas (D1): EVERY reload Vite can do to the preview frame — HMR
 * dead end, Astro's post-error clientReload, data-store reload, circular
 * import, reconnect after a server restart — ends in client.mjs's
 * `location.reload()`. Route each through the bridge first; it returns true
 * when it handled the change in place. Unknown client shape → null → native
 * reloads kept (fail closed: a reload never loses data once drafts exist).
 */
const VITE_RECONNECT_RELOAD = /(await waitForSuccessfulPing\([^)]*\);\s*)location\.reload\(\);/;
export function patchViteClient(code) {
  if (typeof code !== 'string' || !VITE_RECONNECT_RELOAD.test(code)) return null;
  const body = code.replace(VITE_RECONNECT_RELOAD, '$1__sqReload("reconnect");')
    .replace(/location\.reload\(\)/g, '__sqReload("reload")')
    // The bridge coalesces refreshes itself; Vite's 20 ms reload debounce is pure delay.
    .replace(/debounceReload\(\d+\)/, 'debounceReload(0)');
  return 'const __sqReload = (reason) => { const h = globalThis.__SQ_VITE_RELOAD__;\n' +
    '  if (!(typeof h === "function" && h(reason) === true)) location.reload(); };\n' + body;
}

/**
 * Writer is the signal (2026-11-08, measured): macOS FSEvents reports a write
 * ~100 ms late (p50 98 ms), and the canvas refresh waits for it. Our routes
 * know the instant they write, so they announce the file to Vite's watcher
 * themselves; FSEvents' later echo of the same bytes (same mtime) is dropped,
 * so Vite still handles each write exactly once. Anything else passes through.
 */
export function announceWrites(watcher, stat = statSync) {
  const own = new Map(); // abs path → mtimeMs we announced
  const emit = watcher.emit.bind(watcher);
  watcher.emit = (event, ...args) => {
    const kind = event === 'all' ? args[0] : event;   // chokidar: emit(ev, path) then emit('all', ev, path)
    const file = event === 'all' ? args[1] : args[0];
    if (kind === 'change' && own.has(file)) {
      let mtime = -1;
      try { mtime = stat(file).mtimeMs; } catch { /* gone: let the event through */ }
      if (mtime === own.get(file)) return false;
      own.delete(file);
    }
    return emit(event, ...args);
  };
  return (files) => {
    for (const file of files) {
      let st;
      try { st = stat(file); } catch { continue; } // deleted: the watcher reports the unlink
      own.set(file, st.mtimeMs);
      setTimeout(() => { if (own.get(file) === st.mtimeMs) own.delete(file); }, 3000).unref?.();
      emit('change', file, st);
      emit('all', 'change', file, st);
    }
  };
}

/**
 * Astro 7 dev reloads the content config 50 ms after it changes, through the `astro`
 * environment — which still holds the OLD module: the store is resynced without the new
 * collection under the NEW file digest, and the next (correct) reload has that same digest,
 * so Astro never syncs again (a new collection stayed empty until a reopen, owner 2026-11-11).
 * Dropping the module at the watcher event makes Astro's own reload read the file.
 */
export function freshContentConfig(server) {
  server.watcher?.on('all', (event, file) => {
    if (!['add', 'change', 'unlink'].includes(event) || !/[\\/]src[\\/]content\.config\.(ts|js|mjs|mts)$/.test(file)) return;
    const env = server.environments?.astro;
    for (const mod of env?.moduleGraph?.getModulesByFile(file) ?? []) env.moduleGraph.invalidateModule(mod, undefined, Date.now(), true);
    for (const mod of env?.runner?.evaluatedModules?.getModulesByFile(file) ?? []) env.runner.evaluatedModules.invalidateModule(mod);
  });
}

export function sqSourcePlugin(options = {}) {
  const { bridgeJsPath } = options; // set ONLY by the local-mode wrapper config (task-132)
  const isLocal = !!bridgeJsPath;
  // Files-truth write-through journal (Phase 2 Task 2.4) — fed by the
  // project-fs routes; pulled by the editor. Local only.
  const journal = isLocal ? createChangeJournal() : null;
  let root = process.cwd();
  let parsePromise = null;
  let parseJsPromise = null;

  // Local mode resolves @astrojs/compiler from the USER project's own astro
  // install (it is a direct dep of astro) — this plugin file lives in OUR repo,
  // so a static import would resolve against the wrong node_modules.
  const loadParse = () => {
    if (!parsePromise) {
      parsePromise = (async () => {
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const req = createRequire(path.join(root, 'package.json'));
        let resolved;
        try {
          resolved = req.resolve('@astrojs/compiler');
        } catch {
          // not hoisted — resolve via astro's own deps
          const astroPkg = req.resolve('astro/package.json');
          resolved = createRequire(astroPkg).resolve('@astrojs/compiler');
        }
        return (await import(pathToFileURL(resolved).href)).parse;
      })();
    }
    return parsePromise;
  };

  /**
   * task-176 — THE PARSE GATE's parser. Same resolution discipline as
   * `loadParse`: `rollup/parseAst` comes from the USER project's own install,
   * because rollup is a hard dep of vite which is a hard dep of astro, and it
   * is the very parser whose `Unexpected token \`ident\`. Expected \`}\`` the
   * user saw when the tagger spliced into a JS string literal.
   *
   * Failure to resolve is NOT swallowed: the caller's try/catch turns it into
   * "this file is served untagged", which is the same fail-closed outcome the
   * gate itself produces. Silently tagging WITHOUT the gate would be the one
   * outcome that can still take a page to 500.
   */
  const loadParseJs = () => {
    if (!parseJsPromise) {
      parseJsPromise = (async () => {
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const req = createRequire(path.join(root, 'package.json'));
        // Vite ≤7 parses with rollup, Vite 8 (Astro 7) with rolldown: whichever this install's vite has.
        const reqs = [req];
        try { reqs.push(createRequire(req.resolve('vite/package.json'))); } catch { /* vite not hoisted */ }
        for (const r of reqs) for (const id of ['rollup/parseAst', 'rolldown/parseAst']) {
          try { return (await import(pathToFileURL(r.resolve(id)).href)).parseAst; } catch { /* next */ }
        }
        throw new Error('No rollup/rolldown parseAst in this install');
      })();
    }
    return parseJsPromise;
  };

  // Local mode: user pages need the window.__SQ_WRITE_*__ senders that
  // preview-template pages get from SqHmrWriteBridge.astro. Serve THE SAME
  // script body (single source: extracted from that component) as a
  // vite-transformed module so import.meta.hot works.
  let writeBridgeSource = null;
  const loadWriteBridgeSource = () => {
    if (writeBridgeSource) return writeBridgeSource;
    const astroSrc = readFileSync(new URL('../components/SqHmrWriteBridge.astro', import.meta.url), 'utf-8');
    // The tag at a line start: the component's comment mentions `<script>` too.
    const m = astroSrc.match(/^<script>([\s\S]*?)^<\/script>/m);
    if (!m) throw new Error('[sq-source] SqHmrWriteBridge.astro has no <script> body');
    writeBridgeSource = m[1];
    return writeBridgeSource;
  };

  return {
    name: 'sq-source-plugin',
    // Local mode must see COMPILED astro output (post astro's own plugins).
    // Unset otherwise so plugin ordering without the option is untouched.
    ...(isLocal ? { enforce: 'post' } : {}),

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (isLocal && id === WRITE_BRIDGE_ID) return WRITE_BRIDGE_ID;
    },

    load(id) {
      if (isLocal && id === WRITE_BRIDGE_ID) return loadWriteBridgeSource();
    },

    async transform(code, id) {
      if (!isLocal) return null;
      if (id.split('?')[0].endsWith('/vite/dist/client/client.mjs')) {
        const patched = patchViteClient(code);
        if (!patched) console.warn('[sq-source] unrecognised Vite client — native reloads kept');
        return patched ? { code: patched, map: null } : null;
      }
      const cleanId = id.split('?')[0];
      if (!cleanId.endsWith('.astro')) return null;
      if (id.includes('node_modules')) return null;
      // Files outside the project root (e.g. the wrapper-dir SqComponentView
      // page, task-136) never get keys — an escaping ../../ key is unwritable
      // and would make our own chrome selectable.
      if (path.relative(root, cleanId).startsWith('..')) return null;
      if (!code.includes('$$render`') && !code.includes('$$render `') && !code.includes('__template(')) {
        return null;
      }
      try {
        const originalCode = await readFile(cleanId, 'utf-8');
        const parse = await loadParse();
        const parseJs = await loadParseJs();
        // task-149: `{ placements: true }` is LOCAL-ONLY (this whole hook
        // returns null above unless isLocal) — it makes the tagger emit
        // per-placement identity so a style edit on `/` cannot leak to
        // `/about` or into the shared component. 6-arg callers of the same
        // tagger get byte-identical output.
        //
        // task-176: `parseJs` is THE PARSE GATE and is passed HERE only — a
        // module the tagger broke is dropped rather than served (HTTP 500).
        return await transformCompiledOutput(code, originalCode, cleanId, root, 'relative', parse, {
          placements: true,
          parseJs,
        });
      } catch (error) {
        console.error(`[sq-source] tagging failed for ${id}:`, error);
        return null;
      }
    },

    configureServer(server) {
      if (isLocal) {
        // Serve the generated bridge.js from OUR repo — never copied into the
        // user's folder. Also the identity probe target (GET → 200).
        // bridge.js + tailwind.js (bridge's live-class engine) from OUR repo.
        // Every page navigation re-requests these (~650 KB combined) — cache
        // the bytes keyed by file mtime; the user-override check is per-root
        // and stable, so it runs once at registration.
        const serveScript = (route, file, contentType = 'text/javascript') => {
          if (existsSync(path.join(root, 'public', route))) return; // user's own copy wins
          // mtime-fresh cache: a regenerated bridge.js reaches a LONG-RUNNING
          // instance on the next iframe reload — no instance restart needed.
          // (The old forever-cache shipped a stale bridge past every fix.)
          let cached = null;
          let cachedMtime = 0;
          server.middlewares.use(route, (req, res) => {
            const mtime = statSync(file).mtimeMs;
            if (!cached || mtime !== cachedMtime) {
              cached = readFileSync(file);
              cachedMtime = mtime;
            }
            res.setHeader('Content-Type', contentType);
            // Plugin middlewares run BEFORE vite's cors/headers middlewares —
            // set these here or the editor's identity probe (a cross-origin
            // fetch from the editor origin) is blocked.
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.end(cached);
          });
        };
        serveScript('/scripts/bridge.js', bridgeJsPath);
        serveScript('/scripts/tailwind.js', path.join(path.dirname(bridgeJsPath), 'tailwind.js'));
        // task-139: real 2s gray MP4 for video stub props (a data-SVG can't play in <video>)
        serveScript('/sq-placeholder.mp4', path.join(path.dirname(bridgeJsPath), '..', 'sq-placeholder.mp4'), 'video/mp4');

        // Files-truth (2026-08-28 Phase 1): this instance answers the editor's
        // /__sq/local/* project-fs calls ITSELF — root = its own project, the
        // request's `path` ignored. Same route table the host serves; the
        // client only changes its base URL (sqLocalBase). Lifecycle routes
        // (open/status/stop/pick) stay with whoever spawned the process.
        freshContentConfig(server);
        const announce = typeof server.watcher?.emit === 'function' ? announceWrites(server.watcher) : null;
        registerProjectFsRoutes(server, {
          journal,
          resolveRoot: () => root,
          sqComponentsDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components'),
          notifyWs: (event) => server.ws.send({ type: 'custom', event, data: {} }),
          // Templates/content drive the canvas refresh; public/ keeps the watcher path (its served set fills on 'add').
          announce: announce && ((files) => announce(files.filter(f => f.startsWith('src/')).map(f => path.join(root, f)))),
        });

        // task-139: astro's /_image 403s data: URIs (remote-domain allowlist).
        // The component-view stub props use a data-SVG placeholder — serve it
        // ourselves (plugin middlewares run before astro's routes). SVG-only.
        // The href is anyone's (a link can name any SVG): the sandboxing CSP
        // keeps it from running script on this origin when opened as a
        // document; an <img> (the placeholder's only use) never runs any.
        server.middlewares.use('/_image', (req, res, next) => {
          const href = new URL(req.url || '/', 'http://x').searchParams.get('href') || '';
          const PREFIX = 'data:image/svg+xml,';
          if (!href.startsWith(PREFIX)) return next();
          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.end(decodeURIComponent(href.slice(PREFIX.length)));
        });

        // Arm the local runtime on every served HTML page — user projects have
        // no Layout.astro of ours to carry it. See armLocalRuntimeHtml: the
        // bridge <script> is deduped, the runtime payload never is.
        server.middlewares.use((req, res, next) => {
          if (!(req.headers.accept || '').includes('text/html')) return next();
          const chunks = [];
          const origWrite = res.write.bind(res);
          const origEnd = res.end.bind(res);
          // encoding/callback args intentionally dropped — we buffer the body
          res.write = (chunk) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return true;
          };
          res.end = (chunk) => {
            if (chunk && typeof chunk !== 'function') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const ct = String(res.getHeader('content-type') || '');
            let body = Buffer.concat(chunks);
            // Headers already on the wire WITH a Content-Length (Astro's dev
            // error page) fix the body size — a grown body would be truncated to
            // it, so such a response passes through unarmed. Ordinary pages are
            // written after writeHead too, but chunked (no length): arm those.
            const lengthSent = res.headersSent && /\r\ncontent-length:/i.test(String(res._header || ''));
            if (ct.includes('text/html') && !lengthSent) {
              body = Buffer.from(armLocalRuntimeHtml(body.toString('utf-8')), 'utf-8');
            }
            // Touching headers once sent throws ERR_HTTP_HEADERS_SENT and kills
            // the whole astro process.
            if (!res.headersSent && res.getHeader('content-length') !== undefined) {
              res.setHeader('content-length', String(body.length));
            }
            res.write = origWrite;
            res.end = origEnd;
            return origEnd(body);
          };
          next();
        });
      }

      // Source writes are not accepted over the dev-server socket (retired
      // 2026-10-18): the editor writes through the token-guarded /__sq/local/*
      // routes and the durable journal.
    },

    handleHotUpdate({ file }) {
      // Doc-first shell: library/layout .astro files are never in the shell's
      // client module graph — the canvas renders them from the doc (RENDER),
      // and scan/__component-preview read the file fresh per request. Astro's
      // full-reload broadcast for them (push-to-source flush via the host
      // :4000 write-back endpoint, manual IDE edits) only blinks the preview
      // iframe ~1s after the user is back on the canvas. Suppress it; the
      // module is still invalidated server-side so the next scan sees fresh
      // content.
      // Local mode: the user's own src/layouts|components must keep normal
      // HMR — external IDE edits drive the re-scan flow (design §4 case #7).
      if (!isLocal && /\/src\/(components\/library|layouts)\//.test(file)) {
        return [];
      }
    }
  };
}
