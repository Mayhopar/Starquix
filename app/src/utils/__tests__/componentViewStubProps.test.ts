// The component (master) view stubs the props a component needs to render (SqComponentView.astro buildStubProps).
// An instance override prop must stay absent: the editor destructures it only to keep it out of a rest spread
// (utils/propOverrides.ts declareProp) and reads it as `Astro.props.h2Class ?? "m-0 text-2xl"` — a stub would
// replace the master's own value in its own preview ('' ?? "lit" is '').
// The .astro frontmatter cannot be imported: this runs the REAL functions, sliced out and transpiled.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const view = readFileSync(resolve(__dirname, '../../../../preview-template/src/components/SqComponentView.astro'), 'utf8');
const code = view.slice(view.indexOf('const PLACEHOLDER_IMG'), view.indexOf('let Component'));
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const buildStubProps = new Function('SqStubContent', `${js}\nreturn buildStubProps;`)({}) as (source: string) => Record<string, unknown>;

describe('component view stub props', () => {
  it.each<[why: string, frontmatter: string, template: string, stubbed: string[]]>([
    ['an instance override prop the editor declared stays absent: the master shows its own value',
      'const { h2Class, imgSrc, post, ...rest } = Astro.props;',
      '<article {...rest}><h2 class={Astro.props.h2Class ?? "m-0 text-2xl"}>{post.data.title}</h2><img src={Astro.props.imgSrc ?? "/a.jpg"} /></article>', ['post']],
    ['a threaded override (forwarded to a child with no value here) stays absent too',
      'import Header from "./Header.astro";\nconst { headerUlClass, ...rest } = Astro.props;', '<main {...rest}><Header ulClass={Astro.props.headerUlClass} /></main>', []],
    ['an optional typed declaration does not count as a use',
      'interface Props { h2Class?: string }\nconst { h2Class, ...rest } = Astro.props;', '<h2 class={Astro.props.h2Class ?? "m-0"} {...rest}>x</h2>', []],
    ['a component forwarding every prop keeps stubbing them all',
      'import Child from "./Child.astro";\nconst { title } = Astro.props;', '<Child {...Astro.props} />', ['title']],
    ['a spread counts as a use', 'const { items } = Astro.props;\nconst list = [...items];', '<ul>{list.length}</ul>', ['items']],
    ['a child prop of the same name is not a use',
      'import Card from "./Card.astro";\nconst { h2Class, ...rest } = Astro.props;', '<Card h2Class={Astro.props.cardH2Class} {...rest} />', []],
  ])('%s', (_, frontmatter, template, stubbed) => {
    expect(Object.keys(buildStubProps(`---\n${frontmatter}\n---\n${template}`)).sort()).toEqual(stubbed);
  });

  it('props the component uses as locals keep their stubs (lists render placeholder cards)', () => {
    const props = buildStubProps(['---', 'const { title, items } = Astro.props;', '---', '<h1>{title}</h1>{items.map((i) => <p>{i.title}</p>)}'].join('\n'));
    expect(props.title).toBe('Placeholder');
    expect(Array.isArray(props.items) && props.items.length).toBe(3);
  });
});
