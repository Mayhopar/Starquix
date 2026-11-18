import React, { useState } from 'react';
import { Row } from '@/components/ui';
import { RobotIcon } from '@/assets/icons';
import type { PageSeoField, PageSeoState } from '@/store/seo/headSeo';
import { SeoTextField } from '../SeoTextField';
import { SECTION_ROW_CLS, SECTION_ICON_CLS, SECTION_CONTENT_CLS } from './shared';

interface Props {
  state: PageSeoState;
  save: (field: PageSeoField, value: string | boolean) => void;
}

/** Whether search engines list the page, and under which address. */
export const IndexingSection: React.FC<Props> = ({ state, save }) => {
  const [expanded, setExpanded] = useState(false);
  const { noindex, canonical } = state.fields;
  return (
    <Row hover={false} title="Indexing" expandable expanded={expanded} onExpandChange={setExpanded} className={SECTION_ROW_CLS} left={<RobotIcon className={SECTION_ICON_CLS} />}>
      <div className={SECTION_CONTENT_CLS}>
        <Row hover={false} title="Hide from search engines" size="sm" className="px-0" disabled={!noindex.editable}
          right={[{ type: 'toggle', value: noindex.value === true, onChange: (v: boolean) => save('noindex', v), 'aria-label': 'Hide from search engines' }]} />
        <SeoTextField label="Canonical URL" field="canonical" st={canonical} save={save} placeholder="Automatic" />
      </div>
    </Row>
  );
};
