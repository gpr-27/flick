import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTranslations, translationTokenBudget } from '../src/modules/ai/translation.js';
import {
  WhisperError,
  audioFileName,
  callWhisper,
  isTranscribable,
  tooLargeMessage,
  transcribeBytes,
  whisperLanguage,
} from '../src/modules/ai/transcripts.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audioFileName', () => {
  it.each([
    ['audio/webm;codecs=opus', 'voice.webm'],
    ['audio/ogg', 'voice.ogg'],
    ['audio/mp4', 'voice.m4a'],
    ['audio/x-m4a', 'voice.m4a'],
    ['audio/mpeg', 'voice.mp3'],
    ['audio/wav', 'voice.wav'],
    ['video/mp4', 'voice.m4a'],
    [null, 'voice.webm'],
    ['application/octet-stream', 'voice.webm'],
  ])('%s -> %s', (mime, name) => {
    expect(audioFileName(mime)).toBe(name);
  });
});

describe('callWhisper', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const stub = (status: number, body: unknown = {}) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('sends the file with a matching extension and the turbo model, and detects the language', async () => {
    const fetchMock = stub(200, { text: ' హలో ', language: 'telugu', duration: 4.2 });
    const result = await callWhisper('key', bytes, 'audio/mp4');
    expect(result).toEqual({ text: 'హలో', language: 'Telugu', durationMs: 4200 });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const init = calls[0]![1];
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('voice.m4a');
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBeNull(); // auto-detect
  });

  it('passes a language hint when one is given', async () => {
    const fetchMock = stub(200, { text: 'x' });
    await callWhisper('key', bytes, 'audio/webm', 'te');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect((calls[0]![1].body as FormData).get('language')).toBe('te');
  });

  it('returns empty text for silence instead of failing', async () => {
    stub(200, { text: '  ', language: 'english' });
    expect((await callWhisper('key', bytes, 'audio/webm')).text).toBe('');
  });

  it.each([
    [429, 'rate_limited'],
    [413, 'too_large'],
    [400, 'unsupported'],
    [500, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    stub(status);
    await expect(callWhisper('key', bytes, 'audio/webm')).rejects.toMatchObject({
      name: 'WhisperError',
      kind,
    });
  });

  it('refuses empty and oversized audio without calling Groq', async () => {
    const fetchMock = stub(200);
    await expect(callWhisper('key', new Uint8Array(), 'audio/webm')).rejects.toBeInstanceOf(
      WhisperError,
    );
    await expect(
      callWhisper('key', new Uint8Array(26 * 1024 * 1024), 'audio/webm'),
    ).rejects.toMatchObject({ kind: 'too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a network failure into a readable error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('socket hang up')));
    await expect(callWhisper('key', bytes, 'audio/webm')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

describe('parseTranslations', () => {
  it('reads a JSON array, also inside a code fence or after a sentence', () => {
    expect(parseTranslations('["నమస్కారం","😀𝒳"]', 2)).toEqual(['నమస్కారం', '😀𝒳']);
    expect(parseTranslations('```json\n["a"]\n```', 1)).toEqual(['a']);
    expect(parseTranslations('Here you go: ["a","b"]', 2)).toEqual(['a', 'b']);
  });

  it('gives null for a wrong count, an empty item or a non-string', () => {
    expect(parseTranslations('["a"]', 2)).toEqual([null, null]);
    expect(parseTranslations('["a",""," ",1]', 4)).toEqual(['a', null, null, null]);
  });

  it('accepts a plain answer for a single text, but not broken JSON', () => {
    expect(parseTranslations('नमस्ते, आप कैसे हैं?', 1)).toEqual(['नमस्ते, आप कैसे हैं?']);
    expect(parseTranslations('["unterminated', 1)).toEqual([null]);
    expect(parseTranslations('plain', 2)).toEqual([null, null]);
  });
});

describe('translationTokenBudget', () => {
  it('grows with the text, for scripts that need many tokens per character', () => {
    expect(translationTokenBudget(['hi'])).toBe(1_000);
    expect(translationTokenBudget(['a'.repeat(1_000)])).toBe(4_200);
    expect(translationTokenBudget(['a'.repeat(100_000)])).toBe(8_000);
  });
});

describe('transcribeBytes', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const answers = (...replies: { text: string; language: string }[]) => {
    const fetchMock = vi.fn();
    for (const r of replies) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r)));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const modelOf = (fetchMock: ReturnType<typeof vi.fn>, call: number): unknown =>
    ((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as FormData).get('model');

  it('asks the accurate model again when the fast one hears an Indian language', async () => {
    const fetchMock = answers(
      { text: 'नामस्कारम', language: 'hindi' },
      { text: 'నమస్కారం', language: 'telugu' },
    );
    const result = await transcribeBytes('key', bytes, 'audio/webm');
    expect(result).toMatchObject({ text: 'నమస్కారం', language: 'Telugu' });
    expect(modelOf(fetchMock, 0)).toBe('whisper-large-v3-turbo');
    expect(modelOf(fetchMock, 1)).toBe('whisper-large-v3');
  });

  it('keeps the fast answer when the accurate call fails, and makes one call for English or a hint', async () => {
    const failing = answers({ text: 'नमस्ते', language: 'hindi' });
    failing.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect((await transcribeBytes('key', bytes, 'audio/webm')).text).toBe('नमस्ते');

    const english = answers({ text: 'hello', language: 'english' });
    await transcribeBytes('key', bytes, 'audio/webm');
    expect(english).toHaveBeenCalledTimes(1);

    const hinted = answers({ text: 'నమస్కారం', language: 'telugu' });
    await transcribeBytes('key', bytes, 'audio/webm', 'te');
    expect(hinted).toHaveBeenCalledTimes(1);
  });
});

describe('whisperLanguage', () => {
  it('maps names and codes, and ignores anything else', () => {
    expect(whisperLanguage('Telugu')).toBe('te');
    expect(whisperLanguage(' hindi ')).toBe('hi');
    expect(whisperLanguage('EN')).toBe('en');
    expect(whisperLanguage('Klingon')).toBeUndefined();
    expect(whisperLanguage(undefined)).toBeUndefined();
  });
});

describe('what can be transcribed', () => {
  it('accepts voice notes and audio, never videos', () => {
    expect(isTranscribable('voice', 'video/webm')).toBe(true); // a voice note in a webm container
    expect(isTranscribable('file', 'audio/mpeg')).toBe(true);
    expect(isTranscribable(null, 'audio/webm')).toBe(true); // dictation
    expect(isTranscribable('video', 'video/mp4')).toBe(false);
    expect(isTranscribable('video', 'audio/mp4')).toBe(false);
    expect(isTranscribable('file', 'video/mp4')).toBe(false);
    expect(isTranscribable('file', 'application/pdf')).toBe(false);
  });

  it('states the size and the limit when audio is too large', () => {
    expect(tooLargeMessage(31 * 1024 * 1024)).toMatch(/This audio is 31 MB; the limit is 25 MB/);
  });
});
