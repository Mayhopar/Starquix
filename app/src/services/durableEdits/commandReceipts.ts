import { db } from '@/db';
import { projectFileId } from '@/db/projectFiles';
import { localFetch } from '@/utils/sqLocalBase';
import { resolveComponentSourcePath } from '@/utils/astroAssetPaths';
import { isCrossFileAtOrigin, allowsCrossFileOverrideWrite, captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { updateClassAttribute } from '@/vite-plugin/ast-updater';
import type { MaterializationCommand, PreparedSourceCommand, SourceCommandOutcome, DurableFileChange, SourceWriteBatch, SourceIdentityMap } from './types';
import { structuralFile, applyStructuralTransform } from './structuralTransform';
import { encodeFileBytes, decodeFileBytes } from './fileEncoding';
import { applyLayoutAppend } from './layoutAppend';
import { assertSourceLocationVersion, attributeIdentityMap, invertIdentityMaps, resolveProjectedSourceLocation, structuralIdentityMap, sourceSelectorProjection } from './sourceIdentity';
import { mergeText, mergeTextReport } from './rebase';
import { noteOwnWrite } from '@/services/agentPresence';

type FeatureCommand = Extract<MaterializationCommand, { kind: 'variables-css' | 'post-write' | 'folder-manifest' }>;
type SourceCommand = Extract<MaterializationCommand, { kind: 'class-write' | 'source-batch' | 'structural-write' | 'file-batch' | 'layout-append' | 'receipt-replay' }> | FeatureCommand;
const encoder = new TextEncoder();
/** Exact source text: keep a leading U+FEFF. The instance compares with the
 *  BOM (Node keeps it), so a BOM-less baseline never matches disk. */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** The pure preparation refused the intent; no runtime mutation was dispatched. */
export class SourcePreparationRefused extends Error {
  /** `file` names the source the user's edit no longer fits, when one does. */
  constructor(message?: string, readonly file?: string) { super(message); }
}

/** Sorted object keys bind an operation ID to intent, independent of key insertion order. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('Source command must contain serializable intent');
}

async function hash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceFile(command: Exclude<SourceCommand, FeatureCommand | { kind: 'file-batch' | 'receipt-replay' }>): string {
  let file: string;
  if (command.kind === 'class-write') {
    const { sourceLocation, origin } = command.payload;
    file = sourceLocation.file;
    const writeOrigin = origin ?? captureLocalWriteOrigin();
    if (isCrossFileAtOrigin(writeOrigin, file) && !allowsCrossFileOverrideWrite(writeOrigin, file)) {
      throw new Error('Instance-scope classes have no source write; retain the durable overlay');
    }
  } else if (command.kind === 'layout-append') {
    file = command.payload.pageFile;
    if (isCrossFileAtOrigin(command.payload.origin ?? captureLocalWriteOrigin(), file)) throw new Error('Layout append belongs to another source surface');
  } else if (command.kind === 'structural-write') {
    const files = command.payload.operations.map(structuralFile);
    if (files.length === 0 || files.some(candidate => candidate !== files[0])) throw new Error('Prepare exactly one structural source file per command');
    file = files[0];
    if (!command.payload.masterWrite && isCrossFileAtOrigin(command.payload.origin ?? captureLocalWriteOrigin(), file)) {
      throw new Error('Structural edits cannot change another surface file');
    }
  } else {
    if (command.payload.payloads.length !== 1) throw new Error('Prepare exactly one source file per command');
    const source = command.payload.payloads[0].astroSource;
    file = source.startsWith('src/') ? source : resolveComponentSourcePath(source);
  }
  validateFile(file);
  return file;
}

function validateFile(file: string, encoding?: 'base64'): void {
  if (typeof file !== 'string' || !(file.startsWith('src/') || file === '.starquix/folders.json' || (encoding === 'base64' && file.startsWith('public/assets/'))) || file.split('/').some(part => !part || part === '..' || part === '.' || part === 'node_modules') || /[\\\0]/.test(file)) {
    throw new Error('Source command must target a project-relative src file');
  }
}

/** Prepared feature bytes cannot enlarge the target authorized by their
 * captured gesture. Recheck on replay as well as before initial acceptance. */
export function validateFeatureCommand(projectId: string, command: MaterializationCommand): void {
  if (command.kind === 'layout-append') {
    const file = sourceFile(command);
    if (command.payload.preparedFiles?.some(change => change.file !== file)) throw new SourcePreparationRefused('Prepared layout file is outside its source intent');
  } else if (command.kind === 'folder-manifest') {
    if (command.payload.localPath !== null && command.payload.localPath !== `wc://${projectId}`) throw new SourcePreparationRefused('Folder intent belongs to another project');
    if (command.payload.preparedFiles.some(change => change.file !== '.starquix/folders.json')) throw new SourcePreparationRefused('Prepared folder file is outside its source intent');
  } else if (command.kind === 'variables-css') {
    const payload = command.payload;
    if (payload.projectPath !== `wc://${projectId}`) throw new SourcePreparationRefused('Variables intent belongs to another project');
    if (payload.file !== 'src/styles/sq-variables.css' || payload.imports.some(intent => !/^src\/(layouts|pages)\/.+\.astro$/.test(intent.file))) throw new SourcePreparationRefused('Invalid variables source intent');
    const targets = new Set([payload.file, ...payload.imports.map(intent => intent.file)]);
    if (payload.preparedFiles.some(change => !targets.has(change.file))) throw new SourcePreparationRefused('Prepared variables file is outside its source intent');
  } else if (command.kind === 'post-write') {
    const { collection, slug, expectedSource, preparedFiles } = command.payload;
    if (preparedFiles.length !== 1 || preparedFiles.some(change => !['md', 'mdx'].some(extension => change.file === `src/content/${collection}/${slug}.${extension}`) || change.beforeSource !== expectedSource)) throw new SourcePreparationRefused('Prepared post file is outside its source intent');
  }
}

/** The bytes on disk and when they were written (the instance's mtime; null
 *  when unknown or the file is absent) — who is newer, ledger B. */
async function readSourceStamp(projectId: string, file: string, encoding?: 'base64'): Promise<{ source: string | null; mtime: number | null }> {
  validateFile(file, encoding);
  const response = await localFetch(`/__sq/local/file?path=${encodeURIComponent(`wc://${projectId}`)}&file=${encodeURIComponent(file)}&probe=1`);
  if (response.status === 404 || response.headers.get('x-sq-missing') === '1') return { source: null, mtime: null };
  if (!response.ok) throw new Error(`Cannot read prepared source (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { source: encoding === 'base64' ? encodeFileBytes(bytes) : decoder.decode(bytes), mtime: Number(response.headers.get('x-sq-mtime')) || null };
}

export async function readSourceState(projectId: string, file: string, encoding?: 'base64'): Promise<string | null> {
  return (await readSourceStamp(projectId, file, encoding)).source;
}

async function readSource(projectId: string, file: string): Promise<string> {
  const response = await localFetch(`/__sq/local/file?path=${encodeURIComponent(`wc://${projectId}`)}&file=${encodeURIComponent(file)}`);
  if (!response.ok) throw new Error(`Cannot read prepared source (${response.status})`);
  return decoder.decode(await response.arrayBuffer());
}

async function astroCompiler() {
  const compiler = await import('@astrojs/compiler');
  if ('initialize' in compiler) {
    const wasm = await import('@astrojs/compiler/astro.wasm?url');
    await (compiler.initialize as (options: { wasmURL: string }) => Promise<void>)({ wasmURL: wasm.default });
  }
  return compiler;
}

async function loadWriteBackTransform() {
  // Loading chunks/WASM is transport work, not a semantic refusal. Keep these
  // failures outside the pure-transform catch so the durable worker retries.
  await astroCompiler();
  return (await import('@/vite-plugin/write-back-apply')).applyWriteBackOverrides;
}

/** Freeze selector transforms while accepting the edit; no receipt or runtime write. */
export async function prepareWriteBackFiles(projectId: string, payload: SourceWriteBatch,
  read: (file: string) => Promise<string | null>, inGesture: Map<string, DurableFileChange> = new Map()): Promise<{ files: DurableFileChange[]; skipped: PreparedSourceCommand['skipped']; appliedTotal: number }> {
  const apply = await loadWriteBackTransform();
  const files = new Map<string, DurableFileChange>();
  const skipped = [...payload.skipped];
  let appliedTotal = 0;
  for (const item of payload.payloads) {
    const file = item.astroSource.startsWith('src/') ? item.astroSource : resolveComponentSourcePath(item.astroSource);
    validateFile(file);
    const earlier = files.get(file);
    const before = earlier ? earlier.afterSource : await read(file);
    if (before === null) throw new SourcePreparationRefused(`Source does not exist: ${file}`);
    const preceding = [inGesture.get(file), earlier].filter((change): change is DurableFileChange => !!change);
    const selectorProjection = item.selectorSourceRevision === undefined ? undefined
      : await sourceSelectorProjection(projectId, file, item.selectorSourceRevision, before, preceding, item.selectorSourceVersion);
    const result = await apply(before, file, item.overrides, selectorProjection);
    if (!result.ok) throw new SourcePreparationRefused('Source write refused: delete would empty file body');
    files.set(file, { file, beforeSource: earlier ? earlier.beforeSource : before, afterSource: result.content,
      identityMaps: [...(earlier?.identityMaps ?? []), ...result.identityMaps] });
    appliedTotal += Object.values(result.report.applied).reduce((total, count) => total + count, 0);
    for (const [category, selectors] of Object.entries(result.report.skipped)) for (const selector of selectors) {
      skipped.push({ source: item.astroSource, category: category as PreparedSourceCommand['skipped'][number]['category'], selector, reason: 'unresolved' });
    }
  }
  return { files: [...files.values()], skipped, appliedTotal };
}

/** No source writes: use the same pure transforms as the existing writers. */
export async function prepareSourceCommand(projectId: string, commandId: string, input: SourceCommand, projection?: {
  read(file: string, encoding?: 'base64'): Promise<string | null>;
}): Promise<PreparedSourceCommand> {
  if (!projectId || !commandId) throw new Error('Source command identity is required');
  if (input.kind === 'source-batch' && input.payload.sourceTextEdits?.length && !input.payload.preparedFiles) {
    throw new SourcePreparationRefused('Source text edits must be prepared at acceptance');
  }
  const command = structuredClone(input);
  validateFeatureCommand(projectId, command);
  const commandDigest = await hash(canonical(command));
  // Read-only projection may cache an inverse before the original writer
  // starts. That preparation is not proof that the original write completed.
  if (command.kind === 'receipt-replay' && !projection) for (const originalId of command.payload.commandIds) {
    if ((await db.durableCommandReceipts.get([projectId, originalId]))?.outcome?.status !== 'written') {
      throw new SourcePreparationRefused('Original source command has no complete receipt');
    }
  }
  const existing = await db.durableCommandReceipts.get([projectId, commandId]);
  if (existing) {
    if (existing.prepared.commandDigest !== commandDigest) throw new Error('Source command identity has different intent');
    return existing.prepared;
  }
  if (command.kind === 'file-batch' || command.kind === 'receipt-replay' || command.kind === 'variables-css' || command.kind === 'post-write' || command.kind === 'folder-manifest'
    || ((command.kind === 'class-write' || command.kind === 'source-batch' || command.kind === 'layout-append') && command.payload.preparedFiles)) {
    if (command.kind === 'class-write') sourceFile(command);
    if (command.kind === 'source-batch') {
      const targets = new Set(command.payload.payloads.map(item => item.astroSource.startsWith('src/') ? item.astroSource : resolveComponentSourcePath(item.astroSource)));
      for (const edit of command.payload.sourceTextEdits ?? []) {
        if (!edit.masterWrite && isCrossFileAtOrigin(edit.origin, edit.sourceLocation.file) && !allowsCrossFileOverrideWrite(edit.origin, edit.sourceLocation.file)) throw new SourcePreparationRefused('Text edits cannot change another surface file');
        targets.add(edit.sourceLocation.file);
      }
      if (command.payload.preparedFiles!.some(file => !targets.has(file.file))) throw new SourcePreparationRefused('Prepared write-back file is outside its source intent');
    }
    let changes: DurableFileChange[];
    if (command.kind === 'file-batch') changes = command.payload.files;
    else if (command.kind !== 'receipt-replay') changes = command.payload.preparedFiles!;
    else {
      const combined = new Map<string, DurableFileChange>();
      for (const originalId of command.payload.commandIds) {
        const receipt = await db.durableCommandReceipts.get([projectId, originalId]);
        let originalFiles: DurableFileChange[] | undefined = receipt?.prepared.files ?? (receipt?.prepared ? [{ file: receipt.prepared.file,
          beforeSource: receipt.prepared.beforeSource, afterSource: receipt.prepared.afterSource }] : undefined);
        if (!originalFiles && projection) {
          // An accepted Undo may be read before its original writer starts.
          // Derive its display from immutable accepted bytes, never new runtime
          // bytes. Actual worker dispatch still requires the written receipt.
          let reference: unknown;
          try { reference = JSON.parse(originalId); } catch { /* legacy receipt-only IDs */ }
          if (Array.isArray(reference) && typeof reference[0] === 'string' && Number.isInteger(reference[1]) && reference[1] >= 0) {
            const original = (await db.durableEdits.get(`${projectId}:${reference[0]}`))?.commands[reference[1]];
            originalFiles = original?.kind === 'file-batch' ? original.payload.files
              : original && 'preparedFiles' in original.payload ? original.payload.preparedFiles : undefined;
          }
        }
        if (!originalFiles) throw new SourcePreparationRefused('Original source command has no complete receipt');
        for (const file of originalFiles) {
          const earlier = combined.get(file.file);
          combined.set(file.file, { file: file.file, ...('encoding' in file && file.encoding ? { encoding: file.encoding } : {}),
            beforeSource: earlier ? earlier.beforeSource : file.beforeSource, afterSource: file.afterSource,
            identityMaps: [...(earlier?.identityMaps ?? []), ...(('identityMaps' in file ? file.identityMaps : undefined) ?? [])] });
        }
      }
      changes = [...combined.values()].map(file => command.payload.direction === 'before'
        ? { ...file, beforeSource: file.afterSource, afterSource: file.beforeSource, identityMaps: invertIdentityMaps(file.identityMaps ?? []) } : file);
    }
    if (!changes.length) throw new SourcePreparationRefused('Empty file batch');
    const seen = new Set<string>();
    const found: Array<{ change: DurableFileChange; current: string | null; mtime: number | null }> = [];
    for (const change of changes) {
      validateFile(change.file, change.encoding);
      if (change.encoding === 'base64') for (const source of [change.beforeSource, change.afterSource]) if (source !== null) decodeFileBytes(source);
      if (seen.has(change.file)) throw new SourcePreparationRefused('Duplicate file in batch');
      seen.add(change.file);
      const { source: current, mtime } = projection ? { source: await projection.read(change.file, change.encoding), mtime: null }
        : await readSourceStamp(projectId, change.file, change.encoding);
      found.push({ change, current, mtime });
    }
    // An edit that waited while an outside writer (an agent) moved its files re-applies onto those bytes (ledger B).
    const files: NonNullable<PreparedSourceCommand['files']> = await Promise.all((await rebaseEdit(projectId, commandId, found)).map(async settled => ({
      ...settled, beforeHash: await hash(JSON.stringify(settled.beforeSource)), afterHash: await hash(JSON.stringify(settled.afterSource)) })));
    // Keep legacy one-file fields readable by older inspection surfaces.
    const first = files[0];
    return persistPreparation({ projectId, commandId, commandDigest, files, file: first.file,
      beforeSource: first.beforeSource ?? '', afterSource: first.afterSource ?? '',
      beforeHash: first.beforeHash, afterHash: first.afterHash,
      skipped: command.kind === 'source-batch' ? command.payload.preparedSkipped ?? [] : [],
      appliedTotal: command.kind === 'source-batch' ? command.payload.preparedAppliedTotal ?? files.length : files.length });
  }
  let file: string;
  try { file = sourceFile(command); }
  catch (error) { throw new SourcePreparationRefused(error instanceof Error ? error.message : String(error)); }
  const beforeSource = projection ? await projection.read(file) : await readSource(projectId, file);
  if (beforeSource === null) throw new SourcePreparationRefused(`Source does not exist: ${file}`);
  const applyWriteBack = command.kind === 'source-batch' ? await loadWriteBackTransform() : null;
  let afterSource: string;
  let skipped: PreparedSourceCommand['skipped'] = [];
  let appliedTotal = 0;
  let structuralResults: PreparedSourceCommand['structuralResults'];
  const identityMaps: NonNullable<DurableFileChange['identityMaps']> = [];
  try { if (command.kind === 'class-write') {
    const p = command.payload;
    let operationId = commandId;
    try { [operationId] = JSON.parse(commandId) as [string, number]; } catch { /* legacy command ID */ }
    const row = await db.durableEdits.get(`${projectId}:${operationId}`);
    const loc = await resolveProjectedSourceLocation(projectId, p.sourceLocation, p.sourceRevision ?? 0, (row?.revision ?? Infinity) - 1);
    assertSourceLocationVersion(loc, beforeSource);
    afterSource = await updateClassAttribute(beforeSource, file, loc, p.newClasses, p.baseClasses ?? undefined);
    identityMaps.push(attributeIdentityMap(beforeSource, afterSource));
    appliedTotal = afterSource === beforeSource ? 0 : 1;
  } else if (command.kind === 'layout-append') {
    afterSource = applyLayoutAppend(beforeSource, command.payload);
    appliedTotal = afterSource === beforeSource ? 0 : 1;
  } else if (command.kind === 'structural-write') {
    afterSource = beforeSource;
    structuralResults = [];
    for (const op of command.payload.operations) {
      if ('loc' in op) assertSourceLocationVersion(op.loc, afterSource);
      else if (op.kind === 'move') {
        assertSourceLocationVersion(op.from, afterSource); assertSourceLocationVersion(op.to, afterSource);
      }
      const { content, ...result } = applyStructuralTransform(afterSource, op);
      identityMaps.push(structuralIdentityMap(afterSource, content, op, result));
      afterSource = content;
      structuralResults.push({ success: true, file, ...result });
    }
    appliedTotal = afterSource === beforeSource ? 0 : command.payload.operations.length;
  } else {
    const payload = command.payload.payloads[0];
    const result = await applyWriteBack!(beforeSource, file, payload.overrides);
    if (!result.ok) throw new Error('Source write refused: delete would empty file body');
    afterSource = result.content;
    identityMaps.push(...result.identityMaps);
    appliedTotal = Object.values(result.report.applied).reduce((total, count) => total + count, 0);
    skipped = [...command.payload.skipped];
    for (const [category, selectors] of Object.entries(result.report.skipped)) {
      for (const selector of selectors) skipped.push({ source: payload.astroSource,
        category: category as PreparedSourceCommand['skipped'][number]['category'], selector, reason: 'unresolved' });
    }
  } } catch (error) { throw new SourcePreparationRefused(error instanceof Error ? error.message : String(error)); }
  const prepared: PreparedSourceCommand = { projectId, commandId, commandDigest, file, beforeSource, afterSource,
    beforeHash: await hash(beforeSource), afterHash: await hash(afterSource), skipped, appliedTotal,
    ...(structuralResults ? { structuralResults } : {}),
    ...(identityMaps.length ? { files: [{ file, beforeSource, afterSource, identityMaps,
      beforeHash: await hash(JSON.stringify(beforeSource)), afterHash: await hash(JSON.stringify(afterSource)) }] } : {}) };
  return persistPreparation(prepared);
}

/** B6: a merge never turns two valid sources into a broken one. A check that
 *  cannot run never blocks the merge. */
async function parses(file: string, source: string | null): Promise<boolean> {
  if (source === null) return true;
  if (file.endsWith('.json')) { try { JSON.parse(source); return true; } catch { return false; } }
  try {
    if (file.endsWith('.astro')) {
      const { diagnostics } = await (await astroCompiler()).parse(source);
      return !diagnostics.some(diagnostic => diagnostic.severity === 1); // DiagnosticSeverity.Error
    }
    if (/\.mdx?$/.test(file)) {
      const [{ postCompiles }, { postSourceParts }] = await Promise.all([import('@/postmodel/compileGate'), import('@/postmodel/frontmatterPatch')]);
      return (await postCompiles(postSourceParts(source).body, file.endsWith('.mdx') ? 'mdx' : 'md')).ok;
    }
  } catch { /* the guard failed, not the merge */ }
  return true;
}

/** Ledger B: an edit accepted after the outside write it now meets is the
 *  newer side. Unknown write time (B11) or a tie (B12): the disk is newer. */
async function acceptedAfter(projectId: string, commandId: string, mtime: number | null): Promise<boolean> {
  if (mtime === null) return false;
  try {
    const [operationId] = JSON.parse(commandId) as [string, number];
    return ((await db.durableEdits.get(`${projectId}:${operationId}`))?.acceptedAt ?? 0) > mtime;
  } catch { return false; }
}

/** The edit yields this file: the outside bytes stay as they are. */
const outsideStays = (change: DurableFileChange, current: string | null): DurableFileChange =>
  ({ file: change.file, ...(change.encoding ? { encoding: change.encoding } : {}), beforeSource: current, afterSource: current, identityMaps: [] });

/** One file of a waiting edit re-applied onto the bytes an outside writer left
 *  (ledger B). `clean` = every change of the edit is in the result. */
async function rebaseFileChange(change: DurableFileChange, current: string | null, editIsNewer: boolean): Promise<{ change: DurableFileChange; clean: boolean }> {
  const { file, encoding, beforeSource: before, afterSource: after } = change;
  // A file the edit thought absent is never overwritten (B8); a deleted file
  // has no write time, so it stays deleted (B7).
  if (before === null || current === null) return { change: outsideStays(change, current), clean: false };
  let afterSource: string | null, clean = true;
  if (encoding || after === null) { // B9, B10: no text to merge — the newer side whole
    if (!editIsNewer) return { change: outsideStays(change, current), clean: false };
    afterSource = after;
  } else {
    const newer = editIsNewer ? after : current;
    ({ text: afterSource, clean } = editIsNewer ? { text: mergeText(before, current, after), clean: true } : mergeTextReport(before, after, current));
    if (afterSource !== newer && !(await parses(file, afterSource)) && await parses(file, newer)) { afterSource = newer; clean = editIsNewer; } // B6
  }
  let identityMaps: SourceIdentityMap[] = [];
  if (!encoding && afterSource !== null) {
    try { identityMaps = [attributeIdentityMap(current, afterSource)]; } catch { /* structure changed: claim no correspondence */ }
  }
  return { change: { file, ...(encoding ? { encoding } : {}), beforeSource: current, afterSource, identityMaps }, clean };
}

/**
 * Agent multiplayer (owner 2026-11-08, ledger B): a waiting edit whose files an
 * outside writer (an agent) moved re-applies onto the bytes there — every kind,
 * never a refusal. Per file the side that changed last (the edit's acceptance vs
 * the file's mtime) keeps the characters both changed; without text to merge
 * (create, delete, binary), or when a merge would no longer parse, the newer
 * side stays whole. A multi-file edit stays atomic (B5a): when an older edit
 * could not land whole in one of its files, all of them keep the outside bytes.
 */
export async function rebaseEdit(projectId: string, commandId: string,
  found: Array<{ change: DurableFileChange; current: string | null; mtime: number | null }>): Promise<DurableFileChange[]> {
  const rebased = await Promise.all(found.map(async ({ change, current, mtime }) => current === change.beforeSource
    ? { change, clean: true } : rebaseFileChange(change, current, await acceptedAfter(projectId, commandId, mtime))));
  if (found.length > 1 && rebased.some(result => !result.clean)) return found.map(({ change, current }) => outsideStays(change, current));
  return rebased.map(result => result.change);
}

/** A prepared, unwritten edit whose file moved before its write landed (an
 * outside write between preparation and dispatch). 'rebased' = the stored
 * preparation now targets the bytes on disk; 'unchanged' = nothing moved. */
export async function rebaseSourceCommand(projectId: string, commandId: string): Promise<'rebased' | 'unchanged'> {
  const row = await stored(projectId, commandId);
  if (row.outcome?.status === 'written' || row.outcome?.status === 'partial') return 'unchanged';
  const p = row.prepared;
  const changes: DurableFileChange[] = p.files ?? [{ file: p.file, beforeSource: p.beforeSource, afterSource: p.afterSource }];
  const found = await Promise.all(changes.map(async change => {
    const { source: current, mtime } = await readSourceStamp(projectId, change.file, change.encoding);
    // A file already holding the edit (disk == after) is in place, not moved.
    return { change: current === change.afterSource ? { ...change, beforeSource: current } : change, current, mtime };
  }));
  if (found.every(({ change, current }) => current === change.beforeSource)) return 'unchanged';
  const files = await rebaseEdit(projectId, commandId, found);
  const hashed = await Promise.all(files.map(async change => ({ ...change,
    beforeHash: await hash(JSON.stringify(change.beforeSource)), afterHash: await hash(JSON.stringify(change.afterSource)) })));
  const first = hashed[0];
  await db.durableCommandReceipts.update([projectId, commandId], { outcome: null, prepared: { ...p, files: hashed, file: first.file,
    beforeSource: first.beforeSource ?? '', afterSource: first.afterSource ?? '', beforeHash: first.beforeHash, afterHash: first.afterHash } });
  return 'rebased';
}

async function persistPreparation(prepared: PreparedSourceCommand): Promise<PreparedSourceCommand> {
  const { projectId, commandId, commandDigest } = prepared;
  return db.transaction('rw', db.durableCommandReceipts, async () => {
    const old = await db.durableCommandReceipts.get([projectId, commandId]);
    if (old) {
      if (old.prepared.commandDigest !== commandDigest) throw new Error('Source command identity has different intent');
      return old.prepared;
    }
    await db.durableCommandReceipts.add({ projectId, commandId, prepared, outcome: null });
    return prepared;
  });
}

async function stored(projectId: string, commandId: string) {
  const row = await db.durableCommandReceipts.get([projectId, commandId]);
  if (!row) throw new Error('Source command has no durable preparation');
  return row;
}

function publishWritten(_prepared: PreparedSourceCommand, outcome: SourceCommandOutcome): SourceCommandOutcome {
  return outcome;
}

/** A verified result and its file bytes commit together before completion is observable. */
async function record(prepared: PreparedSourceCommand, outcome: SourceCommandOutcome): Promise<SourceCommandOutcome> {
  const { projectId, commandId, file } = prepared;
  return db.transaction('rw', db.durableCommandReceipts, db.projectFiles, async () => {
    const row = await stored(projectId, commandId);
    if (row.prepared.commandDigest !== prepared.commandDigest) throw new Error('Source command identity changed');
    if (row.outcome?.status === 'written' || row.outcome?.status === 'partial') return row.outcome;
    if (outcome.status === 'written' || outcome.status === 'partial') {
      // The disk was just read at afterSource: that is the mirror row now. A
      // stale row (a missed journal entry) never turns a verified write into
      // "unknown" — that blocked every later save (audit 2026-10-18).
      const files: DurableFileChange[] = prepared.files ?? [{ file, beforeSource: prepared.beforeSource, afterSource: prepared.afterSource }];
      for (const change of files) {
        const id = projectFileId(projectId, change.file);
        if (change.afterSource === null) await db.projectFiles.delete(id);
        else await db.projectFiles.put({ id, projectId, path: change.file, content: change.encoding === 'base64' ? decodeFileBytes(change.afterSource) : encoder.encode(change.afterSource),
          isText: change.encoding !== 'base64', updatedAt: Date.now(), pendingSync: 1 });
      }
    }
    await db.durableCommandReceipts.update([projectId, commandId], { outcome });
    return outcome;
  });
}

/** Read-only with respect to the runtime. Absence of evidence never permits replay. */
export async function reconcileSourceCommand(projectId: string, commandId: string): Promise<SourceCommandOutcome> {
  const row = await stored(projectId, commandId);
  if (row.outcome?.status === 'written' || row.outcome?.status === 'partial') return publishWritten(row.prepared, row.outcome);
  const p = row.prepared;
  let outcome: SourceCommandOutcome;
  try {
    if (p.files) {
      let complete = true;
      for (const change of p.files) {
        const current = await readSourceState(projectId, change.file, change.encoding);
        if (current === change.afterSource) continue;
        if (current !== change.beforeSource) throw new Error('Source differs from both prepared states');
        complete = false;
      }
      outcome = complete ? p.skipped.length ? { status: 'partial', skipped: p.skipped }
        : { status: 'written', receipt: { projectId, operationId: commandId, materializedAt: Date.now() } }
        : { status: 'not-written' };
    } else {
    const current = await readSource(projectId, p.file);
    if (current === p.afterSource) {
      outcome = p.skipped.length ? { status: 'partial', skipped: p.skipped } : {
        status: 'written', receipt: { projectId, operationId: commandId, materializedAt: Date.now() },
      };
    } else if (current === p.beforeSource) outcome = { status: 'not-written' };
    else outcome = { status: 'unknown', error: 'Source differs from both prepared states' };
    }
  } catch (error) {
    outcome = { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
  return publishWritten(p, await record(p, outcome));
}

export async function dispatchSourceCommand(projectId: string, commandId: string): Promise<SourceCommandOutcome> {
  const outcome = await reconcileSourceCommand(projectId, commandId);
  if (outcome.status !== 'not-written') return outcome;
  const { prepared } = await stored(projectId, commandId);
  // Agent presence (G5): the watcher echoes this write; it is not the agent's.
  for (const change of prepared.files ?? [{ file: prepared.file, afterSource: prepared.afterSource }]) {
    if (!('encoding' in change && change.encoding)) noteOwnWrite(projectId, change.file, change.afterSource);
  }
  try {
    await localFetch('/__sq/local/source-command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prepared, path: `wc://${projectId}` }) });
  } catch { /* A lost ACK is reconciled against exact prepared source, never replayed blindly. */ }
  return reconcileSourceCommand(projectId, commandId);
}
