import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The wire protocol has ONE source of truth shared by two runtimes (Node relay
// + browser editor) that cannot import each other. Keep the copies identical.
it('app/src/mcp/protocol.ts is byte-identical to mcp/src/protocol.ts', () => {
  const a = readFileSync(resolve(__dirname, '../protocol.ts'), 'utf8');
  const b = readFileSync(resolve(__dirname, '../../../../mcp/src/protocol.ts'), 'utf8');
  expect(a).toBe(b);
});
