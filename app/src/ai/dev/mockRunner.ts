// src/ai/dev/mockRunner.ts
// Development mock runner — tests the full tool-calling pipeline without hitting the AI API.
//
// ACTIVATION (browser console):
//   localStorage.setItem('sq:ai-mock', 'update-classes')   // set a scenario
//   localStorage.removeItem('sq:ai-mock')                   // disable
//
// See SCENARIOS below for all available scenario names.
//
// What this tests:
//   tool.execute() → dispatch() → Yjs mutation → ClassStoreContext observer
//   → SYNC_CLASSES_TO_IFRAME → ViewportFrame → bridge.js → DOM class change
//
// Nothing is faked except the AI response stream. Every other layer (Yjs, dispatch,
// observers, iframe messaging) runs exactly as it does in production.

import type { ToolSet } from 'ai';
import type { AgentCallbacks } from '../AIService';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'sq:ai-mock';

export function isMockEnabled(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export function getMockScenario(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'update-classes';
  } catch {
    return 'update-classes';
  }
}

/**
 * Run a mock agent turn.
 * Fires all the same AgentCallbacks as generateWithTools() would.
 * Tools are executed for real — only the AI response is simulated.
 */
export async function runMockAgent(
  tools: ToolSet,
  callbacks: AgentCallbacks,
  _userPrompt: string,
  opts?: { currentPageId?: string | null },
): Promise<void> {
  mockPageId = opts?.currentPageId ?? null;
  const scenario = getMockScenario();
  const runner = SCENARIOS[scenario];

  if (!runner) {
    callbacks.onError(
      new Error(
        `Unknown mock scenario "${scenario}". Available: ${Object.keys(SCENARIOS).join(', ')}. ` +
        `Set with: localStorage.setItem('${STORAGE_KEY}', '<scenario>')`,
      ),
    );
    return;
  }

  console.group(`[AI Mock] Running scenario: "${scenario}"`);
  try {
    await runner(tools, callbacks);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    console.groupEnd();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep without blocking the event loop. */
function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** Active page id, passed in by useAIAgent per run (scenarios that add page
 *  content need it — the real AI reads it from autoContext). */
let mockPageId: string | null = null;

/** Execute a single tool call and fire onToolCall / onToolResult. */
async function callTool(
  tools: ToolSet,
  callbacks: AgentCallbacks,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools[toolName];
  if (!tool) {
    const err = `Mock: tool "${toolName}" not found in tool set`;
    console.warn(err);
    callbacks.onToolResult(toolName, { success: false, error: err });
    return { success: false, error: err };
  }

  callbacks.onToolCall(toolName, args);
  await delay(80); // small pause so the UI can render the "calling…" state

  const result = await (tool as unknown as { execute: (args: unknown) => Promise<unknown> }).execute(args);
  console.log(`[AI Mock] ${toolName}`, { args, result });
  callbacks.onToolResult(toolName, result);
  await delay(60);
  return result;
}

/** Safely extract the elements array from a read_source_elements result. */
function extractSourceElements(
  result: unknown,
): Array<{ sourceKey: string; classes: string; file?: string }> {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.elements)) return [];
  return r.elements as Array<{ sourceKey: string; classes: string; file?: string }>;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type ScenarioFn = (tools: ToolSet, callbacks: AgentCallbacks) => Promise<void>;

/**
 * SCENARIO: update-classes
 *
 * Discovers all registered source elements via read_source_elements, then applies
 * a visible color change (adds text-pink-500) to the first three.
 *
 * Verifies: read_source_elements → UPDATE_SOURCE_CLASSES → sourceClasses observer
 *           → SYNC_CLASSES_TO_IFRAME → bridge.js → DOM class change
 */
const scenarioUpdateClasses: ScenarioFn = async (tools, callbacks) => {
  callbacks.onText('Discovering source elements…');

  const readResult = await callTool(tools, callbacks, 'read_source_elements', {});
  const elements = extractSourceElements(readResult);

  if (elements.length === 0) {
    const msg =
      'No source elements registered. Make sure the editor has a page open ' +
      'and the iframe has rendered at least one element.';
    callbacks.onComplete(msg);
    return;
  }

  // Take the first up to 3 elements and add text-pink-500 as a canary class.
  const targets = elements.slice(0, 3);
  for (const el of targets) {
    const newClasses = el.classes
      ? `${el.classes} text-pink-500`
      : 'text-pink-500';
    await callTool(tools, callbacks, 'update_element_by_key', {
      sourceKey: el.sourceKey,
      classes: newClasses,
    });
  }

  callbacks.onComplete(
    `Mock complete. Applied \`text-pink-500\` to ${targets.length} element(s): ` +
    targets.map(e => e.sourceKey).join(', ') + '\n\n' +
    'If those elements turned pink in the canvas, the full pipeline is working. ' +
    'Remove the mock flag with: `localStorage.removeItem(\'sq:ai-mock\')`',
  );
};

/**
 * SCENARIO: update-text
 *
 * Updates the textContent of the first registered source element.
 *
 * Verifies: UPDATE_SOURCE_TEXT → sourceText Yjs map → iframe SYNC_TEXT_TO_IFRAME
 */
const scenarioUpdateText: ScenarioFn = async (tools, callbacks) => {
  callbacks.onText('Discovering source elements for text update…');

  const readResult = await callTool(tools, callbacks, 'read_source_elements', {});
  const elements = extractSourceElements(readResult);

  if (elements.length === 0) {
    callbacks.onComplete('No source elements found. Open a page in the editor first.');
    return;
  }

  const target = elements[0];
  await callTool(tools, callbacks, 'update_element_by_key', {
    sourceKey: target.sourceKey,
    textContent: `[Mock text ${Date.now()}]`,
  });

  callbacks.onComplete(
    `Mock complete. Updated text on ${target.sourceKey}. ` +
    'If the element text changed in the canvas, UPDATE_SOURCE_TEXT is working.',
  );
};

/**
 * SCENARIO: read-only
 *
 * Calls read_source_elements and read_page_content without mutating anything.
 * Use this to inspect what the AI would see as its starting context.
 */
const scenarioReadOnly: ScenarioFn = async (tools, callbacks) => {
  callbacks.onText('Reading editor state (no mutations)…\n\n');

  const srcResult = await callTool(tools, callbacks, 'read_source_elements', {});
  const elements = extractSourceElements(srcResult);

  const lines: string[] = [
    `**read_source_elements** → ${elements.length} element(s)`,
    ...elements.map(e => `- \`${e.sourceKey}\`  classes: \`${e.classes || '(empty)'}\``),
  ];

  callbacks.onComplete(lines.join('\n'));
};

/**
 * SCENARIO: update-classes-revert
 *
 * Same as update-classes but then immediately reverts by re-applying the original
 * classes. Useful for verifying round-trips without leaving the canvas dirty.
 */
const scenarioUpdateClassesRevert: ScenarioFn = async (tools, callbacks) => {
  callbacks.onText('Testing round-trip: apply change, then revert…');

  const readResult = await callTool(tools, callbacks, 'read_source_elements', {});
  const elements = extractSourceElements(readResult);

  if (elements.length === 0) {
    callbacks.onComplete('No source elements found. Open a page in the editor first.');
    return;
  }

  const target = elements[0];

  // Apply change
  await callTool(tools, callbacks, 'update_element_by_key', {
    sourceKey: target.sourceKey,
    classes: `${target.classes} text-pink-500`,
  });

  await delay(300);

  // Revert
  await callTool(tools, callbacks, 'update_element_by_key', {
    sourceKey: target.sourceKey,
    classes: target.classes,
  });

  callbacks.onComplete(
    'Round-trip complete. If the element briefly went pink and then returned ' +
    'to its original color, the pipeline is working correctly.',
  );
};

/**
 * SCENARIO: tool-error
 *
 * Calls update_element_by_key with an invalid sourceKey to verify that the error
 * path is handled correctly (tool returns success:false, UI shows the error action).
 */
const scenarioToolError: ScenarioFn = async (tools, callbacks) => {
  callbacks.onText('Testing error path with an invalid sourceKey…');

  await callTool(tools, callbacks, 'update_element_by_key', {
    sourceKey: 'nonexistent-key:that:does-not-exist',
    classes: 'text-red-500',
  });

  callbacks.onComplete(
    'Error scenario complete. The action log above should show a failure message. ' +
    'If you see "failed to update classes (no source element…)", error handling is working.',
  );
};

/**
 * SCENARIO: add-section
 *
 * Adds two sections (no tool-input streaming — the exact path a provider that
 * buffers tool args exercises), then edits an element inside the first one.
 *
 * Verifies: add_page_content → RENDER one-by-one stagger, result-time
 * highlight (orbit stroke on the created section), inner-element edit
 * stroking the ENCLOSING section.
 */
const scenarioAddSection: ScenarioFn = async (tools, callbacks) => {
  // Streams like a provider: onText carries the whole reply so far, so the chat places each run between its tools.
  const intro = 'Adding two sections, then editing inside the first…';
  callbacks.onText(intro);

  const sec = (title: string) =>
    `<section class='py-16 bg-white' data-with-props='true'>` +
    `<div class='max-w-6xl mx-auto px-6' data-with-props='true'>` +
    `<h2 class='text-3xl font-bold' data-with-props='true' contenteditable='false'>${title}</h2>` +
    `<p class='mt-4 text-gray-600' data-with-props='true' contenteditable='false'>Mock copy one.</p>` +
    `<p class='mt-2 text-gray-600' data-with-props='true' contenteditable='false'>Mock copy two.</p>` +
    `</div></section>`;

  const r1 = await callTool(tools, callbacks, 'add_page_content', { pageId: mockPageId, staticMarkup: sec('Mock Section A') });
  await delay(2500); // long enough to eyeball the stagger + stroke on section A

  await callTool(tools, callbacks, 'add_page_content', { pageId: mockPageId, staticMarkup: sec('Mock Section B') });
  await delay(2500);

  const created = (r1 as { data?: { elementId?: string } } | null)?.data?.elementId;
  if (created) {
    // Edit an element INSIDE section A → the section must show the stroke.
    await callTool(tools, callbacks, 'update_element_by_key', {
      sourceKey: `${created}:h2-0`,
      textContent: 'Mock Section A (edited)',
    });
    await delay(2500);
  }

  // Expected on the canvas: each section built element-by-element (dissolve+blur stagger), an orbit stroke on the
  // section while the run was active.
  const reply = `${intro}\n\n**Done.** Two sections added, and the first heading now reads *Mock Section A (edited)*.`;
  callbacks.onText(reply);
  callbacks.onComplete(reply);
};

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, ScenarioFn> = {
  'update-classes': scenarioUpdateClasses,
  'update-text': scenarioUpdateText,
  'read-only': scenarioReadOnly,
  'update-classes-revert': scenarioUpdateClassesRevert,
  'tool-error': scenarioToolError,
  'add-section': scenarioAddSection,
};

export const MOCK_SCENARIO_NAMES = Object.keys(SCENARIOS);
