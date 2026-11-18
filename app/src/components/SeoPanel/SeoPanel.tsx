import React from 'react';
import { Row } from '@/components/ui';
import { getLocalExpectedRoute } from '@/utils/localPageSync';
import { scorePageSeo } from '@/store/seo/pageSeoScore';
import { usePageSeo } from './usePageSeo';
import { CompletenessBar } from './CompletenessBar';
import { SearchSection } from './sections/SearchSection';
import { SharingSection } from './sections/SharingSection';
import { IndexingSection } from './sections/IndexingSection';
import { SiteSection } from './sections/SiteSection';
import { StructuredDataSection } from './sections/StructuredDataSection';

/** The current page's SEO, edited where it lives in the project files (design 2026-11-17). */
export const SeoPanel: React.FC = () => {
  const { pageFile, state, rendered, save, post } = usePageSeo();

  if (!pageFile) {
    return (
      <div className="p-3">
        <div className="py-6 px-3 text-center text-text-secondary text-xs">
          Select a page to edit SEO
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="p-2" role="status" aria-label="Loading SEO">
        {['Search', 'Sharing', 'Indexing'].map((t) => <Row key={t} skeleton title={t} hover={false} className="pl-1 pr-0" />)}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="seo-panel">
      <CompletenessBar result={scorePageSeo(state)} />
      {state.problem && <Row hover={false} size="sm" className="px-3" title={`Can't edit: ${state.problem}`} />}
      <div className="p-2">
        <SearchSection state={state} rendered={rendered} route={getLocalExpectedRoute()} save={save} />
        <SharingSection state={state} rendered={rendered} save={save} post={post} />
        <IndexingSection state={state} save={save} />
        <StructuredDataSection pageFile={pageFile} page={state} posts={!!post} />
        <SiteSection />
      </div>
    </div>
  );
};
