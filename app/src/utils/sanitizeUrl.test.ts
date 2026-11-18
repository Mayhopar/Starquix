import { describe, it, expect } from 'vitest';
import { sanitizeUrl } from './sanitizeUrl';

describe('sanitizeUrl', () => {
  describe('valid URLs', () => {
    it('passes http URLs', () => {
      expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
    });

    it('passes https URLs', () => {
      expect(sanitizeUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    });

    it('passes relative URLs', () => {
      expect(sanitizeUrl('/images/photo.png')).toBe('/images/photo.png');
    });

    it('passes anchor-only URLs', () => {
      expect(sanitizeUrl('#section')).toBe('#section');
    });

    it('passes mailto: URLs', () => {
      expect(sanitizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
    });

    it('passes tel: URLs', () => {
      expect(sanitizeUrl('tel:+1234567890')).toBe('tel:+1234567890');
    });

    it('passes data:image/ URLs (allowed)', () => {
      expect(sanitizeUrl('data:image/png;base64,iVBOR')).toBe('data:image/png;base64,iVBOR');
    });

    it('passes data:image/svg+xml URLs', () => {
      expect(sanitizeUrl('data:image/svg+xml,%3Csvg%3E')).toBe('data:image/svg+xml,%3Csvg%3E');
    });
  });

  describe('blocked schemes', () => {
    it('blocks javascript: URLs', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    });

    it('blocks javascript: with mixed case', () => {
      expect(sanitizeUrl('JavaScript:alert(1)')).toBeNull();
    });

    it('blocks javascript: uppercase', () => {
      expect(sanitizeUrl('JAVASCRIPT:void(0)')).toBeNull();
    });

    it('blocks vbscript: URLs', () => {
      expect(sanitizeUrl('vbscript:MsgBox("XSS")')).toBeNull();
    });

    it('blocks vbscript: mixed case', () => {
      expect(sanitizeUrl('VbScript:MsgBox("XSS")')).toBeNull();
    });

    it('blocks file: URLs', () => {
      expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
    });

    it('blocks file: mixed case', () => {
      expect(sanitizeUrl('FILE:///C:/Windows/system32')).toBeNull();
    });

    it('blocks data:text/html with comma', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    });

    it('blocks data:text/html with semicolon (base64)', () => {
      expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    });

    it('blocks data:text/html with colon', () => {
      expect(sanitizeUrl('data:text/html:something')).toBeNull();
    });

    it('blocks data:text/html mixed case', () => {
      expect(sanitizeUrl('Data:Text/HTML,<img onerror=alert(1)>')).toBeNull();
    });

    it('blocks data:text/html with no suffix', () => {
      expect(sanitizeUrl('data:text/html')).toBeNull();
    });
  });

  describe('whitespace handling', () => {
    it('trims leading spaces', () => {
      expect(sanitizeUrl('  https://example.com')).toBe('https://example.com');
    });

    it('trims trailing spaces', () => {
      expect(sanitizeUrl('https://example.com  ')).toBe('https://example.com');
    });

    it('trims leading spaces before blocking', () => {
      expect(sanitizeUrl('  javascript:alert(1)')).toBeNull();
    });
  });

  describe('falsy input', () => {
    it('returns empty string for empty string', () => {
      expect(sanitizeUrl('')).toBe('');
    });
  });
});
