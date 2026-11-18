import React, { useState } from 'react';
import { Row } from '@/components/ui';
import { SearchIcon } from '@/assets/icons';
import type { PageSeoField, PageSeoState } from '@/store/seo/headSeo';
import type { RenderedHead } from '@/store/seo/seoFiles';
import { DESCRIPTION_MAX, TITLE_MAX } from '@/store/seo/pageSeoScore';
import { SeoTextField } from '../SeoTextField';
import { SECTION_ROW_CLS, SECTION_ICON_CLS, SECTION_CONTENT_CLS, shownValue } from './shared';

interface Props {
  state: PageSeoState;
  rendered: RenderedHead | null;
  route: string | null;
  save: (field: PageSeoField, value: string | boolean) => void;
}

/** Title + description, and the search result they make. */
export const SearchSection: React.FC<Props> = ({ state, rendered, route, save }) => {
  const [expanded, setExpanded] = useState(true);
  const { fields } = state;
  const title = rendered?.title || shownValue(fields.title);
  const description = rendered?.description || shownValue(fields.description);
  const url = rendered?.url || route || '/';

  return (
    <Row hover={false} title="Search" expandable expanded={expanded} onExpandChange={setExpanded} className={SECTION_ROW_CLS} left={<SearchIcon className={SECTION_ICON_CLS} />}>
      <div className={SECTION_CONTENT_CLS}>
        <SeoTextField label="Title" field="title" st={fields.title} save={save} max={TITLE_MAX} placeholder="Page title — primary keyword first" />
        <SeoTextField label="Description" field="description" st={fields.description} save={save} multiline max={DESCRIPTION_MAX} placeholder="What a searcher gets on this page" />
        <div className="pt-2 pb-1 min-w-0" data-testid="seo-search-preview" aria-label="Search result preview">
          <div className="text-2xs text-text-secondary truncate">{url}</div>
          <div className="text-xs text-info truncate">{title || 'Untitled'}</div>
          <div className="text-2xs text-text-secondary line-clamp-2">{description}</div>
        </div>
      </div>
    </Row>
  );
};
