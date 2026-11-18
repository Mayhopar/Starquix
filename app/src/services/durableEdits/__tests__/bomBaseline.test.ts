// @vitest-environment node
// Audit 2026-10-18 (b): Response.text() drops a leading U+FEFF, the instance
// keeps it. A BOM file's baseline then never matched disk: the write was
// refused and every later save waited behind it, silently.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { putProjectFiles } from '@/db/projectFiles';
import { readLocalFile } from '@/utils/localElementSource';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { prepareSourceCommand, dispatchSourceCommand, readSourceState } from '../commandReceipts';

const projectId = 'browser_bom_baseline';
const file = 'src/pages/index.astro';
const source = '﻿<main class="p-2"><h1>Title</h1></main>\n';
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  await db.delete(); await db.open();
  runtime = projectFsRuntime(projectId, { [file]: source });
  // The P0 mirror holds the disk bytes, BOM included.
  await putProjectFiles(projectId, [{ path: file, content: new TextEncoder().encode(source) }]);
});
afterEach(() => runtime.close());

it('reads a BOM file with its BOM (Source tab + field-binding baseline)', async () => {
  expect(await readLocalFile(file)).toBe(source);
  expect(await readSourceState(projectId, file)).toBe(source);
});

it('writes a whole-file change to a BOM file and keeps the BOM', async () => {
  const before = await readSourceState(projectId, file);
  await prepareSourceCommand(projectId, 'bom-file', { kind: 'file-batch', payload: { files: [
    { file, beforeSource: before, afterSource: before!.replace('Title', 'Заголовок') }] } });
  expect(await dispatchSourceCommand(projectId, 'bom-file')).toMatchObject({ status: 'written' });
  expect(runtime.read(file)).toBe(source.replace('Title', 'Заголовок'));
});

it('writes a class edit to a BOM file and keeps the BOM', async () => {
  await prepareSourceCommand(projectId, 'bom-class', { kind: 'class-write', payload: {
    sourceLocation: { file, line: 1, column: 1 }, newClasses: 'p-4', baseClasses: 'p-2', origin: { armed: true, pageFile: file } } });
  expect(await dispatchSourceCommand(projectId, 'bom-class')).toMatchObject({ status: 'written' });
  expect(runtime.read(file)).toBe(source.replace('p-2', 'p-4'));
});
