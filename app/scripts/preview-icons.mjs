/** Generate a disposable native-size review sheet: node scripts/preview-icons.mjs.
 * Open /icon-review.html on the app's Vite port. This is not a production entry.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const app = new URL('../', import.meta.url);
const directory = new URL('src/assets/icons/', app);
const files = readdirSync(directory).filter(file => file.endsWith('.svg')).sort();
const sizes = [16, 24];
const rows = files.map(file => {
  const source = readFileSync(new URL(file, directory), 'utf8');
  const cells = sizes.map(size => `<td>${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</td>`).join('');
  return `<tr><th scope="row">${file.slice(0, -4)}</th>${cells}</tr>`;
}).join('\n');
const theme = readFileSync(new URL('src/styles/theme.css', app), 'utf8');
const optical = theme.slice(theme.indexOf('/* Editor icons:'));
const table = `<table><thead><tr><th>Icon</th>${sizes.map(size => `<th>${size === 24 ? '24px box · 20px art' : '16px'}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
writeFileSync(new URL('icon-review.html', app), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Starquix · Icon review</title>
<style>
body{margin:0;font:12px/1.5 system-ui;background:#f7f7f8;color:#282a30}header{padding:24px 32px;border-bottom:1px solid #ddd}h1{margin:0 0 8px;font-size:22px}p{margin:0}main{display:grid;grid-template-columns:1fr 1fr}section{padding:20px 24px}.dark{background:#191a1e;color:#dddfe5}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{height:48px;text-align:center;border-bottom:1px solid #8882}th:first-child{text-align:left;width:150px;font-weight:500}thead th{height:32px;color:#888}svg{vertical-align:middle}
${optical}
</style><header><h1>Editor icons</h1><p>${files.length} symbols · balanced 1px drawings on the half-pixel lattice, at native sizes · light and dark surfaces</p></header><main><section>${table}</section><section class="dark">${table}</section></main></html>`);
console.log(`Review sheet: ${fileURLToPath(new URL('icon-review.html', app))}`);
