/**
 * Bridge Part: Utilities
 *
 * Element lookup, key parsing, source location extraction,
 * computed styles, and image thumbnail helpers.
 */
export const BRIDGE_UTILS = `
  /** Extract { top, left, width, height } from a DOMRect. */

  /**
   * Bounding rect of an element, falling back to the union of its direct
   * children's rects when the element itself has zero size (e.g.
   * \`display: contents\`, used by BlogSlot's named \`<slot>\`).
   */

  function getClosestEdge(rect, cursorX, cursorY, allowedEdges) {
    var distances = {
      top:    Math.abs(cursorY - rect.top),
      bottom: Math.abs((rect.top + rect.height) - cursorY),
      left:   Math.abs(cursorX - rect.left),
      right:  Math.abs((rect.left + rect.width) - cursorX)
    };
    var closest = null, minDist = Infinity;
    for (var i = 0; i < allowedEdges.length; i++) {
      if (distances[allowedEdges[i]] < minDist) {
        minDist = distances[allowedEdges[i]];
        closest = allowedEdges[i];
      }
    }
    return closest;
  }

  /** Force GPU layer recomposition to ensure repaint after class changes. */

  /** Resolve the relative source path from an astro-source-file attribute. */

  IFrameBridge.prototype.getElementClasses = function(element) {
    if (element.className && typeof element.className === 'string') {
      return element.className;
    }
    if (element.className && element.className.baseVal !== undefined) {
      return element.className.baseVal;
    }
    return element.getAttribute('class') || '';
  };

  /**
   * task-149 — placement identity (LOCAL MODE ONLY).
   *
   * \`data-sq-source\` is the DEFINING file:line:col, so it is identical on every
   * page that renders the same component and on every repeat of it. The tagger
   * (\`sq-tagging.js\`, armed with \`{ placements: true }\` by the local-mode
   * plugin) additionally stamps \`data-sq-placement\` = a hash of the authored
   * component INVOCATION chain. Composing the two gives local mode the
   * per-placement identity server/WC mode get from the doc's \`el-…\` ids.
   *
   * Resolution order: own \`data-sq-placement\` → own \`data-sq-p\` (present when a
   * component spreads \`{...Astro.props}\` onto its root) → nearest ancestor
   * carrying \`data-sq-placement\`. An EMPTY \`data-sq-placement\` is a real answer,
   * not a miss: page files emit it to terminate the walk.
   *
   * Gated on window.__SQ_LOCAL_MODE__ (set by sq-source-plugin's HTML
   * injection) so WC/server keys stay byte-identical by construction and the
   * extra DOM walk never runs there.
   */
  IFrameBridge.prototype.resolvePlacement = function(element) {
    if (!window.__SQ_LOCAL_MODE__) return '';
    if (!element || !element.getAttribute) return '';
    var own = element.getAttribute('data-sq-placement');
    if (own !== null) return own;
    var propAttr = element.getAttribute('data-sq-p');
    // task-160: \`data-sq-p\` carries the TRIPLE "<s-id> <q-id> <p-id>" — the
    // stamped id first, then the two transitional chains in recency order.
    if (propAttr !== null) return propAttr.split(' ')[0] || '';
    var ancestor = element.closest ? element.closest('[data-sq-placement]') : null;
    return ancestor ? (ancestor.getAttribute('data-sq-placement') || '') : '';
  };

  /**
   * task-159/160 — the SAME resolution over a TRANSITIONAL chain, so a scan can
   * name the addresses an override may have been stored under before the
   * identity scheme changed. Two of them now, because a user's outstanding work
   * can predate EITHER change:
   *
   *   \`data-sq-lq\` (field 1) — task-159's ordinal chain
   *   \`data-sq-lp\` (field 2) — the pre-task-159 coordinate chain
   *
   * Field 1 could NOT simply be redefined as "the previous address": under
   * eager stamping the stamp lands before the first scan ever runs, so a
   * pre-task-159 \`p…\` key would never see a \`p\` field and would strand.
   *
   * Mirrors \`resolvePlacement\` exactly, including the rule that an EMPTY value
   * is a real answer (a page file's own elements terminate the walk). Both
   * chains are pure subtraction once one full usage cycle has passed.
   */
  IFrameBridge.prototype.resolveTransitionalPlacement = function(element, attr, field) {
    if (!window.__SQ_LOCAL_MODE__) return '';
    if (!element || !element.getAttribute) return '';
    var own = element.getAttribute(attr);
    if (own !== null) return own;
    var propAttr = element.getAttribute('data-sq-p');
    if (propAttr !== null) return propAttr.split(' ')[field] || '';
    var ancestor = element.closest ? element.closest('[' + attr + ']') : null;
    return ancestor ? (ancestor.getAttribute(attr) || '') : '';
  };

  /** task-159's ordinal chain. */
  IFrameBridge.prototype.resolveOrdinalPlacement = function(element) {
    return this.resolveTransitionalPlacement(element, 'data-sq-lq', 1);
  };

  /** The pre-task-159 coordinate chain. */
  IFrameBridge.prototype.resolveLegacyPlacement = function(element) {
    return this.resolveTransitionalPlacement(element, 'data-sq-lp', 2);
  };

  /** Append the placement segment to a bare \`file:line:col\` source key. */
  IFrameBridge.prototype.withPlacement = function(sourceKey, element) {
    var placement = this.resolvePlacement(element);
    return placement ? sourceKey + '~' + placement : sourceKey;
  };

  /**
   * The same key under every transitional chain, MOST RECENT FIRST, with
   * empties and duplicates dropped. The parent walks this in order and takes
   * the first tier that has a stored value, so p→s and q→s each migrate in ONE
   * hop — never a transitive replay through an intermediate address.
   */
  IFrameBridge.prototype.legacyKeysFor = function(sourceKey, element) {
    var out = [];
    var chains = [this.resolveOrdinalPlacement(element), this.resolveLegacyPlacement(element)];
    for (var i = 0; i < chains.length; i++) {
      if (!chains[i]) continue;
      var key = sourceKey + '~' + chains[i];
      if (out.indexOf(key) === -1) out.push(key);
    }
    return out;
  };

  IFrameBridge.prototype.findElementByKey = function(key) {
    if (!key || typeof key !== 'string') return null;

    // Escape key for safe use in CSS selector
    var escapedKey = this.escapeCssSelector(key);

    // Direct lookup by data-key
    var element = document.querySelector('[data-key="' + escapedKey + '"]');
    if (element) return element;

    // Try data-sq-source for backwards compatibility.
    // task-149: a placement-scoped key (\`…:4:1~p<16 hex>\`) never matches a raw
    // data-sq-source attribute, so this fallback simply misses — which is the
    // SAFE outcome. Matching would return an arbitrary sibling placement. The
    // data-key lookup above already covers scanned elements.
    element = document.querySelector('[data-sq-source="' + escapedKey + '"]');
    if (element) return element;

    // Try data-astro-source-file + data-astro-source-loc combo
    // Keys from Astro look like: "src/pages/file.astro:7:27"
    var lastColon = key.lastIndexOf(':');
    if (lastColon > 0) {
      var secondLastColon = key.lastIndexOf(':', lastColon - 1);
      if (secondLastColon > 0) {
        var filePart = key.substring(0, secondLastColon);
        var loc = key.substring(secondLastColon + 1); // "7:27"
        var allAstro = document.querySelectorAll('[data-astro-source-file]');
        for (var a = 0; a < allAstro.length; a++) {
          var el = allAstro[a];
          var file = el.getAttribute('data-astro-source-file');
          var elLoc = el.getAttribute('data-astro-source-loc');
          if (!file || !elLoc) continue;
          var srcIdx = file.indexOf('/src/');
          var rel = srcIdx !== -1 ? file.substring(srcIdx + 1) : file;
          if (rel === filePart && elLoc === loc) {
            // Cache by setting data-key for future lookups
            el.setAttribute('data-key', key);
            return el;
          }
        }
      }
    }

    return null;
  };

  IFrameBridge.prototype.getElementKey = function(element) {
    // Return existing key if present
    var key = element.getAttribute('data-key');
    if (key) return key;

    // For source-tracked elements, build source key. node_modules internals
    // (e.g. astro's own Image.astro renders the <img> and forwards attrs)
    // never get source keys — they fall through to dynamic keys.
    var astroFile = element.getAttribute('data-astro-source-file');
    var astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc && astroFile.indexOf('node_modules') === -1) {
      var srcIndex = astroFile.indexOf('/src/');
      if (srcIndex !== -1) {
        // task-149: same placement composition as resolveSourceKey — this
        // fallback must not hand back an unscoped key for an element the scan
        // would have scoped.
        var sourceKey = this.withPlacement(astroFile.substring(srcIndex + 1) + ':' + astroLoc, element);
        element.setAttribute('data-key', sourceKey);
        return sourceKey;
      }
    }

    // Fallback: generate dynamic key (must be globally unique)
    var tagName = element.tagName.toLowerCase();
    var id = element.id;
    var dynamicKey = 'dynamic:' + tagName;
    if (id) {
      dynamicKey += '#' + id;
    }

    var parent = element.parentElement;
    if (parent) {
      var siblings = Array.from(parent.children);
      var index = siblings.indexOf(element);
      dynamicKey += ':' + index;

      // Include parent's key hash to ensure global uniqueness
      var parentKey = parent.getAttribute('data-key');
      if (parentKey) {
        var parentHash = parentKey.split('').reduce(function(a, b) {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0);
        dynamicKey += '@' + Math.abs(parentHash).toString(36);
      }
    }

    element.setAttribute('data-key', dynamicKey);
    return dynamicKey;
  };

  /**
   * \`<file>:<line>:<col>\` -> { file, line, column }, or undefined.
   *
   * ONE parser for BOTH \`data-sq-source\` and task-148's \`data-sq-usage\`: the
   * usage attribute is deliberately emitted in the source-key grammar so a
   * component's invocation tag is an ORDINARY source location, handled by every
   * existing writer, scope guard and undo op with no special case.
   *
   * The file is rejoined from the head parts, never \`parts[0]\` — a Windows-ish
   * or colon-bearing path must not be truncated into a different file.
   */
  IFrameBridge.prototype.parseLocationString = function(value) {
    if (!value) return undefined;
    var parts = value.split(':');
    if (parts.length < 3) return undefined;
    var column = parseInt(parts.pop(), 10);
    var line = parseInt(parts.pop(), 10);
    var file = parts.join(':');
    if (isNaN(line) || isNaN(column) || !file) return undefined;
    return { file: file, line: line, column: column };
  };

  /**
   * task-148 item 7 — WHERE THIS ELEMENT'S COMPONENT WAS PLACED.
   *
   * \`data-sq-usage\` is field 3 of \`data-sq-p\`, carried RAW by the tagger: the
   * \`file:line:col\` of the \`<Card />\` invocation tag in the file that placed it.
   * It is what "remove this component from THIS page" has to write to, and it is
   * the only address for it that is not derived (no ordinal, no hash inversion,
   * no DOM order) — the compiler hands it over.
   *
   * Read from the element's OWN attribute only, never \`closest()\`. The
   * ancestor walk that \`resolvePlacement\` needs would be a BUG here: it crosses
   * component boundaries and would answer with the wrong file. An element with
   * no usage of its own has none — fail closed, and the caller refuses.
   *
   * An EMPTY value is a real answer (a page file's own elements emit \`""\`), and
   * it parses to undefined, which is exactly the "no usage" the caller wants.
   *
   * Gated on __SQ_LOCAL_MODE__ so WC/server scans stay byte-identical.
   */
  IFrameBridge.prototype.parseUsageLocation = function(element) {
    if (!window.__SQ_LOCAL_MODE__) return undefined;
    if (!element || !element.getAttribute) return undefined;
    var own = element.getAttribute('data-sq-usage');
    var version = element.getAttribute('data-sq-usage-version');
    if (own === null) {
      var propAttr = element.getAttribute('data-sq-p');
      // Field 3 is LAST and read with slice().join(' '), never [3]: a
      // project-relative path may contain spaces and the delimiter is a space.
      var fields = (propAttr || '').split('\\t');
      own = fields[0].split(' ').slice(3).join(' ');
      version = fields[1];
    }
    var location = this.parseLocationString(own);
    if (location && version) location.sourceVersion = version;
    return location;
  };

  /**
   * task-207: is this scanned element part of an sq/ SYSTEM component?
   *
   * The rehype pass wraps EVERY component invocation in a post body (D8 probe),
   * so the wrapper alone cannot tell ours from the user's own SingleImage —
   * the source path is what decides. \`data-sq-unit\` short-circuits it for
   * Media, whose root declares one.
   *
   * Walks from the element up to (and including) the wrapper looking for the
   * nearest \`data-sq-source\`: an inner element with no source of its own still
   * belongs to whichever component encloses it.
   */
  IFrameBridge.prototype.isSystemComponentElement = function(element, wrapper) {
    if (!wrapper) return false;
    // The block belongs to whatever component the wrapper's own root is. A
    // system component used INSIDE another component (a <Credit/> inside a
    // <CreditWrapper/>) would otherwise splice the OUTER invocation, and
    // setProp matches the first such attribute anywhere in that block — i.e. an
    // arbitrary nested tag. Refuse instead: no stamp, no panel, nothing written.
    // Found by verifying task-207 on the real post route, not by reasoning.
    var root = wrapper.firstElementChild;
    if (!root) return false;

    // A root that declares data-sq-unit (Media) is a system root by definition,
    // even when it carries no data-sq-source of its own.
    if (root.getAttribute && root.getAttribute('data-sq-unit') !== null) {
      return !element.closest || root.contains(element) || root === element;
    }

    var own = this.nearestComponentFile(element, wrapper);
    if (!own || own.indexOf('src/components/sq/') !== 0) return false;
    return this.nearestComponentFile(root, wrapper) === own;
  };

  /** Nearest \`data-sq-source\` FILE at or above \`element\`, stopping at
   *  \`wrapper\`. \`data-sq-unit\` marks a system root whose own source wins. */
  IFrameBridge.prototype.nearestComponentFile = function(element, wrapper) {
    var node = element;
    while (node && node.getAttribute) {
      var src = node.getAttribute('data-sq-source');
      if (src) return src.replace(/:\\d+:\\d+$/, '');
      if (node === wrapper) break;
      node = node.parentElement;
    }
    return null;
  };

  IFrameBridge.prototype.parseSourceLocation = function(element) {
    var sourceAttr = element.getAttribute('data-sq-source');
    if (sourceAttr) {
      var fromSource = this.parseLocationString(sourceAttr);
      if (fromSource) {
        var version = element.getAttribute('data-sq-source-version');
        if (version && window.__SQ_LOCAL_MODE__) fromSource.sourceVersion = version;
        return fromSource;
      }
    }

    // node_modules internals must NEVER become a write target — a tag swap
    // once rewrote astro's own Image.astro (its <img> forwards attrs, so it
    // looked source-tracked) and broke every image on the site. Absolute
    // paths without /src/ are equally unwritable — refuse both.
    var astroFile = element.getAttribute('data-astro-source-file');
    var astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc && astroFile.indexOf('node_modules') === -1) {
      var locParts = astroLoc.split(':');
      var line = parseInt(locParts[0], 10);
      var column = parseInt(locParts[1], 10);
      if (!isNaN(line) && !isNaN(column)) {
        var srcIndex = astroFile.indexOf('/src/');
        if (srcIndex !== -1) {
          return { file: astroFile.substring(srcIndex + 1), line: line, column: column };
        }
      }
    }

    return undefined;
  };

  // The layout's <body> when it is a scanned element (scanning.ts bodyHead:
  // data-sq-source under src/layouts/) — the Layers panel's Layout row. Null
  // for a page-file body, which the scan never lists either.
  IFrameBridge.prototype.layoutRootBody = function() {
    var body = document.body;
    var src = body && body.getAttribute('data-sq-source');
    return src && src.indexOf('src/layouts/') === 0 ? body : null;
  };

  IFrameBridge.prototype.findEditableElement = function(target, forSelection, directSelect) {
    if (!target) return null;

    if (target.nodeType !== 1) target = target.parentElement;
    if (!target) return null;
    // A click on <body> / <html> selects the LAYOUT ROOT (owner report
    // 2026-09-10: bare body area was dead to the mouse). Same predicate the
    // scan uses for its body row, so the key is one the parent knows.
    if (target === document.body || target === document.documentElement) return this.layoutRootBody();

    // task-206 D4: a click inside a SELECTION UNIT (an element carrying
    // data-sq-unit — system components' roots, e.g. <Media/>) selects the
    // unit, never the outermost post root the walk below would return.
    // ⌘-click (directSelect) keeps innermost for power users.
    if (forSelection && !directSelect && target.closest) {
      var unitRoot = target.closest('[data-sq-unit]');
      if (unitRoot) return unitRoot;
    }

    var editableAncestors = [];
    var allAncestors = [];
    var current = target;
    while (current && current !== document.documentElement) {
      if (current === document.body) {
        // OUTSIDE → INSIDE (owner ruling 2026-09-11): the layout <body> is the
        // outermost editable ancestor, so the first click on a page selects
        // the Layout; a double-click drills into it (handleDrillDown sets it as
        // the context and the context loop below returns its child).
        if (this.layoutRootBody()) editableAncestors.push(current);
        break;
      }
      var tagName = current.tagName.toLowerCase();
      if (tagName !== 'script' && tagName !== 'style' && tagName !== 'noscript') {
        allAncestors.push(current);
      }

      if (this.isTrackedElement(current)) {
        editableAncestors.push(current);
      }
      current = current.parentElement;
    }

    if (editableAncestors.length === 0) {
      if (allAncestors.length > 0) {
        return allAncestors[0];
      }
      return null;
    }

    if (!forSelection || directSelect) {
      return editableAncestors[0];
    }

    if (this.contextKey) {
      var contextElement = this.findElementByKey(this.contextKey);
      if (contextElement) {
        for (var i = 0; i < editableAncestors.length; i++) {
          var el = editableAncestors[i];
          var parent = this.findEditableElement(el.parentElement, false);
          if (parent && this.getElementKey(parent) === this.contextKey) {
            return el;
          }
          if (el === contextElement) {
            return el;
          }
        }
        if (contextElement.contains(target)) {
          return editableAncestors[0];
        }
      }
    }

    // Return the outermost ancestor, but skip the infrastructure container
    // (the Astro page wrapper with [pageId].astro in its key)
    for (var j = editableAncestors.length - 1; j >= 0; j--) {
      var ancestorKey = this.getElementKey(editableAncestors[j]);
      if (!ancestorKey || !ancestorKey.includes('[pageId].astro')) {
        return editableAncestors[j];
      }
    }
    // Fallback: return innermost if all ancestors are infrastructure
    return editableAncestors[0];
  };

  IFrameBridge.prototype.getComputedStyles = function(element) {
    var computed = window.getComputedStyle(element);
    return {
      display: computed.display,
      boxSizing: computed.boxSizing,
      maxWidth: computed.maxWidth,
      objectFit: computed.objectFit,
      objectPosition: computed.objectPosition,
      borderTopWidth: computed.borderTopWidth,
      borderRightWidth: computed.borderRightWidth,
      borderBottomWidth: computed.borderBottomWidth,
      borderLeftWidth: computed.borderLeftWidth,
      parentDisplay: element.parentElement ? window.getComputedStyle(element.parentElement).display : '',
      imageFillOwned: element.getAttribute('data-sq-image-fill') === 'true',
      imageFillInlineBackground: !!element.style.backgroundImage,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontFamily: computed.fontFamily,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
      color: computed.color,
      width: computed.width,
      height: computed.height,
      paddingTop: computed.paddingTop,
      paddingRight: computed.paddingRight,
      paddingBottom: computed.paddingBottom,
      paddingLeft: computed.paddingLeft,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage
    };
  };

  IFrameBridge.prototype._makeThumbnail = function(imgElement, maxWidth) {
    maxWidth = maxWidth || 200;
    try {
      var scale = Math.min(1, maxWidth / imgElement.naturalWidth);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(imgElement.naturalWidth * scale);
      canvas.height = Math.round(imgElement.naturalHeight * scale);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      return null;
    }
  };

  IFrameBridge.prototype.captureAndSendBgImagePreview = function(element, key) {
    var computed = window.getComputedStyle(element);
    if (!computed.backgroundImage || computed.backgroundImage === 'none') return;
    var bgMatch = computed.backgroundImage.match(/url\\(["']?(.+?)["']?\\)/);
    if (!bgMatch) return;

    var self = this;
    var url = bgMatch[1];

    // task-120 (5.5): thumbnail capture (Image load + canvas encode) cached
    // per (key, resolved URL) — repeat clicks/refreshes on the same element
    // resend the cached data URL instead of re-capturing.
    this._bgThumbCache = this._bgThumbCache || {};
    var cacheKey = key + '\\u0000' + url;
    var cached = this._bgThumbCache[cacheKey];
    if (cached) {
      this.sendToParent({
        type: 'BG_IMAGE_PREVIEW',
        payload: { key: key, dataUrl: cached }
      });
      return;
    }

    // Try without crossOrigin first (same-origin in iframe), fall back to crossOrigin
    function attempt(useCors) {
      var bgImg = new Image();
      if (useCors) bgImg.crossOrigin = 'anonymous';
      bgImg.onload = function() {
        var dataUrl = self._makeThumbnail(bgImg);
        if (dataUrl) {
          self._bgThumbCache[cacheKey] = dataUrl;
          self.sendToParent({
            type: 'BG_IMAGE_PREVIEW',
            payload: { key: key, dataUrl: dataUrl }
          });
        } else if (!useCors) {
          // Tainted canvas from non-CORS load -- retry with CORS
          attempt(true);
        }
      };
      bgImg.onerror = function() {
        // CORS load failed -- retry without if we haven't tried that yet
        if (useCors) attempt(false);
      };
      bgImg.src = url;
    }
    attempt(false);
  };

IFrameBridge.prototype.escapeCssSelector = function(str) {
    if (!str || typeof str !== 'string') return '';
    // Use CSS.escape if available, otherwise manual escape
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(str);
    }
    // Manual escape for browsers without CSS.escape
    return str.replace(/["\\\\/:[\\](){}|^$.*+?]/g, '\\\\$&');
  };

IFrameBridge.prototype.escapeHtmlAttr = function(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

IFrameBridge.prototype.rectOf = function(element) {
    var rect = element.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return this.buildRect(rect);
    if (!element.children || element.children.length === 0) return this.buildRect(rect);
    var top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    var anyMatch = false;
    for (var i = 0; i < element.children.length; i++) {
      var cr = element.children[i].getBoundingClientRect();
      if (cr.width === 0 && cr.height === 0) continue;
      anyMatch = true;
      if (cr.top < top) top = cr.top;
      if (cr.left < left) left = cr.left;
      if (cr.right > right) right = cr.right;
      if (cr.bottom > bottom) bottom = cr.bottom;
    }
    return anyMatch
      ? { top: top, left: left, width: right - left, height: bottom - top }
      : this.buildRect(rect);
  };

IFrameBridge.prototype.buildRect = function(domRect) {
    return {
      top: domRect.top,
      left: domRect.left,
      width: domRect.width,
      height: domRect.height
    };
  };

IFrameBridge.prototype.requireElement = function(key, warnMsg) {
    var element = this.findElementByKey(key);
    if (!element && warnMsg) {
      console.warn('[IFrameBridge] ' + warnMsg + ':', key);
    }
    return element;
  };

// task-240: files-truth blog CHROME the source stamps like any element but
  // that is ours, not the user's — the per-card post-link wrapper a bound page
  // emits (<a href data-sq-post-slug><BlogCard/></a>, utils/blogBinding) and
  // BlogSlot.astro's pagination container. Scanned as elements they were a
  // page-file row between the posts container and the BlogCard root (the drill
  // stopped on it: pencil, but no ↗/⋮ — those need a component-file placement
  // ROOT) and a 0×0 "div" row with pagination off. Transparent everywhere:
  // never a row, never a click/drill stop; children nest under the next
  // tracked ancestor. The wrapper's slug still reaches the card through
  // closest('[data-sq-post-slug]').
  IFrameBridge.prototype.isBlogChrome = function(element) {
    return element.hasAttribute('data-sq-post-slug') ||
           element.getAttribute('data-blog-source') === 'pagination';
  };

  IFrameBridge.prototype.isTrackedElement = function(element) {
    if (this.isBlogChrome(element)) return false;
    return element.hasAttribute('data-key') ||
           element.hasAttribute('data-sq-source') ||
           element.hasAttribute('data-astro-source-file');
  };

IFrameBridge.prototype.isInstanceChildKey = function(key) {
    if (!key || typeof key !== 'string') return false;
    // Instance-child keys have format: instanceId:tagname-index
    // The selector part (after last colon) should match tagname-number pattern
    var colonIdx = key.lastIndexOf(':');
    if (colonIdx <= 0) return false;
    var selector = key.substring(colonIdx + 1);
    return /^[a-z][a-z0-9]*-\\d+$/i.test(selector);
  };

IFrameBridge.prototype.findParentKey = function(element, excludeKey) {
    var parent = element.parentElement;
    // Layout-element paradigm (2026-08-24): the walk INCLUDES document.body —
    // a layout-owned body is a scanned element (data-key stamped first in the
    // scan pass) and children must nest under it. A keyless body returns null
    // exactly as the old body-excluding walk did.
    while (parent && parent !== document.documentElement) {
      var key = parent.getAttribute('data-key');
      if (key && key !== excludeKey) {
        return key;
      }
      parent = parent.parentElement;
    }
    return null;
  };

IFrameBridge.prototype.findAncestorWithInstanceChildKey = function(element) {
    var current = element.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      var key = current.getAttribute('data-key');
      if (key && this.isInstanceChildKey(key)) {
        return { element: current, key: key };
      }
      current = current.parentElement;
    }
    return null;
  };

IFrameBridge.prototype.getParentDisplay = function(element) {
    if (!element.parentElement) return null;
    return window.getComputedStyle(element.parentElement).display;
  };

IFrameBridge.prototype.findRootSection = function(element) {
    var current = element;
    var root = element;
    while (current && current !== document.body && current !== document.documentElement) {
      // #sq-components is the editor shell wrapper — it carries a
      // data-sq-source of the preview shell .astro, but it is NEVER a
      // content section. Without this boundary every element "rooted" to the
      // whole page (one page-sized AI stroke instead of per-section).
      if (current.id === 'sq-components') break;
      var key = current.getAttribute('data-key') || current.getAttribute('data-sq-source');
      if (key) {
        root = current;
      }
      current = current.parentElement;
    }
    return root;
  };

IFrameBridge.prototype.hasBlockChildren = function(element) {
    var children = element.querySelectorAll('[data-key], [data-sq-source]');
    for (var i = 0; i < children.length; i++) {
      var childTag = children[i].tagName.toLowerCase();
      if (INLINE_TEXT_TAGS.indexOf(childTag) === -1) {
        return true;
      }
    }
    return element.children.length > 0 && element.querySelector(BLOCK_ELEMENT_SELECTOR) !== null;
  };

IFrameBridge.prototype.getPostSlug = function(element) {
    if (!element || !element.closest) return null;
    var el = element.nodeType === 1 ? element : element.parentElement;
    if (!el) return null;
    var slugEl = el.closest('[data-sq-post-slug]');
    return slugEl ? slugEl.getAttribute('data-sq-post-slug') : null;
  };

/** task-142/143: astro <Image> output — decode the dev /_image?href=/@fs… URL
 *  to the real bound asset under src/. These imgs carry NO data-sq-source
 *  (their render is attributed to node_modules/astro — never emitted), so the
 *  underlying asset path is the only editable handle. Shared by the click
 *  payload AND the scan so Layers-selected imgs classify identically. */
IFrameBridge.prototype.decodeBoundAssetPath = function(element) {
    if (element.getAttribute('data-image-component') !== 'true') return null;
    var rawImgSrc = element.getAttribute('src') || '';
    if (rawImgSrc.indexOf('/_image?') !== 0) return null;
    try {
      var boundHref = new URL(rawImgSrc, window.location.origin).searchParams.get('href') || '';
      if (boundHref.indexOf('/@fs') === 0) {
        var boundFsPath = boundHref.slice(4).split('?')[0];
        if (boundFsPath.indexOf('/node_modules/') === -1) return boundFsPath;
      }
    } catch (imgUrlErr) { /* malformed URL — no handle */ }
    return null;
  };

/** task-143: position of an astro-<Image> img among such imgs WITHIN ITS
 *  OWNING COMPONENT'S subtree — the component-default-image write maps it to
 *  the nth image tag in that component's source. Scope = the OUTERMOST
 *  ancestor tagged with the owner file (an inner tagged div would give every
 *  img index 0); no component owner → whole document (component view of a
 *  page-level img). Nested sub-components inside the owner can still shift
 *  the index — per-tag static components only. */
IFrameBridge.prototype.imageComponentIndexOf = function(element) {
    if (element.getAttribute('data-image-component') !== 'true') return -1;
    var ownerFile = this.resolveOwnerComponentFile(element);
    var scope = null;
    if (ownerFile) {
      var cur = element.closest ? element.closest('[data-sq-source]') : null;
      while (cur) {
        if ((cur.getAttribute('data-sq-source') || '').split(':')[0] === ownerFile) scope = cur;
        cur = cur.parentElement ? cur.parentElement.closest('[data-sq-source]') : null;
      }
    }
    var all = (scope || document).querySelectorAll('img[data-image-component="true"]');
    for (var ii = 0; ii < all.length; ii++) { if (all[ii] === element) return ii; }
    return -1;
  };

/** task-142/143: img with no source location (prop-driven astro <Image>) —
 *  the OWNING component's file (nearest tagged component/layout ancestor),
 *  so the panel can offer "Edit component" / the usage picker. */
IFrameBridge.prototype.resolveOwnerComponentFile = function(element) {
    var ownerEl = element.closest ? element.closest('[data-sq-source]') : null;
    if (!ownerEl) return null;
    var ownerSrc = ownerEl.getAttribute('data-sq-source') || '';
    var ownerFile = ownerSrc.split(':')[0];
    if (ownerFile.indexOf('src/components/') === 0 || ownerFile.indexOf('src/layouts/') === 0) {
      return ownerFile;
    }
    return null;
  };

/** Read-only navigation evidence for a card, never a write target: a bound
 *  card's link is its page's <a data-sq-post-slug> wrapper (transparent
 *  chrome), an imported card's are the links in its own <article>. */
IFrameBridge.prototype.getPostLinkPaths = function(element) {
    if (!element || !element.closest) return [];
    var wrapper = element.closest('a[data-sq-post-slug]');
    var article = wrapper ? null : element.closest('article');
    var links = wrapper ? [wrapper] : article ? article.querySelectorAll('a[href]') : [];
    var paths = [];
    for (var i = 0; i < links.length; i++) {
      if (article && links[i].closest('article') !== article) continue;
      var href = links[i].getAttribute('href');
      if (!href || !href.trim() || href.trim().charAt(0) === '#') continue;
      try {
        var url = new URL(href, document.baseURI);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== window.location.origin) continue;
        if (paths.indexOf(url.pathname) === -1) paths.push(url.pathname);
      } catch (err) { /* Invalid links supply no post identity. */ }
    }
    return paths;
  };

/** The link an element is or sits inside: its own, never one it merely holds or
 *  a click landed near. No link: linkBlocked if an <a> cannot go around it. */
IFrameBridge.prototype.linkAttributesOf = function(element) {
    var link = element.closest('a[href]');
    if (!link) {
      // HTML: an <a> holds no interactive content; a wrapper breaks table and document structure.
      var cannotHold = 'a,button,input,select,textarea,label,iframe,embed,details';
      var cannotWrap = 'html,body,tr,td,th,thead,tbody,tfoot,caption,colgroup,col,option,summary';
      return element.matches(cannotHold + ',' + cannotWrap) || element.querySelector(cannotHold) ? { linkBlocked: true } : null;
    }
    return {
      // A bound card's wrapper has no key: the binding writes it, the panel only follows it.
      linkKey: link.hasAttribute('data-sq-post-slug') ? undefined : link.getAttribute('data-key') || undefined,
      linkHref: link.getAttribute('href') || '',
      linkTarget: link.getAttribute('target') || undefined,
      linkAriaLabel: link.getAttribute('aria-label') || undefined
    };
  };

// Selection/HMR can arrive before image decode. Retain one guarded load
// callback, using the existing thumbnail message after pixels become ready.
IFrameBridge.prototype.captureAndSendImagePreview = function(element, key) {
    if (this._imagePreviewSelectionKey && this._imagePreviewSelectionKey !== key) return;
    if (this._imagePreviewSelectionElement && this._imagePreviewSelectionElement !== element) return;
    if (this._imagePreviewCleanup) this._imagePreviewCleanup();
    var self = this;
    var src = element.getAttribute('src');
    var cleanup = function() {
      element.removeEventListener('load', loaded);
      element.removeEventListener('error', cleanup);
      if (self._imagePreviewCleanup === cleanup) self._imagePreviewCleanup = null;
    };
    var loaded = function() {
      cleanup();
      if (!element.isConnected || element.getAttribute('src') !== src ||
          (self._imagePreviewSelectionKey && self._imagePreviewSelectionKey !== key) ||
          !element.complete || !element.naturalWidth) return;
      var dataUrl = self._makeThumbnail(element);
      if (dataUrl) self.sendToParent({ type: 'IMAGE_PREVIEW_REFRESH', payload: { key: key, dataUrl: dataUrl } });
    };
    this._imagePreviewCleanup = cleanup;
    if (element.complete && element.naturalWidth > 0) loaded();
    else {
      element.addEventListener('load', loaded, { once: true });
      element.addEventListener('error', cleanup, { once: true });
    }
  };

IFrameBridge.prototype.buildElementPayload = function(element, options, ctx) {
    // ctx (optional, blog-card click only): { rawTarget, clickedCardWrapper }
    // Non-first blog cards have their data-key attrs stripped at render, so the
    // caller redirects \`element\` to the first-card template for ancestor
    // walking. Map back to the actually-clicked card so per-instance attrs
    // (href/src/slug) and the overlay rect come from the right card.
    ctx = ctx || {};
    var clickedEquivalent = ctx.clickedCardWrapper
      ? this._mapFirstCardElementToClickedCard(element, ctx.clickedCardWrapper)
      : null;

    var originalElement = clickedEquivalent || element;
    var originalPostSlug = this.getPostSlug(originalElement);

    var key = this.getElementKey(element);
    if (this._imagePreviewCleanup) this._imagePreviewCleanup();
    this._imagePreviewSelectionKey = key;
    this._imagePreviewSelectionElement = originalElement;
    var tagName = element.tagName.toLowerCase();
    var payload = {
      key: key,
      tagName: tagName,
      classes: this.getElementClasses(element),
      sourceLocation: this.parseSourceLocation(element),
      rect: this.rectOf(element),
      parentKey: this.getEditableParentKey(element),
      parentDisplay: this.getParentDisplay(element),
      hasChildren: this.hasBlockChildren(element)
    };

    if (options) {
      for (var prop in options) {
        if (options.hasOwnProperty(prop)) {
          payload[prop] = options[prop];
        }
      }
    }

    if (!options || options.computedStyles !== false) {
      payload.computedStyles = this.getComputedStyles(element);
    }

    // Fallback to ctx.rawTarget when originalElement is outside any card
    // (e.g. blog slot selected) but the raw click landed on a card with
    // data-sq-post-slug. Note: must NOT fall back to \`element\` — when
    // clickedEquivalent is set, \`element\` is the first-card template and
    // would yield post #1's slug instead of the actually-clicked card's.
    var slug = originalPostSlug || (ctx.rawTarget ? this.getPostSlug(ctx.rawTarget) : null);
    if (slug) payload.postSlug = slug;
    payload.postLinkPaths = this.getPostLinkPaths(clickedEquivalent || ctx.rawTarget || originalElement);

    // task-140: unresolved media-fill flag rides the click payload so the
    // DesignBar Fill block can show the Media state without a doc mirror.
    if (originalElement.getAttribute('data-sq-media') === 'true') {
      payload.mediaFill = true;
    }

    // task-141: Media tab picks tag-swap vs background treatment by element
    // children (text nodes excluded natively by .children).
    payload.hasElementChildren = originalElement.children.length > 0;

    // task-141: video src rides imageAttributes too — the resolved-media
    // undo (inverse tag swap) needs the previous src for either tag.
    if (tagName === 'img' || tagName === 'video') {
      payload.imageAttributes = {
        src: originalElement.getAttribute('src') || null,
        alt: originalElement.getAttribute('alt') || null,
        loading: originalElement.getAttribute('loading') || null
      };
      if (tagName === 'img' && originalElement.naturalWidth > 0 && originalElement.complete) {
        var thumbDataUrl = this._makeThumbnail(originalElement);
        if (thumbDataUrl) payload.imagePreviewDataUrl = thumbDataUrl;
      } else if (tagName === 'img') {
        this.captureAndSendImagePreview(originalElement, key);
      }
    }

    if (tagName === 'video') {
      payload.videoAttributes = {
        src: originalElement.getAttribute('src') || null,
        autoplay: originalElement.hasAttribute('autoplay') ? 'true' : 'false',
        loop: originalElement.hasAttribute('loop') ? 'true' : 'false',
        muted: originalElement.hasAttribute('muted') ? 'true' : 'false',
        controls: originalElement.hasAttribute('controls') ? 'true' : 'false'
      };
    }

    // task-142: astro <Image> bound-asset handle (see decodeBoundAssetPath).
    if (tagName === 'img') {
      var boundPath = this.decodeBoundAssetPath(originalElement);
      if (boundPath) payload.boundAssetPath = boundPath;
      var imgCompIdx = this.imageComponentIndexOf(originalElement);
      if (imgCompIdx >= 0) payload.imageComponentIndex = imgCompIdx;
      // Prop-driven astro <Image>: name the OWNING component so the panel can
      // offer "Edit component" / the usage picker.
      if (!payload.sourceLocation) {
        var ownerFile = this.resolveOwnerComponentFile(element);
        if (ownerFile) payload.ownerComponentFile = ownerFile;
      }
    }

    if (clickedEquivalent) {
      payload.rect = this.rectOf(clickedEquivalent);
    }

    return payload;
  };

IFrameBridge.prototype.buildSelectionPayload = function(key) {
    var selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { key: key, selectedText: '', hasSelection: false, isInsideLink: false };
    }

    var selectedText = selection.toString();
    var hasSelection = !selection.isCollapsed && selectedText.trim().length > 0;
    var range = selection.getRangeAt(0);

    // Check for cross-link-boundary selection (invalid)
    if (hasSelection) {
      var startLink = this.findClosestLink(range.startContainer);
      var endLink = this.findClosestLink(range.endContainer);
      var crossesBoundary = (startLink && !endLink) || (!startLink && endLink) ||
                            (startLink && endLink && startLink !== endLink);
      if (crossesBoundary) {
        return { key: key, selectedText: '', hasSelection: false, isInsideLink: false };
      }

      // Save selection for later use
      var textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        this.savedSelectionRange = {
          key: key, selectedText: selectedText,
          startOffset: range.startOffset, endOffset: range.endOffset,
          textContent: textNode.textContent
        };
      } else {
        this.savedSelectionRange = { range: range.cloneRange(), key: key, selectedText: selectedText };
      }
    }

    // Check if cursor is inside a link
    var linkElement = this.findClosestLink(range.commonAncestorContainer);
    var payload = {
      key: key,
      selectedText: selectedText,
      hasSelection: hasSelection,
      isInsideLink: !!linkElement
    };

    if (linkElement) {
      payload.existingHref = linkElement.getAttribute('href') || '';
      payload.existingTarget = linkElement.getAttribute('target') || undefined;
      payload.linkKey = linkElement.getAttribute('data-key') || undefined;
    }

    return payload;
  };


IFrameBridge.prototype.updateAttribute = function(element, attr, value) {
    if (value) {
      element.setAttribute(attr, value);
    } else {
      element.removeAttribute(attr);
    }
  };

`;
