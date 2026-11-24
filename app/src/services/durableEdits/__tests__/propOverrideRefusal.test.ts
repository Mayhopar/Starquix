/**
 * Issue #7 investigation (results-L2 b#0 / j#0, L4 j#1, L3 ghost#0): an element
 * edit the files cannot carry — no source position, one tag rendering several
 * copies, a text a prop cannot express — showed on the canvas, was written
 * nowhere (a console.warn only) and was gone on reload. It is refused where the
 * edit is accepted, so the caller's existing toast + revert runs.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { noteScan } from '@/utils/propOverrides';
import { capturePropOverride, preparePropOverrides } from '../propOverrideCommands';
import { SourcePreparationRefused } from '../commandReceipts';

const PAGE = 'src/pages/index.astro', CARD = 'src/components/Card.astro';
const loc = (file: string, line: number, column: number) => ({ file, line, column });
// The probe's shape: text read from a destructured prop (`{title}`), placed by the page.
const H3 = loc(CARD, 4, 1);
const card = (key: string) => ({ key, parentKey: null, tagName: 'h3', sourceLocation: H3, usageLocation: loc(PAGE, 1, 1) });

let projectId: string, runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  await db.delete(); await db.open();
  projectId = `prop-refusal-${crypto.randomUUID()}`;
  runtime = projectFsRuntime(projectId, {
    [CARD]: '---\nconst { title } = Astro.props;\n---\n<h3>{title}</h3>\n', [PAGE]: '<Card title="a" />\n' });
  setLocalPageFile(PAGE); setLocalExpectedRoute('/');
});
afterEach(() => { runtime.close(); noteScan([]); _resetLocalPageSyncForTests(); });

const capture = (key: string, at = H3, kind: 'class' | 'text' = 'class') =>
  capturePropOverride(key, at, captureLocalWriteOrigin(), kind);
const prepare = (target: ReturnType<typeof capturePropOverride>, value = 'p-4') =>
  preparePropOverrides(projectId, 0, [{ target: target!, value, key: 'k' }]);
async function expectRefused(pending: Promise<unknown>, reason: string) {
  const error = await pending.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(SourcePreparationRefused);
  expect((error as Error).message).toBe(reason);
}

it('an element with no source position (Not editable) is refused', async () => {
  await expectRefused(prepare(capturePropOverride('dynamic:h1:1@x', undefined, captureLocalWriteOrigin())),
    'not editable — open in code');
});

it('one tag rendering several copies (a loop) is refused', async () => {
  noteScan([card('c#0'), card('c#1')]);
  await expectRefused(prepare(capture('c#1')), 'it comes from Card.astro — edit it there');
});

it('a text a prop cannot express is refused with the planner’s reason', async () => {
  noteScan([card('c')]);
  await expectRefused(prepare(capture('c', H3, 'text'), 'New'), 'text with expressions — edit it in its component');
});

it('a writable instance edit still plans its page prop; a same-file element is a direct write', async () => {
  noteScan([card('c')]);
  expect((await prepare(capture('c')))?.kind).toBe('file-batch');
  expect(capture('p', loc(PAGE, 1, 1))).toBeNull();
  // A batch action often carries no location: a source KEY still has a position (resolved later), so it is not refused.
  expect(capturePropOverride(`${PAGE}:1:1`, undefined, captureLocalWriteOrigin())).toBeNull();
});
