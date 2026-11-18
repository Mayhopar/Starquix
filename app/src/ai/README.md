# AI Module — Developer Reference

This module implements the AI layer for Starquix: a multi-provider, tool-calling agent that reads editor state and dispatches commands to mutate the Yjs document.

---

## Directory Layout

```
src/ai/
├── AIService.ts          # Multi-provider streaming client (Anthropic, OpenAI, OpenRouter, Ollama)
├── AIContext.tsx         # React context — global AI state (messages, config, context elements)
├── types.ts              # Shared TypeScript types and interfaces
│
├── hooks/
│   └── useAIAgent.ts     # Tool-calling agent hook (the only execution path)
│
├── tools/
│   ├── commandRegistry.ts    # Single source of truth for all AI-callable commands (Zod schemas)
│   ├── commandTools.ts       # Wraps commandRegistry entries into Vercel AI SDK tool() definitions
│   ├── readTools.ts          # Read-only inspection tools (GET_CURRENT_CONTEXT, GET_VARIABLES, …)
│   └── autoContext.ts        # Builds the auto-context block injected into every agent prompt
│
├── prompts/
│   ├── system.ts         # Default HTML-generation system prompt (editable in AI settings)
│   └── userPrompts.ts    # localStorage-backed custom prompt override
│
└── utils/
    └── activityKeys.ts   # Maps tool call names → affected entity keys (for UI highlights)
```

---

## Architecture Overview

There is one execution path: the tool-calling agent.

### Agent Mode (`useAIAgent`)

Used for all user requests: styling, adding elements, editing text, renaming pages, updating variables, writing files.

```
User message
  → augment with ## Referenced Elements / ## Pinned Variables
  → buildAutoContext() injects current page, element, breakpoint state
  → generateWithTools() streams response from AI provider
      ↓ tool call detected
      → executeCommand() dispatches to Yjs via dispatch()
      → takeSnapshot() was called before first mutation (undo support)
      ↓ text chunk
      → updateMessage() streams to chat UI
  → onComplete: saveAll() flushes pending file writes, attachFileRecords() for undo
```

---

## Key Files in Depth

### `AIService.ts`

Thin wrapper around the Vercel AI SDK. Handles four providers:

| Provider | Default model |
|---|---|
| Anthropic | `claude-sonnet-4-6` |
| OpenAI | `gpt-4o` |
| OpenRouter | `google/gemini-2.5-flash-preview-05-20` |
| Ollama | `llama3.2:1b` |

**`generateWithTools(config, messages, tools, callbacks, signal)`** — the main entry point for agent mode. Calls the provider with tool definitions and streams text + tool results back via callbacks:
- `onText(text)` — incremental text chunk
- `onToolCall(name, args)` — tool invoked (before execution)
- `onToolResult(name, result)` — tool executed (after execution)
- `onComplete(fullText)` — stream finished
- `onError(error)` — stream failed

### `AIContext.tsx`

Global React context. Holds:
- `config` — provider, apiKey, model (persisted to `localStorage:starquix:ai-config`)
- `messages[]` — full chat history
- `contextElements[]` — elements the user has pinned (from clicking the + button on canvas)
- `contextVariables[]` — variables pinned for the AI to reference
- `activeKeys / recentlyTouchedKeys` — which elements are currently being edited by AI (drives canvas highlights); touched keys are persisted to `localStorage:starquix:ai-touched` with a 7-day window
- `abortRef` — shared AbortController for cancelling in-flight requests

### `tools/commandRegistry.ts`

**The single source of truth for every command the AI can execute.**

Each entry has:
- A Zod schema (used to validate AI tool call params)
- A human-readable description (injected into the tool definition the AI sees)
- A category (`element | variable | page | navigation | draw | file`)
- Optional `readOnly: true` flag (skips `takeSnapshot()` before execution)
- Optional `examples[]` (appended to description for the AI)

Adding a new AI-callable command means adding one entry here — the tool definition, TypeScript types, and validation all derive from it automatically.

### `tools/commandTools.ts`

Converts `commandRegistry` entries into Vercel AI SDK `tool()` definitions at runtime.

Key responsibilities:
1. **Param normalisation** — AI models sometimes flatten nested objects. `normalizeParams()` re-nests them to match what command handlers expect (e.g. `ADD_ELEMENT` expects `{ element: { ... } }`, not a flat object).
2. **sourceKey validation** — `UPDATE_SOURCE_CLASSES` and `UPDATE_SOURCE_TEXT` require a valid `sourceKey`. Invalid values (`"undefined"`, `"null"`, empty string) are rejected before dispatch to prevent silent failures from AI hallucinations.
3. **Snapshot management** — `takeSnapshot()` is called at most once per agent turn, before the first mutating command. All tools in a single response share one undo snapshot.

```typescript
interface ToolExecutionContext {
  doc: Y.Doc;
  dispatch: (command: EditorCommand) => boolean;
  takeSnapshot: () => void;
  currentPageId: string | null;
  selectedElementKey: string | null;
}
```

### `tools/readTools.ts`

Read-only tools the AI can call to inspect editor state without mutating anything:

| Tool | What it returns |
|---|---|
| `GET_CURRENT_CONTEXT` | Active page, selected element, breakpoint, all registered source element keys |
| `GET_PAGE_ELEMENTS` | Root elements on a given page with type, classes, and markup preview |
| `GET_ELEMENT_MARKUP` | Full resolved HTML of a single element |
| `LIST_PAGES` | All pages with element counts |
| `GET_VARIABLES` | All variable collections, modes, and current values |

### `tools/autoContext.ts`

Before each agent turn, `buildAutoContext(doc)` snapshots:
- Current page name and ID
- Selected element's sourceKey and classes
- Active breakpoint
- Active panel
- All page names
- All root element IDs and labels on the current page
- All registered source element keys (valid targets for `UPDATE_SOURCE_CLASSES`)
- Variable collection summary

`formatAutoContext()` renders this as a structured markdown block prepended to the system prompt so the AI always has current state without needing to call `GET_CURRENT_CONTEXT` first.

### `hooks/useAIAgent.ts`

The only hook consumed by the chat UI. Wires together all the pieces:

1. Pulls editor state (doc, dispatch, currentPageId, selectedKey) from store
2. Pulls undo primitives (`takeSnapshot`, `attachFileRecords`) from UndoContext
3. Pulls `saveAll` from ClassStore to flush pending file writes on completion
4. Builds tool context and generates all three tool sets (command, read, file)
5. Runs `generateWithTools()` and streams results back into the message history
6. On each tool call, calls `markActiveKey()` + dispatches `sq:ai-active-highlights` to highlight affected canvas elements
7. On complete, calls `saveAll()` so class file writes are flushed immediately (rather than waiting for the 5-second idle debounce)

### `utils/activityKeys.ts`

Maps a tool name + its arguments to a string key identifying the affected entity. Used to light up canvas highlights while the AI is working:

```
UPDATE_SOURCE_CLASSES  → sourceKey value
ADD_ELEMENT            → elementId value
UPDATE_VARIABLE_VALUE  → "variable:<variableId>"
CREATE_FILE            → "file:<path>"
```

---

## Persistence and the 5-Second Debounce

Class changes go through this pipeline:

```
AI calls UPDATE_SOURCE_CLASSES
  → Yjs sourceClasses map updated
  → ClassStoreContext observer fires
  → markDirty(key) sets a 5-second idle timer
  → After 5 seconds: persistClassToFile() → ViteClassWriter → writes to .astro file
  → On reload: iframe rescans updated file, re-registers elements
```

**Important:** `useAIAgent` calls `saveAll()` in `onComplete` to flush dirty keys immediately when the agent finishes, bypassing the debounce. Without this, reloading within 5 seconds after an AI edit would lose changes.

`saveAll()` is only available for source element changes (keys of the form `file:line:col`). Instance child class changes (keys of the form `instanceId:selector`) require `UPDATE_THEME_INSTANCE_CLASS_OVERRIDE` to be persisted via `classOverrides` in the element's Yjs map, which is saved by `saveCurrentPage()`.

---

## Adding a New AI Command

1. Add an entry to `commandRegistry.ts` with a Zod schema, description, and category.
2. Implement the command handler in `store/commands.ts` under the matching `case`.
3. `commandTools.ts` and TypeScript types pick it up automatically.
4. If the command targets nested params, add a normalisation rule to `normalizeParams()` in `commandTools.ts`.
5. If the command affects a canvas element, add a key mapping in `utils/activityKeys.ts`.

---

## Adding a New AI Provider

1. Add the provider name to the `AIProvider` union in `types.ts`.
2. Add model initialisation in `AIService.ts` (import the SDK provider, create model instance).
3. Add a default model entry to `DEFAULT_MODELS` in `types.ts`.
4. Add the provider option to the settings UI (`components/Footer/AISettings.tsx`).

---

## Known Limitations

- **Instance child persistence**: `UPDATE_SOURCE_CLASSES` does not persist changes to instance child elements (canvas components with composite keys like `instanceId:selector`). The correct command for those is `UPDATE_THEME_INSTANCE_CLASS_OVERRIDE`, but the AI is not currently instructed to distinguish between source and instance keys.
- **No server-side proxy**: All API calls are made directly from the browser using the user's own API key. There is no token counting, rate limiting, or key validation server-side.
- **Context window**: Chat history is trimmed to the last 20 messages before sending to avoid token overflow, but very long tool outputs (e.g. large file reads) can still exceed limits silently.
