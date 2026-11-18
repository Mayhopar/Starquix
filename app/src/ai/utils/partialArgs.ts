// app/src/ai/utils/partialArgs.ts
// Tolerant extraction of a string field's value from INCOMPLETE JSON
// (streaming tool-call args). ponytail: first literal `"field"` match only —
// embedded field names inside values are escaped in raw JSON so they can't
// false-match; nested objects are out of scope (tool args are flat).

export function extractPartialStringField(
  partialJson: string,
  field: string,
): { value: string; complete: boolean } | null {
  const marker = `"${field}"`;
  const mi = partialJson.indexOf(marker);
  if (mi === -1) return null;

  let i = mi + marker.length;
  while (i < partialJson.length && (partialJson[i] === ' ' || partialJson[i] === ':')) i++;
  if (partialJson[i] !== '"') return null; // value not started yet

  i++; // past opening quote
  let raw = '';
  let complete = false;
  while (i < partialJson.length) {
    const ch = partialJson[i];
    if (ch === '\\') {
      raw += ch + (partialJson[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '"') { complete = true; break; }
    raw += ch;
    i++;
  }

  // Trim an incomplete trailing escape (lone `\` or partial \uXXXX) so JSON.parse can't throw
  raw = raw.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '');
  try {
    return { value: JSON.parse(`"${raw}"`) as string, complete };
  } catch {
    return { value: raw, complete };
  }
}

/** Cut a streaming HTML string's mid-tag tail (a `<` opened after the last
 *  complete `>`); trailing TEXT after a closed tag is kept — it's legitimate
 *  streaming content. */
export function trimToTagBoundary(html: string): string {
  const lt = html.lastIndexOf('<');
  const gt = html.lastIndexOf('>');
  if (lt > gt) return html.slice(0, lt); // inside an unclosed tag — cut it
  return gt === -1 ? '' : html; // no complete tag yet → nothing to show
}

export type StreamPreviewEmit =
  | { mode: 'section'; partial: string }
  | { mode: 'text'; targetKey: string; partial: string }
  | { mode: 'busy'; targetKey: string };

const THROTTLE_MS = 100;

/** Accumulates tool-input deltas for ONE tool call and emits throttled
 *  preview updates. Sequential tool calls: harness start()s a new feed state
 *  per call. endEmit fires only if at least one preview was emitted. */
export class StreamPreviewFeed {
  private buf = '';
  private toolName = '';
  private active = false;
  private emitted = false;
  private emittedBusy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;

  constructor(
    private emit: (e: StreamPreviewEmit) => void,
    private endEmit: (cancelled?: boolean) => void,
  ) {}

  start(toolName: string) {
    this.buf = '';
    this.toolName = toolName;
    this.active = toolName === 'add_page_content' || toolName === 'update_element_by_key';
    this.emitted = false;
    this.emittedBusy = false;
  }

  delta(text: string) {
    if (!this.active) return;
    this.buf += text;
    const now = Date.now();
    if (now - this.lastEmit >= THROTTLE_MS) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, THROTTLE_MS);
    }
  }

  end(cancelled = false) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.active = false;
    if (this.emitted) this.endEmit(cancelled);
    this.emitted = false;
  }

  private flush() {
    if (!this.active) return;
    this.lastEmit = Date.now();
    if (this.toolName === 'add_page_content') {
      const m = extractPartialStringField(this.buf, 'staticMarkup');
      if (m) {
        const html = trimToTagBoundary(m.value);
        if (!html) return;
        this.emitted = true;
        this.emit({ mode: 'section', partial: html });
        return;
      }
      // type:'text' — synthesize a one-element section from tag + streaming text
      const tag = extractPartialStringField(this.buf, 'tag');
      if (!tag?.complete || !/^[a-z][a-z0-9-]*$/i.test(tag.value)) return;
      const text = extractPartialStringField(this.buf, 'textContent');
      if (!text) return;
      const esc = text.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      this.emitted = true;
      this.emit({ mode: 'section', partial: `<${tag.value}>${esc}</${tag.value}>` });
    } else {
      const key = extractPartialStringField(this.buf, 'sourceKey');
      if (!key?.complete || !key.value) return;
      const text = extractPartialStringField(this.buf, 'textContent');
      if (!text) {
        // class-only edit — pulse the target once so the canvas shows activity
        if (!this.emittedBusy) {
          this.emittedBusy = true;
          this.emitted = true;
          this.emit({ mode: 'busy', targetKey: key.value });
        }
        return;
      }
      this.emitted = true;
      this.emit({ mode: 'text', targetKey: key.value, partial: text.value });
    }
  }
}
