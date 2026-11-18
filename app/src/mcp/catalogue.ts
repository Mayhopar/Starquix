// The MCP tool catalogue = the chat's registry tools (same generator, same
// confirm gate) + the MCP-only get_project. Parity guard: catalogue.test.
import { asSchema, type Tool } from 'ai';
import { generateCommandTools, type ToolExecutionContext } from '@/ai/tools/commandTools';
import { commandRegistry } from '@/ai/tools/commandRegistry';
import { extraTools, type ExtraToolMeta } from './extraTools';
import type { ToolDescriptor } from './protocol';

export type Validation = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

export interface Callable {
  /** False for registry readOnly tools and the extras — no snapshot, no flush. */
  mutating: boolean;
  validate: (args: unknown) => Promise<Validation>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface Catalogue {
  callables: Map<string, Callable>;
  /** JSON-Schema conversion for ~75 tools is the expensive part — only tools/list pays it. */
  descriptors: () => ToolDescriptor[];
}

export function buildCatalogue(ctx: ToolExecutionContext, meta: ExtraToolMeta): Catalogue {
  const extras = extraTools(ctx, meta);
  const tools = { ...generateCommandTools(ctx), ...extras } as Record<string, Tool>;
  const callables = new Map<string, Callable>();
  for (const [name, t] of Object.entries(tools)) {
    const schema = asSchema(t.inputSchema as never);
    const entry = (commandRegistry as Record<string, { readOnly?: boolean }>)[name];
    callables.set(name, {
      mutating: !(name in extras) && entry?.readOnly !== true,
      validate: async args => {
        if (!schema.validate) return { ok: true, value: (args ?? {}) as Record<string, unknown> };
        const r = await schema.validate(args ?? {});
        return r.success
          ? { ok: true, value: r.value as Record<string, unknown> }
          : { ok: false, message: r.error instanceof Error ? r.error.message : String(r.error ?? 'invalid arguments') };
      },
      execute: args => Promise.resolve(t.execute!(args as never, { toolCallId: 'mcp', messages: [] } as never)),
    });
  }
  const descriptors = () => Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description ?? '',
    inputSchema: asSchema(t.inputSchema as never).jsonSchema as Record<string, unknown>,
  }));
  return { callables, descriptors };
}
