import { toastComponentOpenFailure } from '@/utils/sourceActionFeedback';
import { LOCAL_COMPONENT_VIEW_FAILED, getLocalComponentViewFile } from '@/services/localComponentView';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { PagesPanel } from '@/components/PagesPanel/PagesPanel';
import { ElementsTree } from '@/components/LayersPanel/ElementsTree';
import { buildDynamicComponentIndex } from '@/store/folderManifest';
import { Button, Tabs } from '@/components/ui';
import { SeoPanel } from '@/components/SeoPanel/SeoPanel';
import { AssetsPanel } from '@/components/AssetsPanel/AssetsPanel';
import { CollectionsPanel } from '@/components/CollectionsPanel/CollectionsPanel';
import { useEditorDoc, useDispatch, useYjsValue } from '@/store/hooks';
import { selectCurrentPageId, selectRootElementIds, selectEditorRootElementId, selectProjectId } from '@/store/selectors';
import { applyCommand } from '@/store/commands';
import { COMPONENT_EDITOR_PAGE_ID as COMPONENT_PAGE_ID } from '@/store/constants';
import { shouldExitLocalComponentView, shouldSkipReselect, shouldRefuseBuiltInInLocal } from './componentViewGates';
import { useComponentLibrary, type ScannedComponent } from '@/hooks/useComponentLibrary';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { isSystemComponentPath } from '@/utils/systemComponents';
import { useLayoutLibrary, layoutToScannedComponent } from '@/hooks/useLayoutLibrary';
import { resolveComponentEditorOpen } from '@/utils/canvasHtml';
import { seedComponentEditorPage } from './seedComponentEditor';
import { refreshMasterFromSource } from '@/utils/ensureBlogPostMaster';
import { flushLayoutAppends, useDrainLayoutAppendsOnUnmount } from '@/services/pendingLayoutAppends';
import { collectWriteBackPayloads } from '@/utils/pushOverridesToSource';
import { bakeEditorMaster, syncDrawnIntoMasterOverlay } from '@/utils/bakeEditorMaster';
import { createDebouncedBake } from '@/utils/editorAutoBake';
import { listenFlushOnHide } from '@/utils/listenFlushOnHide';
import { flushPendingSourceWrites, queueSourceWrites } from '@/utils/pendingSourceWrites';
import { stripDrawnElements } from '@/utils/stripDrawnElements';
import { dispatchSaveEvent } from './editorSaveStatus';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import { awaitAccepted } from '@/services/durableEdits/acceptance';
import { observeEditorPageStructure } from '@/utils/observeEditorPageStructure';
import { EDITOR_FLUSH_OVERRIDE_MAP_KEYS } from './editorFlushKeys';
import { useVariables } from '@/context/VariablesContext';
import { usePostEditor } from '@/context/PostEditorContext';
import { useSidebarTab } from '@/context/SidebarTabContext';
import { useSelectionContext } from '@/context/SelectionContext';


const MIN_PAGES_HEIGHT = 120;
const MIN_LAYERS_HEIGHT = 100;
const DEFAULT_PAGES_HEIGHT = 190;
const STORAGE_KEY = 'starquix:left-sidebar-pages-height';

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 256; // w-64
const WIDTH_STORAGE_KEY = 'starquix:left-sidebar-width';

/**
 * Resolve an `sq:go-to-source-component` payload to the component to open.
 * Exported for tests. Precedence:
 * 1. name — deliberate override only (blog slot's astroSource points at
 *    BlogCard.astro while the ↗ must open BlogSlot; post roots likewise).
 * 2. exact path — the project scan lists `src/components/...` so the
 *    system-master dispatch (`src/components/sq/Media.astro`) lands here.
 * 3. path suffix (either direction) — the built-in catalog is
 *    `src/components`-relative (`library/Foo.astro`) while dispatchers may
 *    carry the full `src/components/library/Foo.astro`.
 * 4. project open: a `src/components|layouts/**` path IS the project file,
 *    listed or not.
 * 5. no project path yet: system (sq/) paths — the built-in catalog covers
 *    only `library/`, so synthesize a component at the template path
 *    (`<base>` → resolveComponentSourcePath → `src/components/<base>`) rather
 *    than no-op or open the unrelated legacy library/Media.astro stub.
 */
export function resolveGoToSourceComponent(
  detail: { path?: string | null; name?: string | null },
  all: ScannedComponent[],
  opts: { isLocal: boolean },
): ScannedComponent | null {
  const { path, name } = detail;
  if (name) {
    const byName = all.find((c) => c.name === name);
    if (byName) return byName;
  }
  if (!path) return null;
  const exact = all.find((c) => c.path === path);
  if (exact) return exact;
  const suffix = all.find(
    (c) => path.endsWith(`/${c.path}`) || c.path.endsWith(`/${path}`),
  );
  if (suffix) return suffix;
  // Files-truth: the path IS the project file (src/components|layouts/**).
  // The scan may not list it yet (materialized a moment ago, or still
  // loading) — the component view renders the file, not a registry row.
  if (opts.isLocal && /^src\/(components|layouts)\/.+\.astro$/.test(path) && !isSystemComponentPath(path)) {
    const base = path.split('/').pop()!;
    return { name: base.replace(/\.astro$/, ''), path, source: 'user-project', html: '', category: 'Project', props: [], slots: [], dependencies: [] };
  }
  if (!opts.isLocal && isSystemComponentPath(path)) {
    const base = path.split('/').pop() ?? '';
    if (!base) return null;
    return {
      name: base.replace(/\.astro$/, ''),
      path: base,
      source: 'built-in',
      html: '',
      category: 'System',
      props: [],
      slots: [],
      dependencies: [],
    };
  }
  return null;
}

export function LeftSidebar() {
  const doc = useEditorDoc();
  const dispatch = useDispatch();
  // Editor unmount ("Back to projects") never reaches the view-leave flush —
  // drain any master writes still queued (no-op on flushed paths).
  useDrainLayoutAppendsOnUnmount();
  const { activeCollectionId, setActiveCollectionId } = useVariables();
  const { editingPost, closePost } = usePostEditor();
  const { clearSelection } = useSelectionContext();
  const currentPageId = useYjsValue(selectCurrentPageId);
  const projectId = useYjsValue(selectProjectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pagesHeight, setPagesHeight] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_PAGES_HEIGHT;
  });
  const [isDragging, setIsDragging] = useState(false);

  // Sidebar width state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(WIDTH_STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [activeLayersTab, setActiveLayersTab] = useState<'layers' | 'seo'>('layers');
  const { activeTopTab, setActiveTopTab } = useSidebarTab();

  // Track the last real page so we can restore it
  const [lastRealPageId, setLastRealPageId] = useState<string | null>(null);
  // Track which component is being edited
  const [activeComponentPath, setActiveComponentPath] = useState<string | null>(null);
  // A view that never opened (switchLocalComponentView): the canvas stayed put, so the row follows it back.
  useEffect(() => {
    const h = (e: Event) => {
      const { file, previous } = (e as CustomEvent<{ file: string; previous: string | null }>).detail;
      setActiveComponentPath(p => (p === file ? previous : p));
    };
    window.addEventListener(LOCAL_COMPONENT_VIEW_FAILED, h);
    return () => window.removeEventListener(LOCAL_COMPONENT_VIEW_FAILED, h);
  }, []);
  // Track the edited component name for instance propagation
  const [editedComponentName, setEditedComponentName] = useState<string | null>(null);
  const { builtIn, userProject, refresh: refreshLibrary } = useComponentLibrary();
  const { layouts } = useLayoutLibrary();
  // Yellow "dynamic" accent for Layers rows — derived from the ONE predicate
  // (isDynamicComponent) over the library this sidebar already fetched.
  // Layouts live in their OWN library — map them in or they never classify.
  const dynamicIndex = useMemo(
    () => buildDynamicComponentIndex([...builtIn, ...userProject, ...layouts.map(layoutToScannedComponent)]),
    [builtIn, userProject, layouts],
  );
  const localProjectPath = useLocalProjectPath();

  // Save to localStorage when height changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(pagesHeight));
  }, [pagesHeight]);

  // Save width to localStorage
  useEffect(() => {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  // Get the component editor element ID (first root element on the virtual page)
  const getEditorElementId = useCallback((): string | null => {
    return selectEditorRootElementId(doc);
  }, [doc]);

  const isFlushingRef = useRef(false);
  // Render identity gates presentation only. An old write still settles its own
  // payload; it cannot announce a failure or reset feedback in a newer visit.
  const saveVisit = useRef(0);
  const saveOwner = useMemo(() => ({ projectId, entityKey: activeComponentPath ?? '', visit: ++saveVisit.current }), [doc, projectId, activeComponentPath]);
  const currentSaveOwner = useRef(saveOwner);
  currentSaveOwner.current = saveOwner;
  const sidebarMounted = useRef(true);
  useEffect(() => { sidebarMounted.current = true; return () => { sidebarMounted.current = false; }; }, []);
  const isCurrentSaveOwner = useCallback(() => sidebarMounted.current && currentSaveOwner.current === saveOwner, [saveOwner]);

  /**
   * 3-store law, drawn half: the master OPEN seeds a stripDrawnElements'd
   * markup into the overlay (the editor renders drawn LIVE from the doc), so a
   * bake alone leaves the overlay WITHOUT the drawn chrome. Mirror the doc's
   * drawn set back SYNCHRONOUSLY — waiting for the .astro write's ack left the
   * overlay clobbered on reload-from-master and the master-drawn chrome
   * vanished from every page (2026-08-26). Idempotent: no-op when the overlay
   * already matches. Sync + doc-only, so it survives pagehide.
   */
  const mirrorDrawnIntoMasterOverlay = useCallback(
    (elementId: string, opts?: { reconcileDrawn?: boolean }) => {
      const collected = collectWriteBackPayloads(doc, elementId, opts);
      if (collected) {
        syncDrawnIntoMasterOverlay(doc, collected.astroSource, collected.drawnMarkups);
      }
    },
    [doc],
  );

  // Capture source intent before changing the editor surface; only its local
  // commit participates in navigation. Projection/reconciliation stays silent.
  const pushAndPropagateChanges = useCallback(async (opts?: { reconcileDrawn?: boolean }) => {
    if (isFlushingRef.current) return;
    const elementId = getEditorElementId();
    if (!elementId || !editedComponentName || !projectId) return;

    isFlushingRef.current = true;
    try {
      // Dev persistence + propagation (unified-components §6, OQ2): bake the
      // editor element's resolved markup into the masters overlay. Every
      // placement's baseMarkup() reads it, so this one write propagates the
      // master edit to all placements — no .astro round-trip needed.
      // DOC-FIRST, before ANY await (2026-08-26): this flush also runs on
      // pagehide, where nothing after an `await` survives.
      bakeEditorMaster(doc, elementId);
      mirrorDrawnIntoMasterOverlay(elementId, opts);
      // task-120 (3.3): flush deferred add-component layout appends —
      // the .astro write reloads the iframe once, here at the boundary.
      const collected = collectWriteBackPayloads(doc, elementId, opts);
      const accepted = collected && (collected.payloads.length || collected.skipped.length)
        ? await queueSourceWrites(collected.payloads, collected.skipped, { doc }) : null;
      const revision = accepted?.revision ?? await awaitAccepted(projectId);
      void (async () => {
        const appendsFlushed = await flushLayoutAppends();
        await flushDurableSourceWritesThrough(projectId, revision);
      // Adds only exist in the SOURCE (the bake can't see them — the editor
      // markup has no placeholder for a fresh add). With appends + override
      // write-back now durable, re-resolve the source into masters so pages
      // pick the new component up NOW instead of at the next master open.
      // Gated on appendsFlushed: a no-add leave keeps the bake untouched.
      // A partial receipt leaves edits absent from source; reading it back
      // here would overwrite the baked draft with that incomplete content.
        if (appendsFlushed > 0 && activeComponentPath && isCurrentSaveOwner()) {
          await refreshMasterFromSource(doc, activeComponentPath, [...builtIn, ...userProject]);
        }
        if (isCurrentSaveOwner()) refreshLibrary();
      })().catch(err => console.warn('[SQ-LAYOUT] source projection retained', err));
    } catch (err) {
      console.error('[SQ-LAYOUT] local acceptance failed', err);
    } finally {
      isFlushingRef.current = false;
    }
  }, [doc, getEditorElementId, editedComponentName, refreshLibrary, activeComponentPath, builtIn, userProject, mirrorDrawnIntoMasterOverlay, projectId, isCurrentSaveOwner]);

  // Editor edits do NOT flush to disk per-keystroke. Yjs (IndexedDB-backed) is
  // the source of truth while editing; the .astro write is one-way and DEFERRED
  // to LEAVE (component switch / tab change), where its instance reload is
  // masked by navigation. Flushing on every edit mirror-wrote the .astro into the
  // instance, which full-reloads the iframe (a "blink") and tore live drawn
  // elements out mid-edit. The observers below only mark the editor dirty for the
  // save-status UI; the actual push runs from the leave handlers (task-078).
  useEffect(() => {
    if (!editedComponentName) return;
    const elementId = getEditorElementId();
    if (!elementId) return;
    const elements = doc.getMap('elements');
    const editorEl = elements.get(elementId) as Y.Map<unknown> | undefined;
    if (!editorEl) return;

    // task-098 reload persistence: edits become durable via a debounced
    // Yjs-only bake into `masters` (childOverrides mirror included). The leave
    // flush is gated on React state that a reload resets — without this,
    // re-opening the component after a reload wiped un-baked child overrides.
    // Yjs-only ⇒ no .astro write ⇒ no iframe blink (task-078 constraint
    // applies to pushOverridesToSource, which stays leave-deferred).
    // LIVE getter, not the captured elementId: the async re-seed replaces the
    // editor element AFTER this effect runs — a captured id goes stale and the
    // bake silently no-ops (edits were lost on reload).
    const autoBake = createDebouncedBake(doc, getEditorElementId);

    const schedule = () => {
      // After the isFlushingRef guard on purpose: observer events fired by the
      // flush's own Yjs mutations (e.g. REMOVE_DRAWN_ELEMENT) are not edits.
      if (isFlushingRef.current) return;
      dispatchSaveEvent({ type: 'EDIT' });
      autoBake.schedule();
    };

    // Reload/close mid-debounce: bake synchronously so the masters observer's
    // leading IndexedDB save still lands before the page dies (task-077 tier
    // pattern). ALSO drain queued layout source-appends — they normally flush
    // only on editor-leave (pushAndPropagateChanges), so a browser reload
    // silently dropped every component added since the last leave (live-caught:
    // dropped nav vanished on reload). Best-effort: in-flight fetches may not
    // survive a hard unload, but tab-switch/hidden completes them.
    const stopFlushOnHide = listenFlushOnHide(() => {
      void flushLayoutAppends();
      autoBake.flushNow();
      // A reload-from-master never reaches the view-leave flush, so the bake
      // above just re-wrote the STRIPPED overlay — mirror the drawn set back
      // here too (LIVE id: the async re-seed replaces the editor element).
      const liveId = getEditorElementId();
      if (liveId) mirrorDrawnIntoMasterOverlay(liveId, { reconcileDrawn: true });
    });

    const unsubs: Array<() => void> = [];
    const observed = new WeakSet<object>();
    const watchMap = (m: Y.Map<unknown> | Y.Array<unknown> | undefined) => {
      if (!m || observed.has(m)) return;
      observed.add(m);
      m.observeDeep(schedule);
      unsubs.push(() => m.unobserveDeep(schedule));
    };
    const watchAllOverrideContainers = () => {
      for (const key of EDITOR_FLUSH_OVERRIDE_MAP_KEYS) {
        watchMap(editorEl.get(key) as Y.Map<unknown> | undefined);
      }
      watchMap(editorEl.get('orderOverrides') as Y.Array<unknown> | undefined);
      watchMap(editorEl.get('reparentOverrides') as Y.Array<unknown> | undefined);
      watchMap(editorEl.get('deletedSelectors') as Y.Array<unknown> | undefined);
    };
    watchAllOverrideContainers();

    // Sub-maps are created lazily by commands — re-watch when new keys are
    // added to the editor element so we don't miss the first edit of each kind.
    const elKeyHandler = () => {
      watchAllOverrideContainers();
      schedule();
    };
    editorEl.observe(elKeyHandler);
    unsubs.push(() => editorEl.unobserve(elKeyHandler));

    // Text edits land in the global sourceText map keyed by `${elementId}:${selector}`.
    const sourceText = doc.getMap('sourceText');
    const sourceTextHandler = (event: Y.YMapEvent<unknown>) => {
      for (const key of event.keysChanged) {
        if (typeof key === 'string' && key.startsWith(elementId + ':')) {
          schedule();
          break;
        }
      }
    };
    sourceText.observe(sourceTextHandler);
    unsubs.push(() => sourceText.unobserve(sourceTextHandler));

    // Structural edits — drawing slots, filling them, adding/styling drawn
    // sections — land on OTHER elements on the editor page. ONLY mark dirty for
    // the save-status UI. Do NOT mirror to source here: drawn stay live in Yjs +
    // localStorage and their component-source mirror defers to the leave flush
    // (handleSelectComponent / handleTopTabChange, `reconcileDrawn: true`). An
    // eager mirror writes the .astro into the instance, which full-reloads
    // the iframe mid-edit — a visible blink (task-078).
    unsubs.push(
      observeEditorPageStructure(doc, COMPONENT_PAGE_ID, elementId, () => {
        schedule();
      }),
    );

    return () => {
      stopFlushOnHide();
      // Unmount/effect-teardown with a pending edit: bake it before disposing.
      autoBake.flushNow();
      autoBake.dispose();
      for (const unsub of unsubs) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, editedComponentName, getEditorElementId]);

  // When a component is selected in the Assets tree
  const handleSelectComponent = useCallback(async (component: ScannedComponent) => {
    // Local mode: built-in (system) components have no editor surface — the
    // doc-seeded flow below would land on the guaranteed-404 route
    // (/__sq_missing_page, found live 2026-08-14). Refuse with the way out.
    if (shouldRefuseBuiltInInLocal(localProjectPath, component.source)) {
      // Mental-model ruling (owner 2026-08-27): clicking a component means
      // "open and edit it" — the old refusal toast asked the user to do the
      // materialization themselves via ⌘K. Do it FOR them: copy the library
      // component into the project (same materializer the ⌘K insert uses,
      // collision-safe — an existing same-name file is reused, not clobbered)
      // and open THAT copy in the component view.
      try {
        const { materializeLibraryComponent } = await import('@/components/Editor/localComponentInsert');
        const m = await materializeLibraryComponent(component, localProjectPath!);
        if (!isCurrentSaveOwner()) return;
        if (!m.ok) {
          console.error('Component could not be prepared for editing:', m.reason);
          toastComponentOpenFailure(component.name);
          return;
        }
        component = { ...component, path: m.path, source: 'user-project', html: m.body };
      } catch (error) {
        console.error('Component preparation failed:', error);
        if (isCurrentSaveOwner()) toastComponentOpenFailure(component.name);
        return;
      }
    }
    // Close variables/post editor when selecting a component
    setActiveCollectionId(null);
    closePost();
    // Drop any layer selection from before so the assets row reads as selected
    // and clicking the same component again re-asserts it as the head selection.
    clearSelection();

    // Re-clicking the already-active component is a no-op for Yjs setup but
    // still needs the selection clear above so the head highlight refreshes.
    // User-project components fall through: re-dispatching the view event is
    // an idempotent iframe nav and heals a desynced canvas (stuck main page).
    if (shouldSkipReselect(component.source, activeComponentPath, component.path)) {
      return;
    }

    // task-136/137 local mode: a user component/layout is edited as a tiny
    // real page (/__sq_component_view) — NO doc seeding, NO push machinery
    // (editedComponentName stays null so the app-rooted flush can never fire;
    // ledger M4). Every edit inside hits the real file via the P0 writers.
    if (component.source === 'user-project') {
      setActiveComponentPath(component.path);
      setEditedComponentName(null);
      dispatchSaveEvent({ type: 'RESET' });
      window.dispatchEvent(new CustomEvent('sq:local-component-view', { detail: { file: component.path } }));
      return;
    }

    // Inspect what's about to be lost: log root elements on the editor page.
    // Anything beyond the single editor element here will NOT survive the
    // component switch — it lives only as Yjs state on an ephemeral page.
    {
      const rootIds = selectRootElementIds(doc, COMPONENT_PAGE_ID);
      if (rootIds.length > 1) {
        const elements = doc.getMap('elements');
        const extras = rootIds.slice(1).map((id) => {
          const el = elements.get(id) as Y.Map<unknown> | undefined;
          return { id, type: el?.get('type'), componentType: el?.get('componentType'), astroSource: el?.get('astroSource') };
        });
        console.warn('[SQ-LAYOUT] handleSelectComponent: extra root elements on editor page will be dropped', extras);
      }
    }

    // If switching components, push current overrides to source first. Reconcile
    // drawn on leave too (catch-all) so a rapid delete-then-switch — faster than
    // the eager debounce — still strips the removed boxes from source.
    if (editedComponentName && getEditorElementId()) {
      await pushAndPropagateChanges({ reconcileDrawn: true });
    }

    // Save the current real page before switching (if not already on component page)
    if (currentPageId && currentPageId !== COMPONENT_PAGE_ID) {
      setLastRealPageId(currentPageId);
    }

    setActiveComponentPath(component.path);
    setEditedComponentName(component.name);
    // Fresh doc in the editor — previous doc's save status no longer applies.
    dispatchSaveEvent({ type: 'RESET' });

    // Nested components become <sq-child> placeholders + a placement list —
    // the seed below materializes each as a real child instance (task-098).
    // The resolver runs the full canvas pipeline on the source (raw source must NEVER seed the
    // editor: browsers parse `<Foo />`/`<slot />` as unclosed open tags).
    const resolved = await resolveComponentEditorOpen(component, [...builtIn, ...userProject]);
    // Strip the baked drawn mirror (`data-sq-drawn`) from the source read: in
    // the editor the same drawn elements come back LIVE from Yjs/localStorage
    // (restoreDrawnElements), so rendering the baked copy too would double them.
    // Instances/exports keep the baked drawn — only this editor reopen strips.
    const html = stripDrawnElements(resolved.html);
    const placements = resolved.placements;

    // No per-open override re-apply: the master's edits now live in the
    // `masters` overlay (IndexedDB-persisted), which baseMarkup() reads as
    // the editor element's base — so re-opening shows the edits without the
    // old task-077 localStorage re-apply.
    const seededId = seedComponentEditorPage(doc, {
      component,
      html,
      placements,
      library: [...builtIn, ...userProject],
    });
  }, [doc, currentPageId, activeComponentPath, editedComponentName, getEditorElementId, pushAndPropagateChanges, setActiveCollectionId, closePost, clearSelection, localProjectPath, isCurrentSaveOwner]);

  // Event-driven (not state-driven) because the payload (`path`, `name`)
  // isn't shared state — it identifies which component to load. Contrast
  // with the editingPost effect below, which reacts to context state.
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, name } = (e as CustomEvent).detail || {};
      if (!path && !name) return;
      // Layouts live in a separate registry (useLayoutLibrary), not the
      // component library — include them so "Edit layout source" resolves.
      const all = [...builtIn, ...userProject, ...layouts.map(layoutToScannedComponent)];
      // Resolution precedence (name → exact path → path suffix → project file
      // → system fallback) lives in resolveGoToSourceComponent — see its doc comment.
      const component = resolveGoToSourceComponent({ path, name }, all, {
        isLocal: !!localProjectPath,
      });
      if (component) {
        setActiveTopTab('assets');
        handleSelectComponent(component);
      }
    };
    window.addEventListener('sq:go-to-source-component', handler);
    return () => window.removeEventListener('sq:go-to-source-component', handler);
  }, [builtIn, userProject, layouts, handleSelectComponent, localProjectPath]);

  // When a post starts being edited (e.g. "Go to post" from DesignBar), switch
  // the top tab to Content so the surrounding context matches the open post.
  // Don't touch activeCollectionId here — Editor.tsx closes the post whenever
  // a collection is selected (variable-collection flow), which would unmount
  // the editor we just opened.
  useEffect(() => {
    if (!editingPost) return;
    setActiveTopTab('content');
  }, [editingPost]);

  // When switching tabs, auto-push/restore; entering Assets opens nothing (owner 2026-11-17)
  const handleTopTabChange = useCallback(async (tab: string) => {
    const newTab = tab as 'pages' | 'assets' | 'content';
    setActiveTopTab(newTab);

    // Deferred source writes (Push-to-source) land at the tab-switch boundary
    // — the preview reload they trigger is masked by the navigation.
    void flushPendingSourceWrites().catch(() => {});

    // The variable-collection selection belongs to the Assets tab — clear it
    // when leaving. The post editor (canvas takeover) belongs to the Content
    // tab — close any open post when leaving so it doesn't linger behind an
    // unrelated sidebar.
    if (newTab !== 'assets') setActiveCollectionId(null);
    if (newTab !== 'content') closePost();

    if (newTab === 'pages' && lastRealPageId && currentPageId === COMPONENT_PAGE_ID) {
      await pushAndPropagateChanges({ reconcileDrawn: true });

      doc.transact(() => {
        applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: lastRealPageId });
      }, 'sync');

      // Reset so the same component can be re-selected with fresh HTML
      setActiveComponentPath(null);
      setEditedComponentName(null);
      dispatchSaveEvent({ type: 'RESET' });
    } else if (shouldExitLocalComponentView(newTab, activeComponentPath ?? getLocalComponentViewFile(), currentPageId)) {
      // Local component view: currentPageId never left the real page, so the
      // branch above can't fire — exit explicitly or the canvas stays stuck
      // on the component (and the stale activeComponentPath then no-ops the
      // Assets tab into "shows the main page").
      setActiveComponentPath(null);
      setEditedComponentName(null);
      dispatchSaveEvent({ type: 'RESET' });
      window.dispatchEvent(new CustomEvent('sq:local-component-view', { detail: { file: null } }));
    }
  }, [doc, lastRealPageId, currentPageId, activeComponentPath, pushAndPropagateChanges, setActiveCollectionId, closePost]);

  // task-143: the usage picker (Fill → Media) jumps the canvas to a page from
  // OUTSIDE this sidebar. Reuse the real tab-switch path — it flushes pending
  // source writes, clears the collection takeover, and exits the component
  // view (Assets chrome included), so the Pages panel + canvas take over.
  useEffect(() => {
    const h = () => { void handleTopTabChange('pages'); };
    window.addEventListener('sq:go-to-page', h);
    return () => window.removeEventListener('sq:go-to-page', h);
  }, [handleTopTabChange]);

  // A page switch from outside (an agent's add_page, a page rename) leaves the view
  // (Editor): follow it to the File tab. An open variable collection stays.
  const seenPageIdRef = useRef(currentPageId);
  useEffect(() => {
    if (seenPageIdRef.current === currentPageId) return;
    seenPageIdRef.current = currentPageId;
    if (activeTopTab === 'assets' && !activeCollectionId && currentPageId !== COMPONENT_PAGE_ID) void handleTopTabChange('pages');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingWidth(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerHeight = containerRect.height;
      const newPagesHeight = e.clientY - containerRect.top;

      // Clamp to min/max values
      const maxPagesHeight = containerHeight - MIN_LAYERS_HEIGHT;
      const clampedHeight = Math.max(MIN_PAGES_HEIGHT, Math.min(maxPagesHeight, newPagesHeight));

      setPagesHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Width resize effect
  useEffect(() => {
    if (!isResizingWidth) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizingWidth(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingWidth]);

  // The top section fills the sidebar on every tab except the Pages tree (which
  // shares its height with the Layers/SEO panel below); an active variable
  // collection also expands it.
  const isFullHeightTopSection = !!activeCollectionId || activeTopTab !== 'pages';

  return (
    <div className="relative h-full flex-shrink-0">
      <div
        ref={containerRef}
        className="bg-bg border-r border-stroke flex flex-col h-full"
        style={{ width: sidebarWidth }}
      >
      {/* Pages/Assets/Content Section — full height for every tab except the
          Pages tree (which shares vertical space with the Layers/SEO panel). */}
      <div
        className={`flex flex-col overflow-hidden ${isFullHeightTopSection ? 'flex-1' : ''}`}
        style={isFullHeightTopSection ? undefined : { height: pagesHeight }}
      >
        {/* Tab header */}
        <div className="flex items-stretch gap-2 px-3 h-10 box-border border-b border-stroke flex-shrink-0">
          <Tabs
            options={[
              { value: 'pages', label: 'File' },
              { value: 'assets', label: 'Assets' },
              { value: 'content', label: 'Content' },
            ]}
            value={activeTopTab}
            onChange={handleTopTabChange}
            size="sm"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {activeTopTab === 'pages' ? (
            <PagesPanel />
          ) : activeTopTab === 'content' ? (
            <CollectionsPanel />
          ) : (
            <AssetsPanel
              activeComponentPath={activeComponentPath}
              onSelectComponent={handleSelectComponent}
              onClearComponent={() => { setActiveComponentPath(null); setEditedComponentName(null); dispatchSaveEvent({ type: 'RESET' }); window.dispatchEvent(new CustomEvent('sq:local-component-view', { detail: { file: null } })); }}
            />
          )}
        </div>
      </div>

      {/* Resize drag zone + Layers/SEO — only on File tab */}
      {activeTopTab === 'pages' && !activeCollectionId && (
        <>
          <div className="peer h-0 relative z-10">
            <div
              className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize"
              onMouseDown={handleMouseDown}
            />
          </div>

          {/* #31: Layers never goes under its minimum — on load, in a shorter window, while dragging. The pages section
              above gives way instead, and keeps its saved height for a window tall enough. */}
          <div className={`flex-1 flex flex-col overflow-hidden border-t transition-colors ${isDragging ? 'border-stroke-active' : 'border-stroke peer-hover:border-stroke-active'}`} style={{ minHeight: MIN_LAYERS_HEIGHT }}>
            <div className="flex items-stretch gap-2 px-3 h-10 box-border border-b border-stroke flex-shrink-0">
              <Tabs
                options={[
                  { value: 'layers', label: 'Layers' },
                  { value: 'seo', label: 'SEO' },
                ]}
                value={activeLayersTab}
                onChange={(v) => setActiveLayersTab(v as 'layers' | 'seo')}
                size="sm"
              />
            </div>

            {activeLayersTab === 'layers' ? (
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <ElementsTree dynamicIndex={dynamicIndex} />
              </div>
            ) : (
              <SeoPanel />
            )}
          </div>
        </>
      )}

        {/* Overlay to prevent iframe/element interference during height drag */}
        {isDragging && (
          <div className="fixed inset-0 z-50 cursor-row-resize" />
        )}
      </div>

      {/* Width Resize Handle - absolute positioned on right edge */}
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-col-resize group z-10"
        style={{ transform: 'translateX(50%)' }}
        onMouseDown={handleWidthResizeStart}
      >
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-px h-full transition-colors delay-0 group-hover:delay-150 ${
            isResizingWidth ? 'bg-stroke-active' : 'bg-transparent group-hover:bg-stroke-active'
          }`}
        />
      </div>

      {/* Overlay to prevent iframe/element interference during width drag */}
      {isResizingWidth && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
    </div>
  );
}
