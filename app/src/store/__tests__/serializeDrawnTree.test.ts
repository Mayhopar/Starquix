import { describe, it, expect } from 'vitest';
import { serializeDrawnTree, serializeDrawnPayload, generateComponentName } from '../serializeDrawnTree';
import { buildShape } from '@/components/Canvas/shapeMarkup';

// task-133 Task 7: local-mode draw payload serialization. Output lands
// DIRECTLY in .astro text position, where `{` opens an expression — braces
// must be entity-escaped on top of the HTML escaping.
describe('serializeDrawnPayload', () => {
  it('escapes HTML AND Astro braces in textContent', () => {
    expect(
      serializeDrawnPayload({ tag: 'p', classes: 'w-[80px]', textContent: 'a {b} <c> & d' })
    ).toBe('<p class="w-[80px]">a &#123;b&#125; &lt;c&gt; &amp; d</p>');
  });

  it('staticMarkup passthrough is NOT brace-escaped (generated shape/pen markup)', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>';
    expect(
      serializeDrawnPayload({ tag: 'div', classes: 'fill-none', textContent: '', staticMarkup: svg })
    ).toBe(`<div class="fill-none">${svg}</div>`);
  });

  it('plain frame: no data-sq-drawn marker, empty body', () => {
    expect(
      serializeDrawnPayload({ tag: 'section', classes: 'w-[10px]', textContent: '' })
    ).toBe('<section class="w-[10px]"></section>');
  });
});

describe('serializeDrawnTree', () => {
  it('serializes a single element with classes and text', () => {
    const elements = [
      { key: 'sq-1', tag: 'p', classes: 'text-lg font-bold', textContent: 'Hello', parentKey: null },
    ];
    expect(serializeDrawnTree(elements, 'sq-1')).toBe(
      '<p class="text-lg font-bold">Hello</p>'
    );
  });

  it('serializes nested children sorted by insertion order', () => {
    const elements = [
      { key: 'sq-1', tag: 'div', classes: 'flex gap-4', textContent: '', parentKey: null },
      { key: 'sq-2', tag: 'h1', classes: 'text-2xl', textContent: 'Title', parentKey: 'sq-1' },
      { key: 'sq-3', tag: 'p', classes: 'text-gray-600', textContent: 'Desc', parentKey: 'sq-1' },
    ];
    const html = serializeDrawnTree(elements, 'sq-1');
    expect(html).toBe(
      '<div class="flex gap-4">\n' +
      '  <h1 class="text-2xl">Title</h1>\n' +
      '  <p class="text-gray-600">Desc</p>\n' +
      '</div>'
    );
  });

  it('serializes deeply nested trees', () => {
    const elements = [
      { key: 'sq-1', tag: 'section', classes: 'p-8', textContent: '', parentKey: null },
      { key: 'sq-2', tag: 'div', classes: 'mt-4', textContent: '', parentKey: 'sq-1' },
      { key: 'sq-3', tag: 'a', classes: 'text-blue-500', textContent: 'Click', parentKey: 'sq-2' },
    ];
    const html = serializeDrawnTree(elements, 'sq-1');
    expect(html).toBe(
      '<section class="p-8">\n' +
      '  <div class="mt-4">\n' +
      '    <a class="text-blue-500">Click</a>\n' +
      '  </div>\n' +
      '</section>'
    );
  });

  it('handles void elements (self-closing)', () => {
    const elements = [
      { key: 'sq-1', tag: 'div', classes: 'p-4', textContent: '', parentKey: null },
      { key: 'sq-2', tag: 'img', classes: 'w-full', textContent: '', parentKey: 'sq-1' },
      { key: 'sq-3', tag: 'hr', classes: 'my-4', textContent: '', parentKey: 'sq-1' },
    ];
    const html = serializeDrawnTree(elements, 'sq-1');
    expect(html).toBe(
      '<div class="p-4">\n' +
      '  <img class="w-full" />\n' +
      '  <hr class="my-4" />\n' +
      '</div>'
    );
  });

  it('omits class attribute when classes are empty', () => {
    const elements = [
      { key: 'sq-1', tag: 'div', classes: '', textContent: '', parentKey: null },
    ];
    expect(serializeDrawnTree(elements, 'sq-1')).toBe('<div></div>');
  });

  it('escapes HTML entities in text content', () => {
    const elements = [
      { key: 'sq-1', tag: 'p', classes: '', textContent: '<script>alert("xss")</script>', parentKey: null },
    ];
    const html = serializeDrawnTree(elements, 'sq-1');
    expect(html).toBe('<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>');
  });

  it('does NOT stamp data-sq-drawn by default (export / Make Component stay clean)', () => {
    const elements = [
      { key: 'sq-1', tag: 'div', classes: 'box', textContent: '', parentKey: null },
      { key: 'sq-2', tag: 'p', classes: '', textContent: 'Hi', parentKey: 'sq-1' },
    ];
    const html = serializeDrawnTree(elements, 'sq-1');
    expect(html).not.toContain('data-sq-drawn');
  });

  it('stamps data-sq-drawn on the ROOT only when markRoot is set', () => {
    const elements = [
      { key: 'sq-1', tag: 'div', classes: 'box', textContent: '', parentKey: null },
      { key: 'sq-2', tag: 'p', classes: '', textContent: 'Hi', parentKey: 'sq-1' },
    ];
    const html = serializeDrawnTree(elements, 'sq-1', { markRoot: true });
    // Root carries the marker, after the class attribute…
    expect(html).toContain('<div class="box" data-sq-drawn="sq-1">');
    // …and exactly once (children are NOT marked).
    expect(html.match(/data-sq-drawn/g)).toHaveLength(1);
  });

  it('stamps the marker on a void root element', () => {
    const elements = [
      { key: 'sq-1', tag: 'img', classes: 'w-full', textContent: '', parentKey: null },
    ];
    const html = serializeDrawnTree(elements, 'sq-1', { markRoot: true });
    expect(html).toBe('<img class="w-full" data-sq-drawn="sq-1" />');
  });
});

describe('generateComponentName', () => {
  it('capitalizes tag name', () => {
    expect(generateComponentName('div', [])).toBe('Div');
    expect(generateComponentName('section', [])).toBe('Section');
    expect(generateComponentName('nav', [])).toBe('Nav');
  });

  it('appends index when name exists', () => {
    expect(generateComponentName('div', ['Div'])).toBe('Div2');
    expect(generateComponentName('div', ['Div', 'Div2'])).toBe('Div3');
  });

  it('handles existing indexed names with gaps', () => {
    expect(generateComponentName('div', ['Div', 'Div3'])).toBe('Div2');
  });
});

describe('serializeDrawnTree staticMarkup (task-106 vector shapes)', () => {
  it('emits staticMarkup as raw inner content for leaf nodes', () => {
    const els = [{ key: 'a', tag: 'div', classes: 'w-[100px] text-gray-900', textContent: '', parentKey: null,
      staticMarkup: '<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100"/></svg>' }];
    const out = serializeDrawnTree(els, 'a');
    expect(out).toContain('<svg viewBox');       // raw, not escaped
    expect(out).not.toContain('&lt;svg');
  });

  it('slotType elements never emit staticMarkup (blog-slot bake regression guard)', () => {
    const els = [{ key: 'b', tag: 'div', classes: 'w-full', textContent: '', parentKey: null,
      slotType: 'blog', staticMarkup: '<div>BLOG SLOT RAW HTML</div>' }];
    expect(serializeDrawnTree(els, 'b')).not.toContain('BLOG SLOT RAW HTML');
  });

  it('children win over staticMarkup', () => {
    const els = [
      { key: 'p', tag: 'div', classes: '', textContent: '', parentKey: null, staticMarkup: '<svg/>' },
      { key: 'c', tag: 'div', classes: 'child', textContent: '', parentKey: 'p' },
    ];
    const out = serializeDrawnTree(els, 'p');
    expect(out).toContain('child');
    expect(out).not.toContain('<svg/>');
  });
});

describe('serializeDrawnTree universal vector shapes (task-109)', () => {
  it('arrow staticMarkup with <defs><marker> raw-emits intact', () => {
    const arrowMarkup = buildShape('arrow', 200, 50, true).staticMarkup;
    const els = [{ key: 'a', tag: 'div', classes: 'w-[200px] h-[50px] fill-none stroke-gray-900 stroke-2',
      textContent: '', parentKey: null, staticMarkup: arrowMarkup }];
    const out = serializeDrawnTree(els, 'a');
    expect(out).toContain('<defs><marker id="sq-arrow"');
    expect(out).toContain('marker-end=');
    expect(out).not.toContain('&lt;defs');
  });

  it('old-model shape (staticMarkup, no penPath) still raw-emits', () => {
    // task-106-era currentColor SVG — render-only compat, by design
    const oldMarkup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style="display:block">' +
      '<line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
    const els = [{ key: 'b', tag: 'div', classes: 'w-[200px] h-[50px] text-gray-900',
      textContent: '', parentKey: null, staticMarkup: oldMarkup }];
    const out = serializeDrawnTree(els, 'b');
    expect(out).toContain(oldMarkup); // emitted verbatim
  });
});
