/**
 * The concrete writers' (`services/Vite*Writer.ts`) iframe payloads, read off
 * their source: every one must carry a `sourceLocation`, because the local
 * write-scope law in `BaseViteWriter.sendRequest` gates on it.
 *
 * This file used to also pin the page-side senders in SqHmrWriteBridge.astro
 * field by field; those senders and the dev-server socket handlers behind them
 * were retired 2026-10-18 (instance-write-path-retired.test.ts).
 *
 * The extractor reads top-level identifier keys of an object LITERAL; a writer
 * that switches to `{...opts}` would silently contribute no fields. Keep the
 * writers' payloads literal.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = path.resolve(__dirname, '../../services');

/** `requestId` is added by BaseViteWriter.sendRequest, not by the writers. */
const IMPLICIT_FIELDS = ['requestId'];

interface WritePayloadContract {
  messageType: string;
  fields: string[];
  source: string;
}

/** Top-level keys of an object literal starting at `src[open]` (the `{`). */
function literalKeys(src: string, open: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = open;
  let expectKey = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (depth === 1) expectKey = true;
      i++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) break;
      i++;
      continue;
    }
    if (depth === 1) {
      if (c === ',') { expectKey = true; i++; continue; }
      if (expectKey && /[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
        keys.push(src.slice(i, j));
        expectKey = false;
        i = j;
        continue;
      }
    }
    i++;
  }
  return keys;
}

/** Every `SQ_WRITE_*` payload the concrete writers build, with its literal keys. */
function writerContracts(): WritePayloadContract[] {
  const out: WritePayloadContract[] = [];
  for (const name of fs.readdirSync(SERVICES_DIR)) {
    if (!/^Vite.*Writer\.ts$/.test(name)) continue;
    const src = fs.readFileSync(path.join(SERVICES_DIR, name), 'utf8');
    const re = /sendViaPostMessage(?:ForPayload)?(?:<[^>]*>)?\(\s*'(SQ_WRITE_[A-Z_]+)'\s*,\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const messageType = m[1];
      out.push({
        messageType,
        fields: [...literalKeys(src, re.lastIndex - 1), ...IMPLICIT_FIELDS],
        source: name,
      });
    }
  }
  return out;
}

describe('writer payloads — the write-scope law has no blind spot', () => {
  const contracts = writerContracts();

  it('found every writer payload (guard against a silently empty extraction)', () => {
    const types = contracts.map((c) => c.messageType).sort();
    // Structural ops (insert/append-page/remove/move/restore/restore-region/
    // import) no longer post to the iframe: since c8535b79 ("add durable
    // structural dispatch core") ViteStructuralWriter routes them through
    // acceptStructuralOperations (in-editor transform + project acceptance).
    expect(types).toEqual([
      'SQ_WRITE_CLASSES', 'SQ_WRITE_IMAGE', 'SQ_WRITE_TAG_SWAP', 'SQ_WRITE_TEXT',
    ]);
    for (const c of contracts) expect(c.fields.length).toBeGreaterThan(1);
  });

  /**
   * task-174: THE local write-scope law (`utils/localWriteScope.ts`) is enforced
   * in `BaseViteWriter.sendRequest` off `payload.sourceLocation.file`, and its
   * `typeof targetFile === 'string'` test means a payload WITHOUT one is not
   * gated at all — it sails past the cross-file refusal into the user's project.
   * `SQ_WRITE_VARIABLES` was the one writer that did this (a bare `{ css }`),
   * and it is now deleted. Keep the law hole-free: a writer that needs to reach
   * a file the user is not editing must be designed, not smuggled in by
   * omitting a field.
   */
  it('every writer payload carries a sourceLocation — the write-scope law has no blind spot', () => {
    const unlocated = contracts.filter((c) => !c.fields.includes('sourceLocation'));
    expect(unlocated.map((c) => `${c.source}:${c.messageType}`)).toEqual([]);
  });
});
