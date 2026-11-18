// MCP server (stdio side). Forwards tools/list + tools/call to the paired tab
// through the TabBridge; adds ONE relay-owned tool, starquix_status, so an
// agent can always learn why the catalogue is empty.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BridgeError, PAIR_INSTRUCTIONS, type TabBridge } from './tabBridge.js';
import { noCatalogueCache, type CatalogueCache } from './catalogueCache.js';

const STATUS_TOOL = {
  name: 'starquix_status',
  description: 'Report whether a Starquix editor tab is paired and which project it has open. Call this first if other tools are missing.',
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
};

export type BridgeLike = Pick<TabBridge, 'isPaired' | 'listTools' | 'callTool' | 'pairedProject' | 'onPairChange'>;

/** generate_image is the only long-running tool (provider round-trip). */
export function callTimeoutFor(name: string): number {
  return name === 'generate_image' ? 180_000 : 60_000;
}

function errorResult(e: unknown) {
  const code = e instanceof BridgeError ? e.code : 'TOOL_FAILED';
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${code}: ${message}` }] };
}

export function createMcpServer(bridge: BridgeLike, cache: CatalogueCache = noCatalogueCache) {
  const server = new Server({ name: 'starquix', version: '0.1.0' }, { capabilities: { tools: { listChanged: true } } });

  // The client (Claude Code) lists tools at startup, BEFORE the tab re-pairs
  // (the editor dials back a few seconds after the relay restarts). Without
  // this notification its catalogue stays frozen at starquix_status only.
  bridge.onPairChange(() => { void server.sendToolListChanged().catch(() => {}); });

  // Unpaired: serve the last catalogue a tab gave us (calls then answer
  // NOT_CONNECTED with the pairing steps) so a client that lists only once
  // still sees every tool. Paired: the live catalogue, and refresh the cache.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!bridge.isPaired()) return { tools: [STATUS_TOOL, ...cache.load()] };
    try {
      const tools = await bridge.listTools();
      cache.save(tools);
      return { tools: [STATUS_TOOL, ...tools] };
    } catch { return { tools: [STATUS_TOOL, ...cache.load()] }; }
  });

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const { name, arguments: args = {} } = req.params;
    if (name === 'starquix_status') {
      const text = bridge.isPaired()
        ? `CONNECTED: ${JSON.stringify(bridge.pairedProject() ?? {})}`
        : `NOT_CONNECTED: ${PAIR_INSTRUCTIONS}`;
      return { content: [{ type: 'text', text }] };
    }
    try {
      const result = await bridge.callTool(name, args as Record<string, unknown>, callTimeoutFor(name));
      const failed = typeof result === 'object' && result !== null && (result as { success?: unknown }).success === false;
      return { isError: failed || undefined, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) { return errorResult(e); }
  });

  return server;
}
