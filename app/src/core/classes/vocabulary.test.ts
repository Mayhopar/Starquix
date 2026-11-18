import { describe, expect, it } from 'vitest';
import {
  COLOR_FAMILIES,
  COLOR_FAMILY_PRIORITY,
  COLOR_MAP,
  getColorClass,
  resolveColorClass,
} from './vocabulary';

describe('COLOR_MAP', () => {
  describe('hex collision handling', () => {
    it('resolves #fafafa deterministically to neutral-50 (priority: neutral > zinc)', () => {
      // #fafafa is BOTH zinc-50 and neutral-50 in Tailwind. Per
      // COLOR_FAMILY_PRIORITY, neutral wins over zinc. This MUST be
      // independent of object/Map iteration order.
      expect(COLOR_MAP.get('#fafafa')).toBe('neutral-50');
    });

    it('keeps stone-50 at its own hex (#fafaf9), not colliding with #fafafa', () => {
      // Sanity: stone-50 is one byte off from neutral-50 / zinc-50.
      // We assert it stays distinct so a future Tailwind palette change
      // does not silently merge them.
      expect(COLOR_MAP.get('#fafaf9')).toBe('stone-50');
      expect(COLOR_MAP.get('#fafafa')).not.toBe('stone-50');
    });

    it('produces the same #fafafa winner via resolveColorClass()', () => {
      expect(resolveColorClass('#fafafa', 'bg')).toBe('bg-neutral-50');
      expect(resolveColorClass('FAFAFA', 'text')).toBe('text-neutral-50');
    });

    it('produces the same #fafafa winner via getColorClass() (no arbitrary fallback)', () => {
      expect(getColorClass('#fafafa', 'bg')).toBe('bg-neutral-50');
    });
  });

  describe('priority policy invariants', () => {
    it('lists every gray family in COLOR_FAMILY_PRIORITY with neutral after zinc', () => {
      // The whole point of this fix: the policy is encoded in the
      // priority array, NOT in COLOR_FAMILIES insertion order. If
      // someone reorders the priority array, that is a deliberate
      // policy change and should fail this test loudly.
      const grayOrder = COLOR_FAMILY_PRIORITY.filter((f) =>
        ['slate', 'gray', 'zinc', 'neutral', 'stone'].includes(f),
      );
      expect(grayOrder).toEqual(['slate', 'gray', 'zinc', 'neutral', 'stone']);
    });

    it('includes every family from COLOR_FAMILIES in COLOR_FAMILY_PRIORITY', () => {
      const families = Object.keys(COLOR_FAMILIES).sort();
      const priority = [...COLOR_FAMILY_PRIORITY].sort();
      expect(priority).toEqual(families);
    });
  });

  describe('non-conflicting hex coverage', () => {
    it('round-trips a sample from every non-gray family correctly', () => {
      // Picks one shade from each family that is known to NOT collide
      // with the gray families. Catches accidental data loss during
      // refactors of buildColorMap().
      const samples: Array<[string, string]> = [
        ['#000000', 'black'],
        ['#ffffff', 'white'],
        ['#ef4444', 'red-500'],
        ['#f97316', 'orange-500'],
        ['#f59e0b', 'amber-500'],
        ['#eab308', 'yellow-500'],
        ['#84cc16', 'lime-500'],
        ['#22c55e', 'green-500'],
        ['#10b981', 'emerald-500'],
        ['#14b8a6', 'teal-500'],
        ['#06b6d4', 'cyan-500'],
        ['#0ea5e9', 'sky-500'],
        ['#3b82f6', 'blue-500'],
        ['#6366f1', 'indigo-500'],
        ['#8b5cf6', 'violet-500'],
        ['#a855f7', 'purple-500'],
        ['#d946ef', 'fuchsia-500'],
        ['#ec4899', 'pink-500'],
        ['#f43f5e', 'rose-500'],
      ];
      for (const [hex, token] of samples) {
        expect(COLOR_MAP.get(hex)).toBe(token);
      }
    });

    it('round-trips representative shades from each gray family that do not collide', () => {
      // 500-shade of each gray family — these never collide so each must
      // map to its own family token.
      expect(COLOR_MAP.get('#64748b')).toBe('slate-500');
      expect(COLOR_MAP.get('#6b7280')).toBe('gray-500');
      expect(COLOR_MAP.get('#71717a')).toBe('zinc-500');
      expect(COLOR_MAP.get('#737373')).toBe('neutral-500');
      expect(COLOR_MAP.get('#78716c')).toBe('stone-500');
    });
  });

  describe('structural sanity', () => {
    it('contains exactly one entry per unique hex across all families', () => {
      // Build the set of unique hex values declared in COLOR_FAMILIES,
      // then assert the Map size matches. This guards against silent
      // duplication on future palette additions.
      const unique = new Set<string>();
      for (const family of Object.values(COLOR_FAMILIES)) {
        for (const [hex] of family) unique.add(hex);
      }
      expect(COLOR_MAP.size).toBe(unique.size);
    });

    it('every Map value points back to a token defined in COLOR_FAMILIES', () => {
      const allTokens = new Set<string>();
      for (const family of Object.values(COLOR_FAMILIES)) {
        for (const [, token] of family) allTokens.add(token);
      }
      for (const token of COLOR_MAP.values()) {
        expect(allTokens.has(token)).toBe(true);
      }
    });
  });

  describe('input normalization (resolveColorClass)', () => {
    it('accepts hex without leading #', () => {
      expect(resolveColorClass('ef4444', 'bg')).toBe('bg-red-500');
    });

    it('is case-insensitive', () => {
      expect(resolveColorClass('#EF4444', 'border')).toBe('border-red-500');
    });

    it('returns null for unknown hex', () => {
      expect(resolveColorClass('#123456', 'bg')).toBeNull();
    });
  });
});
