import { describe, it, expect } from 'vitest';
import { encodePairingCode, decodePairingCode } from './protocol';
import { generateToken } from './token';

describe('pairing code', () => {
  it('round-trips port + token', () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{24}$/); // 96 bits hex
    const code = encodePairingCode(43110, token);
    expect(decodePairingCode(code)).toEqual({ port: 43110, token });
  });
  it('is case-insensitive and ignores dashes/spaces when decoding', () => {
    const token = generateToken();
    const code = encodePairingCode(5000, token);
    expect(decodePairingCode(code.toLowerCase().replace(/-/g, ' '))).toEqual({ port: 5000, token });
  });
  it('rejects garbage', () => {
    expect(decodePairingCode('nope')).toBeNull();
    expect(decodePairingCode('')).toBeNull();
    expect(decodePairingCode('zzzzz.' + 'a'.repeat(24))).toBeNull(); // port > 65535
  });
});
