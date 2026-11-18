// app/src/ai/utils/__tests__/streamPreviewFeed.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamPreviewFeed } from '../partialArgs';
import { commandRegistry } from '../../tools/commandRegistry';

// StreamPreviewFeed hardcodes the two preview-able tool names (a deliberate
// ponytail shortcut over a registry `preview` descriptor). This pins them to
// the registry so a rename fails CI instead of silently disabling the preview.
it('preview tool names still exist in the command registry', () => {
  expect(commandRegistry).toHaveProperty('add_page_content');
  expect(commandRegistry).toHaveProperty('update_element_by_key');
});

describe('StreamPreviewFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function feedWith() {
    const emits: unknown[] = [];
    const ends: number[] = [];
    const feed = new StreamPreviewFeed(
      e => emits.push(e),
      () => ends.push(1),
    );
    return { feed, emits, ends };
  }

  function collectEmits(run: (feed: StreamPreviewFeed) => void) {
    const { feed, emits } = feedWith();
    run(feed);
    return emits as { mode: string; partial?: string; targetKey?: string }[];
  }

  it('emits section previews for add_page_content staticMarkup, trimmed to tag boundary', () => {
    const { feed, emits } = feedWith();
    feed.start('add_page_content');
    feed.delta('{"pageId":"p1","staticMarkup":"<section class=\'py-16\'><p cla');
    vi.advanceTimersByTime(200);
    expect(emits.at(-1)).toEqual({ mode: 'section', partial: "<section class='py-16'>" });
  });

  it('throttles to one emit per interval', () => {
    const { feed, emits } = feedWith();
    feed.start('add_page_content');
    for (let i = 0; i < 20; i++) feed.delta(i === 0 ? '{"staticMarkup":"<div>' : 'x');
    expect(emits.length).toBeLessThanOrEqual(2); // leading emit + maybe one trailing
    vi.advanceTimersByTime(200);
    expect((emits.at(-1) as { partial: string }).partial).toContain('x');
  });

  it('synthesizes a section preview from tag + textContent when staticMarkup is absent', () => {
    const emits = collectEmits(feed => {
      feed.start('add_page_content');
      feed.delta('{"type":"text","tag":"h1","textContent":"Welco');
      vi.advanceTimersByTime(150);
    });
    expect(emits.at(-1)).toEqual({ mode: 'section', partial: '<h1>Welco</h1>' });
  });

  it('emits nothing while tag is incomplete or invalid', () => {
    expect(collectEmits(f => { f.start('add_page_content'); f.delta('{"tag":"h'); vi.advanceTimersByTime(150); })).toHaveLength(0);
    expect(collectEmits(f => { f.start('add_page_content'); f.delta('{"tag":"x><script","textContent":"hi"'); vi.advanceTimersByTime(150); })).toHaveLength(0);
  });

  it('escapes HTML in synthesized text', () => {
    const emits = collectEmits(f => { f.start('add_page_content'); f.delta('{"tag":"p","textContent":"a<b>"'); vi.advanceTimersByTime(150); });
    expect(emits.at(-1)).toEqual({ mode: 'section', partial: '<p>a&lt;b&gt;</p>' });
  });

  it('text mode waits for a complete sourceKey before emitting', () => {
    const { feed, emits } = feedWith();
    feed.start('update_element_by_key');
    feed.delta('{"sourceKey":"src/pages/index.astro:5:1","textContent":"Hel');
    vi.advanceTimersByTime(200);
    expect(emits.at(-1)).toEqual({ mode: 'text', targetKey: 'src/pages/index.astro:5:1', partial: 'Hel' });
  });

  it('emits busy once when sourceKey completes with no textContent', () => {
    const emits = collectEmits(f => {
      f.start('update_element_by_key');
      f.delta('{"sourceKey":"src/pages/index.astro:5:1","classes":"bg-blu');
      vi.advanceTimersByTime(150);
      f.delta('e-500"'); vi.advanceTimersByTime(150);
    });
    expect(emits.filter(e => e.mode === 'busy')).toHaveLength(1);
    expect(emits[0]).toEqual({ mode: 'busy', targetKey: 'src/pages/index.astro:5:1' });
  });

  it('upgrades busy to text mode when textContent arrives later', () => {
    const emits = collectEmits(f => {
      f.start('update_element_by_key');
      f.delta('{"sourceKey":"k:1:1"'); vi.advanceTimersByTime(150);
      f.delta(',"textContent":"Hi'); vi.advanceTimersByTime(150);
    });
    expect(emits[0].mode).toBe('busy');
    expect(emits.at(-1)).toEqual({ mode: 'text', targetKey: 'k:1:1', partial: 'Hi' });
  });

  it('emits nothing for untracked tools and nothing before the watched field appears', () => {
    const { feed, emits } = feedWith();
    feed.start('read_variables');
    feed.delta('{"x":"y"}');
    vi.advanceTimersByTime(200);
    expect(emits).toHaveLength(0);
  });

  it('end() fires endEmit and stops further emits', () => {
    const { feed, emits, ends } = feedWith();
    feed.start('add_page_content');
    feed.delta('{"staticMarkup":"<div>');
    feed.end();
    expect(ends).toHaveLength(1);
    feed.delta('more');
    vi.advanceTimersByTime(200);
    const count = emits.length;
    vi.advanceTimersByTime(200);
    expect(emits.length).toBe(count);
  });

  // Call-site contract (2026-07-23): tools execute EAGERLY, so tool-result(A)
  // is delivered AFTER tool-input-start(B) when one step carries several tool
  // calls. useAIAgent therefore ends the feed at tool-call (args complete) and
  // must NOT end it at tool-result — ending there set active=false mid-B and
  // silently dropped every remaining delta (no preview at all for B).
  it('survives the eager-execution part order: end at tool-call, nothing at tool-result', () => {
    const { feed, emits, ends } = feedWith();
    feed.start('add_page_content');                    // tool-input-start A
    feed.delta('{"staticMarkup":"<div>a</div>');
    feed.end();                                        // tool-call A
    expect(ends).toHaveLength(1);
    feed.start('add_page_content');                    // tool-input-start B (same step)
    feed.delta('{"staticMarkup":"<div>b</div>');
    // tool-result A lands here — the call site does nothing with the feed
    vi.advanceTimersByTime(200);
    expect(emits.some(e => (e as { partial: string }).partial.includes('b'))).toBe(true);
    feed.end();                                        // tool-call B
    expect(ends).toHaveLength(2);
  });

  // Cancel path (task-128): abort must tell the bridge to RESTORE original
  // text — a plain END keeps the truncated stream text (commit path).
  it('end(cancelled) forwards the cancelled flag to endEmit', () => {
    const cancelled: boolean[] = [];
    const feed = new StreamPreviewFeed(() => {}, c => cancelled.push(!!c));
    feed.start('update_element_by_key');
    feed.delta('{"sourceKey":"k:1:1","textContent":"Hi');
    vi.advanceTimersByTime(150);
    feed.end(true);
    expect(cancelled).toEqual([true]);
  });

  it('end() without any emit is a no-op for endEmit', () => {
    const { feed, ends } = feedWith();
    feed.start('add_page_content');
    feed.end();
    expect(ends).toHaveLength(0); // never showed a preview → nothing to clean up
  });
});
