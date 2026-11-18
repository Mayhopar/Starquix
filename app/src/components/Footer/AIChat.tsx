// The AI tab's chat — the built-in API agent (owner 2026-11-08: "UX like in any modern tool inside the chat like claude
// code"; ledger docs/plans/2026-11-08-ai-chat-ux-ledger.md): prompts as filled blocks, replies as text with each step's
// tool calls grouped (ReplyFeed), a working line, and ONE composer box holding the selected elements, the
// model/style/prompt pills and send/stop. The draft and the queue live in Footer, so they survive the panel closing.
import React, { useEffect, useRef } from 'react';
import type { AIContextElement, AIFailureCode, AIMessage } from '@/ai/types';
import { aiFailureCopy } from '@/ai/failure';
import { Badge, Button, IconButton, Row, cx } from '@/components/ui';
import { OperationNotice } from '@/components/ui/OperationNotice';
import { ArrowUpIcon, CloseIcon, StopIcon } from '@/assets/icons';
import { PROSE, ReplyFeed } from './AIActivityFeed';

export function AIFailureNotice({ failure, onSettings }: { failure?: AIFailureCode; onSettings: () => void }) {
  const { title, detail, settings } = aiFailureCopy(failure);
  return <OperationNotice title={title} detail={detail}
    action={settings ? { label: 'Open AI settings', onClick: onSettings } : undefined} />;
}

type Props = {
  messages: AIMessage[];
  isGenerating: boolean;
  genSeconds: number;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  /** Typed while the agent worked: sent when the run completes, handed back to the composer otherwise. */
  queued: string | null;
  onUnqueue: () => void;
  onSubmit: () => void;
  onStop: () => void;
  onContinue: () => void;
  contextElements: AIContextElement[];
  onRemoveContext: (key: string) => void;
  /** An empty chat's notice: no key yet (`configuration`), or the last request failed. */
  emptyNotice: { failure?: AIFailureCode } | null;
  onOpenSettings: () => void;
  placeholder: string;
  /** The model / Style / Prompt pills. */
  pills: React.ReactNode;
};

const USER_BLOCK = cx(PROSE, 'whitespace-pre-wrap rounded-outer bg-bg-hover px-2 py-1.5');
const STICK_PX = 48; // within this much of the bottom still counts as "following"

const workedFor = (m: AIMessage) => {
  if (!m.endedAt) return null;
  const s = Math.max(0, Math.round((m.endedAt - m.timestamp) / 1000));
  return `Worked for ${s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}`;
};

function Reply({ message: m, onContinue, isGenerating, onOpenSettings }: {
  message: AIMessage; onContinue: () => void; isGenerating: boolean; onOpenSettings: () => void;
}) {
  // An error without a typed failure is a legacy reply whose text may be a raw provider error (keys, tokens): not shown.
  const shown = m.status === 'error' && !m.failure ? { ...m, content: '' } : m;
  const meta = m.status !== 'streaming' ? workedFor(m) : null;
  return (
    <div className="flex flex-col gap-1">
      <ReplyFeed message={shown} />
      {m.status === 'error' && <AIFailureNotice failure={m.failure} onSettings={onOpenSettings} />}
      {m.status === 'needs-continue' && (
        <Row size="sm" className="h-6 px-1" hover={false} title={<span className="text-warning">Stopped mid-task</span>}
          right={[{ type: 'custom', unboxed: true, node: (
            <Button variant="ghost" size="sm" label="Continue" onClick={onContinue} disabled={isGenerating} />
          ) }]} />
      )}
      {meta && m.content && (
        <Row size="sm" className="h-6 px-1" hover={false} title={<span className="text-2xs text-text-secondary">{meta}</span>}
          right={[{ type: 'custom', unboxed: true, showOnHover: true, node: (
            <Button variant="ghost" size="sm" label="Copy" title="Copy the reply"
              onClick={() => void navigator.clipboard?.writeText(m.content).catch(() => {})} />
          ) }]} />
      )}
    </div>
  );
}

export function AIChat({
  messages, isGenerating, genSeconds, prompt, onPromptChange, queued, onUnqueue, onSubmit, onStop, onContinue,
  contextElements, onRemoveContext, emptyNotice, onOpenSettings, placeholder, pills,
}: Props): React.ReactElement {
  // Follow the bottom only while the reader is parked there: reasoning streams several updates a second, and a
  // reader who scrolled up to a thought block must not be yanked back mid-sentence.
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight > STICK_PX) return;
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' }); // ?.(): jsdom has none
  }, [messages, queued]);
  const empty = messages.length === 0 && queued === null; // the composer is the whole panel, nothing above it

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={listRef} data-testid="chat-messages" className={cx('min-h-0 overflow-y-auto scrollbar-thin px-3 pt-1 flex-col gap-2', empty ? 'hidden' : 'flex flex-1')}>
        {messages.map(m => (m.role === 'user'
          ? <div key={m.id} className={USER_BLOCK}>{m.content}</div>
          : <Reply key={m.id} message={m} onContinue={onContinue} isGenerating={isGenerating} onOpenSettings={onOpenSettings} />))}
        {queued !== null && (
          <div data-testid="chat-queued" className={cx(USER_BLOCK, 'flex items-start gap-2 text-text-secondary')}>
            <span className="flex-1 min-w-0">{queued}<span className="block text-2xs text-text-muted">Queued — sends when this finishes</span></span>
            <IconButton size="sm" onClick={onUnqueue} aria-label="Unqueue" title="Back to the composer"
              className="bg-transparent text-text-secondary hover:text-text hover:bg-text/10">
              <CloseIcon className="w-4 h-4" />
            </IconButton>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={cx('flex flex-col gap-1 px-3 pb-3 pt-1', empty ? 'flex-1 min-h-0' : 'shrink-0')}>
        {!isGenerating && messages.length === 0 && emptyNotice && <AIFailureNotice failure={emptyNotice.failure} onSettings={onOpenSettings} />}
        {isGenerating && (
          <Row size="sm" className="h-6 px-1" hover={false} left={[{ type: 'spinner' }]} rightText="Esc to stop"
            title={<span className="text-text-secondary">Working…{genSeconds >= 2 ? ` ${genSeconds}s` : ''}</span>} />
        )}
        <div className={cx('flex flex-col gap-1 rounded-outer border border-input-stroke bg-input-fill px-2 pt-1.5 pb-1', empty && 'flex-1 min-h-0')}>
          {contextElements.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contextElements.map(el => (
                <Badge key={el.key} className="gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded bg-text/8 text-text border-text/12 max-w-[120px]">
                  <span className="truncate">{el.displayLabel}</span>
                  <IconButton size="sm" onClick={() => onRemoveContext(el.key)} aria-label="Remove context element"
                    className="w-3.5 h-3.5 bg-transparent text-text-secondary hover:text-text hover:bg-text/10">
                    <CloseIcon className="w-4 h-4" />
                  </IconButton>
                </Badge>
              ))}
            </div>
          )}
          <textarea
            aria-label="Message"
            value={prompt}
            onChange={e => onPromptChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); }
              else if (e.key === 'Escape' && isGenerating) { e.preventDefault(); onStop(); }
            }}
            placeholder={placeholder}
            rows={1}
            className={cx(PROSE, 'w-full resize-none bg-transparent placeholder-text-muted outline-none field-sizing-content', empty ? 'flex-1' : 'max-h-40')}
          />
          <div className="flex items-center gap-1">
            {pills}
            <span className="flex-1" />
            {isGenerating ? (
              <Button iconOnly size="sm" onClick={onStop} title="Stop (Esc)" aria-label="Stop" icon={<StopIcon className="w-4 h-4" />}
                className="rounded-full bg-text text-bg hover:bg-text hover:text-bg hover:opacity-90" />
            ) : (
              <Button iconOnly size="sm" onClick={onSubmit} disabled={!prompt.trim()} title="Send (Enter)" aria-label="Send"
                icon={<ArrowUpIcon className="w-4 h-4" />} className="rounded-full bg-text text-bg hover:bg-text hover:text-bg hover:opacity-90" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
