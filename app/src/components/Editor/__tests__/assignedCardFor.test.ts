import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CARD } from '@/utils/cardFields';
import { IMPORTED_CARD } from '@/utils/__tests__/fixtures/cards';
import { _resetCardTitleLocksForTests, setProjectSources } from '@/utils/cardTitleLock';
import { setCardCollection } from '@/utils/cardAssignment';
import { assignedCardFor } from '../localBlogBind';
import { TWO_SLOTS } from '@/utils/__tests__/fixtures/lists';

const PAGE = 'src/pages/blog.astro';
const page = (card: string, prop: string) => `---\nimport ${card} from '../components/${card}.astro';\nconst posts = await getCollection('blog');\n---\n{posts.map((post) => <${card} ${prop}={post} />)}\n`;

beforeEach(() => {
  _resetCardTitleLocksForTests();
  setProjectSources({
    files: {
      'src/components/BlogCard.astro': DEFAULT_CARD, // blog by name
      'src/components/WorkCard.astro': setCardCollection(IMPORTED_CARD, 'blog'), // moved onto blog (typed)
      'src/components/FeaturedWork.astro': IMPORTED_CARD, // works
    },
    collections: ['works', 'blog'],
  });
});

describe('assignedCardFor — the card a Blog bound to a collection renders', () => {
  it('keeps the card the page renders when it belongs to that collection (the re-emit no longer reverts a move)', () => {
    expect(assignedCardFor('blog', PAGE, page('WorkCard', 'work'))).toBe('src/components/WorkCard.astro');
    expect(assignedCardFor('blog', PAGE, page('BlogCard', 'post'))).toBe('src/components/BlogCard.astro');
  });
  it('otherwise the collection\'s card from its folder, typed first; none → null (create WorksCard)', () => {
    expect(assignedCardFor('blog', PAGE, page('FeaturedWork', 'work'))).toBe('src/components/WorkCard.astro');
    expect(assignedCardFor('works', PAGE, '')).toBe('src/components/FeaturedWork.astro');
    expect(assignedCardFor('notes', PAGE, '')).toBeNull();
  });
});

describe('assignedCardFor — per slot (task-244 L21)', () => {
  it('reads the card in THAT slot\'s fragment', () => {
    setProjectSources({
      files: { 'src/components/FeaturedWork.astro': setCardCollection(IMPORTED_CARD, 'works'), 'src/components/WorkCard.astro': setCardCollection(IMPORTED_CARD, 'works') },
      collections: ['works'],
    });
    expect(assignedCardFor('works', 'src/pages/index.astro', TWO_SLOTS, 0)).toBe('src/components/FeaturedWork.astro');
    expect(assignedCardFor('works', 'src/pages/index.astro', TWO_SLOTS, 1)).toBe('src/components/WorkCard.astro');
  });
});

describe('assignedCardFor — the slot keeps the card it renders (live 2026-10-10)', () => {
  it('a card typed for ANOTHER collection that the slot already renders for this one stays (no WorksCard swap on re-emit)', () => {
    setProjectSources({
      files: { 'src/components/FeaturedWork.astro': IMPORTED_CARD.replace('"works"', '"blog"'), 'src/components/WorkCard.astro': setCardCollection(IMPORTED_CARD, 'blog') },
      collections: ['works', 'blog'],
    });
    expect(assignedCardFor('works', 'src/pages/index.astro', TWO_SLOTS, 1)).toBe('src/components/WorkCard.astro');
    // A rebind to another collection does not keep it.
    expect(assignedCardFor('notes', 'src/pages/index.astro', TWO_SLOTS, 1)).toBeNull();
  });
});

