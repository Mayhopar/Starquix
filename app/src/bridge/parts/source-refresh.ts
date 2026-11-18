/**
 * Bridge Part: Source refresh (seamless canvas, plan
 * docs/plans/2026-10-04-seamless-canvas-plan.md Layers 1–2).
 *
 * Vite's client asks __SQ_VITE_RELOAD__ before every location.reload()
 * (sq-source-plugin.js patchViteClient). We answer true = handled: fetch our
 * own URL, morph the live DOM in place (keyed by data-sq-source + placement
 * + usage, positional fallback), reconcile head style carriers, rescan. The
 * document is replaced only at a boundary: a script change, a morph that
 * cannot be planned, a server restart.
 */
import { SQ_BOUNDARY_PARAM } from '../boundaryParam.ts';

export const BRIDGE_SOURCE_REFRESH = `
  // Attributes the editor owns on user elements; the server never sends them.
  var SQ_EDITOR_ATTR = /^(data-key|data-drawn|data-mode|data-slot-|data-drag-|data-reparent-|data-sq-(ai-|selection-|media)|contenteditable$)/;

  IFrameBridge.prototype.installSourceRefresh = function() {
    var self = this;
    // A boundary's marker and scroll (documentBoundary): the URL is clean before anything
    // reads or reports it (navigation detection is installed after this).
    try {
      var here = new URL(location.href);
      if (here.searchParams.has('${SQ_BOUNDARY_PARAM}')) {
        here.searchParams.delete('${SQ_BOUNDARY_PARAM}');
        history.replaceState(history.state, '', here.href);
        var at = JSON.parse(sessionStorage.getItem('sq-b-scroll') || 'null');
        sessionStorage.removeItem('sq-b-scroll');
        if (at && at[0] === location.pathname) this.restoreBoundaryScroll(at[1], at[2]);
      }
    } catch (e) {}
    this._refreshDone = Promise.resolve();
    this._refreshDirty = false;
    this._refreshRunning = false;
    this._refreshRetry = null;
    // Style carriers the SERVER rendered (vs. ones Vite injects at runtime):
    // only those may be removed when a fresh page no longer carries them.
    this._serverHeadKeys = {};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { self.recordServerHead(document); }, { once: true });
    else this.recordServerHead(document);
    // The document is going away (link click, crash recovery, app quit): keep the typed text.
    window.addEventListener('pagehide', function() { self.flushTextDraft(); });
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') self.flushTextDraft(); });
    // Layer 3 (cases 21/22): never move targets under a live pointer gesture
    // or an IME composition — hold the refresh, run it when they end.
    this._gestureSince = 0;
    this._composingSince = 0;
    var resume = function() { setTimeout(function() { self.resumeHeldRefresh(); }, 0); };
    document.addEventListener('pointerdown', function() { self._gestureSince = Date.now(); }, true);
    document.addEventListener('pointerup', function() { self._gestureSince = 0; resume(); }, true);
    document.addEventListener('pointercancel', function() { self._gestureSince = 0; resume(); }, true);
    document.addEventListener('mouseup', resume, true); // flow drag clears its state on mouseup
    document.addEventListener('compositionstart', function() { self._composingSince = Date.now(); }, true);
    document.addEventListener('compositionend', function() { self._composingSince = 0; resume(); }, true);
    window.__SQ_VITE_RELOAD__ = function(reason) {
      if (reason === 'reconnect') { self.documentBoundary('reconnect'); return true; }
      self.requestSourceRefresh();
      return true;
    };
  };

  // ponytail: a gesture whose end never reaches this frame (pointerup outside
  // it) expires after 10 s; the held-refresh poll then runs it.
  var SQ_HOLD_MAX_MS = 10000;
  IFrameBridge.prototype.refreshHeld = function() {
    var now = Date.now();
    return (this._gestureSince && now - this._gestureSince < SQ_HOLD_MAX_MS)
      || (this._composingSince && now - this._composingSince < SQ_HOLD_MAX_MS)
      || !!(this._flowDrag && this._flowDrag._state);
  };

  IFrameBridge.prototype.holdRefresh = function() {
    var self = this;
    this._refreshQueued = true;
    if (this._heldPoll) return;
    this._heldPoll = setTimeout(function() { self._heldPoll = null; self.resumeHeldRefresh(); }, 250);
  };

  IFrameBridge.prototype.resumeHeldRefresh = function() {
    if (!this._refreshQueued) return;
    if (this.refreshHeld()) { this.holdRefresh(); return; }
    this._refreshQueued = false;
    this.requestSourceRefresh();
  };

  IFrameBridge.prototype.requestSourceRefresh = function() {
    var self = this;
    if (this.refreshHeld()) { this.holdRefresh(); return; }
    this._refreshDirty = true;
    if (this._refreshRunning) return;
    this._refreshRunning = true;
    this._refreshDone = (async function() {
      try {
        while (self._refreshDirty) {
          self._refreshDirty = false;
          var html = await self.fetchOwnHtml();
          if (html === null) { self.scheduleRefreshRetry(); return; }
          if (self._refreshDirty) continue; // stale response: refetch (case 20)
          if (self.refreshHeld()) { self.holdRefresh(); return; }  // a gesture began during the fetch
          await self.applySourceHtml(html);
        }
      } finally { self._refreshRunning = false; }
    })();
  };

  /** Parent asks for a re-render from source (Reset/Push/stale scan, Task 2.6). */
  IFrameBridge.prototype.handleRefreshFromSource = function() {
    this.requestSourceRefresh();
  };

  IFrameBridge.prototype.fetchOwnHtml = async function() {
    try {
      var r = await fetch(location.href.split('#')[0], { headers: { Accept: 'text/html' }, cache: 'no-store' });
      if (!r.ok) return null;
      return await r.text();
    } catch (e) { return null; }
  };

  // Case 23: one silent retry after 1 s; the next Vite reload also heals it.
  IFrameBridge.prototype.scheduleRefreshRetry = function() {
    var self = this;
    if (this._refreshRetry) return;
    this._refreshRetry = setTimeout(function() { self._refreshRetry = null; self.requestSourceRefresh(); }, 1000);
  };

  var SQ_REFRESH_DEFER = {};

  IFrameBridge.prototype.applySourceHtml = async function(html) {
    var next = new DOMParser().parseFromString(html, 'text/html');
    if (this.refreshBlockedByEdit(next)) { this._refreshDeferred = true; return; }
    // Case 25: a response with nothing we tagged (error JSON, foreign page) is not this page.
    // A torn write (truncate → write) renders an empty page for an instant: re-read once first.
    if (!next.body.querySelector('[data-sq-source]') && document.body.querySelector('[data-sq-source]')) {
      if (!this._untaggedRetried) { this._untaggedRetried = true; this.scheduleRefreshRetry(); return; }
      this._untaggedRetried = false; this.documentBoundary('shape'); return;
    }
    this._untaggedRetried = false;
    var head = this.planHead(next.head);
    if (!head) { this.documentBoundary('shape'); return; }
    // New stylesheets load BEFORE the body changes (case 12: no unstyled flash).
    if (head.loads.length) {
      head.insertLinks();
      await Promise.race([Promise.all(head.loads), new Promise(function(r) { setTimeout(r, 2000); })]);
      if (this._refreshDirty) return;                       // a newer change is queued; it re-plans
      if (this.refreshBlockedByEdit(next)) { this._refreshDeferred = true; return; }
    }
    var plan = [];
    this._morphSeq++;          // one refresh = one verification miss at most per held key
    this._morphTouched = [];   // what this refresh changes (SOURCE_CHANGED, ledger A)
    try { if (!this.planMorph(document.body, next.body, plan)) { this.documentBoundary('shape'); return; } }
    catch (e) {
      if (e === SQ_REFRESH_DEFER) { this._refreshDeferred = true; return; }
      console.warn('[sq] morph failed', e); this.documentBoundary('shape'); return;
    }
    var observing = this.mutationObserverStarted;
    this.stopMutationObserver();
    try {
      head.apply();
      for (var i = 0; i < plan.length; i++) plan[i]();
      this.releaseDetachedClassHolds();   // a held node the morph removed loses its hold: no re-assert by key
      this.resetDocumentKeyCaches();
      this.reapplyLocalOverridesNow();
      this.refreshProjectCssLinks();
    } catch (e) {
      console.warn('[sq] morph failed', e); this.documentBoundary('shape'); return;   // case 25
    } finally { if (observing) this.startMutationObserver(); }
    this.scanElements();
    this.sendToParent({ type: 'SOURCE_OK' }); // case 24: a good render clears the error status
    try { this.reportSourceChanged(this._morphTouched); } catch (e) { console.warn('[sq] change report failed', e); }  // D2
    this._morphTouched = null;
  };

  /** Agent edits on the canvas (docs/plans/2026-11-10-agent-canvas-flash-design.md):
   *  the keys of what the morph changed. Never decides whose edit it
   *  was — the editor attributes it. Keys are read after the scan (A13). */
  IFrameBridge.prototype.reportSourceChanged = function(nodes) {
    var keys = [], seen = {}, i;
    for (i = 0; nodes && i < nodes.length && keys.length < 200; i++) {   // D5
      var n = nodes[i];
      if (!n || n.nodeType !== 1 || n === document.body || !document.body.contains(n)) continue;
      var keyed = n.closest('[data-key]');
      if (!keyed || keyed === document.body) continue;
      var key = keyed.getAttribute('data-key');
      if (seen[key]) continue;
      seen[key] = true; keys.push(key);
    }
    if (keys.length) this.sendToParent({ type: 'SOURCE_CHANGED', payload: { keys: keys } });
  };
  // Line shifts rewrite data-sq-source/data-key, every save bumps data-sq-source-version,
  // a component edit rewrites every data-astro-cid-*: none is a change the user should see (A3).
  var SQ_NOT_A_CHANGE = /^(data-sq-|data-key$|data-astro-)/;
  function sqClassWithoutAI(v) { return (v || '').split(/\\s+/).filter(function(c) { return c && c.indexOf('sq-ai-') !== 0; }).join(' '); }
  IFrameBridge.prototype.morphTouch = function(n) { if (this._morphTouched && n) this._morphTouched.push(n); };

  /** The morph identity: source coordinate + placement + usage (plan D2). */
  function sqMorphKey(el) {
    var src = el.nodeType === 1 && el.getAttribute('data-sq-source');
    return src ? src + '\t' + (el.getAttribute('data-sq-placement') || '') + '\t' + (el.getAttribute('data-sq-usage') || '') : null;
  }
  function sqHasScript(el) { return el.tagName === 'SCRIPT' || !!(el.querySelector && el.querySelector('script')); }

  /**
   * Keyed morph of live's children into fresh's (morphdom-style, no
   * dependency — owner decision 1). Plans every change before any mutation:
   * returns false → boundary; throws SQ_REFRESH_DEFER when it would touch the
   * element being edited. Pairing per fresh child: (a) first unused live
   * sibling with the same key (FIFO, so loops pair in order); (b) else the
   * live child at the cursor when it has the same tag and is unkeyed or keyed
   * with a key the fresh list no longer has (a shifted coordinate); (c) else a
   * clone of the fresh node. Unpaired live children are removed.
   */
  IFrameBridge.prototype.planMorph = function(live, fresh, plan) {
    var editing = this.editingElement;
    var liveKids = [], freshKids = [], freshKeys = {}, byKey = {}, used = new Set(), desired = [], i;
    for (i = 0; i < live.childNodes.length; i++) if (!this.isEditorNode(live.childNodes[i])) liveKids.push(live.childNodes[i]);
    for (i = 0; i < fresh.childNodes.length; i++) freshKids.push(fresh.childNodes[i]);
    for (i = 0; i < freshKids.length; i++) { var fk = sqMorphKey(freshKids[i]); if (fk) freshKeys[fk] = true; }
    for (i = 0; i < liveKids.length; i++) { var lk = sqMorphKey(liveKids[i]); if (lk) (byKey[lk] = byKey[lk] || []).push(liveKids[i]); }
    var cursor = 0;
    for (i = 0; i < freshKids.length; i++) {
      var f = freshKids[i], m = null, key = sqMorphKey(f), c;
      if (key && byKey[key]) {
        while (!m && byKey[key].length) { c = byKey[key].shift(); if (!used.has(c) && c.tagName === f.tagName) m = c; }
      }
      if (!m) {
        while (cursor < liveKids.length && used.has(liveKids[cursor])) cursor++;
        c = liveKids[cursor];
        if (c && c !== editing && c.nodeType === f.nodeType && (c.nodeType !== 1
            || (c.tagName === f.tagName && (!sqMorphKey(c) || !freshKeys[sqMorphKey(c)])))) { m = c; cursor++; }
      }
      if (m && m.tagName === 'ASTRO-ISLAND' && !this.sameIsland(m, f)) m = null;  // case 15: replace that island alone
      if (m) {
        used.add(m);
        if (!this.planPair(m, f, plan)) return false;
        desired.push(m);
      } else {
        if (f.nodeType === 1 && sqHasScript(f)) return false;          // case 14: scripts never re-run in place
        var imported = document.importNode(f, true);
        desired.push(imported);
        if (f.nodeType === 1 || (f.nodeType === 3 && f.data.trim())) this.morphTouch(f.nodeType === 1 ? imported : live);  // A4
      }
    }
    var removed = [];
    for (i = 0; i < liveKids.length; i++) {
      var r = liveKids[i];
      if (used.has(r)) continue;
      if (editing && (r === editing || (r.nodeType === 1 && r.contains(editing)))) throw SQ_REFRESH_DEFER;
      if (r.nodeType === 1 && sqHasScript(r)) return false;
      removed.push(r);
      if (r.nodeType === 1 || (r.nodeType === 3 && r.data.trim())) this.morphTouch(live);   // A5: the container shows where
    }
    this.morphTouchMoves(liveKids, desired, used);
    var self = this;
    plan.push(function() {
      var next = function(n) { while (n && self.isEditorNode(n)) n = n.nextSibling; return n; };
      var at = next(live.firstChild);
      for (var d = 0; d < desired.length; d++) {
        if (desired[d] === at) at = next(at.nextSibling);
        else live.insertBefore(desired[d], at);
      }
      for (var x = 0; x < removed.length; x++) if (removed[x].parentNode === live) live.removeChild(removed[x]);
    });
    return true;
  };

  /** A6: a kept element moved when BOTH its neighbours among the kept ones
   *  changed — so a removal or an insert never reads as its siblings moving. */
  IFrameBridge.prototype.morphTouchMoves = function(liveKids, desired, used) {
    if (!this._morphTouched) return;
    var before = liveKids.filter(function(n) { return used.has(n) && n.nodeType === 1; });
    var after = desired.filter(function(n) { return used.has(n) && n.nodeType === 1; });
    if (before.length < 2) return;
    for (var i = 0; i < after.length; i++) {
      var j = before.indexOf(after[i]);
      if (before[j - 1] !== after[i - 1] && before[j + 1] !== after[i + 1]) this.morphTouch(after[i]);
    }
  };

  /** One paired node: patch it in place, recurse unless its subtree is protected. */
  IFrameBridge.prototype.planPair = function(x, y, plan) {
    if (x.nodeType !== 1) {
      if (x.data !== y.data) { this.morphTouch(x.parentNode); plan.push(function() { x.data = y.data; }); }  // A1
      return true;
    }
    var tag = x.tagName;
    if (tag === 'SCRIPT') return x.outerHTML === y.outerHTML;               // case 14
    if (tag === 'ASTRO-ISLAND') return true;                                  // case 16: kept untouched
    this.planAttrPatch(x, y, plan);
    if (x === this.editingElement) return true;                               // typed subtree is never touched
    if (this.isHeldEdit(x, y)) return true;
    // Playback continues; user-typed form values stay (case 2.1 rules).
    if ((tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') && x.getAttribute('src') === y.getAttribute('src')) return true;
    if (tag === 'TEXTAREA') return true;
    return this.planMorph(x, y, plan);
  };

  /** Head carriers by key (Task 2.2). Returns null → boundary (a new or changed script). */
  IFrameBridge.prototype.planHead = function(freshHead) {
    var self = this, head = document.head, ops = [], links = [], loads = [];
    var keyOf = function(el) { return self.headCarrierKey(el); };
    var liveByKey = {}, liveScripts = {}, i, el;
    for (i = 0; i < head.children.length; i++) {
      el = head.children[i];
      if (el.tagName === 'SCRIPT') liveScripts[el.outerHTML] = true;
      var lk = keyOf(el);
      if (lk && !liveByKey[lk]) liveByKey[lk] = el;
    }
    // Added/changed head scripts cannot run in place. A live script the fresh
    // page lacks (runtime-injected analytics, our tailwind loader) is left alone.
    var freshKeys = {}, prev = null;
    for (i = 0; i < freshHead.children.length; i++) {
      el = freshHead.children[i];
      if (el.tagName === 'SCRIPT') { if (!liveScripts[el.outerHTML]) return null; continue; }
      if (el.tagName === 'TITLE') {
        var title = el.textContent;
        if (document.title !== title) ops.push(function() { document.title = title; });
        continue;
      }
      var key = keyOf(el);
      if (!key) continue;
      freshKeys[key] = true;
      var live = liveByKey[key];
      if (live) {
        if (key.indexOf('style:') === 0 && live.textContent !== el.textContent) ops.push((function(l, t) { return function() { l.textContent = t; }; })(live, el.textContent));
        if (key.indexOf('meta:') === 0 && live.getAttribute('content') !== el.getAttribute('content')) ops.push((function(l, v) { return function() { l.setAttribute('content', v || ''); }; })(live, el.getAttribute('content')));
        prev = live;
        continue;
      }
      var node = document.importNode(el, true);
      var after = prev;
      if (el.tagName === 'LINK') {
        links.push({ node: node, after: after });
        loads.push(new Promise(function(r) { node.addEventListener('load', r); node.addEventListener('error', r); }));
      } else {
        ops.push((function(n, a) { return function() { if (a && a.parentNode === head) a.after(n); else head.appendChild(n); }; })(node, after));
      }
      prev = node;
    }
    for (var k in liveByKey) {
      if (freshKeys[k]) continue;
      // Only what the server once rendered may go; Vite's runtime styles stay.
      if (this._serverHeadKeys[k]) ops.push((function(l) { return function() { if (l.parentNode) l.parentNode.removeChild(l); }; })(liveByKey[k]));
    }
    for (var fkey in freshKeys) this._serverHeadKeys[fkey] = true;
    return {
      loads: loads,
      insertLinks: function() { for (var j = 0; j < links.length; j++) { var l = links[j]; if (l.after && l.after.parentNode === head) l.after.after(l.node); else head.appendChild(l.node); } links = []; },
      apply: function() { this.insertLinks(); for (var j = 0; j < ops.length; j++) ops[j](); },
    };
  };

  /** Style carriers + keyed metas; anything else in <head> is not reconciled. */
  IFrameBridge.prototype.headCarrierKey = function(el) {
    if (el.tagName === 'STYLE' && el.hasAttribute('data-vite-dev-id')) return 'style:' + el.getAttribute('data-vite-dev-id');
    // Our own inline viewer styles (SqComponentView's backdrop) carry a key too.
    if (el.tagName === 'STYLE' && el.hasAttribute('data-sq-head')) return 'style:sq:' + el.getAttribute('data-sq-head');
    if (el.tagName === 'LINK' && (el.getAttribute('rel') || '').toLowerCase() === 'stylesheet') return 'link:' + this.hmrHref(el.getAttribute('href') || '');
    if (el.tagName === 'META') {
      var n = el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('http-equiv');
      return n ? 'meta:' + n : null;
    }
    return null;
  };

  /**
   * Every stylesheet <link> to the project's own sources — in <head> OR in the
   * body (the component master view renders them there) — is re-fetched after
   * a refresh. Its URL never changes while its CONTENT does (Tailwind
   * regenerates on every source edit), so a kept link goes stale and, loaded
   * after the fresh styles, outranks newer rules: a padding set to 0 at xl kept
   * rendering the old sm:px-6 (owner 2026-10-06, measured in the canvas). The
   * stamped copy loads next to the old one; the old is removed once it loaded
   * (no unstyled flash). One refresh per link at a time.
   */
  IFrameBridge.prototype.refreshProjectCssLinks = function() {
    var self = this;
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"]'), function(old) {
      if (old._sqCssRefreshing || !self.isProjectCssLink(old)) return;
      old._sqCssRefreshing = true;
      var fresh = old.cloneNode(false);
      fresh.setAttribute('href', self.hmrHref(old.getAttribute('href') || '', String(Date.now())));
      var settle = function() { clearTimeout(timer); if (old.parentNode) old.parentNode.removeChild(old); };
      var timer = setTimeout(settle, 5000);
      fresh.addEventListener('load', settle, { once: true });
      fresh.addEventListener('error', settle, { once: true });
      old.after(fresh);
    });
  };

  /** A stylesheet link served from this instance's own project sources. */
  IFrameBridge.prototype.isProjectCssLink = function(link) {
    try { var u = new URL(link.getAttribute('href') || '', location.href); return u.origin === location.origin && u.pathname.indexOf('/src/') === 0; }
    catch (e) { return false; }
  };

  /** The href with the t stamp set (stamp given) or removed (none): path + query, same-origin. */
  IFrameBridge.prototype.hmrHref = function(href, stamp) {
    try {
      var u = new URL(href, location.href);
      if (stamp) u.searchParams.set('t', stamp); else u.searchParams.delete('t');
      return u.pathname + u.search;
    } catch (e) { return href; }
  };


  /** The head style carriers the server rendered at load (see installSourceRefresh). */
  IFrameBridge.prototype.recordServerHead = function(doc) {
    var els = doc.head ? doc.head.children : [];
    for (var i = 0; i < els.length; i++) { var k = this.headCarrierKey(els[i]); if (k) this._serverHeadKeys[k] = true; }
  };

  IFrameBridge.prototype.sameIsland = function(x, y) {
    var attrs = ['component-url', 'renderer-url', 'props', 'client', 'component-export'];
    for (var i = 0; i < attrs.length; i++) if (x.getAttribute(attrs[i]) !== y.getAttribute(attrs[i])) return false;
    return true;
  };

  IFrameBridge.prototype.planAttrPatch = function(x, y, plan) {
    for (var i = 0; i < y.attributes.length; i++) {
      var at = y.attributes[i];
      if (SQ_EDITOR_ATTR.test(at.name)) continue;
      // Our own ?t= stamp on a refreshed project stylesheet is the same link.
      if (x.tagName === 'LINK' && at.name === 'href' && this.hmrHref(x.getAttribute('href') || '') === this.hmrHref(at.value)) continue;
      // instant-edit P0b: a held class is not the file's to overwrite until the file carries it (dom-updates.ts);
      // the verification of a settled hold happens here too, whether or not the fresh class differs.
      if (at.name === 'class' || at.name === 'style') {
        var held = this.classHoldFor(x);
        if (held && at.name === 'class' && this.holdSkipsClassPatch(held, at.value)) continue;
        if (held && at.name === 'style' && held.inlineBg) continue;   // the bg-image inline fallback
      }
      if (x.getAttribute(at.name) !== at.value) {
        // Our self-cleaning animation classes (sq-ai-*) are not the server's: same
        // class otherwise = no patch, so a refresh never cuts a dissolve short.
        if (at.name === 'class' && sqClassWithoutAI(x.getAttribute('class')) === sqClassWithoutAI(at.value)) continue;
        plan.push((function(el, n, v) { return function() { el.setAttribute(n, v); }; })(x, at.name, at.value));
        if (!SQ_NOT_A_CHANGE.test(at.name)) this.morphTouch(x);   // A2
      }
    }
    // The element moved in its file (a line added above it): the key the scan
    // derived from the OLD location goes, so the rescan stamps the new one —
    // else a click selects by the stale line (live 2026-10-10: the date <p>
    // read as the <h3> above it after a backdrop note added a line).
    var oldSrc = x.getAttribute('data-sq-source'), newSrc = y.getAttribute('data-sq-source'), key = x.getAttribute('data-key');
    // Same for an untracked node that gains a source (a predicted ⌘D copy): its
    // \`dynamic:\` stand-in key would otherwise win the rescan and route edits away.
    var moved = oldSrc && newSrc && oldSrc !== newSrc && key && (key === oldSrc || key.indexOf(oldSrc + '#') === 0 || key.indexOf(oldSrc + '~') === 0);
    if (moved || (!oldSrc && newSrc && key && key.indexOf('dynamic:') === 0)) {
      plan.push((function(el) { return function() { el.removeAttribute('data-key'); }; })(x));
    }
    for (var j = x.attributes.length - 1; j >= 0; j--) {
      var name = x.attributes[j].name;
      if (!y.hasAttribute(name) && !SQ_EDITOR_ATTR.test(name)) {
        if (name === 'class' || name === 'style') {
          var heldGone = this.classHoldFor(x);
          if (heldGone && name === 'class' && this.holdSkipsClassPatch(heldGone, '')) continue;
          if (heldGone && name === 'style' && heldGone.inlineBg) continue;
        }
        plan.push((function(el, n) { return function() { el.removeAttribute(n); }; })(x, name));
        // An empty style/class (left by an editor animation's cleanup) shows nothing.
        if (!SQ_NOT_A_CHANGE.test(name) && !((name === 'style' || name === 'class') && !(x.getAttribute(name) || '').trim())) this.morphTouch(x);
      }
    }
  };

  /** D2: keys are positional. During an edit, patch only when the new HTML
   *  provably holds the SAME element: identical key AND identical version.
   *  Then position = identity (the file is unchanged up to that element). */
  IFrameBridge.prototype.refreshBlockedByEdit = function(next) {
    var el = this.editingElement;
    if (!el) return false;
    var src = el.getAttribute('data-sq-source');
    if (!src) return true;
    var want = [src, el.getAttribute('data-sq-source-version') || '', el.getAttribute('data-sq-placement') || '', el.getAttribute('data-sq-usage') || ''];
    var all = next.querySelectorAll('[data-sq-source]');
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (c.getAttribute('data-sq-source') === want[0] && (c.getAttribute('data-sq-source-version') || '') === want[1]
          && (c.getAttribute('data-sq-placement') || '') === want[2] && (c.getAttribute('data-sq-usage') || '') === want[3]) return false;
    }
    return true;
  };

  /** Edit exit: run a refresh that was deferred, and hold the just-typed text
   *  until the served file carries it — the commit write is still in flight,
   *  and patching the old file text back would flash it.
   *  ponytail: 10 s cap; a failed commit then shows the file text (files are truth). */
  IFrameBridge.prototype.onEditExitedForRefresh = function(element, changed, original) {
    if (element && changed) this._heldEdit = { el: element, until: Date.now() + 10000, original: original == null ? null : String(original),
      version: element.getAttribute('data-sq-source-version') || '' };
    if (!this._refreshDeferred) return;
    this._refreshDeferred = false;
    this.requestSourceRefresh();
  };

  IFrameBridge.prototype.isHeldEdit = function(live, fresh) {
    var held = this._heldEdit;
    if (!held || held.el !== live) return false;
    // Keys are positional: hold only while the fresh node is provably the
    // element that was edited — the file is unchanged (same version) or it
    // still renders the text the edit started from (the commit has not landed).
    // Anything else is another element on a reused key (a reorder) or a newer
    // truth: release (desktop 2026-10-04: typed text painted onto 'Hello post').
    var same = (fresh.getAttribute('data-sq-source-version') || '') === held.version
      || (held.original !== null && fresh.textContent === held.original);
    if (live.textContent !== fresh.textContent && Date.now() < held.until && same) return true;
    this._heldEdit = null;
    return false;
  };

  /** Nodes the bridge injected into <body> (drag ghost, placeholders, highlights, AI preview). */
  IFrameBridge.prototype.isEditorNode = function(n) {
    return n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')
      || n.hasAttribute('data-sq-selection-highlight')
      || n.hasAttribute('data-sq-ai-preview') || n.hasAttribute('data-sq-ai-highlight') || n === this._aiHighlightOverlay
      || n === this.selectionHighlightElement);
  };

  /** A fresh load starts these empty; a refresh must too, or a reused key
   *  inherits another element's baseline. The edited element keeps its own. */
  IFrameBridge.prototype.resetDocumentKeyCaches = function() {
    var el = this.editingElement;
    var keep = el ? (el.getAttribute('data-key') || el.getAttribute('data-sq-source')) : null;
    var pick = function(map, extra) {
      var out = {}; if (keep && map && map[keep] !== undefined) out[keep] = map[keep];
      for (var h = 0; extra && h < extra.length; h++) if (map && map[extra[h]] !== undefined) out[extra[h]] = map[extra[h]];
      return out;
    };
    // A held key keeps its undo baseline too: the next apply would otherwise capture the HELD value as the baseline.
    this.originalClassesByKey = pick(this.originalClassesByKey, Object.keys(this._classHoldByKey));
    this.originalTextByKey = pick(this.originalTextByKey);
    this.originalImageAttrsByKey = pick(this.originalImageAttrsByKey);
    this.originalMarkupByKey = pick(this.originalMarkupByKey);
    this._preAppliedFileClasses = {};
    this._scannedLayouts = null;
    this._gridProbeCache = null;
  };

  /** D4: the #sq-ov overrides, same function the pre-paint path uses. */
  IFrameBridge.prototype.reapplyLocalOverridesNow = function() {
    if (!window.__SQ_LOCAL_MODE__) return;
    var overrides = null;
    try { var h = location.hash || ''; if (h.indexOf('#sq-ov=') === 0) overrides = JSON.parse(decodeURIComponent(h.slice(7))); } catch (e) { overrides = null; }
    if (!overrides || typeof overrides !== 'object') return;
    var counts = {}, seen = new WeakSet();
    var tagged = document.querySelectorAll('[data-sq-source]');
    for (var i = 0; i < tagged.length; i++) this.applyLocalOverrideTo(tagged[i], overrides, counts, seen);
  };

  /** Layer 1 boundary: never lose typed text, then let the document go — as a same-origin
   *  REPLACE, never a reload: a reload is not eligible for the paint-hold view transition
   *  (sq-source-plugin armLocalRuntimeHtml), and without it Chromium shows one blank frame
   *  between the new document's commit and first paint (A4/A5, log-proven 2026-11-10). */
  IFrameBridge.prototype.documentBoundary = function(reason) {
    try { this.flushTextDraft(); } catch (e) {}
    // A reload restored the scroll; the replace starts at the top: carry it (preview mode).
    try { if (window.scrollX || window.scrollY) sessionStorage.setItem('sq-b-scroll', JSON.stringify([location.pathname, window.scrollX, window.scrollY])); } catch (e) {}
    console.info('[sq] document boundary:', reason);
    location.replace(this.boundaryUrl(location.href));
  };

  /** A new URL even when only the #sq-ov fragment would differ (that would be a same-document
   *  fragment navigation, not a new document); installSourceRefresh drops sq-b again. */
  IFrameBridge.prototype.boundaryUrl = function(href) {
    var url = new URL(href);
    url.searchParams.set('${SQ_BOUNDARY_PARAM}', String(Date.now()));
    return url.href;
  };

  /** Like a reload's scroll restoration: re-apply every frame while the page grows, until it
   *  holds on a loaded page, the user scrolls, or ~10 s. */
  IFrameBridge.prototype.restoreBoundaryScroll = function(x, y) {
    var stopped = false, frames = 0;
    var stop = function() { stopped = true; };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function(t) { window.addEventListener(t, stop, { once: true, capture: true, passive: true }); });
    var pin = function() {
      if (stopped) return;
      window.scrollTo(x, y);
      var held = Math.abs(window.scrollX - x) < 1 && Math.abs(window.scrollY - y) < 1;
      if ((!held || document.readyState !== 'complete') && ++frames < 600) requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
  };

`;
