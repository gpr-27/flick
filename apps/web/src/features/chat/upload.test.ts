import { describe, expect, it } from 'vitest';
import { ANY_FILE_ACCEPT, attachmentKindFor, mimeForFile } from './upload';

describe('attachment types', () => {
  it('accepts every file in a picker', () => {
    expect(ANY_FILE_ACCEPT).toBe('*/*');
  });

  it('keeps the browser type and falls back to the extension, then to octet-stream', () => {
    expect(mimeForFile({ name: 'a.png', type: 'image/png' })).toBe('image/png');
    expect(mimeForFile({ name: 'IMG_1.HEIC', type: '' })).toBe('image/heic');
    expect(mimeForFile({ name: 'movie.mkv', type: '' })).toBe('video/x-matroska');
    expect(mimeForFile({ name: 'song.flac', type: '' })).toBe('audio/flac');
    expect(mimeForFile({ name: 'mystery.xyz', type: '' })).toBe('application/octet-stream');
    expect(mimeForFile({ name: 'noext', type: '' })).toBe('application/octet-stream');
  });

  it('sends drawable photos and playable videos inline and the rest as files', () => {
    expect(attachmentKindFor({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image');
    expect(attachmentKindFor({ name: 'a.avif', type: '' })).toBe('image');
    expect(attachmentKindFor({ name: 'a.mp4', type: 'video/mp4' })).toBe('video');
    for (const name of [
      'a.heic',
      'a.tiff',
      'a.svg',
      'a.dng',
      'a.mkv',
      'a.avi',
      'a.3gp',
      'a.flac',
      'a.docx',
      'a.xyz',
    ]) {
      expect(attachmentKindFor({ name, type: '' })).toBe('file');
    }
  });
});
