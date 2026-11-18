/**
 * RESOLVE_DRAWN_MEDIA (task-141): a drawn frame/rect/ellipse becomes an
 * <img>/<video> via staticMarkup; kind 'none' un-resolves back to the plain
 * container render. Polygon/pen/line shapes are rejected (v2).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

// ADD_DRAWN_ELEMENT dispatches a CustomEvent on window
const dispatchEventMock = vi.fn();
vi.stubGlobal('window', {
  dispatchEvent: dispatchEventMock,
  CustomEvent: class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, opts?: { detail?: unknown }) {
      this.type = type;
      this.detail = opts?.detail;
    }
  },
});

function addPage(doc: Y.Doc, id: string): void {
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  page.set('id', id);
  page.set('name', 'Page');
  page.set('rootElementIds', new Y.Array<string>());
  pages.set(id, page);
  doc.getArray('rootPages').push([id]);
}

function addDrawn(
  doc: Y.Doc,
  key: string,
  extra: Record<string, unknown> = {},
  classes = 'w-40 h-40'
): void {
  applyCommand(doc, {
    type: 'ADD_DRAWN_ELEMENT',
    element: {
      key,
      pageId: 'page-1',
      parentKey: 'some-parent',
      insertIndex: 0,
      tag: 'div',
      classes,
      textContent: '',
      ...extra,
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

const getDrawn = (doc: Y.Doc, key: string) => {
  const el = doc.getMap('elements').get(key) as Y.Map<unknown>;
  return { staticMarkup: el?.get('staticMarkup') as string | undefined };
};

const ELLIPSE_PEN_PATH = JSON.stringify({
  closed: true,
  anchors: [
    { x: 20, y: 0, hIn: { dx: -11, dy: 0 }, hOut: { dx: 11, dy: 0 }, corner: false },
    { x: 40, y: 20, hIn: { dx: 0, dy: -11 }, hOut: { dx: 0, dy: 11 }, corner: false },
    { x: 20, y: 40, hIn: { dx: 11, dy: 0 }, hOut: { dx: -11, dy: 0 }, corner: false },
    { x: 0, y: 20, hIn: { dx: 0, dy: 11 }, hOut: { dx: 0, dy: -11 }, corner: false },
  ],
});

const POLYGON_PEN_PATH = JSON.stringify({
  closed: true,
  anchors: [
    { x: 10, y: 0, corner: true }, { x: 30, y: 0, corner: true },
    { x: 40, y: 20, corner: true }, { x: 30, y: 40, corner: true },
    { x: 10, y: 40, corner: true }, { x: 0, y: 20, corner: true },
  ],
});

describe('RESOLVE_DRAWN_MEDIA', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    addPage(doc, 'page-1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('resolves a drawn frame to an img via staticMarkup', () => {
    addDrawn(doc, 'drawn:1');
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:1', kind: 'image', src: '/up/a.jpg' });
    expect(getDrawn(doc, 'drawn:1').staticMarkup).toBe('<img src="/up/a.jpg" alt="" class="w-40 h-40" />');
  });

  it('video kind emits ambient-loop video markup', () => {
    addDrawn(doc, 'drawn:1');
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:1', kind: 'video', src: '/up/a.mp4' });
    const markup = getDrawn(doc, 'drawn:1').staticMarkup!;
    expect(markup).toContain('<video src="/up/a.mp4"');
    expect(markup).toContain('autoplay');
    expect(markup).toContain('muted');
    expect(markup).toContain('loop');
    expect(markup).toContain('playsinline');
    expect(markup).toContain('class="w-40 h-40"');
  });

  it('ellipse shape resolves with rounded-full appended', () => {
    addDrawn(doc, 'drawn:e', { staticMarkup: '<svg>…</svg>', penPath: ELLIPSE_PEN_PATH });
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:e', kind: 'image', src: '/up/a.jpg' });
    expect(getDrawn(doc, 'drawn:e').staticMarkup).toContain('class="w-40 h-40 rounded-full"');
  });

  it('escapes quotes in src', () => {
    addDrawn(doc, 'drawn:1');
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:1', kind: 'image', src: '/up/a"b.jpg' });
    expect(getDrawn(doc, 'drawn:1').staticMarkup).toContain('src="/up/a&quot;b.jpg"');
  });

  it('un-resolve restores the container markup', () => {
    addDrawn(doc, 'drawn:1');
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:1', kind: 'image', src: '/up/a.jpg' });
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:1', kind: 'none' });
    expect(getDrawn(doc, 'drawn:1').staticMarkup).toBeUndefined();
  });

  it('rejects polygon/pen shapes with a warning, markup unchanged', () => {
    addDrawn(doc, 'drawn:p', { staticMarkup: '<svg>poly</svg>', penPath: POLYGON_PEN_PATH });
    applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn:p', kind: 'image', src: '/up/a.jpg' });
    expect(getDrawn(doc, 'drawn:p').staticMarkup).toBe('<svg>poly</svg>');
    expect(console.warn).toHaveBeenCalled();
  });

  it('rejects unknown keys without throwing', () => {
    expect(() =>
      applyCommand(doc, { type: 'RESOLVE_DRAWN_MEDIA', key: 'nope', kind: 'image', src: '/x.jpg' })
    ).not.toThrow();
  });
});
