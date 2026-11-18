// app/src/ai/utils/activityFeed.ts
// Helpers for the chat activity feed (structured AIMessage.activities).
import type { AIActivity, AIMessage, AIThought } from '../types';

export type ActivityIconKind =
  | 'read'
  | 'edit'
  | 'text'
  | 'image'
  | 'page'
  | 'component'
  | 'blog'
  | 'variable'
  | 'delete'
  | 'deploy'
  | 'history'
  | 'layout'
  | 'shape';

/** Map a tool name to an icon category for the feed row.
 *  ponytail: keyword matching over a 70-case switch — order matters (delete first). */
export function activityIconKind(toolName: string): ActivityIconKind {
  // Synthetic feed row (useAIAgent onRateLimit), not a tool — retry arrow, not the edit pencil.
  if (toolName === 'rate_limit') return 'history';
  if (toolName === 'undo' || toolName === 'redo') return 'history';
  if (toolName.includes('delete') || toolName.includes('remove') || toolName.includes('unwrap') || toolName.includes('unbind')) return 'delete';
  if (toolName.startsWith('read_') || toolName === 'verify_layout') return 'read';
  if (toolName.includes('image')) return 'image';
  if (toolName.includes('drawn')) return 'shape';
  if (toolName.includes('layout')) return 'layout';
  if (toolName.includes('variable')) return 'variable';
  if (toolName.includes('collection') || toolName.includes('post') && !toolName.includes('post_page') || toolName.includes('blog') || toolName === 'set_post_page_binding' || toolName === 'bind_content_field') return 'blog';
  if (toolName.includes('component') || toolName.includes('instance')) return 'component';
  if (toolName.includes('page') || toolName === 'rename_project' || toolName === 'set_home_page') return 'page';
  if (toolName === 'export_project' || toolName === 'deploy_project') return 'deploy';
  if (toolName.includes('text')) return 'text';
  return 'edit';
}

/**
 * Append or extend the reasoning block `blockId`.
 *
 * A block is created on its first delta and anchored to `activityIndex` — the
 * number of activity rows that existed at that moment — which is what lets the
 * feed re-interleave thoughts and tool rows in real order. Later deltas only
 * replace the text, so the anchor and start time never drift.
 */
export function upsertThought(
  thoughts: AIThought[],
  block: { id: string; text: string; activityIndex: number; now: number },
): AIThought[] {
  if (thoughts.some(t => t.id === block.id)) {
    return thoughts.map(t => (t.id === block.id ? { ...t, text: block.text } : t));
  }
  return [
    ...thoughts,
    { id: block.id, text: block.text, startedAt: block.now, activityIndex: block.activityIndex },
  ];
}

/** Close every still-open block: the step stopped thinking (first tool call, or
 *  run end/abort/error). Already-closed blocks keep their original endedAt. */
export function closeThoughts(thoughts: AIThought[], now: number): AIThought[] {
  if (!thoughts.some(t => !t.endedAt)) return thoughts;
  return thoughts.map(t => (t.endedAt ? t : { ...t, endedAt: now }));
}

export type ChatFeedItem =
  | { kind: 'thought'; thought: AIThought }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; activities: AIActivity[] };

/**
 * One reply as the chat shows it, in real order: each step's thinking, then its text, then its tool calls — consecutive
 * calls form ONE group. Thoughts and text runs render before the activity row they were anchored to; anchors at or past
 * the end trail the feed. Out-of-range anchors are clamped rather than dropped — a step losing its words is worse than
 * one landing slightly late. A reply without anchors (saved before they existed, or a settle text like "Cancelled.")
 * shows its text after the feed.
 */
export function buildChatFeed(message: Pick<AIMessage, 'content' | 'activities' | 'thoughts' | 'textAnchors'>): ChatFeedItem[] {
  const activities = message.activities ?? [];
  const n = activities.length;
  const at = (index: number) => Math.min(Math.max(index, 0), n);
  const anchors = message.textAnchors?.length ? message.textAnchors : [{ activityIndex: n, offset: 0 }];
  const texts = new Map<number, string[]>();
  anchors.forEach((anchor, i) => {
    const text = message.content.slice(i === 0 ? 0 : anchor.offset, anchors[i + 1]?.offset ?? message.content.length);
    if (text.trim()) texts.set(at(anchor.activityIndex), [...(texts.get(at(anchor.activityIndex)) ?? []), text]);
  });
  const thoughts = new Map<number, AIThought[]>();
  for (const thought of message.thoughts ?? []) thoughts.set(at(thought.activityIndex), [...(thoughts.get(at(thought.activityIndex)) ?? []), thought]);
  const feed: ChatFeedItem[] = [];
  for (let i = 0; i <= n; i++) {
    for (const thought of thoughts.get(i) ?? []) feed.push({ kind: 'thought', thought });
    (texts.get(i) ?? []).forEach((text, j) => feed.push({ kind: 'text', key: `text-${i}-${j}`, text }));
    if (i === n) break;
    const last = feed[feed.length - 1];
    if (last?.kind === 'tools') last.activities.push(activities[i]);
    else feed.push({ kind: 'tools', key: activities[i].id, activities: [activities[i]] });
  }
  return feed;
}

/** Serialize activities back into the plain-text action log the model sees in
 *  chat history (continue runs re-check it for what is already done). */
export function formatActivitiesForModel(activities: AIActivity[]): string {
  return activities
    .map(a => `> ${a.label}${a.detail ? ` — ${a.detail}` : ''}`)
    .join('\n');
}
