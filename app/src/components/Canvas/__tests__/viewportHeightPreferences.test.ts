import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_OF, screenHeight, setScreenHeight } from '../viewportHeightPreferences';

beforeEach(() => localStorage.removeItem('sq:screen-h'));

describe('screen height preferences', () => {
  it('maps breakpoints to device classes; all desktop widths share one class', () => {
    expect([DEVICE_OF.base, DEVICE_OF.sm]).toEqual(['mobile', 'mobile']);
    expect(DEVICE_OF.md).toBe('tablet');
    expect([DEVICE_OF.lg, DEVICE_OF.xl, DEVICE_OF['2xl']]).toEqual(['desktop', 'desktop', 'desktop']);
  });

  it('is per project and per device, with device defaults', () => {
    expect(screenHeight('one', 'desktop')).toBe(900);
    expect(screenHeight('one', 'tablet')).toBe(1024);
    expect(screenHeight('one', 'mobile')).toBe(844);
    setScreenHeight('one', 'desktop', 1080.4);
    expect(screenHeight('one', 'desktop')).toBe(1080);
    expect(screenHeight('two', 'desktop')).toBe(900);
    expect(screenHeight('one', 'mobile')).toBe(844);
    expect(JSON.parse(localStorage.getItem('sq:screen-h')!)).toEqual({ one: { desktop: 1080 } });
  });

  it('clamps drags and ignores writes without a project', () => {
    setScreenHeight('one', 'mobile', 10);
    expect(screenHeight('one', 'mobile')).toBe(200);
    setScreenHeight(null, 'mobile', 700);
    expect(screenHeight(null, 'mobile')).toBe(844);
  });
});
