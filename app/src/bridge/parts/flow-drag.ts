/**
 * Bridge Part: Flow Drag Manager
 *
 * Canvas drag within the iframe: a live-slot reorder among siblings and a
 * drop-line reparent into another container (container detection included).
 */
export const BRIDGE_FLOW_DRAG = `
  var BLOCK_CONTAINERS = new Set([
    'div', 'section', 'article', 'nav', 'header', 'footer',
    'main', 'aside', 'form', 'ul', 'ol', 'li', 'table', 'td', 'th',
    'details', 'dialog', 'fieldset', 'figure', 'figcaption'
  ]);

  function isInstanceChildKey(key) {
    if (!key || key.includes('/')) return false;
    var colonIdx = key.lastIndexOf(':');
    if (colonIdx <= 0) return false;
    var selector = key.slice(colonIdx + 1);
    return /^[a-z][a-z0-9]*-\\d+$/i.test(selector);
  }

  // A grid with ONE column is a stack: its children reorder like any stack's.
  // Pinning a row there (col-start-1 row-start-3 on the base layer) follows the
  // card to every wider breakpoint and strands it on a row of its own.
  function isStackGrid(style) {
    return /^[\\d.]+px$/.test((style.gridTemplateColumns || '').trim());
  }

  function keyOf(el) {
    return el.getAttribute('data-key') || el.getAttribute('data-sq-source');
  }

  function FlowDragManager(bridge) {
    this._bridge = bridge;
    this._state = null;
    this._containers = null;
    this._currentTarget = null;
    this._reparentTarget = null;
  }

  /** A look-alike copy that is pure drag chrome: no keys or ids (never found,
   *  scanned or selected), islands flattened to their SSR markup so cloning
   *  never hydrates a component twice. */
  FlowDragManager.prototype._inertClone = function(el) {
    var copy = el.cloneNode(true);
    var all = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    for (var i = 0; i < all.length; i++) {
      all[i].removeAttribute('data-key');
      all[i].removeAttribute('data-sq-source');
      all[i].removeAttribute('id');
    }
    var islands = copy.querySelectorAll('astro-island');
    for (var j = 0; j < islands.length; j++) {
      var flat = document.createElement('div');
      flat.innerHTML = islands[j].innerHTML;
      islands[j].parentNode.replaceChild(flat, islands[j]);
    }
    copy.setAttribute('data-drag-ghost', 'true');
    return copy;
  };

  FlowDragManager.prototype._createGhost = function(el, rect) {
    var ghost = this._inertClone(el);
    ghost.style.position = 'fixed';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.opacity = '0.6';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '99999';
    ghost.style.margin = '0';
    ghost.style.transition = 'none';
    document.body.appendChild(ghost);
    return ghost;
  };

  FlowDragManager.prototype._detectAxis = function(parentElement, style) {
    var parentStyle = style || window.getComputedStyle(parentElement);
    var display = parentStyle.display;

    // Grid: use grid-auto-flow to determine primary axis
    if (display === 'grid' || display === 'inline-grid') {
      if (isStackGrid(parentStyle)) return 'vertical';
      var autoFlow = parentStyle.gridAutoFlow || 'row';
      return autoFlow.indexOf('column') !== -1 ? 'vertical' : 'horizontal';
    }

    var isHorizontal = display === 'flex' || display === 'inline-flex';
    if (isHorizontal) {
      var direction = parentStyle.flexDirection;
      if (direction === 'column' || direction === 'column-reverse') {
        isHorizontal = false;
      }
    }
    return isHorizontal ? 'horizontal' : 'vertical';
  };

  /** Insert target from [{el, rect}] entries — the ONE insert-position rule
   *  (reorder passes cached rects; reparent maps live rects). */
  FlowDragManager.prototype._findInsertTarget = function(entries, cursorX, cursorY, axis) {
    var edges = axis === 'horizontal' ? ['left', 'right'] : ['top', 'bottom'];
    for (var i = 0; i < entries.length; i++) {
      var edge = getClosestEdge(entries[i].rect, cursorX, cursorY, edges);
      if (axis === 'horizontal' ? edge === 'left' : edge === 'top') {
        return entries[i].el;
      }
    }
    return null;
  };

  FlowDragManager.prototype.handleStart = function(payload) {
    if (!payload || !payload.key) return;

    var el = this._bridge.findElementByKey(payload.key);
    if (!el) return;
    var parentElement = el.parentElement;
    if (!parentElement) return;

    var parentStyle = window.getComputedStyle(parentElement);
    var gridParent = parentStyle.display === 'grid' || parentStyle.display === 'inline-grid';
    var isGrid = gridParent && !isStackGrid(parentStyle);
    // The host assumes cell placement for a grid child: tell it this one reorders.
    if (gridParent && !isGrid) this._bridge.sendToParent({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'flow' } });

    var rect = el.getBoundingClientRect();
    var parentRect = parentElement.getBoundingClientRect();
    var ghost = this._createGhost(el, rect);
    var axis = this._detectAxis(parentElement);

    // Owner UX 2026-11-11 (flexbox-style, reverses the 2026-11-08 drop line
    // for same-parent drags): a ghost follows the cursor, a dimmed copy of
    // the element holds its slot and moves LIVE between the siblings — top
    // half of a hovered sibling = slot above it, bottom half = below. The
    // real element stays hidden at its original spot (scans keep the true
    // order); handleEnd commits ONE insertBefore into the slot.
    el.style.opacity = '0.3';
    el.style.pointerEvents = 'none';

    this._state = {
      key: payload.key,
      element: el,
      ghost: ghost,
      ghostOffsetX: payload.iframeX - rect.left,
      ghostOffsetY: payload.iframeY - rect.top,
      parentElement: parentElement,
      axis: axis,
      isGrid: isGrid,
      siblingRects: null, // re-measured after every slot move (siblings shift)
      placeholder: null, // the dimmed copy holding the reorder slot
      // Measured now: once the slot copy is in, the hidden element measures 0.
      dragSize: isGrid ? 0 : rect[axis === 'vertical' ? 'width' : 'height'],
      originalParentRect: { left: parentRect.left, top: parentRect.top, right: parentRect.right, bottom: parentRect.bottom },
      startX: payload.iframeX,
      startY: payload.iframeY,
      mode: 'reorder',
    };
  };

  /** The insertion line for a drop into ANOTHER container (same-parent
   *  reorder moves a live slot instead), position:fixed above the page. entries = [{el, rect}] in order;
   *  the line sits between targetRef (null = end) and the entry before it. */
  FlowDragManager.prototype._showDropLine = function(box, axis, entries, targetRef) {
    var line = this._dropLine;
    if (!line) {
      line = this._dropLine = document.createElement('div');
      line.setAttribute('data-sq-drop-line', 'true');
      line.style.position = 'fixed';
      line.style.zIndex = '99998';
      line.style.pointerEvents = 'none';
      line.style.background = '#3b82f6';
      line.style.borderRadius = '1px';
      document.body.appendChild(line);
    }
    var at = entries.length;
    for (var i = 0; i < entries.length; i++) if (entries[i].el === targetRef) { at = i; break; }
    var next = entries[at] ? entries[at].rect : null, prev = at > 0 ? entries[at - 1].rect : null;
    var horizontal = axis === 'horizontal';
    var lo = horizontal ? 'left' : 'top', hi = horizontal ? 'right' : 'bottom';
    var pos = next && prev ? (prev[hi] + next[lo]) / 2 : next ? next[lo] - 1 : prev ? prev[hi] + 1 : box[lo];
    line.style.left = (horizontal ? pos - 1 : box.left) + 'px';
    line.style.top = (horizontal ? box.top : pos - 1) + 'px';
    line.style.width = (horizontal ? 2 : box.right - box.left) + 'px';
    line.style.height = (horizontal ? box.bottom - box.top : 2) + 'px';
    line.style.display = '';
  };

  /** The next real sibling (drag chrome and the hidden dragged element
   *  skipped); null when last. */
  FlowDragManager.prototype._nextSibling = function(el) {
    var n = el.nextElementSibling;
    while (n && (this._bridge.isEditorNode(n) || n === this._state.element)) n = n.nextElementSibling;
    return n;
  };

  /** Reorder slot: a dimmed inert copy in the flow; the real element hides. */
  FlowDragManager.prototype._ensurePlaceholder = function() {
    var state = this._state;
    if (state.placeholder) return state.placeholder;
    var ph = this._inertClone(state.element);
    ph.style.opacity = '0.3';
    ph.style.pointerEvents = 'none';
    ph.style.display = '';
    state.parentElement.insertBefore(ph, state.element);
    state.element.style.display = 'none';
    state.placeholder = ph;
    state.siblingRects = null;
    this._containers = null;
    return ph;
  };

  /** Drop the slot copy and show the real element at its original spot. */
  FlowDragManager.prototype._clearPlaceholder = function() {
    var state = this._state;
    if (!state || !state.placeholder) return;
    if (state.placeholder.parentNode) state.placeholder.parentNode.removeChild(state.placeholder);
    state.placeholder = null;
    state.element.style.display = '';
    state.siblingRects = null;
    this._containers = null;
  };

  /** A container's real children with their rects (drag chrome and the
   *  dragged element skipped). */
  FlowDragManager.prototype._childEntries = function(parent) {
    var entries = [];
    for (var i = 0; i < parent.children.length; i++) {
      var kid = parent.children[i];
      if (kid === this._state.element || this._bridge.isEditorNode(kid)) continue;
      entries.push({ el: kid, rect: kid.getBoundingClientRect() });
    }
    return entries;
  };

  /** Move the slot to the pointer: before the first sibling whose nearer
   *  edge (along the stack) is its leading one. Rects are re-read after a
   *  move, so a hovered sibling that slid away is judged where it now is. */
  FlowDragManager.prototype._reorderMove = function(x, y) {
    var state = this._state;
    var ph = this._ensurePlaceholder();
    if (!state.siblingRects) state.siblingRects = this._childEntries(state.parentElement);
    var targetRef = this._findInsertTarget(state.siblingRects, x, y, state.axis);
    if (targetRef === this._nextSibling(ph)) return;
    state.parentElement.insertBefore(ph, targetRef);
    state.siblingRects = null;
    this._containers = null;
  };

  FlowDragManager.prototype._cleanupIndicators = function() {
    if (this._dropLine && this._dropLine.parentNode) this._dropLine.parentNode.removeChild(this._dropLine);
    this._dropLine = null;
    var lit = document.querySelectorAll('[data-reparent-highlight]');
    for (var i = 0; i < lit.length; i++) {
      lit[i].style.outline = '';
      lit[i].removeAttribute('data-reparent-highlight');
    }
    this._lastInsertRef = undefined;
  };


  FlowDragManager.prototype._teardown = function() {
    if (!this._state) return;
    this._clearPlaceholder();
    if (this._state.ghost && this._state.ghost.parentNode) {
      this._state.ghost.parentNode.removeChild(this._state.ghost);
    }
    this._state.element.style.opacity = '';
    this._state.element.style.pointerEvents = '';
    this._cleanupIndicators();
    this._state = null;
    this._containers = null;
    this._currentTarget = null;
    this._reparentTarget = null;
  };

  FlowDragManager.prototype.handleCancel = function() {
    if (!this._state) return;
    // The real element never moved — teardown drops the slot copy and the chrome.
    this._teardown();

    this._bridge.sendToParent({
      type: 'DRAG_ELEMENT_DROP',
      payload: { cancelled: true }
    });
  };

  FlowDragManager.prototype._scanContainers = function(){
    var state = this._state;
    if (!state) return [];

    // task-120 (5.2/C3): single DOM walk with depth tracked as we descend.
    // The dragged element and drag chrome subtrees are pruned outright. The
    // original parent is ALWAYS a target — even <body> or an untagged wrapper
    // (sections directly in <body> once snapped back: log-proven 2026-11-11).
    // Any other container must be larger than the dragged element across its
    // stack (width for a vertical stack, height for a row): a same-size
    // sibling section — or anything inside one — means "before/after it", not
    // "inside" (a sideways hand drift used to nest a section into its
    // neighbour, log-proven 2026-11-10). Ancestors always fit.
    // ponytail: size heuristic; a same-width wrapper is nested via Layers.
    var containers = [];
    var self = this;
    var dim = state.axis === 'vertical' ? 'width' : 'height';

    function walk(node, depth) {
      var kids = node.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        if (el === state.element || self._bridge.isEditorNode(el)) continue;
        var isParent = el === state.parentElement;
        var key = keyOf(el);
        if (isParent || (key && BLOCK_CONTAINERS.has(el.tagName.toLowerCase()) && !isInstanceChildKey(key))) {
          var style = window.getComputedStyle(el);
          var rect = el.getBoundingClientRect();
          if (isParent || (style.display !== 'none' &&
              (rect[dim] > state.dragSize + 1 || el.contains(state.element)))) {
            containers.push({ element: el, rect: rect, key: key, axis: self._detectAxis(el, style), depth: depth });
          }
        }
        walk(el, depth + 1);
      }
    }

    walk(document.documentElement, 0);
    return containers;
  };

  FlowDragManager.prototype._findDeepestContainer = function(x, y) {
    // Lazy: any layout change (a slot move) drops the cache.
    if (!this._containers) this._containers = this._scanContainers();

    var candidates = [];
    for (var i = 0; i < this._containers.length; i++) {
      var c = this._containers[i];
      if (x >= c.rect.left && x <= c.rect.right &&
          y >= c.rect.top  && y <= c.rect.bottom) {
        candidates.push(c);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort(function(a, b) { return b.depth - a.depth; });
    return candidates[0];
  };

  FlowDragManager.prototype._enterReparentMode = function() {
    var state = this._state;
    if (!state) return;

    // Leaving reorder drops the slot copy: the element is back in place.
    this._clearPlaceholder();
    this._containers = null;
    this._currentTarget = null;
    state.mode = 'reparent';
  };

  FlowDragManager.prototype._exitReparentMode = function() {
    this._cleanupIndicators();
    this._reparentTarget = null;
    this._containers = null;
    this._currentTarget = null;
    this._state.mode = 'reorder';
  };

  FlowDragManager.prototype._handleReparentMove = function(container, x, y) {

    // Clean up previous indicators if target changed
    if (container !== this._currentTarget) {
      this._cleanupIndicators();
      this._currentTarget = container;
      this._lastInsertRef = undefined;
    }

    if (!container) {
      // No container under the cursor — a stale target must not survive,
      // or the drop would land in whatever was hovered last.
      this._reparentTarget = null;
      return;
    }

    // Highlight container
    container.element.style.outline = '2px solid #3b82f6';
    container.element.setAttribute('data-reparent-highlight', 'true');

    // Find insertion position among container's children
    var entries = this._childEntries(container.element);
    var targetRef = this._findInsertTarget(entries, x, y, container.axis);
    var insertIndex = entries.length;
    for (var i = 0; i < entries.length; i++) if (entries[i].el === targetRef) { insertIndex = i; break; }

    // Update insertion info (used by handleEnd)
    this._reparentTarget = {
      containerKey: container.key,
      element: container.element,
      insertIndex: insertIndex,
    };

    // Skip redraws if insert position hasn't changed
    if (targetRef === this._lastInsertRef) return;
    this._lastInsertRef = targetRef;
    this._showDropLine(container.rect, container.axis, entries, targetRef);
  };




  FlowDragManager.prototype.handleMove = function(payload) {
    if (!this._state) return;

    var state = this._state;

    // Ghost follows cursor, or snaps to grid cell when applicable
    var snap = state.isGrid && state.mode === 'reorder' && payload.snapRect;
    if (snap) {
      state.ghost.style.left = payload.snapRect.left + 'px';
      state.ghost.style.top = payload.snapRect.top + 'px';
      state.ghost.style.width = payload.snapRect.width + 'px';
      state.ghost.style.height = payload.snapRect.height + 'px';
    } else {
      state.ghost.style.left = (payload.iframeX - state.ghostOffsetX) + 'px';
      state.ghost.style.top = (payload.iframeY - state.ghostOffsetY) + 'px';
    }

    // Has the cursor left the original parent's box?
    var parentRect = state.originalParentRect;
    var inParent = payload.iframeX >= parentRect.left && payload.iframeX <= parentRect.right &&
                   payload.iframeY >= parentRect.top  && payload.iframeY <= parentRect.bottom;

    if (state.isGrid) {
      // Grid children: containment-based, REVERSIBLE mode. No cross-axis flip —
      // horizontal cell-to-cell drags inside the grid must stay in reorder mode.
      if (!inParent && state.mode !== 'reparent') {
        this._enterReparentMode();
        this._bridge.sendToParent({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'reparent' } });
      } else if (inParent && state.mode === 'reparent') {
        this._exitReparentMode();
        this._bridge.sendToParent({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'grid' } });
      }
      if (state.mode === 'reparent') {
        this._handleReparentMove(this._findDeepestContainer(payload.iframeX, payload.iframeY), payload.iframeX, payload.iframeY);
      }
      return;
    }

    // Flow elements: a container OTHER than the original parent can take the
    // drop once the pointer leaves the parent or drifts across the stack
    // (full-width elements never leave their parent). Otherwise — and again
    // whenever the pointer comes back over the parent — it is a live reorder.
    var REPARENT_THRESHOLD = 50;
    var crossAxisDelta = state.axis === 'vertical'
      ? Math.abs(payload.iframeX - state.startX)
      : Math.abs(payload.iframeY - state.startY);
    var container = (!inParent || crossAxisDelta > REPARENT_THRESHOLD)
      ? this._findDeepestContainer(payload.iframeX, payload.iframeY)
      : null;

    if (container && container.element !== state.parentElement) {
      if (state.mode !== 'reparent') this._enterReparentMode();
      this._handleReparentMove(container, payload.iframeX, payload.iframeY);
      return;
    }
    if (state.mode === 'reparent') this._exitReparentMode();
    this._reorderMove(payload.iframeX, payload.iframeY);
  };

  FlowDragManager.prototype.handleEnd = function() {
    if (!this._state) return;

    var state = this._state;
    var reparent = this._reparentTarget;
    var dropPayload;

    if (state.mode === 'reparent' && reparent) {
      // Dropping back into the original parent is a plain reorder, not a reparent.
      var parentKey = keyOf(state.parentElement);
      var isDropBack = reparent.element === state.parentElement ||
                       (parentKey && reparent.containerKey === parentKey);
      dropPayload = {
        key: state.key,
        newParentKey: reparent.containerKey,
        insertIndex: reparent.insertIndex,
        cancelled: false,
        reparented: !isDropBack,
      };
    } else {
      // Commit the reorder NOW — the single real-element move of the whole
      // drag, into the slot the dimmed copy holds.
      if (state.placeholder && state.placeholder.parentNode === state.parentElement) {
        state.parentElement.insertBefore(state.element, state.placeholder);
      }
      this._clearPlaceholder();

      var self = this;
      var children = Array.prototype.slice.call(state.parentElement.children)
        .filter(function(child) { return !self._bridge.isEditorNode(child); });
      var insertIndex = Array.prototype.indexOf.call(children, state.element);
      if (insertIndex === -1) insertIndex = children.length;

      dropPayload = {
        key: state.key,
        newParentKey: keyOf(state.parentElement) || null,
        insertIndex: insertIndex,
        cancelled: false,
        reparented: false,
      };
    }

    this._teardown();
    this._bridge.sendToParent({ type: 'DRAG_ELEMENT_DROP', payload: dropPayload });
  };

  FlowDragManager.prototype.handleReenter = function() {
    if (!this._state) return;
    // The next move decides the mode (reorder over the parent, else reparent).
    if (this._state.ghost) {
      this._state.ghost.style.display = '';
    }
  };
`;
