#!/usr/bin/env node
// Dev tool: drive starquix-mcp as a real stdio MCP client. Prints the connect
// code, waits for a tab to pair, then runs a scripted sequence and prints one
// JSON line per step. Usage: node scripts/probe.mjs [--wait-min 10]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const waitMin = Number(process.argv[process.argv.indexOf('--wait-min') + 1] || 10);
const out = (step, data) => console.log(JSON.stringify({ step, ...data }));

const transport = new StdioClientTransport({ command: 'node', args: [resolve(here, '../dist/cli.js')], stderr: 'pipe' });
transport.stderr?.on('data', d => process.stderr.write(d));
const client = new Client({ name: 'probe', version: '0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { isError: r.isError ?? false, result: parsed };
};

// 1. wait for the tab
const deadline = Date.now() + waitMin * 60_000;
let status;
for (;;) {
  status = await call('starquix_status');
  if (String(status.result).startsWith('CONNECTED')) break;
  if (Date.now() > deadline) { out('status', { ...status, timedOut: true }); process.exit(1); }
  await new Promise(r => setTimeout(r, 2000));
}
out('status', status);

// 2. catalogue
const { tools } = await client.listTools();
out('tools/list', { count: tools.length, hasConfirm: tools.filter(t => t.inputSchema?.properties?.confirm).map(t => t.name) });

// 3. the scripted edits
out('get_project', await call('get_project'));
out('add_page', await call('add_page', { page: { id: `page-${Date.now()}-about`, name: 'About' } }));
await new Promise(r => setTimeout(r, 1500)); // let the write-through land
out('list_files', await call('list_files', { prefix: 'src/pages/' }));
const read = await call('read_file', { path: 'src/pages/about.astro' });
out('read_file', { isError: read.isError, head: typeof read.result === 'object' ? String(read.result.content ?? '').slice(0, 120) : read.result });
out('gate/no-confirm', await call('deploy_project', { provider: 'vercel' }));
out('invalid_args', await call('add_page', { nope: 1 }));
out('done', { note: 'now press Cmd+Z in the editor and check src/pages/about.astro is gone' });
await new Promise(r => setTimeout(r, 20_000));
out('after-undo/list_files', await call('list_files', { prefix: 'src/pages/' }));
await client.close();
process.exit(0);
