import { describe, it, expect } from 'vitest';
import { SQ_UPGRADE_MARKERS as PLUGIN_MARKERS } from '../../../../preview-template/src/plugins/sq-project-fs.js';
import { SQ_UPGRADE_MARKERS, staleSqUpgrades } from '../systemComponents';

describe('staleSqUpgrades (our sq/ components upgrade on open)', () => {
  it('mirrors the plugin markers', () => {
    expect(SQ_UPGRADE_MARKERS).toEqual(PLUGIN_MARKERS);
  });
  it('a copy without the current marker → template + .bak; a current (maybe edited) copy is kept', () => {
    const snapshot = { 'src/components/Stack.astro': '// sq-stack-v5 new', 'src/components/Media.astro': 'sq-media-v2' };
    expect(staleSqUpgrades({ 'src/components/sq/Stack.astro': '// sq-stack-v1 old' }, snapshot)).toEqual({
      'src/components/sq/Stack.astro': '// sq-stack-v5 new',
      'src/components/sq/Stack.astro.bak': '// sq-stack-v1 old',
    });
    expect(staleSqUpgrades({ 'src/components/sq/Stack.astro': '// sq-stack-v5 edited by me' }, snapshot)).toEqual({});
    expect(staleSqUpgrades({}, snapshot)).toEqual({}); // never shipped → nothing to upgrade
  });
});
