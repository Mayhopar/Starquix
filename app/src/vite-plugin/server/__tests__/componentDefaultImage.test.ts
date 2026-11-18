/**
 * task-143 unified image UX — writeComponentDefaultImage: the component
 * editor's Replace writes an ImageMetadata import + destructure default into
 * the component (`const { src = __sqDefault_src } = Astro.props`); clear
 * removes both. The component-view stub injector skips destructure names
 * WITH defaults, so the default renders in the editor too.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { writeComponentDefaultImage, writeDefaultImageAsset, findImagePropAt } from '../../project-fs';

let root: string;

const COMPONENT = `---
import { Image } from 'astro:assets';
const { alt, src, customClass, caption } = Astro.props;
---
<div class={customClass}>
    <Image alt={alt} src={src} loading="lazy" format="webp"/>
</div>`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sq-default-img-'));
  mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'components', 'SingleImage.astro'), COMPONENT);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findImagePropAt', () => {
  it('maps the nth image tag to its bare-identifier prop', () => {
    const two = `---
const { lsrc, rsrc } = Astro.props;
---
<Image src={lsrc}/><Image src={rsrc}/>`;
    expect(findImagePropAt(two, 0)).toBe('lsrc');
    expect(findImagePropAt(two, 1)).toBe('rsrc');
    expect(() => findImagePropAt(two, 2)).toThrow(/index 2/);
  });
});

describe('writeComponentDefaultImage', () => {
  it('set: adds the import + destructure default; clear removes both', async () => {
    const asset = writeDefaultImageAsset(root, 'hero.jpg', Buffer.from([1, 2, 3]));
    expect(asset).toBe('src/assets/sq-defaults/hero.jpg');

    const set = await writeComponentDefaultImage(root, 'src/components/SingleImage.astro', 0, asset);
    expect(set).toMatchObject({ ok: true, prop: 'src', asset, previous: null });
    const after = readFileSync(path.join(root, 'src/components/SingleImage.astro'), 'utf8');
    expect(after).toContain("import __sqDefault_src from '../assets/sq-defaults/hero.jpg';");
    expect(after).toContain('src = __sqDefault_src');

    const cleared = await writeComponentDefaultImage(root, 'src/components/SingleImage.astro', 0, null);
    expect(cleared.previous).toBe(asset);
    const restored = readFileSync(path.join(root, 'src/components/SingleImage.astro'), 'utf8');
    expect(restored).not.toContain('__sqDefault_src');
    expect(restored).toContain('const { alt, src, customClass, caption } = Astro.props;');
  });

  it('replacing an existing default reports it as previous and swaps cleanly', async () => {
    const a1 = writeDefaultImageAsset(root, 'a.jpg', Buffer.from([1]));
    const a2 = writeDefaultImageAsset(root, 'b.jpg', Buffer.from([2]));
    await writeComponentDefaultImage(root, 'src/components/SingleImage.astro', 0, a1);
    const second = await writeComponentDefaultImage(root, 'src/components/SingleImage.astro', 0, a2);
    expect(second.previous).toBe(a1);
    const after = readFileSync(path.join(root, 'src/components/SingleImage.astro'), 'utf8');
    expect(after).toContain("from '../assets/sq-defaults/b.jpg'");
    expect(after).not.toContain("from '../assets/sq-defaults/a.jpg'");
    expect(after.match(/__sqDefault_src/g)!.length).toBe(2); // import + default, once each
  });

  it('collision-suffixes asset names', () => {
    writeDefaultImageAsset(root, 'x.png', Buffer.from([1]));
    expect(writeDefaultImageAsset(root, 'x.png', Buffer.from([2]))).toBe('src/assets/sq-defaults/x-1.png');
  });

  it('fails honestly on unknown component / missing destructure', async () => {
    await expect(writeComponentDefaultImage(root, 'src/components/Nope.astro', 0, null)).rejects.toThrow(/unknown component/);
    writeFileSync(path.join(root, 'src/components/Inline.astro'), '---\nconst src = Astro.props.src;\n---\n<img src={src}/>');
    await expect(writeComponentDefaultImage(root, 'src/components/Inline.astro', 0, 'src/assets/x.png')).rejects.toThrow(/destructure/);
  });
});
