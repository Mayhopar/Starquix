// Vite plugin, copied into <project>/.sq/desktop-guard.mjs and run INSIDE the
// Astro child: private routes require the per-instance secret main injects.
import { timingSafeEqual } from 'node:crypto';

export function desktopGuard({ token, identity }) {
  if (!token) throw new Error('Desktop token is required');
  const expected = Buffer.from(token);
  const authorized = value => typeof value === 'string' && value.length === token.length
    && timingSafeEqual(Buffer.from(value), expected);
  return {
    name: 'sq-desktop-guard', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const privateRoute = url.pathname.startsWith('/__sq/local/') || url.pathname === '/__sq/desktop-health';
        if (!privateRoute) return next();
        if (!authorized(req.headers['x-sq-desktop-token'])) { res.statusCode = 403; res.end(); return; }
        if (url.pathname === '/__sq/desktop-health') {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(identity)); return;
        }
        next();
      });
      // Preview's Vite websocket is same-origin. Refuse browser upgrades from
      // other sites; trusted project JS already has native Node capability.
      server.httpServer?.prependListener('upgrade', (req, socket) => {
        if (req.headers.origin !== `http://${req.headers.host}`) socket.destroy();
      });
    },
  };
}
