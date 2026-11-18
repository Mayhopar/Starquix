/**
 * ONE chrome resolver, shared by the canvas render and the delete-a-layout
 * transform. A parallel lookalike resolver is the mistake that cost a month on
 * layout parity — these tests pin the contract so the two cannot drift.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { resolvePageChrome } from '../selectors';
import { ensureLayoutElement } from '../layoutElement';

function docWithPage(pageId: string, layoutName: string): Y.Doc {
  const doc = new Y.Doc();
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('layoutName', layoutName);
  page.set('rootElementIds', new Y.Array());
  doc.getMap('pages').set(pageId, page);
  return doc;
}

describe('resolvePageChrome', () => {
  it('reads the chrome element when the page has one', () => {
    const doc = docWithPage('p1', 'Foo');
    ensureLayoutElement(doc, 'p1', 'Foo', '<body><header>hi</header><slot /></body>');
    const chrome = resolvePageChrome(doc, 'p1', 'Foo', new Map());
    expect(chrome).toContain('<header');
    expect(chrome).toContain('<slot');
  });

  it('falls back to layoutBodies when the page was never opened', () => {
    const doc = docWithPage('p1', 'Foo');
    const bodies = new Map([['Foo', '<body><nav>n</nav><slot /></body>']]);
    const chrome = resolvePageChrome(doc, 'p1', 'Foo', bodies);
    expect(chrome).toContain('<nav');
  });

  it('returns null when neither source has the layout', () => {
    const doc = docWithPage('p1', 'Foo');
    expect(resolvePageChrome(doc, 'p1', 'Foo', new Map())).toBeNull();
  });
});

