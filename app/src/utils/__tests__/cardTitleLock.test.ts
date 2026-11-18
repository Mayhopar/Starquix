import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CARD } from '../cardFields';
import { IMPORTED_CARD } from './fixtures/cards';
import { _resetCardTitleLocksForTests, cardFieldAt, containsCardTitle, isCardTitleElement, setCardSource } from '../cardTitleLock';

const FILE = 'src/components/WorksCard.astro';
const lineOf = (needle: string) => DEFAULT_CARD.split('\n').findIndex((l) => l.includes(needle)) + 1;
const loc = (needle: string) => ({ file: FILE, line: lineOf(needle), column: DEFAULT_CARD.split('\n')[lineOf(needle) - 1].indexOf('<') + 1 });

beforeEach(() => { _resetCardTitleLocksForTests(); setCardSource(FILE, DEFAULT_CARD); });

describe('cardFieldAt — Layers names card elements by field (owner 2026-10-11)', () => {
  it('a field element → its field; a container or plain element → null', () => {
    expect(cardFieldAt(loc('<h3'))).toBe('title');
    expect(cardFieldAt(loc('<img'))).not.toBeNull();
    expect(cardFieldAt(loc('<article'))).toBeNull();
    expect(cardFieldAt(loc('<div class="p-4'))).toBeNull();
    expect(cardFieldAt({ file: 'src/pages/index.astro', line: 1, column: 1 })).toBeNull();
    // an imported <Image src={work.data.image} alt={work.data.title}> is "image", not unnamed
    setCardSource(FILE, '---\nconst { work } = Astro.props;\n---\n<article>\n<Image\n  src={work.data.image}\n  alt={work.data.title}\n/>\n<h1>{work.data.title}</h1>\n</article>\n');
    expect(cardFieldAt({ file: FILE, line: 5, column: 1 })).toBe('image');
  });
});

describe('card title lock', () => {
  it('the title element and every ancestor of it are locked; other fields are not', () => {
    expect(isCardTitleElement(loc('<h3'))).toBe(true);
    expect(containsCardTitle(loc('<h3'))).toBe(true);
    expect(containsCardTitle(loc('<div class="p-4'))).toBe(true);
    expect(containsCardTitle(loc('<article'))).toBe(true);
    expect(isCardTitleElement(loc('<div class="p-4'))).toBe(false);
    expect(containsCardTitle(loc('<p class'))).toBe(false);
    expect(containsCardTitle(loc('<img'))).toBe(false);
  });
  it('an eye-guarded title stays locked', () => {
    setCardSource(FILE, DEFAULT_CARD.replace('<h3', '{show.title && <h3').replace('</h3>', '</h3>}'));
    expect(isCardTitleElement({ file: FILE, line: lineOf('<h3'), column: DEFAULT_CARD.split('\n')[lineOf('<h3') - 1].indexOf('<') + 1 + '{show.title && '.length })).toBe(true);
  });
  it('a file that is not cached (or not a card) is never locked', () => {
    expect(containsCardTitle({ file: 'src/pages/index.astro', line: 1, column: 1 })).toBe(false);
    setCardSource(FILE, '<h3>{title}</h3>');
    expect(containsCardTitle({ file: FILE, line: 1, column: 1 })).toBe(false);
  });
});

describe('imported card title lock', () => {
  it('locks an imported card title (`work.data.title`, multi-line h1)', () => {
    const F = 'src/components/FeaturedWork.astro';
    setCardSource(F, IMPORTED_CARD);
    const lines = IMPORTED_CARD.split('\n');
    const h1 = lines.findIndex((l) => l.includes('<h1')) + 1;
    expect(isCardTitleElement({ file: F, line: h1, column: lines[h1 - 1].indexOf('<') + 1 })).toBe(true);
    const p = lines.findIndex((l) => l.includes('<p class="description')) + 1;
    expect(containsCardTitle({ file: F, line: p, column: lines[p - 1].indexOf('<') + 1 })).toBe(false);
  });
});

describe('project sources → assignments', () => {
  it('setProjectSources caches cards, assigns them by usage, and bumps the version', async () => {
    const { setProjectSources, cardAssignmentOf, cardSourceOf, allCardAssignments } = await import('../cardTitleLock');
    const list = `---\nimport { getCollection } from 'astro:content';\nimport WorkCard from './WorkCard.astro';\nconst works = await getCollection('works');\n---\n{works.map((w) => <WorkCard post={w} />)}\n`;
    setProjectSources({
      files: { 'src/components/WorkCard.astro': DEFAULT_CARD, 'src/components/WorkList.astro': list, 'src/pages/index.astro': '<h1>hi</h1>' },
      collections: ['works', 'notes'],
    });
    expect(cardAssignmentOf('src/components/WorkCard.astro')).toEqual({ card: true, collections: ['works'], typed: null, conflict: [] });
    expect(cardSourceOf('src/components/WorkCard.astro')).toBe(DEFAULT_CARD);
    expect(cardSourceOf(FILE)).toBeNull(); // replaced, not merged
    expect(cardAssignmentOf('src/components/WorkList.astro')).toEqual({ card: false, collections: ['works'], typed: 'works', conflict: [] }); // a list: related, not a card
    expect(cardSourceOf('src/components/WorkList.astro')).toBeNull(); // no title lock on a list
    expect([...allCardAssignments().keys()].sort()).toEqual(['src/components/WorkCard.astro', 'src/components/WorkList.astro']);
  });
});

describe('block-form card title lock', () => {
  it('a promoted card: the <h3> {f(\'title\')} is locked, the guarded <p> is not', async () => {
    const { promoteCard } = await import('../cardSetup');
    const F = 'src/components/P.astro';
    const src = promoteCard(DEFAULT_CARD, 'blog');
    setCardSource(F, src);
    const lines = src.split('\n');
    const at = (needle: string) => { const l = lines.findIndex((x) => x.includes(needle)) + 1; return { file: F, line: l, column: lines[l - 1].indexOf('<') + 1 }; };
    expect(isCardTitleElement(at('<h3'))).toBe(true);
    expect(containsCardTitle(at('<h3'))).toBe(true);
    expect(containsCardTitle(at('<div class="p-4'))).toBe(true);
    const p = lines.findIndex((x) => x.includes('<p class')) + 1;
    expect(containsCardTitle({ file: F, line: p, column: lines[p - 1].indexOf('<p') + 1 })).toBe(false);
    expect(isCardTitleElement({ file: F, line: p, column: lines[p - 1].indexOf('<p') + 1 })).toBe(false);
  });
});
