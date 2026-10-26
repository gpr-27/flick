import { describe, expect, it } from 'vitest';
import { firstChunk, previewKindFor } from './previewKind';

describe('previewKindFor', () => {
  it('knows pdf and text, downloads the rest', () => {
    expect(previewKindFor('Report.PDF')).toBe('pdf');
    expect(previewKindFor('notes.txt')).toBe('text');
    expect(previewKindFor('archive.zip')).toBeNull();
    expect(previewKindFor('noext')).toBeNull();
  });
  it('cuts long text at a line end', () => {
    const long = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
    expect(firstChunk(long)).toBe(`${'a'.repeat(1500)}\n...`);
    expect(firstChunk('short')).toBe('short');
  });
});
