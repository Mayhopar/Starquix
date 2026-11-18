import { memo, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { OperationNotice } from '@/components/ui';
import { type OperationIssue, mayOfferRecovery } from '@/utils/operationIssue';
import { postWriteIssue, postIssueCopy } from './postWriteIssue';
import { POST_COLUMN_CLS } from './postEditorLayout';
import { PostEditorHeader } from './PostEditorHeader';
import { FrontmatterForm } from './FrontmatterForm';
import { PostBodyEditor, type PostBodyEditorHandle } from './PostBodyEditor';
import { contentOps, hasLocalContentSource } from '@/core/collections/content-ops';
import { postFileName } from '@/core/collections/postFileName';
import { readPostLayoutSettings, type PostLayoutSettings } from '@/core/post/postLayoutProps';
import { DEFAULT_POST_HEADER } from '@/core/post/postHeaderView';
import { fetchLocalPageSource } from '@/utils/localPageSync';
import { validateFrontmatter } from '@/core/collections/validateFrontmatter';
import { resolveRenamedSlug, fetchCollectionSlugs, renamePostToTitle } from '@/core/collections/renamePost';
import type { CollectionField } from '@/core/collections/types';
import { useYjsValue, useEditorDoc } from '@/store/hooks';
import { applyCommand } from '@/store/commands';
import { dispatchDurableAction } from '@/store/durableDispatch';
import { selectContentCollections } from '@/store/collectionSelectors';
import { fieldsFromInferred } from '@/core/collections/localFields';
import { useContentCollections } from '@/hooks/useContentCollections';
import type { DiscoveredPost } from '@/hooks/useContentCollections';
import { usePostEditor } from '@/context/PostEditorContext';
import { localPageId } from '@/utils/localMode';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { slugify } from '@/utils/slugify';
import { parsePostBody, serializePostDoc, type PostDoc, type PostFormat } from '@/postmodel/postModel';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { PostWriteQueue } from '@/postmodel/writeQueue';
import { PostSourceConflict, equalPostValue, type PostWriteAttempt } from '@/postmodel/frontmatterPatch';
import { acceptPreparedPostWrite, readAcceptedPost } from '@/services/durableEdits/featureAcceptance';
import { mergeText } from '@/services/durableEdits/rebase';
import { subscribeDurableEditStatus } from '@/services/durableEdits/status';
import { noteAgentActivity } from '@/services/agentPresence';

interface PostEditorProps {
  collectionName: string;
  post: DiscoveredPost;
  /** Body line to open at (post text double-clicked on the canvas). */
  focusBodyLine?: number;
  onPostUpdate: () => void;
  /** Child astro dev origin, and the URL paths that might render THIS post.
   *  Absent for every runtime but local — no instance, no component previews. */
  previewOrigin?: string | null;
  /** WC only: the preview iframe used to proxy page-HTML fetches (no CORS on
   *  the container origin). Null in local mode, which fetches directly. */
  previewIframe?: HTMLIFrameElement | null;
  /** Upload a file and return the src to write into the MDX. */
  onUploadMedia?: (file: File) => Promise<string>;
  /** Local mode only: frontmatter-image upload. `field` picks the target: an
   *  `image()` schema field gets a POST-RELATIVE src (`./images/uploads/…` —
   *  that schema rejects the public `/uploads/…` src onUploadMedia returns,
   *  2026-08-14 owner report: InvalidContentEntryFrontmatterError 500s every
   *  route); any other field gets the public src, which renders from ANY
   *  page (a listing card included). */
  onUploadFieldMedia?: (postFile: string, file: File, field: string, collection: string) => Promise<string>;
}

export const PostEditor = memo(function PostEditor({ collectionName, post, focusBodyLine, onPostUpdate, previewOrigin = null, previewIframe = null, onUploadMedia, onUploadFieldMedia }: PostEditorProps) {
  const projectPath = useLocalProjectPath();
  const [writeIssue, setWriteIssue] = useState<OperationIssue | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [frontmatter, setFrontmatter] = useState(post.frontmatter);
  const frontmatterRef = useRef(frontmatter);
  frontmatterRef.current = frontmatter;
  const pendingFrontmatter = useRef(false);
  const acceptedFrontmatter = useRef(post.frontmatter);
  const frontmatterRevision = useRef(0);
  // Feedback follows the attempt that started it, not the time its response
  // arrives. Queue/draft ownership is separate and is never cleared here.
  const nextIssueEpisode = useRef(0);
  const publishedIssueEpisode = useRef(0);
  const beginWriteIssue = useCallback(() => {
    const episode = ++nextIssueEpisode.current;
    return (issue: OperationIssue | null) => {
      if (episode < publishedIssueEpisode.current) return;
      publishedIssueEpisode.current = episode;
      setWriteIssue(issue ? { ...issue, episode } : null);
    };
  }, []);
  const beginBodyWriteIssue = useCallback(() => {
    const report = beginWriteIssue();
    return (issue: OperationIssue | null) => {
      if (issue || !pendingFrontmatter.current) report(issue);
    };
  }, [beginWriteIssue]);
  const fallbackBaseline = useRef({ frontmatter: post.frontmatter, body: post.body });
  const fallbackAttempts = useRef<PostWriteAttempt[]>([]);
  const fallbackAcceptance = useRef(Promise.resolve());
  const handleFrontmatterChange = (value: Record<string, unknown>, options?: { collectionAccepted: true; field: string }) => {
    frontmatterRef.current = value;
    setFrontmatter(value);
    if (queue.durable && options?.collectionAccepted) {
      const baseline = { ...acceptedFrontmatter.current };
      if (Object.prototype.hasOwnProperty.call(value, options.field)) baseline[options.field] = value[options.field];
      else delete baseline[options.field];
      acceptedFrontmatter.current = baseline;
      fallbackBaseline.current = { ...fallbackBaseline.current, frontmatter: baseline };
      queue.acceptCollectionField(options.field, value);
      return;
    }
    pendingFrontmatter.current = true;
    if (queue.durable) {
      const revision = ++frontmatterRevision.current;
      const report = beginWriteIssue();
      const body = bodyEditorRef.current?.getDoc() ?? fallbackDoc();
      const invalid = validateFrontmatter(fields, value).length > 0;
      const queued = !!body && !invalid;
      const accept = invalid
        ? Promise.reject(new Error('Check this property'))
        : body ? queue.enqueue(body, value) : saveUnparseableBody(renamedSlugRef.current ?? post.slug, value, post.body);
      const candidateRevision = queue.draftRevision;
      void accept.then(() => {
        if (!queued) acceptedFrontmatter.current = value;
        if (frontmatterRevision.current === revision && queue.draftRevision === candidateRevision) { pendingFrontmatter.current = false; report(null); }
      }, error => {
        if (frontmatterRevision.current !== revision || queue.draftRevision !== candidateRevision) return;
        if (!queued) { frontmatterRef.current = acceptedFrontmatter.current; setFrontmatter(acceptedFrontmatter.current); }
        pendingFrontmatter.current = false; report(postWriteIssue(error, queue.projectId, collectionName, post.slug));
      });
    }
  };
  /** Schedules the live merge of outside writes (set below, once its inputs exist). */
  const outsideSyncRef = useRef<() => void>(() => {});
  const onPostUpdateRef = useRef(onPostUpdate);
  onPostUpdateRef.current = onPostUpdate;
  const { openPost } = usePostEditor();
  const editorDoc = useEditorDoc();

  const format: PostFormat = postFileName(post).toLowerCase().endsWith('.mdx') ? 'mdx' : 'md';

  const yCollections = useYjsValue(selectContentCollections);

  const collection = useMemo(
    () => yCollections.find(c => c.name === collectionName),
    [yCollections, collectionName],
  );
  // Review F2: no Yjs collection (local_ projects — files are truth) → derive
  // fields from the disk posts' inferred shape; never block on OUR defaults.
  const { collections: diskCollections } = useContentCollections();
  const inferredFields = useMemo(() => {
    if (collection) return null;
    const disk = diskCollections.find(d => d.name === collectionName);
    return disk && disk.inferredFields.length > 0 ? fieldsFromInferred(disk.inferredFields) : null;
  }, [collection, diskCollections, collectionName]);
  const fields: CollectionField[] = collection?.fields ?? inferredFields ?? [];

  // Local runtime (files-truth, gap 18): no Yjs collection exists, so field
  // add/delete write the post files instead — the schema IS the files. The
  // Editor arms the local source before any post can open, so a plain read is
  // stable for this mount.
  const localCollection = !collection && hasLocalContentSource() ? collectionName : null;

  // ONE write path for the post file (binding law #2): the queue serializes,
  // compile-gates and slug-binds every write — body flushes and frontmatter
  // saves alike.
  const queue = useMemo(
    () =>
      new PostWriteQueue({
        projectId: getActiveSaveProjectId(),
        collection: collectionName,
        slug: post.slug,
        format,
        baseline: { frontmatter: post.frontmatter, body: post.body },
        onWritten: () => {
          onPostUpdateRef.current();
          bodyEditorRef.current?.refreshPreviews();
          outsideSyncRef.current(); // an outside write that raced ours shows up now
        },
      }),
    [collectionName, post.slug, format],
  );
  // No dispose-on-unmount: the queue only ever writes ITS post (slug-bound at
  // construction), so draining pending jobs after a post switch is correct —
  // and StrictMode's simulated remount would permanently kill a memoized queue
  // whose cleanup disposes it (found live: every write silently aborted).
  useEffect(() => {
    return () => {
      void queue.flushNow().catch(() => {});
    };
  }, [queue]);

  const bodyEditorRef = useRef<PostBodyEditorHandle>(null);
  useEffect(() => queue.durable ? queue.subscribeDraftOutcome(outcome => {
    if (outcome.status === 'accepted') acceptedFrontmatter.current = structuredClone(outcome.frontmatter);
    else { frontmatterRef.current = acceptedFrontmatter.current; setFrontmatter(acceptedFrontmatter.current); }
    if (outcome.revision === queue.draftRevision) pendingFrontmatter.current = false;
  }) : undefined, [queue]);
  // Lazy: only needed when the body editor has no doc (unparseable body) —
  // the eager memo re-parsed the whole body on every write echo.
  const fallbackDoc = (): PostDoc | null => {
    try {
      return parsePostBody(post.body, format);
    } catch {
      return null;
    }
  };

  const saveUnparseableBody = useCallback(async (slug: string, values: Record<string, unknown>, body: string) => {
    const attempt = { frontmatter: structuredClone(values), body };
    if (queue.durable) {
      const previous = fallbackAcceptance.current;
      const acceptance = acceptPreparedPostWrite(queue.projectId!, collectionName, slug, async () => {
        await previous;
        return { ...attempt, options: { baseline: fallbackBaseline.current } };
      }, crypto.randomUUID()).then(() => { fallbackBaseline.current = attempt; });
      fallbackAcceptance.current = acceptance.catch(() => {});
      await acceptance;
      return;
    }
    try {
      const options = {
        baseline: fallbackBaseline.current,
        ...(fallbackAttempts.current.length ? { unresolvedAttempts: [...fallbackAttempts.current] } : {}),
      };
      await contentOps.updatePost(collectionName, slug, attempt.frontmatter, body, options);
      fallbackBaseline.current = attempt;
      fallbackAttempts.current = [];
    } catch (error) {
      if (error instanceof PostSourceConflict) {
        fallbackAttempts.current = fallbackAttempts.current.map(previous => ({ ...previous, canReconcileCandidate: false }));
        const constraint = { ...attempt, canReconcileCandidate: false };
        if (!fallbackAttempts.current.some(previous => JSON.stringify(previous) === JSON.stringify(constraint))) fallbackAttempts.current.push(constraint);
      }
      throw error;
    }
  }, [collectionName, queue]);

  /**
   * "The MDX file takes the name of the title": a NEW post (still named
   * untitled-<ts>.mdx) is renamed to slugify(title).mdx the first time its
   * title is saved. Runs AFTER the save so the rename copies saved bytes; a
   * renamed post never matches untitled-* again, so URLs stay stable. No undo
   * (git is history) — same contract as post delete.
   */
  const renamingRef = useRef(false);
  // The listing refreshed this post (after the rename's replay, after a field
  // patch, after an agent's write): a durable editor merges it in (below);
  // otherwise the queue takes it as its baseline while it has not written yet.
  useEffect(() => {
    if (renamingRef.current) return;
    if (queue.durable) outsideSyncRef.current();
    else queue.rebase({ frontmatter: post.frontmatter, body: post.body });
  }, [queue, post.frontmatter, post.body]);
  const renamedSlugRef = useRef<string | null>(null);
  const maybeRenameToTitle = useCallback(async (doc: PostDoc | null, reportIssue: (issue: OperationIssue | null) => void): Promise<void> => {
    if (renamingRef.current) return;
    const finishRename = async (newSlug: string) => {
      const oldPageId = localPageId(`/${collectionName}/${slugify(post.slug)}`);
      if (typeof editorDoc?.getMap === 'function' && editorDoc.getMap('pages').has(oldPageId)) {
        if (queue.durable) await dispatchDurableAction(editorDoc, { type: 'DELETE_PAGE', pageId: oldPageId });
        else applyCommand(editorDoc, { type: 'DELETE_PAGE', pageId: oldPageId });
      }
      queue.dispose();
      onPostUpdateRef.current();
      openPost(collectionName, newSlug);
    };
    const replayLatestBeforeRemount = async (newSlug: string) => {
      renamingRef.current = true;
      let retainedDoc = doc;
      try {
        for (;;) {
          const latestFrontmatter = frontmatterRef.current;
          const latestDoc = bodyEditorRef.current?.getDoc() ?? retainedDoc;
          retainedDoc = latestDoc;
          const latestBody = latestDoc ? serializePostDoc(latestDoc) : post.body;
          if (latestDoc) await queue.enqueue(latestDoc, latestFrontmatter);
          else {
            await saveUnparseableBody(newSlug, latestFrontmatter, latestBody);
          }
          // Discovery can remove the old slug and tear down its body ref while
          // this write awaits. Missing input is not a reversion to the original
          // pre-rename doc: keep the latest revision this replay observed.
          const currentDoc = bodyEditorRef.current?.getDoc() ?? retainedDoc;
          if (frontmatterRef.current === latestFrontmatter && (!currentDoc || serializePostDoc(currentDoc) === latestBody)) break;
        }
        pendingFrontmatter.current = false;
        await finishRename(newSlug);
      } finally {
        renamingRef.current = false;
      }
    };
    // Recovery must re-check current input after its first retry lands, just
    // like the initial rename: newer title/body revisions still belong here.
    if (renamedSlugRef.current) { await replayLatestBeforeRemount(renamedSlugRef.current); return; }
    if (!/^untitled-\d+/.test(postFileName(post))) return;
    const title = frontmatterRef.current.title;
    if (typeof title !== 'string' || title.trim() === '') return;
    if (slugify(title).toLowerCase() === post.slug.toLowerCase()) return;
    const existingSlugs = await fetchCollectionSlugs(collectionName, post.slug);
    if (existingSlugs === null) return;
    const newSlug = resolveRenamedSlug({ title: frontmatterRef.current.title, fileName: postFileName(post), oldSlug: post.slug, existingSlugs });
    if (!newSlug || renamingRef.current) return;
    renamingRef.current = true;
    try { await queue.flushNow(); }
    catch (error) { renamingRef.current = false; throw error; }
    // Keystrokes since this save captured `doc` (the flush just wrote them) mean the
    // user is mid-typing: renaming now would fail the rename's compare-and-swap
    // ("This change could not be stored") and remount over the typing. Skip
    // quietly; the next save retries.
    const live = bodyEditorRef.current?.getDoc() ?? doc;
    const accepted = queue.accepted;
    if (doc && live && accepted && (serializePostDoc(live) !== serializePostDoc(doc) || !equalPostValue(accepted.frontmatter, frontmatterRef.current))) {
      renamingRef.current = false;
      return;
    }
    queue.suspend();
    const savedFrontmatter = frontmatterRef.current;
    const body = doc ? serializePostDoc(doc) : post.body;
    try {
      await renamePostToTitle({ collection: collectionName, oldSlug: post.slug, newSlug, frontmatter: savedFrontmatter, body });
    } catch (e) {
      queue.resume();
      renamingRef.current = false;
      reportIssue(postWriteIssue(e, queue.projectId, collectionName, post.slug));
      return;
    }
    // Typing can continue during the rename round-trip. Keep that revision in
    // this mounted editor and write it to the acknowledged new path BEFORE
    // openPost destroys this component. A refused write stays in this queue.
    await queue.flushNow();
    queue.followRenamedPost(newSlug);
    renamedSlugRef.current = newSlug;
    await replayLatestBeforeRemount(newSlug);
  }, [collectionName, post, queue, editorDoc, openPost, saveUnparseableBody]);

  const persistIfValid = useCallback(async (): Promise<boolean> => {
    if (renamingRef.current) return false;
    const reportIssue = beginWriteIssue();
    try {
      const savingFrontmatter = frontmatterRef.current;
      const issues = validateFrontmatter(fields, savingFrontmatter);
      if (issues.length > 0) {
        reportIssue({ ...postWriteIssue(null, queue.projectId, collectionName, post.slug), code: 'invalid-input', outcome: 'no-write', recover: 'none' });
        return false;
      }
      const doc = bodyEditorRef.current?.getDoc() ?? fallbackDoc();
      if (doc) {
        await queue.enqueue(doc, frontmatterRef.current);
        if (frontmatterRef.current === savingFrontmatter) reportIssue(null);
      } else {
        // Body never parsed, so it was never editable here — the bytes pass
        // through unchanged. Frontmatter must stay saveable on a broken file.
        await saveUnparseableBody(renamedSlugRef.current ?? post.slug, savingFrontmatter, post.body);
        if (frontmatterRef.current === savingFrontmatter) reportIssue(null);
        onPostUpdateRef.current();
      }
      await maybeRenameToTitle(doc, reportIssue);
      if (frontmatterRef.current === savingFrontmatter) pendingFrontmatter.current = false;
      return true;
    } catch (error) {
      reportIssue(postWriteIssue(error, queue.projectId, collectionName, post.slug));
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, post.slug, post.body, fields, queue, maybeRenameToTitle, saveUnparseableBody, beginWriteIssue]);

  const persistRef = useRef(persistIfValid);
  persistRef.current = persistIfValid;

  // Agent multiplayer (owner 2026-11-08, ledger F): what an outside writer — an
  // agent in the terminal, an MCP call, another app — did to this post shows up
  // here live. Its write is the newest: the user's unsaved typing is re-applied
  // onto it, and the post as the agent left it becomes the queue's baseline, so
  // the next save carries only the user's own changes.
  const outsideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingOutside = useRef(false);
  const syncOutside = useCallback(async (): Promise<void> => {
    const body = bodyEditorRef.current;
    if (!queue.durable || !queue.projectId || !body || renamingRef.current || syncingOutside.current) return;
    const later = () => { scheduleOutsideSync(400); };
    if (queue.size !== 0) { later(); return; } // F3: our own write is in flight
    syncingOutside.current = true;
    try {
      let theirs: Awaited<ReturnType<typeof readAcceptedPost>>;
      try { theirs = await readAcceptedPost(queue.projectId, collectionName, renamedSlugRef.current ?? post.slug); }
      catch { return; } // the post is gone (E7) or the runtime is down: nothing to show now
      const base = queue.accepted;
      if (!base || (theirs.body === base.body && equalPostValue(theirs.frontmatter, base.frontmatter))) return; // F4
      if (queue.size !== 0 || renamingRef.current) { later(); return; }
      const mine = body.getDoc();
      if (mine) {
        const parse = (text: string) => { try { return parsePostBody(text, format); } catch { return null; } };
        const merged = parse(mergeText(base.body, serializePostDoc(mine), theirs.body)) ?? parse(theirs.body);
        if (!merged) return; // F7: the editor cannot show what was written; the next save merges text-wise
        if (!body.applyOutside(merged)) { later(); return; } // F12, F13
      }
      const has = (fields: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(fields, key);
      const values = { ...frontmatterRef.current };
      for (const key of new Set([...Object.keys(base.frontmatter), ...Object.keys(theirs.frontmatter)])) {
        if (has(base.frontmatter, key) === has(theirs.frontmatter, key) && equalPostValue(base.frontmatter[key], theirs.frontmatter[key])) continue;
        if (has(theirs.frontmatter, key)) values[key] = theirs.frontmatter[key]; else delete values[key]; // F8: newest wins
      }
      queue.adopt({ frontmatter: theirs.frontmatter, body: theirs.body });
      acceptedFrontmatter.current = structuredClone(theirs.frontmatter);
      frontmatterRef.current = values; setFrontmatter(values);
      noteAgentActivity({ projectId: queue.projectId, file: theirs.file });
    } finally { syncingOutside.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, collectionName, post.slug, format]);
  const scheduleOutsideSync = (delay: number) => {
    if (outsideTimer.current) clearTimeout(outsideTimer.current);
    outsideTimer.current = setTimeout(() => { outsideTimer.current = null; void syncOutsideRef.current(); }, delay);
  };
  const syncOutsideRef = useRef(syncOutside);
  syncOutsideRef.current = syncOutside;
  outsideSyncRef.current = () => scheduleOutsideSync(150); // coalesce bursts (typing saves, an agent's run of writes)
  useEffect(() => {
    if (!queue.durable) return;
    const onFiles = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; files: string[] }>).detail;
      if (detail?.projectId === queue.projectId && detail.files.some(file => file.startsWith(`src/content/${collectionName}/`))) outsideSyncRef.current();
    };
    window.addEventListener('sq:files-changed', onFiles);
    const offAccepted = subscribeDurableEditStatus(() => outsideSyncRef.current()); // F5: MCP / another writer through the journal
    return () => {
      window.removeEventListener('sq:files-changed', onFiles); offAccepted();
      if (outsideTimer.current) clearTimeout(outsideTimer.current);
    };
  }, [queue, collectionName]);

  const handleSave = useCallback(async () => {
    try { return await persistIfValid(); }
    catch { return false; /* The attempted save already published its scoped failure. */ }
  }, [persistIfValid]);

  // The route's PostLayout header variant, mirrored in the writing view.
  const [postHeader, setPostHeader] = useState<PostLayoutSettings>(DEFAULT_POST_HEADER);
  useEffect(() => {
    if (!projectPath) return;
    let alive = true;
    void fetchLocalPageSource(projectPath, `src/pages/${collectionName}/[slug].astro`).then(src => {
      if (alive) setPostHeader((src && readPostLayoutSettings(src)) || DEFAULT_POST_HEADER);
    });
    return () => { alive = false; };
  }, [projectPath, collectionName]);

  return (
    <div className="flex-1 flex flex-col bg-bg-contrast overflow-hidden min-w-0">
      <PostEditorHeader collection={collectionName} fileName={postFileName(post)} onLayoutChange={setPostHeader} />
      <div className="sq-post-writing-area flex-1 overflow-auto bg-bg" data-sq-post-header={postHeader.header}>
        {writeIssue && <div className={`${POST_COLUMN_CLS} pt-4`}>
          <OperationNotice {...postIssueCopy(writeIssue)} action={mayOfferRecovery(writeIssue) ? {
            label: 'Retry save', busy: retrying, onClick: () => {
              setRetrying(true);
              void handleSave().finally(() => setRetrying(false));
            },
          } : undefined} />
        </div>}
        <FrontmatterForm
          key={JSON.stringify([projectPath, post.filePath])}
          fileName={postFileName(post)}
          postFile={post.filePath}
          projectPath={projectPath}
          fieldSource={collection ? 'schema' : 'inferred'}
          onFocusBody={() => bodyEditorRef.current?.focusStart()}
          header={postHeader}
          body={post.body}
          frontmatter={frontmatter}
          readOnlyPropertyKeys={post.readOnlyPropertyKeys}
          fields={fields}
          collectionId={collection?.id ?? null}
          localCollection={localCollection}
          onChange={handleFrontmatterChange}
          onBlur={handleSave}
          onUploadMedia={
            // Field images on a files-truth post need the post-relative writer;
            // body/MDX media (PostBodyEditor below) keeps the public-path one.
            onUploadFieldMedia && localCollection
              ? (file: File, field: string) => onUploadFieldMedia(post.filePath, file, field, collectionName)
              : onUploadMedia
          }
        />
        <PostBodyEditor
          ref={bodyEditorRef}
          onBeginWriteIssue={beginBodyWriteIssue}
          body={post.body}
          focusBodyLine={focusBodyLine}
          format={format}
          queue={queue}
          projectId={queue.projectId}
          frontmatterRef={frontmatterRef}
          previewOrigin={previewOrigin}
          previewIframe={previewIframe}
          collection={collectionName}
          slug={post.slug}
          filePath={post.filePath ?? null}
          onUploadMedia={onUploadMedia}
        />
      </div>
    </div>
  );
});
