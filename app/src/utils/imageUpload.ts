/**
 * Shared image-file upload: browser mode stores in IndexedDB + transfers the
 * blob to the iframe, cloud/server mode uses a presigned URL. Used by
 * ImageBlock (DesignBar) and the canvas hover-upload overlay — never
 * duplicate this branch.
 */
import type { ComponentUsages } from '@/vite-plugin/project-fs';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { isLocalProjectId, findLocalProjectEntry, PROJECT_NOT_READY } from '@/utils/localMode';
import type { UploadAssetResult } from '@/hooks/useAssetUpload';
import { localFetch } from './sqLocalBase';
import { readJsonResponse } from './readJsonResponse';
import { isImageSchemaFieldIn } from '@/core/collections/contentConfigSchema';
import { readLocalContentConfig } from '@/core/collections/content-ops';
import { fetchImageMutation } from '@/services/imageMutationReceipts';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { encodeFileBytes } from '@/services/durableEdits/fileEncoding';
import { settleSourceWrites } from '@/services/durableEdits/sourceMaterialization';

interface UploadImageFileParams {
  file: File;
  projectId: string;
  pageId: string;
  uploadAsset: (file: File) => Promise<UploadAssetResult>;
}

interface UploadImageFileResult {
  /** Value to store as the img's src attribute (sq-asset: ref or public URL) */
  src: string;
  /** Value to render locally right away (data URL, editor-origin blob URL or public URL) */
  previewUrl: string;
}

/**
 * Ask ViewportFrame to forward an image-attribute change to the iframe.
 * Single definition of the SYNC_IMAGE_ATTR_TO_IFRAME payload shape for the
 * upload surfaces (ImageBlock, canvas hover-upload overlay).
 */
export function syncImageAttrToIframe(key: string, attribute: string, value: string): void {
  window.postMessage({
    type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
    payload: { key, attribute, value },
  }, '*');
}

/**
 * task-132 local mode: the file IS the asset. Host writes the bytes into the
 * folder's public/uploads/; src is a plain root-relative URL the user's own
 * astro dev serves. No Dexie, no sq-asset ref, no iframe blob transfer.
 */
export async function uploadLocalAssetFile(projectId: string, file: File): Promise<UploadImageFileResult> {
  const entry = findLocalProjectEntry(projectId);
  if (!entry) throw new Error(PROJECT_NOT_READY);
  let previewUrl = '';
  const params = new URLSearchParams({ path: entry.path, name: file.name });
  const resp = await fetchImageMutation(projectId, `/__sq/local/asset?${params}`, file, bytes => {
    // Runtime-relative URLs cannot render on the editor origin. Reuse the
    // receipt owner's single File read, before dispatch, without a blob lifetime.
    previewUrl = `data:${file.type || 'application/octet-stream'};base64,${encodeFileBytes(bytes)}`;
  });
  if (!resp.ok) throw new Error(`Asset write failed (${resp.status})`);
  const { src } = (await resp.json()) as { src: string };
  return { src, previewUrl };
}

/**
 * Does `collection`'s schema in the project's content config declare `field`
 * with Astro's `image()` helper? Scoped to the collection (2026-09-12, owner's
 * site: `works.image: image()` + an editor-added `blog` with no config entry —
 * a name-keyed check over the whole file sent the blog upload post-relative,
 * which the listing card cannot resolve). No config → false.
 */
export async function isImageSchemaField(field: string, collection: string): Promise<boolean> {
  const config = await readLocalContentConfig().catch(() => null);
  return !!config && isImageSchemaFieldIn(config.content, collection, field);
}

/**
 * Frontmatter-image upload for a files-truth post. An `image()` schema field
 * (2026-08-14 owner report) rejects a `/uploads/…` public src —
 * InvalidContentEntryFrontmatterError 500s the whole site — so for THAT field
 * the host writes the bytes INSIDE the collection and returns a src relative
 * to the post file (`./images/uploads/…`). Any other field (no schema, or a
 * plain string) gets the public src: it renders from any page, a listing
 * card's `<img src={post.data.cover}>` included, where a post-relative path
 * cannot. Body/MDX media stays on uploadLocalAssetFile.
 */
export async function uploadLocalPostFieldImage(
  projectId: string, postFile: string, file: File, field: string, collection: string,
): Promise<string> {
  const entry = findLocalProjectEntry(projectId);
  if (!entry) throw new Error(PROJECT_NOT_READY);
  if (!(await isImageSchemaField(field, collection))) return (await uploadLocalAssetFile(projectId, file)).src;
  const params = new URLSearchParams({ path: entry.path, name: file.name, postFile });
  const resp = await fetchImageMutation(projectId, `/__sq/local/asset?${params}`, file);
  if (!resp.ok) throw new Error(`Asset write failed (${resp.status})`);
  const { src } = (await resp.json()) as { src: string };
  return src;
}

/** task-142 data-aware swap: new file lands NEXT TO the bound asset and every
 *  src/content reference is repointed — the <Image src={data}> binding
 *  survives. Returns the repo-relative new asset path (undo handle). */
export async function rebindLocalBoundAsset(
  projectId: string, boundAssetPath: string, file: File,
): Promise<{ newAsset: string; updatedFiles: string[] }> {
  const entry = findLocalProjectEntry(projectId);
  if (!entry) throw new Error(PROJECT_NOT_READY);
  const params = new URLSearchParams({ path: entry.path, old: boundAssetPath, name: file.name });
  await settleSourceWrites(projectId);
  const resp = await fetchImageMutation(projectId, `/__sq/local/rebind-asset?${params}`, file);
  return readJsonResponse(resp, value => {
    if (!value || typeof value !== 'object' || !('newAsset' in value) || typeof value.newAsset !== 'string' || !value.newAsset || !('updatedFiles' in value) || !Array.isArray(value.updatedFiles) || !value.updatedFiles.every(file => typeof file === 'string')) throw new Error('Invalid rebind receipt');
    return { newAsset: value.newAsset, updatedFiles: value.updatedFiles as string[] };
  });
}

/** task-142 "delete" for bound media: the schema requires an image, so
 *  removal rebinds to a generated neutral placeholder (same mountain art as
 *  the editor's media slots). 1200×800 PNG, drawn on a canvas. */
export async function makePlaceholderImageFile(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 800;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e2e8f0';
  g.fillRect(0, 0, 1200, 800);
  g.fillStyle = '#94a3b8';
  g.beginPath();
  g.arc(880, 235, 72, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#cbd5e1';
  g.beginPath(); g.moveTo(96, 640); g.lineTo(478, 288); g.lineTo(780, 640); g.closePath(); g.fill();
  g.fillStyle = '#94a3b8';
  g.beginPath(); g.moveTo(570, 640); g.lineTo(834, 394); g.lineTo(1104, 640); g.closePath(); g.fill();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('placeholder render failed'))), 'image/png'));
  return new File([blob], 'placeholder.png', { type: 'image/png' });
}

/** task-142 undo/redo: repoint refs onto an asset already on disk. */
export async function repointLocalBoundAsset(
  projectId: string, fromAssetPath: string, toAssetPath: string,
): Promise<void> {
  const entry = findLocalProjectEntry(projectId);
  if (!entry) throw new Error(PROJECT_NOT_READY);
  const params = new URLSearchParams({ path: entry.path, old: fromAssetPath, to: toAssetPath });
  await settleSourceWrites(projectId);
  const resp = await fetchImageMutation(projectId, `/__sq/local/rebind-asset?${params}`);
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Repoint failed (${resp.status})`);
  }
}

/** task-143 usage picker: pages/content entries that (transitively) render
 *  the component. */
export async function fetchComponentUsages(projectPath: string, componentFile: string): Promise<ComponentUsages> {
  const params = new URLSearchParams({ path: projectPath, file: componentFile });
  const resp = await localFetch(`/__sq/local/component-usages?${params}`);
  return readJsonResponse(resp, value => {
    if (!value || typeof value !== 'object' || !('usages' in value) || !Array.isArray(value.usages) || !('contentUsages' in value) || !Array.isArray(value.contentUsages)) throw new Error('Invalid usages');
    const usages = value.usages.map((page: unknown) => {
      if (!page || typeof page !== 'object' || !('route' in page) || typeof page.route !== 'string' || !('file' in page) || typeof page.file !== 'string' || !('editable' in page) || typeof page.editable !== 'boolean' || 'dynamic' in page && typeof page.dynamic !== 'boolean') throw new Error('Invalid page usage');
      return page as ComponentUsages['usages'][number];
    });
    const contentUsages = value.contentUsages.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || !('file' in entry) || typeof entry.file !== 'string' || !('collection' in entry) || typeof entry.collection !== 'string' || !('slug' in entry) || typeof entry.slug !== 'string') throw new Error('Invalid content usage');
      return entry as ComponentUsages['contentUsages'][number];
    });
    return { usages, contentUsages };
  });
}

/** task-143 unified image UX: set / repoint / clear a component's DEFAULT
 *  image (the editable placeholder in the component editor). */
export type DefaultImageOp = { clear: true } | { to: string } | { file: File };

export async function postComponentDefaultImage(
  projectPath: string, componentFile: string, imgIndex: number, op: DefaultImageOp,
): Promise<{ previous: string | null; asset: string }> {
  const params = new URLSearchParams({ path: projectPath, file: componentFile, imgIndex: String(imgIndex) });
  let body: File | undefined;
  if ('clear' in op) params.set('clear', '1');
  else if ('to' in op) params.set('to', op.to);
  else { params.set('name', op.file.name); body = op.file; }
  await settleSourceWrites(getActiveSaveProjectId());
  const resp = await fetchImageMutation(getActiveSaveProjectId(), `/__sq/local/component-default-image?${params}`, body);
  return readJsonResponse(resp, value => {
    if (!value || typeof value !== 'object' || !('previous' in value) || value.previous !== null && typeof value.previous !== 'string' || !('asset' in value) || typeof value.asset !== 'string' || !('clear' in op) && !value.asset) throw new Error('Invalid default image receipt');
    return { previous: value.previous, asset: value.asset };
  });
}

/**
 * THE post-media upload path (task-144) — never a second one. Returns the
 * project-relative src the MDX attribute gets. Shared by Canvas's post-editor
 * seam and MediaBlock's slot Replace; the caller picks which projectId names
 * the project (local mode needs the ROUTE id — see Canvas.uploadPostMedia).
 */
export async function uploadPostMediaFile(projectId: string, file: File): Promise<string> {
  return (await uploadLocalAssetFile(projectId, file)).src;
}

export async function uploadImageFile({
  file, projectId, uploadAsset,
}: UploadImageFileParams): Promise<UploadImageFileResult> {
  if (isLocalProjectId(projectId)) {
    return uploadLocalAssetFile(projectId, file);
  }

  const { assetId, editorBlobUrl } = await uploadAsset(file);
  await transferAssetToIframe(assetId, file);
  return { src: `sq-asset:${assetId}`, previewUrl: editorBlobUrl };
}
