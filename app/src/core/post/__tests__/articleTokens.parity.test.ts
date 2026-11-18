/** The writing view and the published post use ONE scale (design: editor parity). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EDITOR_SCALE, BODY, COLUMN, HEADER, SPACE } from '../articleTokens';

const CSS = readFileSync(join(__dirname, '../../../components/PostEditor/PostBodyEditor.css'), 'utf8');
const rem = (px: number) => `${px / 16}rem`;

describe('editor ↔ page scale', () => {
  it('measure', () => {
    expect(COLUMN).toContain(`max-w-[${EDITOR_SCALE.measurePx}px]`);
    expect(CSS).toContain(`.sq-post-column { max-width: ${EDITOR_SCALE.measurePx}px; width: 100%; padding-left: 20px; padding-right: 20px; box-sizing: border-box;`);
    // the gutter sits INSIDE the column on both sides → the same 632px text line
    expect(COLUMN).toContain('px-5 sm:px-6 box-border');
    expect(CSS).toContain('.sq-post-column { padding-left: 24px; padding-right: 24px; }');
  });
  it('spacing: ONE source — the editor applies the page\'s SPACE rules; its CSS only sets the unit', () => {
    const EDITOR = readFileSync(join(__dirname, '../../../components/PostEditor/PostBodyEditor.tsx'), 'utf8');
    expect(EDITOR).toContain("import { SPACE } from '@/core/post/articleTokens';");
    expect(EDITOR).toContain('class: `sq-post-prose ${SPACE}`');
    expect(BODY).toContain(SPACE);
    expect(BODY).toContain('[--sq-u:1.125rem] md:[--sq-u:1.25rem] [--sq-section:3rem] md:[--sq-section:4rem]');
    expect(SPACE).not.toContain('--sq-u:'); // SPACE only consumes the units
    expect(CSS).toContain('--sq-u: 1.125rem;');
    expect(CSS).toContain('--sq-section: 3rem;');
    // no hand-copied tier left in the editor CSS
    expect(CSS).not.toMatch(/calc\(var\(--sq-u\)/);
  });
  it('body size + line height (desktop)', () => {
    expect(BODY).toContain(`md:text-[${rem(EDITOR_SCALE.bodyPx)}]`);
    expect(BODY).toContain(`leading-[${EDITOR_SCALE.lineHeight}]`);
    expect(CSS).toContain(`.sq-post-editor .ProseMirror { font-size: ${rem(EDITOR_SCALE.bodyPx)}; --sq-u: ${rem(EDITOR_SCALE.bodyPx)}; --sq-section: 4rem; }`);
    expect(CSS).toContain(`line-height: ${EDITOR_SCALE.lineHeight};`);
  });
  it('headings, title, subtitle (desktop)', () => {
    expect(BODY).toContain(`md:[&_:is(h1,h2)]:text-[${rem(EDITOR_SCALE.h2Px)}]`);
    expect(BODY).toContain(`md:[&_h3]:text-[${rem(EDITOR_SCALE.h3Px)}]`);
    expect(HEADER.title).toContain(`sm:text-[${rem(EDITOR_SCALE.titlePx)}]`);
    expect(HEADER.subtitle).toContain(`sm:text-[${rem(EDITOR_SCALE.subtitlePx)}]`);
    expect(CSS).toContain(`.sq-post-editor .ProseMirror h2 { font-size: ${rem(EDITOR_SCALE.h2Px)}; }`);
    expect(CSS).toContain(`.sq-post-editor .ProseMirror h3 { font-size: ${rem(EDITOR_SCALE.h3Px)}; }`);
    expect(CSS).toContain(`.sq-post-title { font-size: ${rem(EDITOR_SCALE.titlePx)}; }`);
    expect(CSS).toContain(`.sq-post-subtitle { font-size: ${rem(EDITOR_SCALE.subtitlePx)}; }`);
  });
});
