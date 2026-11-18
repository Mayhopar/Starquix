/**
 * Regression: EDIT_MODE_EXITED textContent source parity (task-017)
 *
 * Two paths in `preview-template/public/scripts/bridge.js` send
 * `EDIT_MODE_EXITED` to the parent:
 *
 *   1. `IFrameBridge.prototype.exitEditModeCleanup` — the canonical exit path
 *      (blur / Escape / click-outside / window-blur). Sends
 *      `payload.textContent = element.textContent` (PLAIN TEXT).
 *
 *   2. `IFrameBridge.prototype.handleWrapSelectionInLink` — runs after a link
 *      is wrapped around a text selection. Historically sent
 *      `payload.textContent = element.innerHTML` (HTML MARKUP, including the
 *      newly-inserted `<a>` tag).
 *
 * The ViewportFrame `EDIT_MODE_EXITED` handler treats `payload.textContent`
 * as plain text: it stores it in either an instance text override
 * (`UPDATE_INSTANCE_OVERRIDE { text }`) or in the `sourceText` Yjs map
 * (`UPDATE_SOURCE_TEXT`). When the wrap path leaks `innerHTML`, that text
 * field gets clobbered with HTML markup AND the link tag itself is stored a
 * second time (the markup is already persisted via the `MARKUP_CHANGED`
 * message that fires immediately before).
 *
 * Both paths must read from the same property — `textContent` is the right
 * one because the link insertion is already covered by `MARKUP_CHANGED` (see
 * systems.json `text-editing.knownIssues` and
 * `app/src/components/Canvas/__tests__/ViewportFrame.test.tsx` MARKUP_CHANGED
 * tests for the consumer behavior).
 *
 * If this test fails: do NOT switch the cleanup path to innerHTML — fix the
 * wrap path to read textContent (or split the message contract so HTML moves
 * to its own field).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRIDGE_JS_PATH = path.resolve(
  __dirname,
  '../../../../preview-template/public/scripts/bridge.js',
);

function loadBridgeSource(): string {
  return fs.readFileSync(BRIDGE_JS_PATH, 'utf8');
}

/**
 * Extract the body of an `IFrameBridge.prototype.<name> = function(...) { ... }`
 * declaration by counting braces from the opening `{`.
 */
function extractPrototypeBody(source: string, name: string): string {
  const re = new RegExp(
    'IFrameBridge\\.prototype\\.' + name + '\\s*=\\s*function[^{]*\\{',
  );
  const match = re.exec(source);
  if (!match) {
    throw new Error('Could not locate IFrameBridge.prototype.' + name);
  }
  const startIdx = match.index + match[0].length;
  let depth = 1;
  let i = startIdx;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    // Skip strings to avoid counting braces inside them.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Skip line comments.
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    // Skip block comments.
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return source.slice(startIdx, i - 1);
}

/**
 * Find the object-literal payload passed to `sendToParent({ type: 'EDIT_MODE_EXITED', payload: { ... } })`
 * inside the given function body. Returns the raw text of the payload object.
 */
function extractEditModeExitedPayload(body: string): string {
  // Match `type: 'EDIT_MODE_EXITED'` then the following `payload: { ... }`.
  const typeIdx = body.search(/type:\s*['"]EDIT_MODE_EXITED['"]/);
  if (typeIdx < 0) {
    throw new Error('No EDIT_MODE_EXITED send found in function body');
  }
  const after = body.slice(typeIdx);
  const payloadMatch = /payload:\s*\{/.exec(after);
  if (!payloadMatch) {
    throw new Error('No payload literal after EDIT_MODE_EXITED type');
  }
  const startIdx = payloadMatch.index + payloadMatch[0].length;
  let depth = 1;
  let i = startIdx;
  while (i < after.length && depth > 0) {
    const ch = after[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return after.slice(startIdx, i - 1);
}

describe('EDIT_MODE_EXITED textContent source parity (task-017)', () => {
  const source = loadBridgeSource();

  it('exitEditModeCleanup sends textContent from element.textContent', () => {
    const body = extractPrototypeBody(source, 'exitEditModeCleanup');
    const payload = extractEditModeExitedPayload(body);
    // The payload must read from the textContent variable, which the
    // cleanup function declares as `var newText = element.textContent;`.
    expect(body).toMatch(/var\s+newText\s*=\s*element\.textContent/);
    expect(payload).toMatch(/textContent:\s*newText\b/);
    // And must NOT carry innerHTML in the textContent slot.
    expect(payload).not.toMatch(/textContent:[^,}]*innerHTML/);
  });

  it('handleWrapSelectionInLink sends textContent from editingElement.textContent (NOT innerHTML)', () => {
    const body = extractPrototypeBody(source, 'handleWrapSelectionInLink');
    const payload = extractEditModeExitedPayload(body);

    // The fix: newText must be sourced from .textContent, not .innerHTML.
    // Pre-fix this assertion failed because the line read
    //   var newText = self.editingElement ? self.editingElement.innerHTML : '';
    expect(body).toMatch(
      /var\s+newText\s*=\s*self\.editingElement\s*\?\s*self\.editingElement\.textContent\s*:/,
    );
    expect(body).not.toMatch(
      /var\s+newText\s*=\s*self\.editingElement\s*\?\s*self\.editingElement\.innerHTML\s*:/,
    );

    // The payload's textContent slot must NOT contain a literal innerHTML reference.
    expect(payload).not.toMatch(/textContent:[^,}]*innerHTML/);
    expect(payload).toMatch(/textContent:\s*newText\b/);
  });

  it('both EDIT_MODE_EXITED senders use the same payload shape (key, textContent, originalText)', () => {
    const cleanupPayload = extractEditModeExitedPayload(
      extractPrototypeBody(source, 'exitEditModeCleanup'),
    );
    const wrapPayload = extractEditModeExitedPayload(
      extractPrototypeBody(source, 'handleWrapSelectionInLink'),
    );

    for (const payload of [cleanupPayload, wrapPayload]) {
      expect(payload).toMatch(/\bkey:/);
      expect(payload).toMatch(/\btextContent:/);
      expect(payload).toMatch(/\boriginalText:/);
    }
  });
});
