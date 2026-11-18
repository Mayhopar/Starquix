// The component view (Assets → a component) paints a neutral white backdrop in
// both editor themes — a card with dark text on a transparent background was
// invisible over the dark editor canvas (owner 2026-10-10). Zero specificity,
// BEFORE the site's CSS: a site's own html/body background still wins.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const view = readFileSync(resolve(__dirname, '../../../../preview-template/src/components/SqComponentView.astro'), 'utf8');

describe('component view backdrop', () => {
  it('the component branch head sets the backdrop (the file note, else :where(html) white) before the site CSS', () => {
    const head = view.slice(view.indexOf('<title>{file}</title>'), view.indexOf('</head>', view.indexOf('<title>{file}</title>')));
    // set:html — Astro does NOT evaluate `{…}` inside <style> (live: it shipped as literal, invalid CSS).
    const backdrop = head.indexOf('<style is:inline data-sq-head="backdrop" set:html={backdropCss} />');
    expect(view).toContain("backdrop ? `html,body{background:${backdrop} !important}` : ':where(html){background:#fff}'");
    expect(backdrop).toBeGreaterThan(-1);
    expect(backdrop).toBeLessThan(head.indexOf('siteCssHtml'));
  });
});
