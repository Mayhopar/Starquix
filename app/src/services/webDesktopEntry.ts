// Web demo build (VITE_SQ_WEB=1): install the HTTP bridge as `sqDesktop` before any editor module asks isDesktop().
// Imported first by main.tsx; a no-op in every other build (Electron's preload installs the real one).
import { createWebDesktop, isWebDemo } from './webDesktop';

const g = globalThis as { sqDesktop?: unknown };
if (isWebDemo() && !g.sqDesktop) g.sqDesktop = createWebDesktop(import.meta.env.VITE_SQ_WEB_API || '/api');
