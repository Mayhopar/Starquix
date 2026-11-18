// Which process opens the pair URL. Dexie/localStorage are per browser
// profile, so the system default opener is wrong whenever the project lives
// in another browser (Arc default, project in Chrome): a configured browser
// name is handed to the platform opener instead.
export function openCommand(url: string, browser: string | undefined, platform: NodeJS.Platform = process.platform): [string, string[]] {
  const app = browser?.trim();
  if (platform === 'darwin') return ['open', app ? ['-a', app, url] : [url]];
  if (platform === 'win32') return ['cmd', app ? ['/c', 'start', '', app, url] : ['/c', 'start', '', url]];
  return app ? [app, [url]] : ['xdg-open', [url]];
}
