// Security (audit 2026-10-18 follow-up): a canvas text commit carries PLAIN
// text (Element.textContent). Written raw into .astro, a typed `<` / `&` became
// markup — `x<y` opened a <y> element and swallowed the paragraph's close tag
// (seen live). Text reaching a file write is HTML element content, like the
// markup commit's innerHTML.
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { handleEditModeExited, handleMarkupChanged } from '@/components/Canvas/viewportMessages/textEditing';
import { makeFakeCtx } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import type { ViewportMessageContext } from '@/components/Canvas/viewportMessages/context';
import { viteTextWriter } from '@/services/ViteTextWriter';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { sourceVersion } from '../sourceIdentity';

const file = 'src/pages/index.astro';
const key = `${file}:1:1`;
let projectId: string, doc: Y.Doc, runtime: ReturnType<typeof projectFsRuntime> | undefined;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_text_escape_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});
afterEach(() => {
  runtime?.close(); runtime = undefined; doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); vi.unstubAllGlobals();
});

const settle = async () => flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
async function commit(original: string, send: (ctx: ViewportMessageContext) => void | Promise<void>) {
  runtime = projectFsRuntime(projectId, { [file]: original });
  const ctx = makeFakeCtx(); ctx.env.doc = doc; ctx.env.projectId = projectId;
  ctx.refs.scannedElements.current = [{ key, classes: '', textContent: 'old', sourceLocation: {
    file, line: 1, column: 1, sourceVersion: sourceVersion(original), sourceRevision: 0,
  } }] as typeof ctx.refs.scannedElements.current;
  await send(ctx);
  await settle();
  return runtime.read(file);
}

it('typed < and & land as text, never as markup', async () => {
  expect(await commit('<p>old</p>\n', ctx => handleEditModeExited(ctx, { key, originalText: 'old', textContent: 'x<y & z</p><b>' })))
    .toBe('<p>x&lt;y &amp; z&lt;/p&gt;&lt;b&gt;</p>\n');
  // The doc keeps the characters the canvas shows.
  expect(doc.getMap<Y.Map<unknown>>('sourceText').get(key)?.get('textContent')).toBe('x<y & z</p><b>');
});

it('a markup commit is written as the canvas serialized it — no second escape', async () => {
  expect(await commit('<p>old</p>\n', ctx => handleMarkupChanged(ctx, { key, innerHTML: 'a<br>&amp; x&lt;y' })))
    .toBe('<p>a<br>&amp; x&lt;y</p>\n');
});

it('the direct text writer (instance text, Push) escapes too', async () => {
  runtime = projectFsRuntime(projectId, { [file]: '<p>old</p>\n' });
  expect(await viteTextWriter.writeTextUpdate({ file, line: 1, column: 1 }, 'x<y & z')).toBe(true);
  await settle();
  expect(runtime.read(file)).toBe('<p>x&lt;y &amp; z</p>\n');
});

it('an override prop fallback keeps a plain string literal (no switch to set:html)', async () => {
  expect(await commit('<p>{Astro.props.pText ?? "old"}</p>\n', ctx => handleEditModeExited(ctx, { key, originalText: 'old', textContent: 'x<y & z' })))
    .toBe('<p>{Astro.props.pText ?? "x<y & z"}</p>\n');
});
