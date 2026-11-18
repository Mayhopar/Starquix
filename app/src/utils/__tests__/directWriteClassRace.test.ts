// @vitest-environment node
// Audit 2026-10-18 (d): a class write waits 5 s with its baseline frozen at
// acceptance. Starquix's own direct writes (font link, image rebind, component
// file ops) rewrote that file inside the window, the class write was refused,
// and every later save queued behind it. A direct write lands pending edits first.
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { classCommands } from '@/services/durableEdits/classCommands';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { sourceVersion } from '@/services/durableEdits/sourceIdentity';
import { updateLocalCustomFont } from '../localFonts';

const projectId = 'browser_direct_write_race';
const file = 'src/layouts/Layout.astro';
const layout = '<html>\n<head>\n<title>T</title>\n</head>\n<body>\n<main class="p-2">Привет</main>\n</body>\n</html>\n';
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  await db.delete(); await db.open(); markFilesTruth(projectId);
  runtime = projectFsRuntime(projectId, { [file]: layout });
});
afterEach(() => { runtime.close(); unmarkFilesTruth(projectId); });

it('a font change inside a pending class write\'s delay keeps both edits on disk', async () => {
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  await acceptProjectEdit(doc, { projectId, operationId: 'class-p4', mutate: () => {},
    commands: classCommands({ file, line: 6, column: 1, sourceVersion: sourceVersion(layout) }, 'p-4', 'p-2', { armed: true, pageFile: file }) });
  await updateLocalCustomFont(projectId, { family: 'Inter', format: 'woff2', srcUrl: '/fonts/inter.woff2' }, 400, false);
  await flushDurableSourceWrites(projectId);
  const disk = runtime.read(file);
  expect(disk).toContain('<main class="p-4">Привет</main>');
  expect(disk).toContain('sq-fonts.css');
  doc.destroy();
});
