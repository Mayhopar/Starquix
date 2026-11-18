import type { SourceLocation } from '@/core/state/index';
import { localFetch } from '@/utils/sqLocalBase';
import { flushPendingSourceWrites } from '@/utils/pendingSourceWrites';
import { openingTagAttributes, readImageFillSource, inspectImageFillTag, inspectImageFillContainerTag } from '../../../preview-template/src/plugins/sq-image-fill.js';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { isLocalProjectId, projectIdFromPath } from '@/utils/localMode';
import { inspectAcceptedProject } from './durableEdits/acceptance';
import { withProjectedSource } from './durableEdits/projectedSource';
import { prepareSourceGesture } from './durableEdits/sourceGesture';

export interface ImageFillSourceRead { content: string; expectedTag: string; location?: SourceLocation }
function projectForRead(projectPath?: string | null) {
  const projectId = projectIdFromPath(projectPath) ?? getActiveSaveProjectId();
  return projectId && isLocalProjectId(projectId) ? projectId : null;
}

export async function readImageFillSourceState(location: SourceLocation, projectPath?: string | null): Promise<ImageFillSourceRead> {
  const projectId = projectForRead(projectPath);
  if (projectId) {
    const gesture = prepareSourceGesture(projectId);
    return inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision, async () => {
      const resolved = await gesture.resolve(location);
      const content = gesture.files.get(resolved.file)!.afterSource;
      if (content === null) throw new Error('Source unavailable');
      return { content, ...readImageFillSource(content, resolved), location: resolved };
    }));
  }
  const query = new URLSearchParams({ file: location.file, ...(projectPath ? { path: projectPath } : {}) });
  const response = await localFetch(`/__sq/local/file?${query}`);
  if (!response.ok) throw new Error('Source unavailable');
  const content = await response.text();
  return { content, ...readImageFillSource(content, location), location };
}
function withoutClass(tag: string) {
  const attr = openingTagAttributes(tag).attributes.find(a => a.name.toLowerCase() === 'class');
  return attr ? tag.slice(0, attr.start) + tag.slice(attr.end) : tag;
}
/** Inspect accepted class/source changes; eventual dispatch checks exact bytes. */
export async function readCurrentImageFillSource(options: {
  location: SourceLocation; projectPath?: string | null; previous?: ImageFillSourceRead | null;
  native: boolean; isCurrent: () => boolean;
}): Promise<ImageFillSourceRead | null> {
  if (!projectForRead(options.projectPath)) await flushPendingSourceWrites();
  if (!options.isCurrent()) return null;
  const source = await readImageFillSourceState(options.location, options.projectPath);
  if (!options.isCurrent()) return null;
  const { expectedTag } = source;
  if (options.previous && withoutClass(options.previous.expectedTag) !== withoutClass(expectedTag)) throw new Error('Source identity changed');
  // Figma model (2026-09-19): no rendered-geometry gate — a conversion keeps
  // the rendered box itself (request.box). The source only has to be ours.
  if (options.native) inspectImageFillTag(expectedTag); else inspectImageFillContainerTag(expectedTag);
  return source;
}
