/**
 * Golden round-trip corpus: parse→serialize of an UNTOUCHED document must be
 * byte-identical. Every corpus file is a review finding's repro input (CRLF,
 * no-trailing-newline, footnotes, setext, fences, comments, ESM, hard breaks).
 * Binding law #1 of the post-editor-v2 plan — any serializer change keeps this green.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parsePostBody, serializePostDoc } from '../postModel';

const DIR = join(__dirname, 'corpus');

describe('postModel round-trip', () => {
  for (const name of readdirSync(DIR)) {
    it(`round-trips ${name} byte-identical`, () => {
      const src = readFileSync(join(DIR, name), 'utf8');
      expect(serializePostDoc(parsePostBody(src))).toBe(src);
    });
  }
});
