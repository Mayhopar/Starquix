// app/src/components/Footer/AIActivityFeed.tsx
// One assistant reply as the chat shows it (buildChatFeed): each step's thinking, its text (markdown), and its tool
// calls — one row for a single call, ONE collapsible group for consecutive calls (the running call heads it while it
// works). Hovering a call with an element key flashes that element on the canvas (the sq:ai-highlight bridge path).
import { useEffect, useMemo, useState } from 'react';
import { Row, cx } from '@/components/ui';
import type { AIActivity, AIMessage, AIThought } from '@/ai/types';
import { activityIconKind, buildChatFeed, type ActivityIconKind } from '@/ai/utils/activityFeed';
import { markdownToHtml } from '@/utils/markdownToHtml';
import {
  CheckIcon,
  CloseIcon,
  ComponentIcon,
  FrameIcon,
  GearIcon,
  ImageIcon,
  NewspaperIcon,
  PageIcon,
  PencilIcon,
  RocketIcon,
  SearchIcon,
  ShapesIcon,
  SparkleIcon,
  TrashIcon,
  TypeIcon,
  UndoIcon,
  type IconComponent,
} from '@/assets/icons';

const KIND_ICONS: Record<ActivityIconKind, IconComponent> = {
  read: SearchIcon,
  edit: PencilIcon,
  text: TypeIcon,
  image: ImageIcon,
  page: PageIcon,
  component: ComponentIcon,
  blog: NewspaperIcon,
  variable: GearIcon,
  delete: TrashIcon,
  deploy: RocketIcon,
  history: UndoIcon,
  layout: FrameIcon,
  shape: ShapesIcon,
};

/** The reply's prose: the chat's one text size, markdown blocks spaced like a paragraph flow. */
export const PROSE = 'text-sm text-text break-words';
const MARKDOWN = '[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 '
  + '[&_li]:my-0.5 [&_h1]:text-sm-medium [&_h2]:text-sm-medium [&_h3]:text-sm-medium [&_h1]:my-1.5 [&_h2]:my-1.5 [&_h3]:my-1 '
  + '[&_strong]:font-medium [&_code]:font-mono [&_code]:text-xs [&_code]:bg-bg-hover [&_code]:rounded-inner [&_code]:px-1 '
  + '[&_pre]:my-1.5 [&_pre]:p-2 [&_pre]:bg-bg-hover [&_pre]:rounded-outer [&_pre]:overflow-x-auto [&_pre_code]:p-0 '
  + '[&_pre_code]:bg-transparent [&_a]:underline [&_blockquote]:pl-2 [&_blockquote]:border-l [&_blockquote]:border-stroke '
  + '[&>:first-child]:mt-0 [&>:last-child]:mb-0';

function highlight(key: string | undefined, on: boolean) {
  if (!key || key.startsWith('page:') || key.startsWith('variable:') || key.startsWith('file:') || key.startsWith('collection:')) return;
  window.dispatchEvent(on
    ? new CustomEvent('sq:ai-highlight', { detail: { key } })
    : new CustomEvent('sq:ai-highlight-clear'));
}

/** Whole seconds since `startedAt`, re-rendered every second while running so a
 *  long tool (image generation) is visibly counting up instead of looking hung.
 *  Shared with Footer's "Working… Ns" — one ticker implementation, not two. */
export function useElapsed(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const ROW = 'h-6 px-1 rounded-inner';
const statusSlot = (running: boolean, failed: boolean) => (running
  ? { type: 'spinner' as const }
  : failed
    ? { type: 'icon' as const, icon: <CloseIcon className="w-4 h-4 text-error" /> }
    : { type: 'icon' as const, icon: <CheckIcon className="w-4 h-4 text-success" /> });
const iconOf = (toolName: string) => { const Icon = KIND_ICONS[activityIconKind(toolName)]; return <Icon className="w-4 h-4 text-text-muted" />; };
const seconds = (a: AIActivity | undefined, now: number) => (a?.status === 'running' && a.startedAt ? Math.floor((now - a.startedAt) / 1000) : 0);

/**
 * One reasoning block: auto-expanded and streaming while the step thinks, then
 * collapsed to "Thought for Ns" once its tools start. An explicit click pins the
 * state for the rest of the session — the auto-collapse must never yank a block
 * shut while it is being read.
 */
function ThoughtRow({ thought, now }: { thought: AIThought; now: number }) {
  const [pinned, setPinned] = useState<boolean | null>(null);
  const open = thought.endedAt === undefined;
  const expanded = pinned ?? open;
  const secs = Math.floor(((thought.endedAt ?? now) - thought.startedAt) / 1000);
  return (
    <Row
      size="sm"
      className={ROW}
      expandable
      expanded={expanded}
      onExpandChange={setPinned}
      title={
        <span className="text-text-muted truncate">
          {open ? 'Thinking…' : 'Thought'}
          {secs >= 1 && <span> {open ? `${secs}s` : `for ${secs}s`}</span>}
        </span>
      }
      left={[{ type: 'icon', icon: <SparkleIcon className="w-4 h-4 text-text-muted" /> }]}
    >
      {/* Capped height with its own scroller: a long block must not push the
          activity rows out of the panel, and the text is never truncated. */}
      <div className="max-h-40 overflow-y-auto pl-6 pr-2 pb-1 text-2xs text-text-muted italic whitespace-pre-wrap break-words">
        {thought.text}
      </div>
    </Row>
  );
}

function ActivityRow({ activity: a, now }: { activity: AIActivity; now: number }) {
  const secs = seconds(a, now);
  return (
    <Row
      size="sm"
      className={ROW}
      title={
        <span className="text-text-secondary truncate">
          {a.label}
          {secs >= 2 && <span className="text-text-muted"> · {secs}s</span>}
          {a.status === 'error' ? <span className="text-text-muted"> — This action could not finish.</span> : a.detail && <span className="text-text-muted"> — {a.detail}</span>}
        </span>
      }
      left={[{ type: 'icon', icon: iconOf(a.toolName) }]}
      right={[statusSlot(a.status === 'running', a.status === 'error')]}
      rowProps={{ onMouseEnter: () => highlight(a.key, true), onMouseLeave: () => highlight(a.key, false) }}
    />
  );
}

/** Consecutive tool calls as one row: the running call (else the first) + the count; a click lists them all. */
function ToolGroup({ activities, now }: { activities: AIActivity[]; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const running = activities.find(a => a.status === 'running');
  const failed = activities.filter(a => a.status === 'error').length;
  const head = running ?? activities[0];
  const secs = seconds(running, now);
  return (
    <Row
      size="sm"
      className={ROW}
      expandable
      expanded={expanded}
      onExpandChange={setExpanded}
      title={
        <span className="text-text-secondary truncate">
          {head.label}
          <span className="text-text-muted"> · {failed ? `${failed} of ${activities.length} failed` : `${activities.length} actions`}{secs >= 2 ? ` · ${secs}s` : ''}</span>
        </span>
      }
      left={[{ type: 'icon', icon: iconOf(head.toolName) }]}
      right={[statusSlot(!!running, failed > 0)]}
    >
      {/* pr-7: each call's status sits under the group's, not under its chevron */}
      <div className="pl-5 pr-7">{activities.map(a => <ActivityRow key={a.id} activity={a} now={now} />)}</div>
    </Row>
  );
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => ({ __html: markdownToHtml(text) }), [text]);
  return <div className={cx(PROSE, MARKDOWN, 'px-1')} dangerouslySetInnerHTML={html} />;
}

export function ReplyFeed({ message }: { message: AIMessage }) {
  const items = buildChatFeed(message);
  const working = !!message.activities?.some(a => a.status === 'running') || !!message.thoughts?.some(t => !t.endedAt);
  const now = useElapsed(working);
  return (
    <div className="flex flex-col gap-1">
      {items.map(item => item.kind === 'thought'
        ? <ThoughtRow key={item.thought.id} thought={item.thought} now={now} />
        : item.kind === 'text'
          ? <Markdown key={item.key} text={item.text} />
          : item.activities.length === 1
            ? <ActivityRow key={item.key} activity={item.activities[0]} now={now} />
            : <ToolGroup key={item.key} activities={item.activities} now={now} />)}
    </div>
  );
}
