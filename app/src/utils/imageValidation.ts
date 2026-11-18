/** Maximum allowed image file size (10 MB). */
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;

/** Accepted MIME types for image uploads. */
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

/**
 * Validate an image file for upload.
 * Returns a human-readable error string, or null if valid.
 */
export function validateImageFile(file: File): string | null {
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return `File too large. Max size is ${MAX_IMAGE_FILE_SIZE / 1024 / 1024}MB`;
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Only PNG, JPEG, GIF, WebP, and SVG files are allowed';
  }
  return null;
}

/** Maximum allowed video file size (50 MB — keeps TRANSFER_ASSET and export zips sane). */
const MAX_VIDEO_FILE_SIZE = 50 * 1024 * 1024;

/** Accepted MIME types for video uploads. */
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;

/**
 * Validate a video file for upload.
 * Returns a human-readable error string, or null if valid.
 */
export function validateVideoFile(file: File): string | null {
  if (file.size > MAX_VIDEO_FILE_SIZE) {
    return `File too large. Max size is ${MAX_VIDEO_FILE_SIZE / 1024 / 1024}MB`;
  }
  if (!(ALLOWED_VIDEO_TYPES as readonly string[]).includes(file.type)) {
    return 'Only MP4 and WebM files are allowed';
  }
  return null;
}
