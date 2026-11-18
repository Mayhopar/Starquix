// app/src/bridge/parts/streamPreview.ts
/**
 * IFrameBridge Part: live AI stream preview (STREAM_PREVIEW → throwaway DOM).
 * Renders partial tool-call HTML/text while the model streams. NEVER touches
 * persisted state — pure DOM, removed on STREAM_PREVIEW_END (held until the
 * commit's RENDER), SET_PAGE, watchdog, or reload.
 *
 * Height contract: the container is a body child, so it inflates the measured
 * content height. Every render AND the post-removal cleanup MUST call
 * reportContentHeight() — RENDER measures during the fade and the
 * ResizeObserver path cannot shrink the frame (scrollHeight is held up by the
 * tall viewport), so a missing re-report leaves a permanent white gap.
 */

export const BRIDGE_STREAM_PREVIEW = `

  IFrameBridge.prototype._sqPreviewSanitize = function(root) {
    var scripts = root.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) scripts[i].remove();
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      for (var k = el.attributes.length - 1; k >= 0; k--) {
        var a = el.attributes[k];
        var name = a.name.toLowerCase();
        var url = a.value.replace(/\\s/g, '').toLowerCase();
        if (name.indexOf('on') === 0 ||
            name === 'data-key' || name === 'data-sq-source' || name === 'data-with-props' ||
            ((name === 'href' || name === 'src') && (url.indexOf('javascript:') === 0 || url.indexOf('vbscript:') === 0))) {
          el.removeAttribute(a.name);
        }
      }
    }
  };

  // Shared style block — section/text/busy paints can each be the first to
  // need it (a text-only or busy-only stream never creates the container).
  IFrameBridge.prototype._sqPreviewEnsureStyle = function() {
    if (document.getElementById('sq-ai-preview-style')) return;
    var st = document.createElement('style');
    st.id = 'sq-ai-preview-style';
    st.textContent =
      // Flat activity fill (Rectangle 50). Hue knob: --sq-ai-hue "r, g, b".
      // Ring + fill are drawn by the PARENT (AIGlowRings) — see _sqReportPreviewRect.
      '[data-sq-ai-preview]{box-sizing:border-box}' +
      // Streamed elements are REAL content dissolving in: 0 opacity + blur → sharp.
      '.sq-ai-new{animation:sq-in 0.5s ease-out both}' +
      '@keyframes sq-in{from{opacity:0;filter:blur(10px)}to{opacity:1;filter:blur(0)}}' +
      '[data-sq-ai-typing]::after{content:"";display:inline-block;width:2px;height:1em;' +
      'background:rgba(var(--sq-ai-hue,95,170,255),0.9);vertical-align:text-bottom;margin-left:1px;' +
      'animation:sq-caret 0.8s step-end infinite}' +
      '@keyframes sq-caret{50%{opacity:0}}' +
      // Busy pulse: class-only edit in flight on this element.
      '[data-sq-ai-busy]{animation:sq-busy 1.2s ease-in-out infinite}' +
      '@keyframes sq-busy{50%{opacity:0.55}}' +
      '@media (prefers-reduced-motion: reduce){.sq-ai-new,[data-sq-ai-busy]{animation:none}}';
    document.head.appendChild(st);
  };

  // Watchdog: if END never arrives (dropped relay, mid-run reload), no preview
  // artifact — container, caret, busy pulse — may squat on the canvas forever.
  // Every paint of every mode re-arms it.
  IFrameBridge.prototype._sqArmPreviewWatchdog = function() {
    var self = this;
    if (this._sqPreviewWatchdog) clearTimeout(this._sqPreviewWatchdog);
    this._sqPreviewWatchdog = setTimeout(function() {
      self.handleStreamPreviewEnd();
    }, 8000);
  };

  IFrameBridge.prototype.handleStreamPreview = function(payload) {
    if (!payload || !payload.mode) return;
    this._sqArmPreviewWatchdog();

    if (payload.mode === 'busy') {
      var busyTarget = this.findElementByKey(payload.targetKey);
      if (!busyTarget) return; // stale key — executor's normal failure path informs the model
      this._sqPreviewEnsureStyle();
      busyTarget.setAttribute('data-sq-ai-busy', 'true');
      return;
    }

    if (payload.mode === 'text') {
      var target = this.findElementByKey(payload.targetKey);
      if (!target) return; // stale key — executor's normal failure path informs the model
      this._sqPreviewEnsureStyle();
      // Save the original ONCE so the no-commit paths (watchdog, SET_PAGE,
      // cancel) can restore instead of baking truncated text into the DOM.
      if (!target.hasAttribute('data-sq-ai-orig')) {
        target.setAttribute('data-sq-ai-orig', target.textContent || '');
      }
      target.removeAttribute('data-sq-ai-busy'); // busy → text upgrade
      target.setAttribute('data-sq-ai-typing', 'true');
      target.textContent = payload.partial;
      return;
    }

    // section mode
    // A new stream while removal is pending (back-to-back tool calls) reuses
    // the live container — no disappear/reappear flicker between sections.
    if (this._sqPreviewEndPending) {
      this._sqPreviewEndPending = false;
      if (this._sqPreviewFallback) { clearTimeout(this._sqPreviewFallback); this._sqPreviewFallback = null; }
    }
    var c = document.querySelector('[data-sq-ai-preview]');
    var content;
    if (!c) {
      // Fresh container = fresh dissolve counter. A counter surviving a
      // finalize-without-END (SET_PAGE, watchdog) suppressed the dissolve-in
      // for the next stream's first N elements.
      this._sqPreviewCount = 0;
      c = document.createElement('div');
      c.setAttribute('data-sq-ai-preview', 'true');
      c.style.pointerEvents = 'none';
      c.style.position = 'relative';
      c.style.transition = 'opacity 300ms ease';

      content = document.createElement('div');
      content.setAttribute('data-sq-ai-preview-content', 'true');
      c.appendChild(content);

      document.body.appendChild(c);
      this._sqPreviewEnsureStyle();
    } else {
      content = c.querySelector('[data-sq-ai-preview-content]');
    }
    content.innerHTML = payload.partial; // innerHTML never executes scripts; handlers stripped below
    this._sqPreviewSanitize(content);

    // Progressive build: elements past the previous render's count are NEW —
    // pop them in with a stagger so growth is visible element by element.
    // ponytail: document-order index works because streamed markup only
    // appends; a rewriting model would re-animate a few tail elements, fine.
    var els = content.querySelectorAll('*');
    var prevCount = this._sqPreviewCount || 0;
    for (var n = prevCount; n < els.length; n++) {
      els[n].classList.add('sq-ai-new');
      els[n].style.animationDelay = Math.min((n - prevCount) * 70, 630) + 'ms';
    }
    this._sqPreviewCount = els.length;

    this.reportContentHeight(); // grow the frame live so the preview is on screen
    this._sqReportPreviewRect(c);
  };

  // The streaming container's ring is drawn by the canvas, exactly like the
  // section rings: it paints outside its own box, and the container spans the
  // full page width, so an in-iframe ring loses both side strokes to the frame
  // edge. Re-reported on every paint — the container grows as content streams.
  // null = preview gone, clear it.
  IFrameBridge.prototype._sqReportPreviewRect = function(c) {
    var r = c && c.getBoundingClientRect();
    var rect = r && r.height ? this.buildRect(r) : null;
    // Text growing inside an already-sized container reports the same box every
    // paint (paints are throttled to 10/s, and each one re-renders ViewportFrame
    // in the parent) — only send when the box actually moved.
    var last = this._sqLastPreviewRect;
    if (last === undefined ? rect === null : JSON.stringify(last) === JSON.stringify(rect)) return;
    this._sqLastPreviewRect = rect;
    this.sendToParent({ type: 'AI_PREVIEW_RECT', payload: { rect: rect } });
  };

  // Render handshake (flashes DID show up live): END only marks removal as
  // pending — the container is held until the committed content's RENDER
  // applies, so the swap is a same-frame replace instead of
  // fade → blank gap → appear. Fallback timer covers a RENDER that never comes.
  IFrameBridge.prototype.handleStreamPreviewEnd = function(payload) {
    var self = this;
    this._sqPreviewCount = 0;
    if (this._sqPreviewWatchdog) { clearTimeout(this._sqPreviewWatchdog); this._sqPreviewWatchdog = null; }
    var typing = document.querySelectorAll('[data-sq-ai-typing]');
    for (var i = 0; i < typing.length; i++) typing[i].removeAttribute('data-sq-ai-typing');
    var busy = document.querySelectorAll('[data-sq-ai-busy]');
    for (var b = 0; b < busy.length; b++) busy[b].removeAttribute('data-sq-ai-busy');
    var origs = document.querySelectorAll('[data-sq-ai-orig]');
    for (var o = 0; o < origs.length; o++) {
      // Cancelled run: no commit will follow — put the original text back.
      // Normal END: keep the streamed text (the commit overwrites it moments
      // later); restoring here would flash the old text.
      if (payload && payload.cancelled) origs[o].textContent = origs[o].getAttribute('data-sq-ai-orig');
      origs[o].removeAttribute('data-sq-ai-orig');
    }
    if (!document.querySelector('[data-sq-ai-preview]')) return;
    this._sqPreviewEndPending = true;
    if (this._sqPreviewFallback) clearTimeout(this._sqPreviewFallback);
    this._sqPreviewFallback = setTimeout(function() { self._sqPreviewFinalize('fallback-2s'); }, 2000);
  };

  // Actual removal — called by the END fallback (the commit is a file write → HMR),
  // or handleSetPage (page switch must not leak the container). Full cleanup:
  // every timer and the dissolve counter die with the container.
  IFrameBridge.prototype._sqPreviewFinalize = function(trigger) {
    this._sqPreviewEndPending = false;
    this._sqPreviewCount = 0;
    if (this._sqPreviewFallback) { clearTimeout(this._sqPreviewFallback); this._sqPreviewFallback = null; }
    if (this._sqPreviewWatchdog) { clearTimeout(this._sqPreviewWatchdog); this._sqPreviewWatchdog = null; }
    // No-commit path (watchdog fallback, SET_PAGE): restore original text so a
    // cancelled stream doesn't bake truncated text into the DOM.
    var origs = document.querySelectorAll('[data-sq-ai-orig]');
    for (var o = 0; o < origs.length; o++) {
      origs[o].textContent = origs[o].getAttribute('data-sq-ai-orig');
      origs[o].removeAttribute('data-sq-ai-orig');
    }
    var typing = document.querySelectorAll('[data-sq-ai-typing]');
    for (var t = 0; t < typing.length; t++) typing[t].removeAttribute('data-sq-ai-typing');
    var busy = document.querySelectorAll('[data-sq-ai-busy]');
    for (var b = 0; b < busy.length; b++) busy[b].removeAttribute('data-sq-ai-busy');
    var c = document.querySelector('[data-sq-ai-preview]');
    if (!c) return;
    if (c.parentNode) c.parentNode.removeChild(c);
    this._sqReportPreviewRect(null);
    this.reportContentHeight(); // shrink the frame back — see height contract above
  };
`;
