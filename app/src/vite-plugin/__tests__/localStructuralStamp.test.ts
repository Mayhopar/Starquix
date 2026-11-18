/**
 * task-160 — the SERVER-side backstop: the plugin refuses spliced markup that
 * already carries a `data-sq-id` stamp.
 *
 * The client strips it (`ViteStructuralWriter`), but a stale editor tab is a
 * real thing and a duplicated stamp is the one outcome worse than a sliding
 * ordinal: on the next open BOTH holders are poisoned back to the ordinal and
 * both lose their stored styling. Default-deny at the file writer, the same
 * discipline `allowRootRemoval` uses.
 */
import { describe, it, expect } from 'vitest';
import { assertNoStamp } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

describe('assertNoStamp', () => {
  it('throws on a grammar-valid stamp', () => {
    expect(() => assertNoStamp('<SiteNav data-sq-id="s0123456789abcdef" />')).toThrow(
      /carries a data-sq-id stamp/,
    );
  });

  it('throws on a single-quoted stamp too', () => {
    expect(() => assertNoStamp("<SiteNav data-sq-id='s0123456789abcdef' />")).toThrow();
  });

  it('throws when the stamp is on any element of a multi-root fragment', () => {
    expect(() =>
      assertNoStamp('<div><p>hi</p></div>\n<SiteNav data-sq-id="sabcdefabcdefabcd" />'),
    ).toThrow();
  });

  it('accepts ordinary markup', () => {
    expect(() => assertNoStamp('<div class="x"><p>hi</p></div>')).not.toThrow();
  });

  it('accepts a hand-authored opt-out — it is not a stamp', () => {
    expect(() => assertNoStamp('<SiteNav data-sq-id={undefined} />')).not.toThrow();
  });

  it('accepts a malformed value — only what the stamper writes is refused', () => {
    expect(() => assertNoStamp('<SiteNav data-sq-id="nope" />')).not.toThrow();
    expect(() => assertNoStamp('<SiteNav data-sq-id="q0123456789abcdef" />')).not.toThrow();
  });

  it('is inert for a non-string payload', () => {
    expect(() => assertNoStamp(undefined)).not.toThrow();
  });
});
