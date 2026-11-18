// Type surface for sq-project-fs.js (files-truth project handlers).
// The host TS modules re-export from the JS; these declarations keep them typed.
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface LocalPage { route: string; file: string; editable: boolean; dynamic?: boolean }
export interface DeletedLocalPage extends LocalPage { content: string }
export interface RenamedLocalPage extends LocalPage { oldRoute: string; oldFile: string }
export interface ContentUsage { file: string; collection: string; slug: string }
export interface ComponentUsages { usages: LocalPage[]; contentUsages: ContentUsage[] }
export interface DefaultImageResult { ok: true; prop: string; asset: string; previous: string | null }
export interface LocalAsset { file: string; url: string | null; kind: 'image' | 'video' | 'file'; size: number }
export interface RebindResult { newAsset: string; updatedFiles: string[] }
export interface LocalPageRef { route: string; file: string; dynamic?: boolean }
export type LocalPageDeletion =
  | { ok: true; route: string; file: string }
  | { ok: false; error: string };

export function slugify(text: string): string;
export function localPageId(route: string): string;
export function resolveLocalPageDeletion(pages: LocalPageRef[], pageId: string): LocalPageDeletion;
export const SQ_DEFAULTS_DIR: string;

export function routeForPageFile(relFile: string): string;
export function discoverLocalPages(dir: string): LocalPage[];
export function findComponentUsages(dir: string, relFile: string): ComponentUsages;
export function findImagePropAt(source: string, imgIndex: number): string;
export function writeComponentDefaultImage(dir: string, componentRel: string, imgIndex: number, asset: string | null): Promise<DefaultImageResult>;
export function writeDefaultImageAsset(dir: string, name: string, data: Buffer): string;
export const MAX_ASSET_BYTES: number;
export function readBinaryBody(
  req: IncomingMessage,
  res: ServerResponse,
  json: (res: ServerResponse, status: number, body: unknown) => void,
  onDone: (data: Buffer) => void,
): void;
export function createLocalPage(dir: string, name: string): LocalPage;
export function deleteLocalPage(dir: string, pageId: string): DeletedLocalPage;
export function resolvePageFilePath(dir: string, relFile: string): string;
export function restoreLocalPage(dir: string, route: string, content: string, file?: string): { route: string; file: string };
export function renameLocalPage(dir: string, pageId: string, name: string): RenamedLocalPage;
/** task-240: rename a page file inside src/pages (pagination route move). */
export function moveLocalPage(dir: string, from: string, to: string): { ok: true; from: string; to: string };
export function writeLocalAsset(dir: string, name: string, data: Buffer): { src: string };
export function writeLocalContentAsset(dir: string, postFile: string, name: string, data: Buffer): { src: string };
export function writeLocalFontFile(dir: string, name: string, data: Buffer): { src: string };
export function mergeLocalFontCss(dir: string, family: string, css: string): Promise<{ file: string }>;
export function ensureLocalFontsLink(dir: string): Promise<{ linked: boolean; updatedFiles: string[] }>;
export function listLocalContentFiles(dir: string): Record<string, string>;
export function listLocalAssets(dir: string): LocalAsset[];
export function resolveBoundAsset(dir: string, assetPath: string): string;
export function repointContentRefs(dir: string, oldAbs: string, newName: string): Promise<string[]>;
export function rebindLocalAsset(dir: string, oldAssetPath: string, name: string, data: Buffer): Promise<RebindResult>;
export function rebindToExisting(dir: string, fromAssetPath: string, toAssetPath: string): Promise<RebindResult>;
export function resolveLocalAssetFile(dir: string, rel: string): string;
export const SQ_INSERTABLE_COMPONENTS: string[];
export const SQ_UPGRADE_MARKERS: Record<string, string>;
export const SQ_HIDDEN: string[];
export const SQ_COMPONENT_NAME: RegExp;
export function projectHasMdx(dir: string): boolean;
export function resolveLocalContentPath(dir: string, rel: string): string;
export function writeLocalFile(dir: string, file: string, content: string): Promise<{ ok: true; file: string }>;
export function ensureSqComponent(dir: string, name: string, sqComponentsDir: string): Promise<{ status: number; body: unknown }>;

export class ComponentFileError extends Error {
  constructor(message: string, status: number);
  readonly status: number;
}
export function resolveInRoot(rootDir: string, componentPath: string): string;
export function createComponentFile(rootDir: string, name: string, astroContent: string, subDir?: string): Promise<string>;
export function renameComponentFile(rootDir: string, componentPath: string, newName: string): Promise<string>;
export function deleteComponentFile(rootDir: string, componentPath: string): Promise<string>;
export function moveComponentToSystemDir(rootDir: string, componentPath: string, promote: boolean, reservedNames?: readonly string[]): Promise<string>;
export function assertLayoutName(name: unknown): string;

export function readFolderManifest(file: string): Promise<unknown>;
export function writeFolderManifest(file: string, manifest: unknown): Promise<void>;
export function localFoldersFile(dir: string): string;

export interface PropDef { name: string; type: string; required: boolean; defaultValue?: string }
export interface DiscoveredComponent {
  name: string;
  path: string;
  absolutePath: string;
  category: string;
  props: PropDef[];
  slots: string[];
  dependencies: string[];
  frontmatter: string;
  pageTemplate: string | null;
  contentBound: boolean;
  defaultChildren: Array<{ name: string; slotName?: string }>;
  /** `@theme` tag; null = shared by every theme. */
  theme: string | null;
  /** `@name` tag: the library section a file is (or was copied from); null for the user's own files. */
  section: string | null;
}
export interface DiscoveredLayout {
  name: string;
  path: string;
  absolutePath: string;
  props: PropDef[];
  slots: string[];
  frontmatter: string;
  body: string;
}
export function discoverComponents(componentsDir: string, baseDir?: string): Promise<DiscoveredComponent[]>;
export function extractContentBound(frontmatter: string): boolean;
export function extractPageTemplate(content: string): string | null;
export function extractCategory(content: string, filePath: string, baseDir: string): string;
export function extractFrontmatter(content: string): string;
export function extractProps(frontmatter: string): PropDef[];
export function extractSlots(content: string): string[];
export function extractDefaultChildren(content: string): Array<{ name: string; slotName?: string }>;
export function extractDependencies(frontmatter: string): string[];
export function discoverLayouts(layoutsDir: string): Promise<DiscoveredLayout[]>;
export interface ScannedLocalComponent {
  name: string; path: string; source: 'user-project'; html: string; category: string;
  props: PropDef[]; slots: string[]; dependencies: string[]; frontmatter: string;
  pageTemplate: null; defaultChildren: Array<{ name: string; slotName?: string }>; contentBound: boolean;
  theme: string | null;
  section: string | null;
}
export function scanComponents(dir: string): Promise<ScannedLocalComponent[]>;
export function scanLayouts(dir: string): Promise<DiscoveredLayout[]>;

export function createBundledAsset(dir: string, file: string, data: Buffer): { file: string; created: boolean };
