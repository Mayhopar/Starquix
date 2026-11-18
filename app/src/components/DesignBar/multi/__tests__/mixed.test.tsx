import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { multiWrapper } from './renderInMulti';
import { useMixedValue, ownsGroups } from '../mixed';

const weight = (c: string) => c.match(/\bfont-(bold|normal|medium)\b/)?.[1] ?? 'normal';

describe('useMixedValue (design C6)', () => {
  it('different parsed values → Mixed', () => {
    expect(renderHook(() => useMixedValue(weight), { wrapper: multiWrapper(['font-bold', 'font-medium']) }).result.current).toBe(true);
  });
  it('a missing token and the explicit default read the same → not Mixed', () => {
    expect(renderHook(() => useMixedValue(weight), { wrapper: multiWrapper(['font-normal p-2', 'p-4']) }).result.current).toBe(false);
  });
  it('single selection → never Mixed', () => {
    expect(renderHook(() => useMixedValue(weight), { wrapper: multiWrapper(null) }).result.current).toBe(false);
  });
});

describe('ownsGroups', () => {
  it('owns tokens of the named property groups only', () => {
    expect(ownsGroups('standalone:fontWeight')('font-bold')).toBe(true);
    expect(ownsGroups('standalone:fontWeight')('text-lg')).toBe(false);
  });
});
