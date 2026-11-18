/**
 * RESOLVE_INSTANCE_MEDIA (task-141): rewrites a Media.astro-born instance's
 * staticMarkup (exactly one <div data-sq-media> root — or an already-resolved
 * img/video for re-resolve). Refuses any other markup shape. NOT
 * UPDATE_STATIC_MARKUP (which wipes overrides).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

const MEDIA_DIV = "<div data-sq-media='true' class='w-full min-h-40'></div>";

function addInstance(doc: Y.Doc, key: string, staticMarkup: string): void {
  const elements = doc.getMap('elements');
  const el = new Y.Map();
  el.set('id', key);
  el.set('staticMarkup', staticMarkup);
  el.set('astroSource', 'library/Media.astro');
  elements.set(key, el);
}

const markupOf = (doc: Y.Doc, key: string) =>
  (doc.getMap('elements').get(key) as Y.Map<unknown>).get('staticMarkup') as string;

describe('RESOLVE_INSTANCE_MEDIA', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('resolves the media div to an img, keeping classes', () => {
    addInstance(doc, 'inst-1', MEDIA_DIV);
    applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-1', kind: 'image', src: 'sq-asset:a1' });
    expect(markupOf(doc, 'inst-1')).toBe('<img src="sq-asset:a1" alt="" class="w-full min-h-40" />');
  });

  it('resolves to ambient-loop video', () => {
    addInstance(doc, 'inst-1', MEDIA_DIV);
    applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-1', kind: 'video', src: 'sq-asset:a2' });
    expect(markupOf(doc, 'inst-1')).toBe('<video src="sq-asset:a2" autoplay muted loop playsinline class="w-full min-h-40"></video>');
  });

  it('re-resolves an already-resolved img (src swap / kind change)', () => {
    addInstance(doc, 'inst-1', '<img src="sq-asset:old" alt="" class="w-full" />');
    applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-1', kind: 'video', src: 'sq-asset:new' });
    expect(markupOf(doc, 'inst-1')).toContain('<video src="sq-asset:new"');
    expect(markupOf(doc, 'inst-1')).toContain('class="w-full"');
  });

  it('un-resolve restores the <div data-sq-media> root with current classes', () => {
    addInstance(doc, 'inst-1', MEDIA_DIV);
    applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-1', kind: 'image', src: 'sq-asset:a1' });
    applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-1', kind: 'none' });
    expect(markupOf(doc, 'inst-1')).toBe("<div data-sq-media='true' class='w-full min-h-40'></div>");
  });

  it('refuses multi-root and non-media markup', () => {
    addInstance(doc, 'multi', '<div></div><div></div>');
    expect(applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'multi', kind: 'image', src: 'x' })).toBe(false);
    expect(markupOf(doc, 'multi')).toBe('<div></div><div></div>');

    addInstance(doc, 'plain', '<div class="hero"><span>x</span></div>');
    expect(applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'plain', kind: 'image', src: 'x' })).toBe(false);

    addInstance(doc, 'plaindiv', '<div class="hero"></div>');
    expect(applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'plaindiv', kind: 'image', src: 'x' })).toBe(false);
  });

  it('unknown key is a no-op false', () => {
    expect(applyCommand(doc, { type: 'RESOLVE_INSTANCE_MEDIA', key: 'nope', kind: 'image', src: 'x' })).toBe(false);
  });
});
