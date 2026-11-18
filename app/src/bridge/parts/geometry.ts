/**
 * Bridge Part: Geometry & Layout
 *
 * Element rect queries, grid geometry detection,
 * content height reporting, and resize observation.
 */
export const BRIDGE_GEOMETRY = `
  /**
   * A page's Layout has no single DOM box. Its selection identity is the bare
   * layout-element id (e.g. "layoutchrome-p1") and its visual extent is the
   * UNION of its top-level chrome tags ([data-sq-chrome] keyed
   * "<layoutElementId>:<selector>"). Chrome nested inside other chrome (e.g. the
   * slot div inside <main>) is skipped so the union is just the outer frame.
   * Returns a rect ({top,left,width,height}) or null when the key isn't a
   * layout-element id / no chrome is present.
   */
  IFrameBridge.prototype.layoutUnionRect = function(key) {
    if (!key || key.indexOf(':') !== -1 || key.indexOf('layoutchrome-') !== 0) return null;
    var all = document.querySelectorAll('[data-sq-chrome][data-key^="' + key + ':"]');
    var top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    var anyMatch = false;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Top-level chrome only: skip chrome whose ancestor is also chrome.
      if (el.parentElement && el.parentElement.closest('[data-sq-chrome]')) continue;
      var r = el.getBoundingClientRect();
      anyMatch = true;
      if (r.left < left) left = r.left;
      if (r.top < top) top = r.top;
      if (r.right > right) right = r.right;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    if (!anyMatch) return null;
    return { top: top, left: left, width: right - left, height: bottom - top };
  };

  IFrameBridge.prototype.handleRequestElementRect = function(payload) {
    if (!payload || !payload.key) return;
    var element = this.findElementByKey(payload.key);
    var rect = element ? this.rectOf(element) : this.layoutUnionRect(payload.key);
    if (!rect) return;

    this.sendToParent({
      type: 'ELEMENT_RECT_RESPONSE',
      payload: {
        key: payload.key,
        rect: rect
      }
    });
  };

  /**
   * Report element rect update to parent after layout changes.
   * Schedules via requestAnimationFrame for accurate measurements.
   */
  IFrameBridge.prototype.reportRectUpdate = function(key, element) {
    var self = this;
    requestAnimationFrame(function() {
      self.sendToParent({
        type: 'RECT_UPDATED',
        payload: { key: key, rect: self.rectOf(element) }
      });
      self.reportContentHeight();
    });
  };

  IFrameBridge.prototype.handleSetElementStyle = function(payload) {
    if (!payload || !payload.key || !payload.styles) return;

    var cache = this._styleElementCache;
    var element;
    if (cache.key === payload.key && cache.element && cache.element.isConnected) {
      element = cache.element;
    } else {
      element = this.findElementByKey(payload.key);
      if (!element) return;
      cache.key = payload.key;
      cache.element = element;
    }

    var styles = payload.styles;
    for (var prop in styles) {
      if (styles.hasOwnProperty(prop)) {
        element.style[prop] = styles[prop];
      }
    }

    // During live resize the overlay tracks size directly -- skip the expensive
    // reportRectUpdate + reportContentHeight round-trip. The final commit
    // (without isLiveResize) still reports so the parent gets the settled rect.
    if (!payload.isLiveResize) {
      this.reportRectUpdate(payload.key, element);
    }
  };

  IFrameBridge.prototype.handleRequestGridGeometry = function(payload) {
    if (!payload || !payload.key) return;
    var element = this.findElementByKey(payload.key);
    if (!element) return;

    // Nearest grid ANCESTOR first — every host consumer looks the element up in
    // the response cells (resize cellInfo, drag isGridDrop, DesignBar Start+Span
    // fallback), so the grid the element PARTICIPATES IN wins. The element's own
    // grid is only a fallback for standalone grid containers; checking the
    // element first broke every lookup for grid-in-grid children (task-090).
    var gridContainer = null;
    var parent = element.parentElement;
    while (parent) {
      var pStyle = window.getComputedStyle(parent);
      if (pStyle.display === 'grid' || pStyle.display === 'inline-grid') { gridContainer = parent; break; }
      parent = parent.parentElement;
    }
    if (!gridContainer) {
      var elStyle = window.getComputedStyle(element);
      if (elStyle.display === 'grid' || elStyle.display === 'inline-grid') gridContainer = element;
    }
    if (!gridContainer) return;

    var style = window.getComputedStyle(gridContainer);
    var borderRect = gridContainer.getBoundingClientRect();
    // Use content box (after padding) since grid tracks are laid out inside padding
    var padTop = parseFloat(style.paddingTop) || 0;
    var padLeft = parseFloat(style.paddingLeft) || 0;
    var padRight = parseFloat(style.paddingRight) || 0;
    var padBottom = parseFloat(style.paddingBottom) || 0;
    var containerRect = {
      top: borderRect.top + padTop,
      left: borderRect.left + padLeft,
      width: borderRect.width - padLeft - padRight,
      height: borderRect.height - padTop - padBottom
    };

    // Parse resolved track sizes (e.g., "200px 100px 200px" → [200, 100, 200])
    var columns = style.gridTemplateColumns.split(/\\s+/).map(function(s) { return parseFloat(s); }).filter(function(n) { return !isNaN(n); });
    var rows = style.gridTemplateRows.split(/\\s+/).map(function(s) { return parseFloat(s); }).filter(function(n) { return !isNaN(n); });
    var columnGap = parseFloat(style.columnGap) || 0;
    var rowGap = parseFloat(style.rowGap) || 0;

    var explicitRowCount = rows.length;

    // An auto-placed child has no numeric start: its track is the one whose
    // START is nearest to its edge. A range test ("inside this track, +1px")
    // names the PREVIOUS track when the gap is under a pixel (the next track
    // starts where this one ends) and no track at all when the computed sizes
    // serialize rounded up — cards swapped with the wrong neighbour and two
    // landed in one cell (live 2026-11-12, a gapless ul). Twin of
    // nearestTrackStart in utils/gridGeometry.ts (bridge parts cannot import).
    var nearestTrack = function(position, tracks, gap) {
      var best = 0, bestDistance = Infinity, offset = 0;
      for (var t = 0; t < tracks.length; t++) {
        var distance = Math.abs(position - offset);
        if (distance < bestDistance) { bestDistance = distance; best = t; }
        offset += tracks[t] + gap;
      }
      return best;
    };

    // Build cells map from children
    var cells = [];
    var children = gridContainer.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var key = child.getAttribute('data-key') || child.getAttribute('data-sq-source');
      if (!key) continue;

      var childStyle = window.getComputedStyle(child);
      var colStartStr = childStyle.gridColumnStart;
      var colEndStr = childStyle.gridColumnEnd;
      var rowStartStr = childStyle.gridRowStart;
      var rowEndStr = childStyle.gridRowEnd;

      var colStart = parseInt(colStartStr, 10) || 0;
      var rowStart = parseInt(rowStartStr, 10) || 0;
      var colEnd = parseInt(colEndStr, 10) || 0;
      var rowEnd = parseInt(rowEndStr, 10) || 0;

      // Parse "span N" values from computed styles (e.g., col-span-6 → "span 6")
      var colSpanMatch = colEndStr.match(/span\\s+(\\d+)/) || colStartStr.match(/span\\s+(\\d+)/);
      var rowSpanMatch = rowEndStr.match(/span\\s+(\\d+)/) || rowStartStr.match(/span\\s+(\\d+)/);

      // Fallback: use bounding rect to determine position when CSS values are auto/0
      // Check col and row independently — one may be explicit while the other is auto
      var childRect = child.getBoundingClientRect();
      var relLeft = childRect.left - containerRect.left;
      var relTop = childRect.top - containerRect.top;

      if (isNaN(colStart) || colStart === 0) colStart = nearestTrack(relLeft, columns, columnGap) + 1;
      if (isNaN(rowStart) || rowStart === 0) rowStart = nearestTrack(relTop, rows, rowGap) + 1;

      // Determine span: prefer explicit "span N" from computed style, then end-start, then fallback to 1
      var colSpan = colSpanMatch ? parseInt(colSpanMatch[1], 10) : ((colEnd > colStart) ? colEnd - colStart : 1);
      var rowSpan = rowSpanMatch ? parseInt(rowSpanMatch[1], 10) : ((rowEnd > rowStart) ? rowEnd - rowStart : 1);

      cells.push({
        col: colStart - 1,  // 0-based
        row: rowStart - 1,  // 0-based
        colSpan: colSpan,
        rowSpan: rowSpan,
        key: key
      });
    }

    // ── Detect & measure implicit rows beyond the explicit grid ──
    // gridTemplateRows only reports explicit rows; implicit rows from
    // auto-placement or content overflow are missing.
    var maxRowFromCells = rows.length;
    for (var mri = 0; mri < cells.length; mri++) {
      var cellRowEnd = cells[mri].row + cells[mri].rowSpan;
      if (cellRowEnd > maxRowFromCells) maxRowFromCells = cellRowEnd;
    }
    var explicitRowsTotal = 0;
    for (var eri = 0; eri < rows.length; eri++) explicitRowsTotal += rows[eri];
    if (rows.length > 1) explicitRowsTotal += (rows.length - 1) * rowGap;

    if (maxRowFromCells > rows.length || containerRect.height > explicitRowsTotal + rowGap + 1) {
      // task-120 (4.4): the probe appends a node and forces a layout per
      // implicit row — cache the answer per container until the container's
      // measurable state changes (sig) or the DOM mutates / RENDER repaints
      // (cache cleared in handleRender + the mutation observer).
      var probeSig = containerRect.height + ':' + rows.join(',') + ':' + maxRowFromCells + ':' + rowGap;
      var probeHit = this._gridProbeCache && this._gridProbeCache.get(gridContainer);
      if (probeHit && probeHit.sig === probeSig) {
        rows = rows.concat(probeHit.extraRows);
      } else {
        var probe = document.createElement('div');
        probe.style.cssText = 'visibility:hidden;pointer-events:none;padding:0;margin:0;border:none;min-height:0;';
        probe.style.gridColumn = '1';
        gridContainer.appendChild(probe);

        var accounted = explicitRowsTotal;
        var pr = rows.length;
        var rowLimit = Math.max(maxRowFromCells, pr + 1);
        var extraRows = [];

        while ((pr < rowLimit || accounted < containerRect.height - 2) && pr < 50) {
          probe.style.gridRow = (pr + 1) + ' / ' + (pr + 2);
          var probeH = probe.getBoundingClientRect().height;
          if (probeH <= 0) break;
          rows.push(probeH);
          extraRows.push(probeH);
          accounted += rowGap + probeH;
          pr++;
        }

        gridContainer.removeChild(probe);
        if (!this._gridProbeCache) this._gridProbeCache = new WeakMap();
        this._gridProbeCache.set(gridContainer, { sig: probeSig, extraRows: extraRows });
      }
    }

    this.sendToParent({
      type: 'GRID_GEOMETRY_RESPONSE',
      payload: {
        containerRect: this.buildRect(containerRect),
        columns: columns,
        rows: rows,
        columnGap: columnGap,
        rowGap: rowGap,
        cells: cells,
        explicitRowCount: explicitRowCount
      }
    });
  };

  IFrameBridge.prototype.reportContentHeight = function() {
    var self = this;
    if (this._pendingHeightFrame != null) return;
    // task-146's law, and this is the second time it has bitten: Chrome FREEZES
    // requestAnimationFrame inside the local-mode cross-origin iframe, so an
    // rAF-gated report simply never fires there. Proven again 2026-08-09 by
    // instrumenting the parent: the post frame emitted IFRAME_READY,
    // ASSETS_OWNED and ELEMENTS_SCANNED but never CONTENT_HEIGHT, leaving the
    // post body pinned at its minimum height. No local-mode consumer existed
    // before the content editor, which is why it went unnoticed.
    //
    // A 0 ms timer coalesces exactly as well and is not frozen.
    if (typeof window !== 'undefined' && window.__SQ_LOCAL_MODE__) {
      this._pendingHeightFrame = setTimeout(function() {
        self._pendingHeightFrame = null;
        self._reportContentHeightNow();
      }, 0);
      return;
    }
    this._pendingHeightFrame = requestAnimationFrame(function() {
      self._pendingHeightFrame = null;
      self._reportContentHeightNow();
    });
  };

  IFrameBridge.prototype.startResizeObserver = function() {
    var self = this;
    var reportDebounce = null;

    // No scrollHeight gate here: scrollHeight is pinned to the (parent-sized)
    // viewport, so a gate on it can grow but NEVER shrink — direct-DOM
    // removals left a permanent white gap. reportContentHeight() is rAF
    // coalesced and measures the true content bottom, so delegating
    // unconditionally is both correct and cheap.
    var reportIfChanged = function() {
      self.reportContentHeight();
      // A body-size change means SOME element reflowed (image finished
      // loading, media grew, content inserted) — push fresh rects so the
      // parent's selection overlay follows the element instead of keeping
      // the box measured at scan time (stale-selection bug, 2026-08-11).
      self.sendRectsUpdate();
    };

    // Use ResizeObserver if available. LEADING-edge + trailing: the first
    // resize in a burst reports immediately (the selection overlay must
    // travel with the element, not ~100ms behind it); the trailing timer
    // catches the burst's final geometry. No rAF here — Chrome freezes rAF
    // in unfocused cross-origin iframes (task-146).
    if (typeof ResizeObserver !== 'undefined') {
      var lastLeadingReport = 0;
      var dirtySinceLeading = false;
      var resizeObserver = new ResizeObserver(function() {
        var now = Date.now();
        if (now - lastLeadingReport > 100) {
          lastLeadingReport = now;
          dirtySinceLeading = false;
          reportIfChanged();
          return; // a lone resize is fully reported — no duplicate trailing pass
        }
        dirtySinceLeading = true;
        if (reportDebounce) clearTimeout(reportDebounce);
        reportDebounce = setTimeout(function() {
          if (dirtySinceLeading) { dirtySinceLeading = false; reportIfChanged(); }
        }, 100);
      });

      resizeObserver.observe(document.body);
      if (document.documentElement) {
        resizeObserver.observe(document.documentElement);
      }
    } else {
      // Fallback: check periodically
      setInterval(reportIfChanged, 1000);
    }

    // task-132 local mode: the page scrolls INSIDE the fixed-viewport iframe,
    // so viewport-relative rects go stale on every scroll — push fresh ones
    // (RECTS_UPDATED also re-syncs the selection overlay parent-side).
    if (window.__SQ_LOCAL_MODE__) {
      var scrollDebounce = null;
      window.addEventListener('scroll', function() {
        if (scrollDebounce) clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(function() { self.sendRectsUpdate(); }, 80);
      }, { passive: true });
    }
  };

  /** Coalesce rect pushes from a burst of content mutations into one (next task;
   *  no rAF — frozen in unfocused cross-origin frames, task-146). */
  IFrameBridge.prototype.scheduleRectsUpdate = function() {
    var self = this;
    if (this._rectsTimer) return;
    this._rectsTimer = setTimeout(function() {
      self._rectsTimer = null;
      // A torn-down document (a test file's jsdom ending under this timer) has nothing to measure.
      if (typeof document !== 'undefined') self.sendRectsUpdate();
    }, 0);
  };

  /** When the layout changes (breakpoint switch, content resize, image load),
   *  send fresh element rects. [data-key] is complete here: the scan stamps
   *  it onto every element it reports, source-keyed ones included. */
  IFrameBridge.prototype.sendRectsUpdate = function() {
    var self = this;
    var elements = document.querySelectorAll('[data-key]');
    var rects = [];

    elements.forEach(function(el) {
      var key = el.getAttribute('data-key');
      if (key) {
        rects.push({
          key: key,
          rect: self.rectOf(el)
        });
      }
    });

    if (rects.length > 0) {
      self.sendToParent({
        type: 'RECTS_UPDATED',
        payload: { rects: rects }
      });
    }
  };

  IFrameBridge.prototype.startResizeListener = function() {
    var self = this;
    var resizeDebounce = null;
    var layoutViewportWidth = window.innerWidth;

    window.addEventListener('resize', function() {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(function() {
        self.sendRectsUpdate();
        self.reportContentHeight();
        // Breakpoint CSS can change layout without changing classes. A height
        // report can resize this iframe again, so do not rescan on height alone.
        if (layoutViewportWidth !== window.innerWidth) {
          layoutViewportWidth = window.innerWidth;
          self.scanElements();
        }
      }, 50);
    });
  };
`;
