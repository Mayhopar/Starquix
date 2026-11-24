// Local-runtime paste (files-truth): EVERY root pastes as markup through the
// task-133 structural-write channel. Gesture order is the law (from
// localComponentInsert): sync gate → guard → resolve target → ONE write →
// stale-mark → undo push → pending selection → release.
// ponytail: instance→local pastes frozen markup; component-file recreation when someone asks
import toast from 'react-hot-toast';
import type { ScannedElement } from '@/context/SelectionContext';
import {
  resolveInsertTarget,
  resolvePageFileAnchor,
} from '@/utils/localStructural';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { setLocalPendingSelection, getSelectionEpoch } from '@/utils/localPendingSelection';
import {
  acquireStructuralWrite,
  releaseStructuralWrite,
  classifyStructuralTarget,
} from '@/components/Editor/localStructuralOps';
import { afterLocalPageArrives, isLocalPageInSync, markLocalScanStaleAfterWrite } from '@/utils/localPageSync';
import { notifyLocalCrossFileWrite, captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { insertRegionInverseOp, type PushStructuralUndo, type StructuralUndoRecord } from '@/store/structuralUndo';
import { collectAssetRefs } from './collectAssets';
import type { ClipboardEnvelope } from './envelope';
import { escapeAstroBraces } from '../../../preview-template/src/plugins/sq-prop-fallback.js';

const XHTML = 'http://www.w3.org/1999/xhtml';

/**
 * Clipboard markup is untrusted — any page can put our marker on the clipboard
 * (pasteClipboard trusts it by the marker alone) — and it lands in an .astro
 * file, where `{…}` runs as server-side code. Every brace becomes an entity
 * except inside HTML <script>/<style> bodies, which Astro keeps raw (an SVG
 * <script> it evaluates — measured with @astrojs/compiler 2.13, 2026-10-18);
 * tags Astro compiles to component calls (`<Foo>` in SVG, `<foo.bar>`) go.
 */
function neutralizeAstroMarkup(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const raw: string[] = [];
  const mark = `sq-raw-${crypto.randomUUID()}-`;
  const visit = (root: DocumentFragment) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (/^[A-Z]|\./.test(el.localName)) { el.remove(); continue; }
      if (el.namespaceURI !== XHTML) continue;
      if (el.localName === 'template') visit((el as HTMLTemplateElement).content);
      if (el.localName === 'script' || el.localName === 'style') {
        raw.push(el.textContent ?? '');
        el.textContent = mark + (raw.length - 1);
      }
    }
  };
  visit(tpl.content);
  return escapeAstroBraces(tpl.innerHTML).replace(new RegExp(`${mark}(\\d+)`, 'g'), (_, i: string) => raw[Number(i)]);
}

export interface PasteLocalDeps {
  scannedElements: ScannedElement[];
  scannedByKey: Map<string, ScannedElement>;
  selectedKey: string | null;
  pageFile: string;                     // current page file (getLocalPageFile())
  writer?: typeof viteStructuralWriter; // injectable
  pushUndo: PushStructuralUndo;
  toast?: (msg: string) => void;
  /** ⌘D: the element being duplicated — its copy is painted at acceptance. */
  duplicateOf?: string | null;
  /** getSelectionEpoch() at the keypress (the copy is read before this runs). */
  selectionEpoch?: number;
}

export async function pasteEnvelopeIntoLocal(env: ClipboardEnvelope, deps: PasteLocalDeps): Promise<boolean> {
  const writer = deps.writer ?? viteStructuralWriter;
  const notify = deps.toast ?? ((msg: string) => toast(msg));
  const roots = env.roots.filter((r) => r.html);
  if (roots.length === 0) return false;

  // Owner 2026-11-10 ("it must just SWITCH"): ⌘V while the page switches
  // pastes into the switched-to page, against its own scan, once that lands —
  // a selection made on the outgoing page is moot there. ⌘D duplicates an
  // element of the page being left: moot, nothing to do.
  if (!isLocalPageInSync()) {
    if (deps.duplicateOf) return false;
    return afterLocalPageArrives(async (page) => {
      if (!page.pageFile) { notify('This page has no source file yet — structural edits need a real page file'); return false; }
      return pasteEnvelopeIntoLocal(env, { ...deps, scannedElements: page.scanned,
        scannedByKey: new Map(page.scanned.map((e) => [e.key, e])), selectedKey: null, pageFile: page.pageFile });
    }, false);
  }
  // Captured before the wait: the paste lands on the page it was made on.
  const origin = captureLocalWriteOrigin();
  const selectionEpoch = deps.selectionEpoch ?? getSelectionEpoch();
  await acquireStructuralWrite();
  try {
    const selection = deps.selectedKey ? deps.scannedByKey.get(deps.selectedKey) ?? null : null;
    const anchor = resolvePageFileAnchor(selection, deps.scannedElements, deps.pageFile);
    const target = resolveInsertTarget(anchor, deps.scannedElements, deps.pageFile);
    if ('error' in target) {
      notify(target.error === 'component-instance'
        ? "Loop copies / component internals can't take inserts — select a page element"
        : "Page isn't ready yet — click an element first");
      return false;
    }
    // ⌘D anchored on its original: the copy is its next sibling, never its
    // child (li-in-li, a-in-a — deleting the original took the copy along).
    if (anchor && anchor.key === deps.duplicateOf && 'loc' in target) target.position = 'after';
    const pageBody = 'pageBody' in target;
    const targetFile = pageBody ? deps.pageFile : target.loc.file;
    if (classifyStructuralTarget(targetFile, deps.pageFile) === 'cross-file') {
      notifyLocalCrossFileWrite(targetFile);
      return false;
    }

    // ONE combined write: one inverse, one undo entry (multi-root markup is legal).
    const markup = roots.map((r) => neutralizeAstroMarkup(r.html)).join('\n');
    let res: Awaited<ReturnType<typeof writer.writeInsert>>;
    try {
      res = pageBody
        ? await writer.writeAppendPage(targetFile, markup, origin)
        : await writer.writeInsert(target.loc, markup, target.position, origin);
    } catch {
      res = false as never;
    }
    if (!res || !res.success) {
      notify('Paste failed — the file was not changed');
      return false;
    }

    // ⌘D paints its copy now (unkeyed until the refresh's morph adopts it); a
    // paste of other content waits for the refresh — that markup isn't on the canvas.
    if (deps.duplicateOf && anchor && roots.length === 1 && !pageBody
        && (target.position === 'after' || target.position === 'inside-end')) {
      window.postMessage({ type: 'SYNC_CLONE_ELEMENT_IN_DOM',
        payload: { key: deps.duplicateOf, anchorKey: anchor.key, position: target.position } }, '*');
    }

    markLocalScanStaleAfterWrite();
    const record: StructuralUndoRecord = {
      structuralOp: {
        sourceFiles: res.sourceFiles,
        forward: [
          pageBody
            ? { kind: 'append-page', pageFile: targetFile, markup }
            : { kind: 'insert', loc: target.loc, markup, position: target.position },
        ],
        inverse: [
          insertRegionInverseOp(res)
            ?? { kind: 'remove', loc: { file: res.file, line: res.insertedLine, column: 1 }, allowRootRemoval: true },
        ],
      },
      origin,
    };
    deps.pushUndo(record);
    setLocalPendingSelection(res.file, res.insertedLine, selectionEpoch);

    // sq-asset refs have no local tier — they will 404 in the user's project.
    const editorOnly = collectAssetRefs([markup]).length;
    if (editorOnly > 0) {
      notify(`${editorOnly} image ref${editorOnly === 1 ? ' is' : 's are'} editor-only and won't resolve in this project — re-upload them`);
    }
    return true;
  } finally {
    releaseStructuralWrite();
  }
}
