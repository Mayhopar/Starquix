// The two env switches the runtime probe (desktop/probe) needs in main.mjs. Each is inert when its variable is unset.
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EDITOR_ORIGIN, resolveEditor } from '../src/editor.mjs';
import { probeInvisible, probeWindowOptions } from '../src/probe-mode.mjs';

const mainSource = await fs.readFile(path.resolve(import.meta.dirname, '../src/main.mjs'), 'utf8');
const dev = (url, env = {}) => resolveEditor({ isPackaged: false, env: { ...env, ...(url ? { SQ_EDITOR_URL: url } : {}) } });

it('unset: the unpackaged editor is today\'s strict 127.0.0.1 loopback (default :3061)', () => {
  expect(dev()).toEqual({ editorUrl: 'http://127.0.0.1:3061/', editorOrigin: 'http://127.0.0.1:3061' });
  expect(dev('http://127.0.0.1:3190/').editorOrigin).toBe('http://127.0.0.1:3190');
  for (const bad of ['http://localhost:3190/', 'http://127.0.0.1/', 'https://127.0.0.1:3190/', 'http://127.0.0.1.evil.test:3190/', 'http://example.com:3190/', 'starquix://app/'])
    expect(() => dev(bad), bad).toThrow('loopback editor');
  for (const off of ['', '0', 'true', 'yes']) expect(() => dev('http://localhost:3190/', { SQ_DEV_EDITOR_LOCALHOST: off }), `switch=${JSON.stringify(off)}`).toThrow('loopback editor');
});

it('SQ_DEV_EDITOR_LOCALHOST=1 additionally accepts http://localhost:<port> (another SITE than the 127.0.0.1 canvas = its own renderer process), nothing else', () => {
  const on = { SQ_DEV_EDITOR_LOCALHOST: '1' };
  expect(dev('http://localhost:3190/', on)).toEqual({ editorUrl: 'http://localhost:3190/', editorOrigin: 'http://localhost:3190' });
  expect(dev('http://127.0.0.1:3190/', on).editorOrigin).toBe('http://127.0.0.1:3190');
  for (const bad of ['http://localhost/', 'https://localhost:3190/', 'http://localhost.evil.test:3190/', 'http://evil.localhost:3190/', 'http://example.com:3190/', 'http://[::1]:3190/'])
    expect(() => dev(bad, on), bad).toThrow('loopback editor');
});

it('packaged: always the custom scheme; SQ_EDITOR_URL and the switch are ignored', () => {
  const env = { SQ_EDITOR_URL: 'http://localhost:3190/', SQ_DEV_EDITOR_LOCALHOST: '1' };
  expect(resolveEditor({ isPackaged: true, env })).toEqual({ editorUrl: `${EDITOR_ORIGIN}/`, editorOrigin: EDITOR_ORIGIN });
  expect(resolveEditor({ isPackaged: true, env: {} }).editorOrigin).toBe(EDITOR_ORIGIN);
});

it('SQ_PROBE_INVISIBLE=1 keeps the window hidden and unfocusable; unset changes nothing', () => {
  expect(probeInvisible({})).toBe(false);
  expect(probeWindowOptions({})).toEqual({});
  for (const off of ['', '0']) { expect(probeInvisible({ SQ_PROBE_INVISIBLE: off })).toBe(false); expect(probeWindowOptions({ SQ_PROBE_INVISIBLE: off })).toEqual({}); }
  expect(probeInvisible({ SQ_PROBE_INVISIBLE: '1' })).toBe(true);
  expect(probeWindowOptions({ SQ_PROBE_INVISIBLE: '1' })).toEqual({ show: false, opacity: 0, focusable: false });
});

it('main.mjs takes the editor from resolveEditor and runs every probe behaviour behind probeInvisible', () => {
  expect(mainSource).toMatch(/resolveEditor\(\{ isPackaged: app\.isPackaged, env: process\.env \}\)/);
  expect(mainSource, 'the editor check lives in one tested place').not.toMatch(/127\\\.0\\\.0\\\.1/);
  for (const call of ["app.setActivationPolicy('accessory')", 'win.setIgnoreMouseEvents(true)', 'win.showInactive()'])
    expect(mainSource.split('\n').find(line => line.includes(call)), call).toContain('probeInvisible(process.env)');
  expect(mainSource).toContain('...probeWindowOptions(process.env)');
});
