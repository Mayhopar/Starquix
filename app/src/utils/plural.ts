/**
 * Number agreement for counted UI copy — the ONE place `s` is decided.
 *
 * Three near-identical `const plural = …` helpers had grown in InstanceMenu,
 * ComponentUsageBadge and localMasterOverrides. Each handled the NOUN and each
 * left the VERB hardcoded, which is why a blind review found `1 placement
 * override` and `1 other placement keep` in shipped copy. The two inflect in
 * OPPOSITE directions — the noun takes `-s` when n !== 1, the verb takes it
 * when n === 1 — so a noun-only helper cannot express an agreeing sentence.
 *
 * Both runtimes read the same strings from the same builders, so a fix here is
 * a fix everywhere; there is nothing runtime-specific about grammar.
 */

/** `1 change` · `2 changes` · `1 entry` / `3 entries` with an explicit plural. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/**
 * Subject/verb agreement for a count-headed subject: `1 placement overrides`,
 * `2 placements override`. Irregulars pass the singular form explicitly
 * (`verb(n, 'have', 'has')`).
 */
export function verb(n: number, base: string, thirdPersonSingular?: string): string {
  return n === 1 ? (thirdPersonSingular ?? `${base}s`) : base;
}
