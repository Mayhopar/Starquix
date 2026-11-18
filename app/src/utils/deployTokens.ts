// src/utils/deployTokens.ts
// A Vercel token saved by the retired token form (docs/plans/2026-10-20-publish-sheet-design.md S2): the AI deploy_project tool still reads it.

type Platform = 'vercel';

const KEYS: Record<Platform, string> = {
  vercel: 'starquix:vercel-token',
};

export function getToken(platform: Platform): string | null {
  try {
    return localStorage.getItem(KEYS[platform]);
  } catch {
    return null;
  }
}
