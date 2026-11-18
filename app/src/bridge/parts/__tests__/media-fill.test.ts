/**
 * task-140 media fill — bridge side:
 * - handleWriteTagSwap delegates to window.__SQ_WRITE_TAG_SWAP__ (write relay)
 * - buildElementPayload carries mediaFill for [data-sq-media="true"] elements
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const PAYLOAD = {
  sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
  requestId: 'media_test_1',
  kind: 'image',
  src: '/uploads/photo.jpg',
};

describe('handleWriteTagSwap', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    delete (window as unknown as { __SQ_WRITE_TAG_SWAP__?: unknown }).__SQ_WRITE_TAG_SWAP__;
  });

  afterEach(() => {
    delete (window as unknown as { __SQ_WRITE_TAG_SWAP__?: unknown }).__SQ_WRITE_TAG_SWAP__;
  });

  it('delegates to window.__SQ_WRITE_TAG_SWAP__', async () => {
    const writer = vi.fn();
    (window as unknown as { __SQ_WRITE_TAG_SWAP__: typeof writer }).__SQ_WRITE_TAG_SWAP__ = writer;
    bridge.handleWriteTagSwap(PAYLOAD);
    await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
  });

  it('forwards an atomic image Fill edit with empty src and expected source', async () => {
    const writer = vi.fn();
    (window as unknown as { __SQ_WRITE_TAG_SWAP__: typeof writer }).__SQ_WRITE_TAG_SWAP__ = writer;
    const payload = { ...PAYLOAD, kind: 'image-fill', src: '', imageFill: { expectedTag: '<img src="/x.png" class="w-24 h-24">', change: { type: 'remove' } } };
    bridge.handleWriteTagSwap(payload);
    await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(payload));
  });

  it('rejects payloads missing kind/src', () => {
    const writer = vi.fn();
    (window as unknown as { __SQ_WRITE_TAG_SWAP__: typeof writer }).__SQ_WRITE_TAG_SWAP__ = writer;
    bridge.handleWriteTagSwap({ ...PAYLOAD, kind: undefined });
    bridge.handleWriteTagSwap({ ...PAYLOAD, src: undefined });
    expect(writer).not.toHaveBeenCalled();
  });

  it('task-141: kind container with empty src (un-resolve) is delegated', async () => {
    const writer = vi.fn();
    (window as unknown as { __SQ_WRITE_TAG_SWAP__: typeof writer }).__SQ_WRITE_TAG_SWAP__ = writer;
    bridge.handleWriteTagSwap({ ...PAYLOAD, kind: 'container', src: '' });
    await vi.waitFor(() => expect(writer).toHaveBeenCalledWith({ ...PAYLOAD, kind: 'container', src: '' }));
  });
});

describe('buildElementPayload mediaFill flag', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  it('sets mediaFill only for data-sq-media="true"', () => {
    document.body.innerHTML = `
      <div id="a" data-sq-source="src/pages/index.astro:3:1" data-sq-media="true"></div>
      <div id="b" data-sq-source="src/pages/index.astro:4:1" data-sq-media="false"></div>
      <div id="c" data-sq-source="src/pages/index.astro:5:1"></div>
    `;
    const p = (id: string) =>
      bridge.buildElementPayload(document.getElementById(id), { computedStyles: false });
    expect(p('a').mediaFill).toBe(true);
    expect(p('b').mediaFill).toBeUndefined();
    expect(p('c').mediaFill).toBeUndefined();
  });
});

describe('node_modules is never a source location (Image.astro incident)', () => {
  it('parseSourceLocation + getElementKey refuse node_modules astro attrs', () => {
    resetHarnessDom();
    const bridge = mountBridgeForTest();
    document.body.innerHTML = `
      <img id="nm" src="/x.jpg"
        data-astro-source-file="/Users/x/proj/node_modules/astro/components/Image.astro"
        data-astro-source-loc="38:2" />
      <img id="abs" src="/y.jpg"
        data-astro-source-file="/Users/x/somewhere/Image.astro"
        data-astro-source-loc="3:1" />
    `;
    const nm = document.getElementById('nm')!;
    const abs = document.getElementById('abs')!;
    const payload = bridge.buildElementPayload(nm, { computedStyles: false });
    expect(payload.sourceLocation).toBeUndefined();
    expect(bridge.getElementKey(nm)).toMatch(/^dynamic:/);
    // absolute path without /src/ is equally unwritable
    const payload2 = bridge.buildElementPayload(abs, { computedStyles: false });
    expect(payload2.sourceLocation).toBeUndefined();
  });
});

describe('buildElementPayload boundAssetPath (task-142 astro <Image> rebind)', () => {
  beforeEach(() => resetHarnessDom());

  it('decodes the /_image?href=/@fs… URL to the bound src/ asset path', () => {
    const bridge = mountBridgeForTest();
    const href = encodeURIComponent('/@fs/Users/x/proj/src/content/works/images/A/A.png?origWidth=1440&origFormat=png');
    document.body.innerHTML = `
      <img id="bound" data-image-component="true" src="/_image?href=${href}&w=1340&f=webp" alt="A" />
    `;
    const p = bridge.buildElementPayload(document.getElementById('bound'), { computedStyles: false });
    expect(p.boundAssetPath).toBe('/Users/x/proj/src/content/works/images/A/A.png');
    expect(p.sourceLocation).toBeUndefined();
  });

  it('names the owning component for prop-driven imgs (nearest tagged ancestor)', () => {
    const bridge = mountBridgeForTest();
    document.body.innerHTML = `
      <div data-sq-source="src/components/FeaturedWork.astro:11:1">
        <a data-sq-source="src/components/FeaturedWork.astro:26:6">
          <img id="prop" data-image-component="true" src="/sq-placeholder.svg" />
        </a>
      </div>
      <div data-sq-source="src/pages/index.astro:3:1">
        <img id="page" data-image-component="true" src="/sq-placeholder.svg" />
      </div>
    `;
    const p = (id: string) =>
      bridge.buildElementPayload(document.getElementById(id), { computedStyles: false });
    expect(p('prop').ownerComponentFile).toBe('src/components/FeaturedWork.astro');
    // pages are not components — no owner emitted
    expect(p('page').ownerComponentFile).toBeUndefined();
  });

  it('never emits node_modules or non-@fs hrefs; plain imgs get nothing', () => {
    const bridge = mountBridgeForTest();
    const nmHref = encodeURIComponent('/@fs/Users/x/proj/node_modules/pkg/a.png');
    document.body.innerHTML = `
      <img id="nm" data-image-component="true" src="/_image?href=${nmHref}" />
      <img id="remote" data-image-component="true" src="/_image?href=${encodeURIComponent('https://cdn.example/a.png')}" />
      <img id="plain" src="/uploads/a.png" data-sq-source="src/pages/index.astro:3:1" />
    `;
    const p = (id: string) =>
      bridge.buildElementPayload(document.getElementById(id), { computedStyles: false });
    expect(p('nm').boundAssetPath).toBeUndefined();
    expect(p('remote').boundAssetPath).toBeUndefined();
    expect(p('plain').boundAssetPath).toBeUndefined();
  });
});

describe('buildElementPayload video src (task-141 undo needs it)', () => {
  it('video elements carry imageAttributes.src', () => {
    resetHarnessDom();
    const bridge = mountBridgeForTest();
    document.body.innerHTML =
      '<video id="v" data-sq-source="src/pages/index.astro:7:7" src="/uploads/clip.mp4"></video>';
    const p = bridge.buildElementPayload(document.getElementById('v'), { computedStyles: false });
    expect((p as { imageAttributes?: { src?: string } }).imageAttributes?.src).toBe('/uploads/clip.mp4');
  });
});

describe('handleFileDrop / handleFileDragOver (task-141 canvas drop)', () => {
  let bridge: HarnessBridge;
  let sent: Array<{ type: string; payload?: Record<string, unknown> }>;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    sent = [];
    (bridge as unknown as { sendToParent: (m: unknown) => void }).sendToParent =
      (m: unknown) => sent.push(m as { type: string });
  });

  it('drop on a source element sends CANVAS_FILE_DROP with payload, files, insideAnchor', () => {
    document.body.innerHTML =
      '<a href="/x"><div id="t" data-key="src/pages/index.astro:5:3" data-sq-source="src/pages/index.astro:5:3"></div></a>';
    const el = document.getElementById('t')!;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    bridge.handleFileDrop({
      dataTransfer: { files: [file] },
      target: el,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    const msg = sent.find(m => m.type === 'CANVAS_FILE_DROP')!;
    expect(msg).toBeTruthy();
    const target = (msg.payload as { target: Record<string, unknown> }).target;
    expect(target.key).toBe('src/pages/index.astro:5:3');
    expect(target.insideAnchor).toBe(true);
    expect((msg.payload as { files: File[] }).files[0]).toBe(file);
  });

  it('dragover without a Files type is left to other drag systems', () => {
    const prevent = vi.fn();
    bridge.handleFileDragOver({
      dataTransfer: { types: ['text/plain'] },
      preventDefault: prevent,
    });
    expect(prevent).not.toHaveBeenCalled();
  });

  it('drop with no files is ignored', () => {
    bridge.handleFileDrop({
      dataTransfer: { files: [] },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    expect(sent.find(m => m.type === 'CANVAS_FILE_DROP')).toBeUndefined();
  });
});

describe('injectMediaPlaceholderStyles (task-141 WC placeholder)', () => {
  it('injects the [data-sq-media] mountain-art CSS once', () => {
    resetHarnessDom();
    const bridge = mountBridgeForTest();
    bridge.injectMediaPlaceholderStyles();
    bridge.injectMediaPlaceholderStyles(); // idempotent
    const els = document.querySelectorAll('#sq-media-placeholder-styles');
    expect(els.length).toBe(1);
    expect(els[0].textContent).toContain('[data-sq-media="true"]');
    expect(els[0].textContent).toContain('data:image/svg+xml');
  });
});

describe('buildElementPayload hasElementChildren', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  it('true for element children, false for text-only', () => {
    document.body.innerHTML = `
      <div id="a" data-sq-source="src/pages/index.astro:3:1"><span>x</span></div>
      <div id="b" data-sq-source="src/pages/index.astro:4:1">text only</div>
    `;
    const p = (id: string) =>
      bridge.buildElementPayload(document.getElementById(id), { computedStyles: false });
    expect(p('a').hasElementChildren).toBe(true);
    expect(p('b').hasElementChildren).toBe(false);
  });
});
