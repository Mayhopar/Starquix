/**
 * task-133 structural write channel — bridge side:
 * handleWriteInsert / handleWriteRemove / handleWriteMove / handleWriteImport
 * delegate to the window.__SQ_WRITE_INSERT__/REMOVE__/MOVE__/IMPORT__ HMR
 * senders (SqHmrWriteBridge.astro) and reject malformed payloads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const LOC = { file: 'src/pages/index.astro', line: 5, column: 1 };
const TARGET = { file: 'src/pages/index.astro', line: 12, column: 1 };

const SENDER_NAMES = [
  '__SQ_WRITE_INSERT__',
  '__SQ_WRITE_APPEND_PAGE__',
  '__SQ_WRITE_REMOVE__',
  '__SQ_WRITE_MOVE__',
  '__SQ_WRITE_IMPORT__',
  '__SQ_WRITE_RESTORE__',
  '__SQ_WRITE_RESTORE_REGION__',
] as const;

type SenderName = (typeof SENDER_NAMES)[number];

function installSender(name: SenderName): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  (window as unknown as Record<string, unknown>)[name] = fn;
  return fn;
}

function clearSenders(): void {
  for (const name of SENDER_NAMES) {
    delete (window as unknown as Record<string, unknown>)[name];
  }
}

describe('task-133 structural write handlers', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    clearSenders();
  });

  afterEach(() => {
    clearSenders();
    vi.restoreAllMocks();
  });

  describe('handleWriteInsert', () => {
    const PAYLOAD = {
      sourceLocation: LOC,
      requestId: 'struct_ins_1',
      markup: '<div>hi</div>',
      position: 'inside-end',
    };

    it('delegates to window.__SQ_WRITE_INSERT__', async () => {
      const writer = installSender('__SQ_WRITE_INSERT__');
      bridge.handleWriteInsert(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('rejects payloads missing sourceLocation/markup/position', () => {
      const writer = installSender('__SQ_WRITE_INSERT__');
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteInsert({ ...PAYLOAD, sourceLocation: undefined });
      bridge.handleWriteInsert({ ...PAYLOAD, markup: undefined });
      bridge.handleWriteInsert({ ...PAYLOAD, position: undefined });
      bridge.handleWriteInsert(null);
      expect(writer).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });
  });

  // Fix 1 (task-148): page-body append — no line/column anchor, the plugin
  // resolves the outermost template element from the file itself.
  describe('handleWriteAppendPage', () => {
    const PAYLOAD = {
      sourceLocation: { file: 'src/pages/index.astro' },
      requestId: 'struct_app_1',
      markup: '<section>hi</section>',
    };

    it('delegates to window.__SQ_WRITE_APPEND_PAGE__', async () => {
      const writer = installSender('__SQ_WRITE_APPEND_PAGE__');
      bridge.handleWriteAppendPage(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('rejects payloads missing sourceLocation/markup/requestId', () => {
      const writer = installSender('__SQ_WRITE_APPEND_PAGE__');
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteAppendPage({ ...PAYLOAD, sourceLocation: undefined });
      bridge.handleWriteAppendPage({ ...PAYLOAD, markup: undefined });
      bridge.handleWriteAppendPage({ ...PAYLOAD, requestId: undefined });
      bridge.handleWriteAppendPage(null);
      expect(writer).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });
  });

  describe('handleWriteRemove', () => {
    const PAYLOAD = { sourceLocation: LOC, requestId: 'struct_rem_1' };

    it('delegates to window.__SQ_WRITE_REMOVE__', async () => {
      const writer = installSender('__SQ_WRITE_REMOVE__');
      bridge.handleWriteRemove(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('rejects payloads missing sourceLocation/requestId', () => {
      const writer = installSender('__SQ_WRITE_REMOVE__');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteRemove({ ...PAYLOAD, sourceLocation: undefined });
      bridge.handleWriteRemove({ ...PAYLOAD, requestId: undefined });
      bridge.handleWriteRemove(null);
      expect(writer).not.toHaveBeenCalled();
    });
  });

  describe('handleWriteMove', () => {
    const PAYLOAD = {
      sourceLocation: LOC,
      requestId: 'struct_mov_1',
      targetLocation: TARGET,
      position: 'after',
    };

    it('delegates to window.__SQ_WRITE_MOVE__', async () => {
      const writer = installSender('__SQ_WRITE_MOVE__');
      bridge.handleWriteMove(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('rejects payloads missing targetLocation/position', () => {
      const writer = installSender('__SQ_WRITE_MOVE__');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteMove({ ...PAYLOAD, targetLocation: undefined });
      bridge.handleWriteMove({ ...PAYLOAD, position: undefined });
      bridge.handleWriteMove(null);
      expect(writer).not.toHaveBeenCalled();
    });
  });

  describe('handleWriteImport', () => {
    const PAYLOAD = {
      sourceLocation: { file: 'src/pages/index.astro', line: 0, column: 0 },
      requestId: 'struct_imp_1',
      name: 'Hero',
      importPath: '../components/Hero.astro',
      remove: false,
    };

    it('delegates to window.__SQ_WRITE_IMPORT__', async () => {
      const writer = installSender('__SQ_WRITE_IMPORT__');
      bridge.handleWriteImport(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('forwards an unnamed side-effect addition unchanged', async () => {
      const writer = installSender('__SQ_WRITE_IMPORT__');
      const payload = { ...PAYLOAD, name: '', importPath: '../styles/sq-variables.css' };
      bridge.handleWriteImport(payload);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(payload));
    });

    it.each([
      { name: '', remove: true },
      { name: '', remove: 'true' },
      { name: '', remove: 1 },
      { name: '', importPath: '' },
      { name: '', importPath: 42 },
      { name: 42 },
      { name: null },
      { importPath: 42 },
    ])('rejects malformed or ambiguous imports with a failure ACK: %j', changes => {
      const writer = installSender('__SQ_WRITE_IMPORT__');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteImport({ ...PAYLOAD, ...changes });
      expect(writer).not.toHaveBeenCalled();
      expect(bridge.sendToParent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'SQ_WRITE_IMPORT_RESULT', payload: { requestId: PAYLOAD.requestId, success: false, error: 'invalid payload' },
      }));
    });

    it('remove:true needs no importPath', async () => {
      const writer = installSender('__SQ_WRITE_IMPORT__');
      const payload = { ...PAYLOAD, importPath: undefined, remove: true };
      bridge.handleWriteImport(payload);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(payload));
    });

    it('rejects add payloads missing name or importPath', () => {
      const writer = installSender('__SQ_WRITE_IMPORT__');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteImport({ ...PAYLOAD, name: undefined });
      bridge.handleWriteImport({ ...PAYLOAD, importPath: undefined }); // remove=false → needs path
      bridge.handleWriteImport(null);
      expect(writer).not.toHaveBeenCalled();
    });
  });

  // task-133 Task 8: verbatim undo-restore of previously removed bytes
  describe('handleWriteRestore', () => {
    const PAYLOAD = {
      sourceLocation: LOC,
      requestId: 'struct_res_1',
      text: '  <div>bye</div>\n',
    };

    it('delegates to window.__SQ_WRITE_RESTORE__', async () => {
      const writer = installSender('__SQ_WRITE_RESTORE__');
      bridge.handleWriteRestore(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('rejects payloads missing sourceLocation/requestId/text', () => {
      const writer = installSender('__SQ_WRITE_RESTORE__');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteRestore({ ...PAYLOAD, sourceLocation: undefined });
      bridge.handleWriteRestore({ ...PAYLOAD, requestId: undefined });
      bridge.handleWriteRestore({ ...PAYLOAD, text: undefined });
      bridge.handleWriteRestore({ ...PAYLOAD, text: '' });
      bridge.handleWriteRestore(null);
      expect(writer).not.toHaveBeenCalled();
    });
  });

  // live-smoke Critical: region restore — byte-exact inverse of an insert/move
  // splice. An EMPTY segment is a legitimate payload (own-line splice inverse).
  describe('handleWriteRestoreRegion', () => {
    const PAYLOAD = {
      sourceLocation: LOC,
      requestId: 'struct_rr_1',
      lineCount: 3,
      segment: '  <p>original</p>\n',
    };

    it('delegates to window.__SQ_WRITE_RESTORE_REGION__', async () => {
      const writer = installSender('__SQ_WRITE_RESTORE_REGION__');
      bridge.handleWriteRestoreRegion(PAYLOAD);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(PAYLOAD));
    });

    it('accepts an EMPTY segment (own-line inverse deletes the inserted lines)', async () => {
      const writer = installSender('__SQ_WRITE_RESTORE_REGION__');
      const payload = { ...PAYLOAD, segment: '' };
      bridge.handleWriteRestoreRegion(payload);
      await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(payload));
    });

    it('rejects payloads missing sourceLocation/requestId/lineCount/segment', () => {
      const writer = installSender('__SQ_WRITE_RESTORE_REGION__');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteRestoreRegion({ ...PAYLOAD, sourceLocation: undefined });
      bridge.handleWriteRestoreRegion({ ...PAYLOAD, requestId: undefined });
      bridge.handleWriteRestoreRegion({ ...PAYLOAD, lineCount: undefined });
      bridge.handleWriteRestoreRegion({ ...PAYLOAD, lineCount: 0 });
      bridge.handleWriteRestoreRegion({ ...PAYLOAD, segment: undefined });
      bridge.handleWriteRestoreRegion(null);
      expect(writer).not.toHaveBeenCalled();
    });
  });

  // Task 10 sweep: a malformed payload used to only console.error, leaving the
  // parent writer to burn its 10s timeout — now the handler fast-fails with the
  // same {requestId, success:false, error} reply shape callHmrFunction uses.
  describe('invalid-payload fast-fail replies', () => {
    const CASES: Array<{
      handler: 'handleWriteInsert' | 'handleWriteRemove' | 'handleWriteMove' | 'handleWriteImport' | 'handleWriteRestore' | 'handleWriteRestoreRegion';
      resultType: string;
      invalid: Record<string, unknown>;
    }> = [
      {
        handler: 'handleWriteRestoreRegion',
        resultType: 'SQ_WRITE_RESTORE_REGION_RESULT',
        invalid: { sourceLocation: LOC, requestId: 'ff_rr', segment: 'x' }, // lineCount missing
      },
      {
        handler: 'handleWriteInsert',
        resultType: 'SQ_WRITE_INSERT_RESULT',
        invalid: { sourceLocation: LOC, requestId: 'ff_ins', position: 'after' }, // markup missing
      },
      {
        handler: 'handleWriteRemove',
        resultType: 'SQ_WRITE_REMOVE_RESULT',
        invalid: { requestId: 'ff_rem' }, // sourceLocation missing
      },
      {
        handler: 'handleWriteMove',
        resultType: 'SQ_WRITE_MOVE_RESULT',
        invalid: { sourceLocation: LOC, requestId: 'ff_mov', position: 'after' }, // targetLocation missing
      },
      {
        handler: 'handleWriteImport',
        resultType: 'SQ_WRITE_IMPORT_RESULT',
        invalid: { sourceLocation: LOC, requestId: 'ff_imp', name: 'Hero', remove: false }, // importPath missing
      },
      {
        handler: 'handleWriteRestore',
        resultType: 'SQ_WRITE_RESTORE_RESULT',
        invalid: { sourceLocation: LOC, requestId: 'ff_res', text: '' }, // empty text
      },
    ];

    for (const { handler, resultType, invalid } of CASES) {
      it(`${handler}: invalid payload WITH requestId replies ${resultType} failure immediately`, () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        bridge[handler](invalid);
        expect(bridge.sendToParent).toHaveBeenCalledExactlyOnceWith({
          type: resultType,
          payload: { requestId: invalid.requestId, success: false, error: 'invalid payload' },
        });
      });
    }

    it('invalid payload WITHOUT a requestId sends nothing (no orphan reply)', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.handleWriteInsert(null);
      bridge.handleWriteRemove({ sourceLocation: LOC }); // no requestId
      expect(bridge.sendToParent).not.toHaveBeenCalled();
    });
  });

  it('registerHandlers maps all six SQ_WRITE_* message types', () => {
    const b = bridge as unknown as {
      registerHandlers: () => void;
      _handlers: Record<string, (p: unknown) => void>;
    };
    b._handlers = {};
    b.registerHandlers();
    for (const type of ['SQ_WRITE_INSERT', 'SQ_WRITE_REMOVE', 'SQ_WRITE_MOVE', 'SQ_WRITE_IMPORT', 'SQ_WRITE_RESTORE', 'SQ_WRITE_RESTORE_REGION']) {
      expect(b._handlers[type], `${type} not registered`).toBeTypeOf('function');
    }
  });
});
