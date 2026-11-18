// Last catalogue the paired tab served, persisted so the NEXT relay start can
// list the full tool set before (or without) a tab pairing. Clients such as
// Claude Code list tools once at startup — a few seconds before the editor
// tab re-dials — so without this the agent only ever sees starquix_status.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ToolDescriptor } from './protocol.js';

export function defaultCachePath(): string {
  return join(process.env.STARQUIX_MCP_HOME || join(homedir(), '.starquix-mcp'), 'catalogue.json');
}

export interface CatalogueCache { load(): ToolDescriptor[]; save(tools: ToolDescriptor[]): void }

export function fileCatalogueCache(path = defaultCachePath()): CatalogueCache {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tools?: unknown };
        return Array.isArray(parsed.tools) ? (parsed.tools as ToolDescriptor[]) : [];
      } catch { return []; }
    },
    save(tools) {
      try {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, JSON.stringify({ savedAt: new Date().toISOString(), tools }));
      } catch { /* cache is best-effort */ }
    },
  };
}

export const noCatalogueCache: CatalogueCache = { load: () => [], save: () => {} };
