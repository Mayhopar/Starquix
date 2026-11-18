/**
 * Every postMessage type sent from app/src to the iframe must be registered
 * in the bridge's _handlers map. Catches the SIMULATE_HOVER bug class:
 * a sender added on the React side with no handler shipped to the iframe.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IFRAME_BRIDGE_SCRIPT } from '../IFrameBridgeScript.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../..');

// Message types handled outside the _handlers map or via other channels.
// Every entry verified 2026-06-10 by classifying its send mechanism.
const IGNORE = new Set<string>([
  // Yjs store command types (dispatch({type}), not postMessage — the regex
  // catches them because the file also contains postMessage somewhere):
  'ADD_CONTENT_COLLECTION', 'ADD_ELEMENT', 'ADD_VARIABLE', 'ADD_VARIABLE_COLLECTION',
  'CLEAR_DRAWN_SLOT_FILL', 'CLEAR_SOURCE_TEXT', 'DELETE_INSTANCE_CHILD', 'DELETE_VARIABLE',
  'GRID_PLACE_ELEMENT', 'REGISTER_SOURCE_ELEMENT', 'REMOVE_ELEMENT',
  'REORDER_PAGE_ELEMENTS', 'REPARENT_ELEMENT', 'SET_BLOG_SLOT_COLLECTION', 'SET_ELEMENT_SLOT_NAME',
  'SET_GRID_SPAN', 'SET_PAGE_LAYOUT', 'SET_POST_PAGE_BINDING', 'UNBIND_BLOG_SLOT',
  'UPDATE_BLOG_SLOT_SETTINGS', 'UPDATE_MARKUP_OVERRIDE', 'UPDATE_SOURCE_CLASSES',
  'UPDATE_SOURCE_TEXT', 'UPDATE_STATIC_MARKUP', 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
  'UPDATE_VARIABLE_VALUE',
  // task-107 (verified 2026-07-11): Yjs command dispatched in Canvas.tsx,
  // which also hosts the pen staticMarkup→iframe mirror (postMessage):
  'UPDATE_PEN_PATH',
  // AI tool parity (2026-06-12): dispatched via ctx.dispatch in
  // commandTools.ts, which also contains a window.postMessage relay:
  'ADD_VARIABLE_MODE', 'ADD_DRAWN_ELEMENT', 'ADD_COLLECTION_FIELD',
  'RENAME_COLLECTION_FIELD', 'DELETE_COLLECTION_FIELD', 'RENAME_CONTENT_COLLECTION',
  'DELETE_CONTENT_COLLECTION', 'SET_CONTENT_BINDING',
  // task-119 (verified 2026-07-17): Yjs command applied via applyCommand in
  // commandTools.ts (select_page / add_page auto-switch), same file as above:
  'SET_CURRENT_PAGE',
  // task-266 (verified 2026-11-12): the same, for set_breakpoint — a session
  // command in the doc; the frame follows its `breakpoint` prop, nothing is posted:
  'SET_BREAKPOINT',
  // Same-window relay (window.postMessage between panels/contexts and
  // ViewportFrame, which translates them into real bridge messages):
  'LOCAL_PAGE_CHANGED', 'NAVIGATE_LOCAL_PAGE',
  'REORDER_ELEMENTS_IN_IFRAME', 'REPARENT_ELEMENT_IN_IFRAME',
  'SYNC_ASSET_TO_IFRAME', 'SYNC_IMAGE_ATTR_TO_IFRAME', 'SYNC_LINK_ATTR_TO_IFRAME',
  'SYNC_REMOVE_ELEMENT_FROM_DOM', 'SYNC_TEXT_TO_IFRAME',
  // Predicted paint (2026-11-08): ⌘D's copy; ViewportFrame translates it into the
  // registered CLONE_ELEMENT_IN_DOM bridge message:
  'SYNC_CLONE_ELEMENT_IN_DOM',
  // task-206 (verified 2026-08-11): MediaBlock demo knobs; ViewportFrame
  // translates into the registered SET_MEDIA_DEMO bridge message:
  'SET_MEDIA_DEMO_TO_IFRAME',
  // task-151 (verified 2026-08-04): posted by ClassStoreContext /
  // useSourceImageSync on the same window; ViewportFrame translates them into
  // the real RESTORE_ORIGINAL_CLASSES / RESTORE_ORIGINAL_IMAGE_ATTRIBUTES
  // bridge messages, both of which ARE registered handlers:
  'RESTORE_CLASSES_TO_IFRAME', 'RESTORE_IMAGE_ATTRS_TO_IFRAME',
  // Remote-graph channel (RemoteGraphContext's injected postMessage — a
  // separate protocol, not the preview-iframe bridge):
  'GRAPH_REDO', 'GRAPH_REQUEST_STATE', 'GRAPH_STATE_UPDATE', 'GRAPH_TRANSACT', 'GRAPH_UNDO',
  // iframe→parent types that only appear in ViewportFrame's receive-side
  // ChildMessage union / switch cases:
  'READY', 'ELEMENT_CLICKED', 'ELEMENT_HOVERED', 'ELEMENT_RECT',
  // Emitted by generated export runtime code in generateAstro.ts strings
  // (iframe→parent HMR write results), not a parent→iframe send:
  'SQ_WRITE_RESULT',
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.includes('__tests__')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

function sentTypes(): Set<string> {
  const types = new Set<string>();
  for (const f of walk(SRC_DIR)) {
    if (f.includes(path.join('src', 'bridge') + path.sep)) continue; // bridge itself
    // Runs INSIDE the preview iframe and posts child→parent, which is the
    // opposite direction to the one this guard protects — same reason the
    // bridge's own source is skipped above.
    if (f.includes(path.join('src', 'previewEditor') + path.sep)) continue;
    const src = fs.readFileSync(f, 'utf8');
    // postMessage({ type: 'X', ... }) — only files that actually post to iframes
    if (!src.includes('postMessage')) continue;
    const re = /type:\s*'([A-Z][A-Z0-9_]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) types.add(m[1]);
  }
  return types;
}

describe('sender/handler parity', () => {
  it('every parent->iframe message type has a registered handler', () => {
    const registered = new Set(
      [...IFRAME_BRIDGE_SCRIPT.matchAll(/_handlers\[\s*'([A-Z_]+)'\s*\]/g)].map((m) => m[1]),
    );
    const missing = [...sentTypes()].filter((t) => !registered.has(t) && !IGNORE.has(t));
    expect(missing).toEqual([]);
  });
});
