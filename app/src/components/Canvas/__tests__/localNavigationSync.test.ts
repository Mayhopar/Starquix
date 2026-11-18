import { describe, it, expect } from 'vitest';
import { LocalNavigationSync } from '../localNavigationSync';

const origin = 'https://instance.test';
const source = {} as Window;

describe('current-document navigation correlation', () => {
  it('recovers a lost departing announce from the new current document without changing src', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/about`);
    const initial = sync.request(source)!;
    expect(sync.accept(source, { ...initial, href: `${origin}/about` }, origin)).toBe(`${origin}/about`);
    // Native navigation changes the document, not the parent src attribute.
    const home = sync.request(source)!;
    expect(sync.accept(source, { ...home, href: `${origin}/` }, origin)).toBe(`${origin}/`);
    sync.adopt('/');
    sync.intent('project', `${origin}/`); // editor adopts the confirmed native route
    expect(sync.request(source)).not.toBeNull();
  });

  it('rejects a late old reply after a newer sidebar intent, even from the same WindowProxy', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/`);
    const old = sync.request(source)!;
    sync.intent('project', `${origin}/about?q=2`);
    expect(sync.accept(source, { ...old, href: `${origin}/` }, origin)).toBeNull();
    const next = sync.request(source)!;
    expect(sync.accept(source, { ...next, href: `${origin}/` }, origin)).toBeNull();
    const complete = sync.request(source)!;
    expect(sync.accept(source, { ...complete, href: `${origin}/about?q=2` }, origin)).toBe(`${origin}/about?q=2`);
  });

  it('requires the captured source, request, instance origin and exact programmatic path/query', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/about?q=1`);
    const request = sync.request(source)!;
    expect(sync.accept({} as Window, { ...request, href: `${origin}/about?q=1` }, origin)).toBeNull();
    expect(sync.accept(source, { requestId: 'stale', href: `${origin}/about?q=1` }, origin)).toBeNull();
    expect(sync.accept(source, { ...request, href: 'https://other.test/about?q=1' }, origin)).toBeNull();
    const next = sync.request(source)!;
    expect(sync.accept(source, { ...next, href: `${origin}/about?q=2` }, origin)).toBeNull();
  });

  it('invalidates on project/instance changes and unmount, but not an override-only fragment', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/`);
    const request = sync.request(source)!;
    sync.intent('project', `${origin}/#sq-ov=next`);
    expect(sync.accept(source, { ...request, href: `${origin}/` }, origin)).toBe(`${origin}/`);
    const old = sync.request(source)!;
    sync.intent('other-project', `${origin}/`);
    expect(sync.accept(source, { ...old, href: `${origin}/` }, origin)).toBeNull();
    const current = sync.request(source)!;
    sync.invalidate();
    expect(sync.accept(source, { ...current, href: `${origin}/` }, origin)).toBeNull();
  });
});


it('rejects a current WindowProxy reply from an unexpected document origin', () => {
  const sync = new LocalNavigationSync();
  sync.intent('project', `${origin}/`);
  const request = sync.request(source)!;
  expect(sync.accept(source, { ...request, href: `${origin}/` }, 'https://other.test')).toBeNull();
});

it('retains exact authenticated path/query for reads, fragment changes and explicit reload', () => {
  const sync = new LocalNavigationSync();
  sync.intent('project', `${origin}/`);
  sync.accept(source, { ...sync.request(source)!, href: `${origin}/` }, origin);
  const href = `${origin}/about/?q=1`;
  sync.accept(source, { ...sync.request(source)!, href }, origin);
  sync.adopt('/about');
  expect(sync.intent('project', `${origin}/about`)).toBe(false);
  expect(sync.currentDocument('project', `${origin}/about#sq-ov=next`, source)).toBe(`${href}#sq-ov=next`);
  sync.navigate(`${href}#sq-ov=next`);
  expect(sync.confirmedDocument('project', `${origin}/about`, source)).toBeNull();
  expect(sync.currentDocument('project', `${origin}/about`, source)).toBe(href);
  expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/about` }, origin)).toBeNull();
  expect(sync.accept(source, { ...sync.request(source)!, href }, origin)).toBe(href);
});

it('invalidates current document before render for a newer query, project or frame owner', () => {
  const sync = new LocalNavigationSync();
  sync.intent('project', `${origin}/`);
  sync.accept(source, { ...sync.request(source)!, href: `${origin}/` }, origin);
  const href = `${origin}/about/?native=1`;
  sync.accept(source, { ...sync.request(source)!, href }, origin);
  sync.adopt('/about');
  expect(sync.currentDocument('project', `${origin}/about`, source)).toBe(href);
  expect(sync.currentDocument('project', `${origin}/about?sidebar=2`, source)).toBe(`${origin}/about?sidebar=2`);
  expect(sync.confirmedDocument('other', `${origin}/`, source)).toBeNull();
  expect(sync.confirmedDocument('project', `${origin}/`, {} as Window)).toBeNull();
  sync.intent('project', `${origin}/about?sidebar=2`);
  expect(sync.confirmedDocument('project', `${origin}/about?sidebar=2`, source)).toBeNull();
});

it('a replacement load invalidates delayed discovery adoption of its predecessor', () => {
  const sync = new LocalNavigationSync();
  sync.intent('project', `${origin}/`);
  sync.accept(source, { ...sync.request(source)!, href: `${origin}/` }, origin);
  sync.accept(source, { ...sync.request(source)!, href: `${origin}/undiscovered` }, origin);
  const replacement = sync.request(source)!;
  sync.adopt('/undiscovered'); // no current document remains to adopt
  expect(sync.confirmedDocument('project', `${origin}/`, source)).toBeNull();
  expect(sync.accept(source, { ...replacement, href: `${origin}/` }, origin)).toBe(`${origin}/`);
  expect(sync.intent('project', `${origin}/undiscovered`)).toBe(true);
});


it.each(['sidebar', 'query', 'project', 'instance', 'reset', 'frame'])('pending native parking cannot survive a newer %s owner/intent', change => {
  const sync = new LocalNavigationSync();
  sync.intent('project', `${origin}/`);
  sync.accept(source, { ...sync.request(source)!, href: `${origin}/` }, origin);
  const request = sync.request(source)!;
  expect(sync.awaitingNativeDocument('project', `${origin}/`, source)).toBe(true);
  const project = change === 'project' ? 'other' : 'project';
  const href = change === 'sidebar' ? `${origin}/about` : change === 'query' ? `${origin}/?q=2` : change === 'instance' ? 'https://other.test/' : `${origin}/`;
  const frame = change === 'frame' ? {} as Window : source;
  if (change === 'reset') sync.navigate(href);
  expect(sync.awaitingNativeDocument(project, href, frame)).toBe(false);
  if (change !== 'frame') {
    sync.intent(project, href);
    expect(sync.accept(source, { ...request, href: `${origin}/` }, origin)).toBeNull();
  }
});

// Owner 2026-11-10 ("it must just SWITCH"), live in the desktop app: Chromium
// does not cancel a superseded iframe navigation, and either commit order
// happens. /blog then /about 77 ms apart: /blog committed, /about never did. A
// 2.5 s /slow then /about: /about committed, then /slow replaced it. Either way
// the canvas stayed on a page the user had left while every edit waited.
describe('a page the editor navigated to and left before it committed', () => {
  it('commits while the newer page is pending → flagged, never confirmed', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/about`);
    sync.accept(source, { ...sync.request(source)!, href: `${origin}/about` }, origin);
    sync.intent('project', `${origin}/blog`);
    sync.intent('project', `${origin}/about`); // straight back, before /blog committed
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/blog` }, origin)).toBeNull();
    expect(sync.takeStrayDocument()).toBe(true);
    expect(sync.takeStrayDocument()).toBe(false);
    sync.navigate(`${origin}/about`);
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/about` }, origin)).toBe(`${origin}/about`);
  });

  it('commits AFTER the newer page committed → flagged, not adopted like a native link click', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/about`);
    sync.accept(source, { ...sync.request(source)!, href: `${origin}/about` }, origin);
    sync.intent('project', `${origin}/slow`);
    sync.intent('project', `${origin}/about`);
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/about` }, origin)).toBe(`${origin}/about`);
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/slow` }, origin)).toBeNull();
    expect(sync.takeStrayDocument()).toBe(true);
    // Consumed: a later native link click to /slow is the user's, and is followed.
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/slow` }, origin)).toBe(`${origin}/slow`);
    expect(sync.takeStrayDocument()).toBe(false);
  });

  it('a page reached natively or by redirect was never left → never flagged', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/about`);
    sync.accept(source, { ...sync.request(source)!, href: `${origin}/about/` }, origin); // trailing-slash variant
    sync.accept(source, { ...sync.request(source)!, href: `${origin}/elsewhere` }, origin); // native click / redirect
    expect(sync.takeStrayDocument()).toBe(false);
    sync.intent('project', `${origin}/blog`);
    sync.intent('project', `${origin}/blog`); // same intent twice is not leaving it
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/blog` }, origin)).toBe(`${origin}/blog`);
    expect(sync.takeStrayDocument()).toBe(false);
  });

  it('forgets left pages on a project change', () => {
    const sync = new LocalNavigationSync();
    sync.intent('project', `${origin}/blog`);
    sync.intent('project', `${origin}/about`);
    sync.intent('other', `${origin}/`);
    sync.accept(source, { ...sync.request(source)!, href: `${origin}/` }, origin);
    expect(sync.accept(source, { ...sync.request(source)!, href: `${origin}/blog` }, origin)).toBe(`${origin}/blog`);
    expect(sync.takeStrayDocument()).toBe(false);
  });
});
