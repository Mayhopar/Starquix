import { describe, it, expect } from 'vitest';
import { validateImageFile, validateVideoFile, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from './imageValidation';

function mockFile(size: number, type: string): File {
  const blob = new Blob(['x'.repeat(Math.min(size, 100))], { type });
  return Object.defineProperty(blob, 'size', { value: size }) as File;
}

describe('validateImageFile', () => {
  describe('allowed types', () => {
    it.each([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ] as const)('accepts %s', (type) => {
      expect(validateImageFile(mockFile(1024, type))).toBeNull();
    });
  });

  describe('blocked types', () => {
    it('rejects text/html', () => {
      expect(validateImageFile(mockFile(1024, 'text/html'))).toContain('Only PNG');
    });

    it('rejects application/javascript', () => {
      expect(validateImageFile(mockFile(1024, 'application/javascript'))).toContain('Only PNG');
    });

    it('rejects application/pdf', () => {
      expect(validateImageFile(mockFile(1024, 'application/pdf'))).toContain('Only PNG');
    });

    it('rejects empty MIME type', () => {
      expect(validateImageFile(mockFile(1024, ''))).toContain('Only PNG');
    });
  });

  describe('file size', () => {
    it('accepts file under 10MB', () => {
      expect(validateImageFile(mockFile(5 * 1024 * 1024, 'image/png'))).toBeNull();
    });

    it('accepts file at exactly 10MB', () => {
      expect(validateImageFile(mockFile(10 * 1024 * 1024, 'image/png'))).toBeNull();
    });

    it('rejects file over 10MB', () => {
      const result = validateImageFile(mockFile(10 * 1024 * 1024 + 1, 'image/png'));
      expect(result).toContain('too large');
      expect(result).toContain('10MB');
    });

    it('checks size before type (size error takes priority)', () => {
      const result = validateImageFile(mockFile(10 * 1024 * 1024 + 1, 'text/html'));
      expect(result).toContain('too large');
    });
  });

  describe('ALLOWED_IMAGE_TYPES export', () => {
    it('contains exactly 5 MIME types', () => {
      expect(ALLOWED_IMAGE_TYPES).toHaveLength(5);
    });

    it('includes standard web image formats', () => {
      expect(ALLOWED_IMAGE_TYPES).toContain('image/png');
      expect(ALLOWED_IMAGE_TYPES).toContain('image/jpeg');
      expect(ALLOWED_IMAGE_TYPES).toContain('image/webp');
    });
  });
});

describe('validateVideoFile', () => {
  it.each(['video/mp4', 'video/webm'] as const)('accepts %s', (type) => {
    expect(validateVideoFile(mockFile(1024, type))).toBeNull();
  });

  it('rejects video/quicktime', () => {
    expect(validateVideoFile(mockFile(1024, 'video/quicktime'))).toContain('Only MP4');
  });

  it('rejects image/png', () => {
    expect(validateVideoFile(mockFile(1024, 'image/png'))).toContain('Only MP4');
  });

  it('accepts a file at exactly 50MB', () => {
    expect(validateVideoFile(mockFile(50 * 1024 * 1024, 'video/mp4'))).toBeNull();
  });

  it('rejects a file over 50MB', () => {
    const result = validateVideoFile(mockFile(50 * 1024 * 1024 + 1, 'video/mp4'));
    expect(result).toContain('too large');
    expect(result).toContain('50MB');
  });

  it('ALLOWED_VIDEO_TYPES is mp4 + webm', () => {
    expect(ALLOWED_VIDEO_TYPES).toEqual(['video/mp4', 'video/webm']);
  });
});
