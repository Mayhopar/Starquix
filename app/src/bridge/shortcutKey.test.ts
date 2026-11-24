/**
 * THE key identity the editor and the iframe relay share (findings #23, #24): case-insensitive; a combo keeps the
 * layout's own Latin letter (AZERTY ⌘Z is the key labelled Z, code KeyW); a key that types no Latin letter or digit
 * falls back to its physical key — a Cyrillic/Greek letter to its KeyX, AZERTY's digit-row symbols to their DigitN.
 */
import { describe, it, expect } from 'vitest';
import { shortcutKey } from './shortcutKey';

describe('shortcutKey', () => {
  it.each([
    ['z', 'KeyZ', 'z', 'QWERTY'],
    ['Z', 'KeyZ', 'z', 'Shift or Caps Lock'],
    ['z', 'KeyW', 'z', 'AZERTY: the key labelled Z'],
    ['q', 'KeyA', 'q', 'AZERTY: the key labelled Q is not A'],
    ['я', 'KeyZ', 'z', 'Russian'],
    ['Я', 'KeyZ', 'z', 'Russian with Shift'],
    ['м', 'KeyV', 'v', 'Russian/Ukrainian'],
    ['ρ', 'KeyR', 'r', 'Greek'],
    ['&', 'Digit1', '1', 'AZERTY digit row'],
    ['é', 'Digit2', '2', 'AZERTY digit row'],
    ['1', 'Digit1', '1', 'QWERTY digit'],
    ['!', 'Digit1', '1', 'QWERTY Shift+1 (the shifted check is the caller\'s)'],
    [';', 'KeyZ', ';', 'Dvorak: punctuation on a letter key stays punctuation'],
    ['=', 'Equal', '=', 'other symbols as typed'],
    ['Enter', 'Enter', 'Enter', 'named keys as they are'],
  ])('%s on %s is %s (%s)', (key, code, identity) => {
    expect(shortcutKey({ key, code })).toBe(identity);
  });

  it('an Alt/AltGr character stays itself: Polish AltGr+Z types ż, not Ctrl+Z', () => {
    expect(shortcutKey({ key: 'ż', code: 'KeyZ', altKey: true })).toBe('ż');
  });
});
