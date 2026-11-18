import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import { BaseViteWriter } from '../BaseViteWriter';
import { setServerWriteMode } from '../serverWriteMode';
import { setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';

/**
 * Local master-surface override writes (2026-08-27, "made Back fixed in the
 * layout master, nothing propagated"): a class/text/image edit on a NESTED
 * component instance inside an open layout/component master used to divert to
 * the session doc overlay — which local pages never read — so the style
 * silently evaporated. From a MASTER surface those writes must cross into the
 * component's own file; from a PAGE surface they must keep the WC-parity
 * overlay divert; structural writes keep the refusal everywhere.
 */
class StubWriter extends BaseViteWriter {
  constructor() {
    super({ resultMessageType: 'STUB_RESULT', writerName: 'StubWriter' });
  }
  send(messageType: string, file: string): Promise<boolean> {
    return this.sendViaPostMessage(messageType, { sourceLocation: { file, line: 1, column: 1 } });
  }
}

function makeWriter(): { writer: StubWriter; posted: Array<{ type: string }> } {
  const writer = new StubWriter();
  const posted: Array<{ type: string }> = [];
  writer.setIframeRef({
    contentWindow: { postMessage: (msg: { type: string }) => posted.push(msg) },
  } as unknown as HTMLIFrameElement);
  writer.setLocalInstanceState({ status: 'running', url: 'http://localhost:4999' }); // Phase 6: the only runtime arms writes
  return { writer, posted };
}

describe('BaseViteWriter — master-surface cross-file override writes', () => {
  beforeEach(() => {
    setServerWriteMode(true);
  });
  afterEach(() => {
    setLocalExpectedRoute(null);
    setLocalPageFile(null);
    setServerWriteMode(false);
  });

  it('override-tier write from a MASTER surface dispatches into the component file', async () => {
    setLocalExpectedRoute('/__sq_component_view/src/layouts/Main.astro');
    setLocalPageFile('src/layouts/Main.astro');
    const { writer, posted } = makeWriter();
    const p = writer.send('SQ_WRITE_CLASSES', 'src/components/Header.astro');
    expect(posted.map((m) => m.type)).toEqual(['SQ_WRITE_CLASSES']);
    writer.disconnect();
    await p.catch(() => {}); // pending ack times out later — irrelevant here
  });

  it('override-tier write from a PAGE surface still diverts (no dispatch, resolves false)', async () => {
    setLocalExpectedRoute('/blog');
    setLocalPageFile('src/pages/blog.astro');
    const { writer, posted } = makeWriter();
    await expect(writer.send('SQ_WRITE_CLASSES', 'src/components/Header.astro')).resolves.toBe(false);
    expect(posted).toEqual([]);
    writer.disconnect();
  });

  it('structural write stays refused cross-file even on a MASTER surface', async () => {
    setLocalExpectedRoute('/__sq_component_view/src/layouts/Main.astro');
    setLocalPageFile('src/layouts/Main.astro');
    const { writer, posted } = makeWriter();
    await expect(writer.send('SQ_WRITE_REMOVE', 'src/components/Header.astro')).resolves.toBe(false);
    expect(posted).toEqual([]);
    writer.disconnect();
  });
});
