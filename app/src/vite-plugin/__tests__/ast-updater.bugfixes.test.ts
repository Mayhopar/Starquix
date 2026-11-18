/**
 * Bug Fix Tests: ast-updater.ts
 *
 * Tests for Bug #6: CRLF line ending corruption
 */
import { describe, it, expect } from 'vitest';
import { updateClassAttribute, updateTextContent, reorderElements, getElementSource } from '../ast-updater';

describe('Bug #6: CRLF line ending handling', () => {
  const LF_CONTENT = `<div>
  <span class="text-red-500">Hello</span>
</div>`;

  const CRLF_CONTENT = `<div>\r\n  <span class="text-red-500">Hello</span>\r\n</div>`;

  describe('updateClassAttribute', () => {
    it('correctly updates classes in LF files', async () => {
      const result = await updateClassAttribute(
        LF_CONTENT,
        'test.astro',
        { file: 'test.astro', line: 2, column: 3 },
        'text-blue-500'
      );

      expect(result).toContain('class="text-blue-500"');
      expect(result).not.toContain('text-red-500');
      // Should preserve LF line endings
      expect(result).not.toContain('\r\n');
    });

    it('correctly updates classes in CRLF files and preserves line endings', async () => {
      const result = await updateClassAttribute(
        CRLF_CONTENT,
        'test.astro',
        { file: 'test.astro', line: 2, column: 3 },
        'text-blue-500'
      );

      expect(result).toContain('class="text-blue-500"');
      expect(result).not.toContain('text-red-500');
      // Should preserve CRLF line endings
      expect(result).toContain('\r\n');
      // Count CRLF occurrences - should be same as original
      const originalCRLF = (CRLF_CONTENT.match(/\r\n/g) || []).length;
      const resultCRLF = (result.match(/\r\n/g) || []).length;
      expect(resultCRLF).toBe(originalCRLF);
    });

    it('does not corrupt file content on CRLF files', async () => {
      // This test ensures the offset calculation is correct
      // If CRLF handling is wrong, the class update would be at wrong position
      const multiLineCRLF = `<html>\r\n<body>\r\n  <header>\r\n    <nav class="flex gap-4">\r\n      <a href="/">Home</a>\r\n    </nav>\r\n  </header>\r\n</body>\r\n</html>`;

      const result = await updateClassAttribute(
        multiLineCRLF,
        'test.astro',
        { file: 'test.astro', line: 4, column: 5 },
        'flex gap-8 items-center'
      );

      // The nav element should be updated
      expect(result).toContain('class="flex gap-8 items-center"');
      // Other elements should be unchanged
      expect(result).toContain('<header>');
      expect(result).toContain('</header>');
      expect(result).toContain('<a href="/">Home</a>');
    });
  });

  describe('updateTextContent', () => {
    it('preserves CRLF endings when updating text', async () => {
      const content = `<div>\r\n  <p>Old text</p>\r\n</div>`;

      const result = await updateTextContent(
        content,
        'test.astro',
        { file: 'test.astro', line: 2, column: 3 },
        'New text'
      );

      expect(result).toContain('New text');
      expect(result).toContain('\r\n');
    });
  });

  describe('getElementSource', () => {
    it('extracts correct source from CRLF files', () => {
      const content = `<div>\r\n  <span class="test">Content</span>\r\n</div>`;

      const result = getElementSource(content, {
        file: 'test.astro',
        line: 2,
        column: 3
      });

      expect(result.source).toContain('<span');
      expect(result.source).toContain('Content');
      expect(result.source).toContain('</span>');
      expect(result.startLine).toBe(2);
      expect(result.endLine).toBe(2);
    });
  });

  describe('reorderElements', () => {
    it('preserves CRLF endings when reordering', async () => {
      const content = `<div>\r\n  <span>First</span>\r\n  <span>Second</span>\r\n</div>`;

      const result = await reorderElements(
        content,
        [
          { file: 'test.astro', line: 2, column: 3 },
          { file: 'test.astro', line: 3, column: 3 }
        ],
        [1, 0] // Swap order
      );

      // Should preserve CRLF
      expect(result).toContain('\r\n');
      // Content should be reordered
      const firstIndex = result.indexOf('Second');
      const secondIndex = result.indexOf('First');
      expect(firstIndex).toBeLessThan(secondIndex);
    });
  });
});
