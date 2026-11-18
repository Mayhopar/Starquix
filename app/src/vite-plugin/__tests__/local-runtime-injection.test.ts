/**
 * Regression 2026-08-04 — the local runtime must not be disarmed by a page
 * that already loads `/scripts/bridge.js`.
 *
 * The injector used ONE guard for two different payloads: the deduped
 * `bridge.js` <script>, and the local runtime (the `__SQ_LOCAL_MODE__` marker
 * plus the write-bridge module) that nothing else can supply. A layout copied
 * from preview-template carries `<script is:inline src="/scripts/bridge.js">`
 * verbatim, so opening such a project in local mode silently produced:
 *
 *   - `window.__SQ_LOCAL_MODE__` undefined → `IFrameBridge.resolvePlacement()`
 *     returns '' → EVERY element key loses its `~p…` placement segment → a
 *     class edit on one page repainted the same element on every other page
 *     and in the master view (the task-149 defect, in full);
 *   - `window.__SQ_WRITE_*` undefined → Push wrote nothing, with no toast and
 *     no cleared badge.
 *
 * Measured on real `astro dev` 4.16.19 bytes before the fix: 0 occurrences of
 * `__SQ_LOCAL_MODE__` in the response for a page whose layout carried the tag,
 * 1 for an otherwise identical page without it.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line import/no-relative-packages -- cross-tree import, same pattern as snapshot-parity
// @ts-expect-error plain-JS preview-template plugin, no types
import { armLocalRuntimeHtml, WRITE_BRIDGE_ID } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

const arm = armLocalRuntimeHtml as (html: string) => string;
const bridgeTags = (html: string) => html.split('src="/scripts/bridge.js"').length - 1;

const PAGE_WITH_OWN_BRIDGE =
  '<html><head><title>t</title></head><body><main>x</main>' +
  '<script src="/scripts/bridge.js"></script></body></html>';
const PAGE_WITHOUT = '<html><head><title>t</title></head><body><main>x</main></body></html>';

describe('armLocalRuntimeHtml', () => {
  it('arms local mode even when the page already loads /scripts/bridge.js', () => {
    const out = arm(PAGE_WITH_OWN_BRIDGE);
    expect(out).toContain('window.__SQ_LOCAL_MODE__=true');
    expect(out).toContain(WRITE_BRIDGE_ID);
  });

  it('does not load bridge.js twice when the page carries its own tag', () => {
    expect(bridgeTags(PAGE_WITH_OWN_BRIDGE)).toBe(1);
    expect(bridgeTags(arm(PAGE_WITH_OWN_BRIDGE))).toBe(1);
  });

  it('adds bridge.js when the page has none', () => {
    expect(bridgeTags(arm(PAGE_WITHOUT))).toBe(1);
    expect(arm(PAGE_WITHOUT)).toContain('window.__SQ_LOCAL_MODE__=true');
  });

  it('injects before </head> so the marker precedes a body-level bridge tag', () => {
    const out = arm(PAGE_WITH_OWN_BRIDGE);
    expect(out.indexOf('__SQ_LOCAL_MODE__')).toBeLessThan(out.indexOf('</head>'));
  });

  it('falls back to prefixing when the page has no </head>', () => {
    const out = arm('<div>fragment</div>');
    expect(out.startsWith('<style>')).toBe(true);
    expect(out).toContain('window.__SQ_LOCAL_MODE__=true');
    expect(out.endsWith('<div>fragment</div>')).toBe(true);
  });

  it('is idempotent — a second pass adds nothing', () => {
    const once = arm(PAGE_WITHOUT);
    expect(arm(once)).toBe(once);
  });

  it('carries the media placeholder style with the rest of the runtime', () => {
    expect(arm(PAGE_WITH_OWN_BRIDGE)).toContain("[data-sq-media='true']");
  });

  // A4/A5 (2026-11-10): without a cross-document view transition Chromium showed ONE blank canvas
  // frame between a new document's commit and first paint (page switch, boundary). The opt-in must
  // be in <head> of BOTH documents at first render; the no-animation rule is scoped to our type so a
  // site's own (astro:transitions) animations are untouched.
  it('opts every page into the paint-hold view transition, in <head>, scoped to its own type', () => {
    const out = arm(PAGE_WITHOUT);
    const hold = out.indexOf('@view-transition{navigation:auto;types:sq-hold}');
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(out.indexOf('</head>'));
    expect(out).toContain('html:active-view-transition-type(sq-hold)::view-transition-old(*)');
    expect(out).not.toMatch(/(^|[}>])::view-transition-(group|old|new)\(\*\)/); // never unscoped
  });
});
