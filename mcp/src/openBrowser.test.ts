import { describe, it, expect } from 'vitest';
import { openCommand } from './openBrowser';

// `pair` must land in the browser that holds the project (Dexie is per
// browser profile): the system default (Arc on the owner's machine) is wrong
// when the project lives in Chrome, so a configured browser name wins.
describe('openCommand', () => {
  const url = 'http://localhost:3000/?mcp=C';
  it('no browser configured → the platform default opener', () => {
    expect(openCommand(url, undefined, 'darwin')).toEqual(['open', [url]]);
    expect(openCommand(url, '', 'darwin')).toEqual(['open', [url]]);
    expect(openCommand(url, undefined, 'win32')).toEqual(['cmd', ['/c', 'start', '', url]]);
    expect(openCommand(url, undefined, 'linux')).toEqual(['xdg-open', [url]]);
  });
  it('configured browser → opened by that app', () => {
    expect(openCommand(url, 'Google Chrome', 'darwin')).toEqual(['open', ['-a', 'Google Chrome', url]]);
    expect(openCommand(url, 'chrome', 'win32')).toEqual(['cmd', ['/c', 'start', '', 'chrome', url]]);
    expect(openCommand(url, 'google-chrome', 'linux')).toEqual(['google-chrome', [url]]);
  });
});
