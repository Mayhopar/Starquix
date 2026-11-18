#!/usr/bin/env node
/**
 * Regenerates src/assets/fontCatalog.json from Google Fonts metadata.
 * Run manually when refreshing the catalog: node scripts/build-font-catalog.mjs
 * ponytail: one-shot fetch script, no error retries — rerun on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets/fontCatalog.json');

const CURATED = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway',
  'Nunito', 'Work Sans', 'DM Sans', 'Manrope', 'Sora', 'Outfit', 'Figtree',
  'Plus Jakarta Sans', 'Space Grotesk', 'IBM Plex Sans', 'Source Sans 3',
  'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Cormorant',
  'EB Garamond', 'Crimson Text', 'Fraunces', 'DM Serif Display',
  'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Space Mono', 'Roboto Mono',
  'Bebas Neue', 'Oswald', 'Archivo', 'Barlow', 'Rubik', 'Karla', 'Mulish', 'Urbanist',
];

const res = await fetch('https://fonts.google.com/metadata/fonts');
if (!res.ok) { console.error(`metadata fetch failed: ${res.status}`); process.exit(1); }
let text = await res.text();
// Google prefixes the JSON with an XSSI guard line — strip anything before the first {
text = text.slice(text.indexOf('{'));
const meta = JSON.parse(text);

// Sorted by Google's popularity rank (1 = most popular) so the picker can
// show the full list most-popular-first without storing the rank.
const families = [...meta.familyMetadataList]
  .sort((a, b) => (a.popularity ?? Infinity) - (b.popularity ?? Infinity))
  .map((f) => ({
    f: f.family,
    c: f.category,          // e.g. "Sans Serif", "Serif", "Monospace"
    // fonts keys are like "400", "700i" / "700italic" — keep numeric uprights only
    w: [...new Set(Object.keys(f.fonts).filter(k => /^\d+$/.test(k)).map(Number))].sort((a, b) => a - b),
  })).filter(f => f.w.length > 0);

fs.writeFileSync(OUT, JSON.stringify({ curated: CURATED, families }, null, 0));
console.log(`Wrote ${families.length} families to ${OUT}`);
