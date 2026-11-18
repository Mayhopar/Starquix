/**
 * IFrameBridge Part: Blog-Card Machinery
 *
 * Key repair and click-context resolution for blog cards rendered by
 * RENDER_COLLECTION / the Phase-5 named-slot model (task-028). After
 * HMR/DOM rebuilds, card children lose their instance-child data-keys;
 * _ensureBlogCardKeys re-assigns them from _blogCardInfo metadata.
 *
 * ⚠️ FRAGILE — ported verbatim from bridge.js; see MEMORY.md blog notes
 * before changing anything here.
 *
 * Constructor state: _blogCardInfo, _blogCardKeysDirty.
 */

export const BRIDGE_BLOG = `

IFrameBridge.prototype._cardContentRoot = function(wrapper) {
    if (!wrapper) return null;
    return wrapper.tagName === 'A' ? wrapper.firstElementChild : wrapper;
  };

IFrameBridge.prototype._ensureBlogCardKeys = function() {
    if (!this._blogCardInfo || this._blogCardInfo.length === 0) return;

    var anyFixed = false;

    for (var i = 0; i < this._blogCardInfo.length; i++) {
      var info = this._blogCardInfo[i];

      var postsWrapper = this.findElementByKey(info.postsWrapperKey);

      // Fallback: find by structure (after HMR, data-key on drawn elements may be lost)
      if (!postsWrapper) {
        var slotEl = this.findElementByKey(info.slotKey);
        if (!slotEl) {
          var blogSlots = document.querySelectorAll('[data-slot-type="blog"]');
          for (var bs = 0; bs < blogSlots.length; bs++) {
            var bsKey = blogSlots[bs].getAttribute('data-key');
            if (bsKey === info.slotKey || (!bsKey && blogSlots.length === 1)) {
              slotEl = blogSlots[bs];
              if (!bsKey) slotEl.setAttribute('data-key', info.slotKey);
              break;
            }
          }
        }
        if (slotEl) {
          var slotChildren = slotEl.children;
          for (var sc = 0; sc < slotChildren.length; sc++) {
            var child = slotChildren[sc];
            if (child.tagName && child.tagName.toLowerCase() === 'div') {
              if (child.children.length > 0) {
                postsWrapper = child;
                var pwKey = child.getAttribute('data-key');
                if (!pwKey || pwKey.indexOf('dynamic:') === 0) {
                  child.setAttribute('data-key', info.postsWrapperKey);
                }
                break;
              }
            }
          }
        }
      }

      if (!postsWrapper) continue;

      var pwCurrentKey = postsWrapper.getAttribute('data-key');
      if (!pwCurrentKey || pwCurrentKey.indexOf('dynamic:') === 0) {
        postsWrapper.setAttribute('data-key', info.postsWrapperKey);
      }

      var firstChild = postsWrapper.firstElementChild;
      if (!firstChild) continue;

      var cardRoot;
      var firstChildTag = firstChild.tagName ? firstChild.tagName.toLowerCase() : '';

      if (firstChildTag === 'a') {
        var anchorKey = info.slotKey + ':post-link';
        var currentAnchorKey = firstChild.getAttribute('data-key');
        if (!currentAnchorKey || currentAnchorKey.indexOf('dynamic:') === 0) {
          firstChild.setAttribute('data-key', anchorKey);
        }
        cardRoot = firstChild.firstElementChild;
      } else if (firstChildTag === 'div' && firstChild.style && firstChild.style.cssText.indexOf('align-items:center') !== -1) {
        continue;
      } else {
        cardRoot = firstChild;
      }

      if (!cardRoot) continue;

      var tagCounts = {};
      var elements = [cardRoot];
      var descendants = cardRoot.querySelectorAll('*');
      for (var d = 0; d < descendants.length; d++) {
        elements.push(descendants[d]);
      }

      for (var j = 0; j < elements.length; j++) {
        var el = elements[j];
        var tag = el.tagName.toLowerCase();
        if (MARKUP_SKIP_TAGS.indexOf(tag) !== -1) continue;

        var index = tagCounts[tag] || 0;
        tagCounts[tag] = index + 1;

        var expectedKey = info.cardElementId + ':' + tag + '-' + index;
        var currentKey = el.getAttribute('data-key');

        if (!currentKey || currentKey.indexOf('dynamic:') === 0) {
          el.setAttribute('data-key', expectedKey);
          anyFixed = true;
        }
      }
    }

    if (!anyFixed) {
      this._blogCardKeysDirty = false;
    }
  };

IFrameBridge.prototype._findCardWrapperUnder = function(element, postsWrapper) {
    var slot = null;
    var children = postsWrapper.children;
    for (var c = 0; c < children.length; c++) {
      if (children[c].tagName === 'SLOT') { slot = children[c]; break; }
    }
    var container = slot || postsWrapper;
    var w = element;
    while (w && w.parentElement !== container) w = w.parentElement;
    return w || null;
  };

IFrameBridge.prototype._findClickedCardWrapper = function(rawTarget, ctx) {
    if (!rawTarget) return null;
    var el = rawTarget.nodeType === 1 ? rawTarget : rawTarget.parentElement;
    if (!el) return null;
    ctx = ctx || this._findPostsWrapperAncestor(el);
    if (!ctx) return null;
    return this._findCardWrapperUnder(el, ctx.postsWrapper);
  };

IFrameBridge.prototype._findPostsWrapperAncestor = function(element) {
    if (!element) return null;
    var cur = element.nodeType === 1 ? element : element.parentElement;
    while (cur && cur !== document.body) {
      var ck = cur.getAttribute('data-key');
      // Legacy drawn-slot path: posts wrapper is registered via
      // \`_blogCardInfo\`. Match exactly so legacy slots keep working.
      if (ck && this._blogCardInfo && this._blogCardInfo.length > 0) {
        for (var i = 0; i < this._blogCardInfo.length; i++) {
          if (ck === this._blogCardInfo[i].postsWrapperKey) {
            return { postsWrapper: cur, blogInfo: this._blogCardInfo[i] };
          }
        }
      }
      // Regular-instance path (task-028): the wrapper carries
      // \`data-blog-source="posts"\`. The first child of that wrapper IS the
      // real BlogCard instance — its data-key prefix is the cardElementId.
      // We synthesise a blogInfo on the fly so downstream redirect logic
      // (_resolveToFirstBlogCard, _resolveBlogClickContext) keeps working
      // without depending on _blogCardInfo bookkeeping.
      if (cur.getAttribute && cur.getAttribute('data-blog-source') === 'posts') {
        // Descend <slot> levels AND the injected post-link <a> — the card's
        // key prefix is the cardElementId; the anchor's is the slot id.
        var firstCard = cur.firstElementChild;
        while (firstCard && (firstCard.tagName === 'SLOT' || firstCard.tagName === 'A')) {
          firstCard = firstCard.firstElementChild;
        }
        if (firstCard) {
          var firstKey = firstCard.getAttribute('data-key') || '';
          var cardElementId = firstKey.split(':')[0];
          if (cardElementId && firstKey.indexOf('dynamic:') !== 0) {
            return {
              postsWrapper: cur,
              // slotKey must be the SLOT INSTANCE id (post-link redirect
              // builds '<slotKey>:post-link'), not the wrapper's full key.
              blogInfo: { cardElementId: cardElementId, slotKey: (ck || '').split(':')[0] },
            };
          }
        }
      }
      cur = cur.parentElement;
    }
    return null;
  };

IFrameBridge.prototype._getCardTagIndex = function(element, cardRoot) {
    var tag = element.tagName.toLowerCase();
    if (MARKUP_SKIP_TAGS.indexOf(tag) !== -1) return -1;

    var allInCard = [cardRoot];
    var desc = cardRoot.querySelectorAll('*');
    for (var d = 0; d < desc.length; d++) allInCard.push(desc[d]);

    var tagIndex = 0;
    for (var j = 0; j < allInCard.length; j++) {
      var cur = allInCard[j];
      if (cur === element) return tagIndex;
      if (cur.tagName.toLowerCase() === tag && MARKUP_SKIP_TAGS.indexOf(cur.tagName.toLowerCase()) === -1) {
        tagIndex++;
      }
    }
    return -1;
  };

IFrameBridge.prototype._mapFirstCardElementToClickedCard = function(firstCardEl, clickedCardWrapper) {
    if (!firstCardEl || !clickedCardWrapper) return null;

    var postsWrapper = clickedCardWrapper.parentElement;
    if (!postsWrapper) return null;
    var firstWrapper = postsWrapper.firstElementChild;
    if (!firstWrapper || firstWrapper === clickedCardWrapper) return null;

    // Wrapping anchor case — both wrappers are the equivalent element.
    if (firstCardEl === firstWrapper) return clickedCardWrapper;

    var firstRoot = this._cardContentRoot(firstWrapper);
    var clickedRoot = this._cardContentRoot(clickedCardWrapper);
    if (!firstRoot || !clickedRoot) return null;
    if (firstCardEl === firstRoot) return clickedRoot;

    var idx = this._getCardTagIndex(firstCardEl, firstRoot);
    if (idx < 0) return null;

    // _getCardTagIndex counts root + descendants, so include clickedRoot when its tag matches.
    var tag = firstCardEl.tagName.toLowerCase();
    if (MARKUP_SKIP_TAGS.indexOf(tag) !== -1) return null;
    var desc = clickedRoot.querySelectorAll(tag);
    var match = clickedRoot.tagName.toLowerCase() === tag ? clickedRoot : null;
    if (match && idx === 0) return match;
    var skipFirst = match ? 1 : 0;
    return desc[idx - skipFirst] || null;
  };

IFrameBridge.prototype._resolveBlogClickContext = function(rawTarget) {
    var ctx = this._findPostsWrapperAncestor(rawTarget);
    if (!ctx) return { clickedCardWrapper: null, resolvedTarget: rawTarget };
    var clickedCardWrapper = this._findClickedCardWrapper(rawTarget, ctx);
    var redirected = this._resolveToFirstBlogCard(rawTarget, ctx);
    return {
      clickedCardWrapper: clickedCardWrapper,
      resolvedTarget: redirected ? redirected.element : rawTarget
    };
  };

IFrameBridge.prototype._resolveToFirstBlogCard = function(element, ctx) {
    if (element && element.nodeType !== 1) element = element.parentElement;
    if (!element) return null;
    ctx = ctx || this._findPostsWrapperAncestor(element);
    if (!ctx) return null;

    // Already-keyed (non-dynamic) elements are first-card / source-tracked — no redirect needed.
    var existingKey = element.getAttribute('data-key');
    if (existingKey && existingKey.indexOf('dynamic:') !== 0) return null;

    var cardWrapper = this._findCardWrapperUnder(element, ctx.postsWrapper);
    if (!cardWrapper) return null;
    // First-card protection: a real (non-dynamic) data-key on the card
    // wrapper means it IS the first card — already the source of truth,
    // no redirect needed. Complements the click-target check above.
    var wrapperKey = cardWrapper.getAttribute('data-key');
    if (wrapperKey && wrapperKey.indexOf('dynamic:') !== 0) return null;

    // User clicked the wrapping <a> of a non-first card. Only the first card's
    // anchor has data-key (slotKey + ':post-link'); redirect there so Yjs
    // lookups, isInsideBlogSlot and LinkBlock visibility resolve consistently.
    if (element === cardWrapper && cardWrapper.tagName === 'A') {
      var postLinkKey = ctx.blogInfo.slotKey + ':post-link';
      var firstAnchor = this.findElementByKey(postLinkKey);
      return firstAnchor ? { element: firstAnchor, key: postLinkKey } : null;
    }

    var cardRoot = this._cardContentRoot(cardWrapper);
    if (!cardRoot) return null;

    var tagIndex = this._getCardTagIndex(element, cardRoot);
    if (tagIndex < 0) return null;

    var firstCardKey = ctx.blogInfo.cardElementId + ':' + element.tagName.toLowerCase() + '-' + tagIndex;
    var firstCardEl = this.findElementByKey(firstCardKey);
    return firstCardEl ? { element: firstCardEl, key: firstCardKey } : null;
  };

`;
