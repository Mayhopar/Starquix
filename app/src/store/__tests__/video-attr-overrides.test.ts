/**
 * Video upload support (2026-07-30 design): applyImageAttributeOverrides (via
 * applyAllOverrides — the shared pipeline for canvas preview, WC sync, and
 * export) must apply imageAttributes/imageOverrides to <video> tags: src like
 * img, and boolean attrs stored as 'true'/'false' strings ('false' strips the
 * attribute even when staticMarkup bakes it in). img behavior must not change.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyAllOverrides } from '../selectors';

function makeElement(overrides: (el: Y.Map<unknown>) => void): Y.Map<unknown> {
  const doc = new Y.Doc();
  const el = doc.getMap('elements').set('e1', new Y.Map()) as Y.Map<unknown>;
  overrides(el);
  return el;
}

function setImageAttributes(el: Y.Map<unknown>, attrs: Record<string, string>) {
  const m = new Y.Map<string>();
  el.set('imageAttributes', m);
  for (const [k, v] of Object.entries(attrs)) m.set(k, v);
}

function setImageOverride(el: Y.Map<unknown>, selector: string, attrs: Record<string, string>) {
  if (!el.has('imageOverrides')) el.set('imageOverrides', new Y.Map<Y.Map<string>>());
  const overrides = el.get('imageOverrides') as Y.Map<Y.Map<string>>;
  const m = new Y.Map<string>();
  overrides.set(selector, m);
  for (const [k, v] of Object.entries(attrs)) m.set(k, v);
}

describe('applyAllOverrides — video attributes', () => {
  it('applies root imageAttributes src to a root <video>', () => {
    const el = makeElement((e) => setImageAttributes(e, { src: 'sq-asset:abc' }));
    const out = applyAllOverrides('<video autoplay muted loop></video>', el);
    expect(out).toContain('src="sq-asset:abc"');
  });

  it("boolean 'false' strips a baked-in attribute; 'true' adds a missing one", () => {
    const el = makeElement((e) => setImageAttributes(e, { autoplay: 'false', controls: 'true' }));
    const out = applyAllOverrides('<video autoplay muted loop></video>', el);
    expect(out).not.toContain('autoplay');
    expect(out).toMatch(/controls/);
    expect(out).toContain('muted'); // untouched attrs survive
  });

  it('applies video-N imageOverrides to the Nth <video> child', () => {
    const el = makeElement((e) => setImageOverride(e, 'video-1', { src: '/b.mp4' }));
    const out = applyAllOverrides(
      '<div><video src="/a.mp4"></video><video src="/x.mp4"></video></div>',
      el,
    );
    expect(out).toContain('src="/a.mp4"');
    expect(out).toContain('src="/b.mp4"');
    expect(out).not.toContain('/x.mp4');
  });

  it('img and video indices count independently (img-0 does not touch video)', () => {
    const el = makeElement((e) => {
      setImageOverride(e, 'img-0', { src: '/new-img.png' });
      setImageOverride(e, 'video-0', { src: '/new-vid.mp4' });
    });
    const out = applyAllOverrides(
      '<div><video src="/v.mp4"></video><img src="/i.png" /></div>',
      el,
    );
    expect(out).toContain('src="/new-vid.mp4"');
    expect(out).toContain('src="/new-img.png"');
  });

  it('img-only markup behaves exactly as before (src/alt/loading)', () => {
    const el = makeElement((e) =>
      setImageOverride(e, 'img-0', { src: '/n.png', alt: 'new alt', loading: 'eager' }),
    );
    const out = applyAllOverrides('<div><img src="/o.png" alt="old" /></div>', el);
    expect(out).toContain('src="/n.png"');
    expect(out).toContain('alt="new alt"');
    expect(out).toContain('loading="eager"');
  });
});
