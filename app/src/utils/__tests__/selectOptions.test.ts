import { expect, it } from 'vitest';
import { selectOptionsFor } from '../selectOptions';
import type { ScannedElement } from '@/context/SelectionContext';

it('a Layers-row selection carries the scanned <img> src — the Fill block shows the image without a canvas click', () => {
  const element = { key: 'src/pages/index.astro:3:1', tagName: 'img', classes: 'w-8', imageSrc: '/logo.svg', imageAlt: 'logo', rect: { top: 0, left: 0, width: 8, height: 8 } } as unknown as ScannedElement;
  expect(selectOptionsFor(element)).toMatchObject({ imageSrc: '/logo.svg', imageAlt: 'logo' });
});
