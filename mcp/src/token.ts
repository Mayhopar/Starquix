import { randomBytes } from 'node:crypto';

/** 96-bit random pairing token, hex. Node-only (the editor never generates one). */
export function generateToken(): string {
  return randomBytes(12).toString('hex');
}
