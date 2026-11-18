import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileCatalogueCache } from './catalogueCache';

describe('fileCatalogueCache', () => {
  it('returns [] when nothing was saved and round-trips a saved catalogue', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sqmcp-')), 'nested', 'catalogue.json');
    const cache = fileCatalogueCache(path);
    expect(cache.load()).toEqual([]);
    const tools = [{ name: 'add_page', description: 'd', inputSchema: { type: 'object', properties: {} } }];
    cache.save(tools);
    expect(fileCatalogueCache(path).load()).toEqual(tools);
  });
});
