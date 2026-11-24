/** Owner feedback (Typography chevrons drift): every dropdown-looking control in the Design Bar draws the kit Field
 *  select's chevron — same icon, size, color token — in the same place: a 4px slot gap inside the 1px field edge. */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Field, fieldTrigger } from '@/components/ui';
import { ColorPicker } from '../ColorPicker';
import { FontFamilySelect } from '../blocks/FontFamilySelect';

const chevron = (root: HTMLElement) => root.querySelector('svg[data-sq-icon="chevron-down"]') as SVGElement;

describe('one dropdown chevron', () => {
  const { container: select } = render(<Field as="select" value="" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />);
  const canonical = chevron(select).getAttribute('class');

  it('the Field select chevron is 16px in text-secondary, 4px inside its 1px-bordered box', () => {
    expect(canonical?.split(' ')).toEqual(expect.arrayContaining(['w-4', 'h-4', 'text-text-secondary']));
    expect(chevron(select).parentElement!.className).toMatch(/\bmr-1\b/);
    expect(select.querySelector('.border-input-stroke')!.className).toMatch(/\bborder\b/);
  });

  it.each([
    ['FontFamilySelect', <FontFamilySelect value="" projectFonts={{}} onChange={() => {}} onUploadClick={() => {}} />],
    ['ColorPicker', <ColorPicker prefix="text" value="text-red-500" onChange={() => {}} />],
  ])('%s draws that chevron in a field-trigger box', (_name, ui) => {
    const { container } = render(ui);
    const icon = chevron(container);
    expect(icon.getAttribute('class')).toBe(canonical);
    const trigger = icon.closest('button')!;
    for (const c of fieldTrigger.split(' ')) expect(trigger.className.split(' ')).toContain(c);
    expect(icon.parentElement).toBe(trigger); // no wrapper adding its own margin
  });
});
