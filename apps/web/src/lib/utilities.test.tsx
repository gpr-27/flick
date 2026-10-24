// Small shared modules: dates, ids, the key-value store, the logger, uploads, image and video
// helpers, waveform maths, notification rules and sound, the notification deep link and the
// toast outlet. Dates are built from local-time parts so the tests pass in any time zone.
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS, type MessageRecord } from '@chat/contracts';
import { AppToaster } from '@/components/ui/Toast';
import { Avatar } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import {
  conversationAvatar,
  conversationTitle,
  presenceLabel,
} from '@/features/chat/conversationView';
import { useChatStore } from '@/features/chat/useChatStore';
import { uploadAttachment } from '@/features/chat/upload';
import { readVideoMeta } from '@/features/content/videoMeta';
import { WAVEFORM_BARS, computeWaveform, reduceSamples } from '@/features/content/waveform';
import { ApiError } from '@/lib/api';
import { groupCallErrorMessage } from '@/features/groupcall/errors';
import {
  MAX_LIVE_AGE_MS,
  SOUND_MIN_GAP_MS,
  canPlaySound,
  excerptOf,
  isMuted,
  mentionsUser,
  shouldNotify,
} from '@/features/notifications/rules';
import { playMessageSound } from '@/features/notifications/sound';
import { useNotificationPrefs } from '@/features/notifications/useNotificationPrefs';
import { useOpenPendingConversation } from '@/features/notifications/useOpenPendingConversation';
import {
  conversationIdFromUrl,
  consumeLaunchParam,
  handleServiceWorkerMessage,
  usePendingOpen,
} from '@/pwa/openFromNotification';
import {
  BOB,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../test/fakes';
import { createMemoryKv, openKv } from './idb';
import { randomId } from './ids';
import { prepareImage } from './imageCompress';
import { logger } from './logger';
import {
  formatDateSeparator,
  formatLastSeen,
  formatMessageTime,
  formatRelativeTime,
  isNewDay,
} from './time';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('time', () => {
  const NOW = new Date(2026, 5, 15, 14, 5, 0); // Monday 15 June 2026, 14:05 local
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('formatMessageTime is a 24-hour HH:MM', () => {
    expect(formatMessageTime(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
    expect(formatMessageTime(new Date(2026, 0, 1, 23, 59))).toBe('23:59');
    expect(formatMessageTime(new Date(2026, 0, 1, 0, 0))).toMatch(/^(00|24):00$/);
  });

  // [name, date, expected]
  const relative: [string, Date | string | null | undefined, string][] = [
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['empty string', '', ''],
    ['10 seconds ago', ago(10_000), 'now'],
    ['59 seconds ago', ago(59_000), 'now'],
    ['a future time', new Date(NOW.getTime() + 5 * MIN), 'now'],
    ['1 minute ago', ago(MIN), '1m'],
    ['59 minutes ago', ago(59 * MIN), '59m'],
    ['3 hours ago, same day', new Date(2026, 5, 15, 11, 0), '3h'],
    ['yesterday evening', new Date(2026, 5, 14, 22, 0), 'Yesterday'],
    [
      '3 days ago',
      new Date(2026, 5, 12, 9, 0),
      new Date(2026, 5, 12).toLocaleDateString('en-US', { weekday: 'short' }),
    ],
    [
      '6 days ago',
      new Date(2026, 5, 9, 9, 0),
      new Date(2026, 5, 9).toLocaleDateString('en-US', { weekday: 'short' }),
    ],
    ['10 days ago', new Date(2026, 5, 5, 9, 0), '6/5'],
    ['last year', new Date(2025, 2, 3, 9, 0), '3/3'],
  ];
  it.each(relative)('formatRelativeTime: %s', (_n, date, expected) => {
    expect(formatRelativeTime(date, NOW)).toBe(expected);
  });

  it('formatRelativeTime defaults to the current clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * MIN))).toBe('5m');
  });

  const separator: [string, Date, string][] = [
    ['today', new Date(2026, 5, 15, 1, 0), 'Today'],
    ['yesterday', new Date(2026, 5, 14, 23, 0), 'Yesterday'],
    ['earlier', new Date(2026, 4, 1, 12, 0), 'May 1, 2026'],
    ['another year', new Date(2024, 11, 31, 12, 0), 'December 31, 2024'],
  ];
  it.each(separator)('formatDateSeparator: %s', (_n, date, expected) => {
    expect(formatDateSeparator(date, NOW)).toBe(expected);
  });

  it('formatLastSeen: today, yesterday, older', () => {
    expect(formatLastSeen(new Date(2026, 5, 15, 9, 5), NOW)).toBe('today at 09:05');
    expect(formatLastSeen(new Date(2026, 5, 14, 20, 30), NOW)).toBe('yesterday at 20:30');
    expect(formatLastSeen(new Date(2026, 4, 2, 8, 0), NOW)).toBe('May 2');
  });

  it('isNewDay: first message, same day, midnight crossing', () => {
    expect(isNewDay(null, new Date(2026, 0, 1))).toBe(true);
    expect(isNewDay(undefined, new Date(2026, 0, 1))).toBe(true);
    expect(isNewDay(new Date(2026, 0, 1, 8), new Date(2026, 0, 1, 23, 59))).toBe(false);
    expect(isNewDay(new Date(2026, 0, 1, 23, 59), new Date(2026, 0, 2, 0, 1))).toBe(true);
    expect(isNewDay(new Date(2026, 0, 1), new Date(2025, 0, 1))).toBe(true);
    expect(isNewDay(new Date(2026, 0, 1).toISOString(), new Date(2026, 0, 1, 5).getTime())).toBe(
      false,
    );
  });

  it('keeps DAY and HOUR constants honest for the table above', () => {
    expect(DAY).toBe(24 * HOUR);
  });
});

describe('ids', () => {
  it('uses randomUUID when available and a unique fallback when not', () => {
    expect(randomId()).toMatch(/^[0-9a-f-]{36}$/);
    vi.stubGlobal('crypto', {});
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe('key-value store', () => {
  it('memory store: put, replace, getAll, delete, clear', async () => {
    const kv = createMemoryKv<{ n: number }>();
    await kv.put('a', { n: 1 });
    await kv.put('b', { n: 2 });
    await kv.put('a', { n: 3 });
    expect(await kv.getAll()).toEqual([{ n: 3 }, { n: 2 }]);
    await kv.delete('a');
    await kv.delete('missing');
    expect(await kv.getAll()).toEqual([{ n: 2 }]);
    await kv.clear();
    expect(await kv.getAll()).toEqual([]);
  });

  it('falls back to memory where IndexedDB does not exist (jsdom)', async () => {
    expect(typeof indexedDB).toBe('undefined');
    const kv = openKv<number>('db', 'store');
    await kv.put('x', 1);
    expect(await kv.getAll()).toEqual([1]);
  });

  describe('with an IndexedDB', () => {
    /** A minimal IndexedDB: enough for open, one object store and four operations. */
    const installFakeIndexedDb = (failOpen = false) => {
      const data = new Map<string, unknown>();
      const request = <T,>(result: T) => {
        const r: { result: T; error: Error | null; onsuccess?: () => void; onerror?: () => void } =
          { result, error: null };
        queueMicrotask(() => r.onsuccess?.());
        return r;
      };
      const objectStore = {
        getAll: () => request([...data.values()]),
        put: (value: unknown, key: string) => request((data.set(key, value), key)),
        delete: (key: string) => request(data.delete(key)),
        clear: () => {
          data.clear();
          return request(undefined);
        },
      };
      const db = {
        transaction: () => ({ objectStore: () => objectStore }),
        createObjectStore: vi.fn(),
      };
      const open = vi.fn(() => {
        const r: {
          result: typeof db;
          error: Error | null;
          onsuccess?: () => void;
          onerror?: () => void;
          onupgradeneeded?: () => void;
        } = {
          result: db,
          error: failOpen ? new Error('blocked') : null,
        };
        queueMicrotask(() => {
          r.onupgradeneeded?.();
          if (failOpen) r.onerror?.();
          else r.onsuccess?.();
        });
        return r;
      });
      vi.stubGlobal('indexedDB', { open });
      return { open, db, data };
    };

    it('creates the store on first open, then reads and writes through it', async () => {
      const { open, db } = installFakeIndexedDb();
      const kv = openKv<{ id: string }>('flick', 'outbox');
      await kv.put('a', { id: 'a' });
      await kv.put('b', { id: 'b' });
      expect(await kv.getAll()).toEqual([{ id: 'a' }, { id: 'b' }]);
      await kv.delete('a');
      expect(await kv.getAll()).toEqual([{ id: 'b' }]);
      await kv.clear();
      expect(await kv.getAll()).toEqual([]);
      expect(open).toHaveBeenCalledTimes(1); // the connection is reused
      expect(db.createObjectStore).toHaveBeenCalledWith('outbox');
    });

    it('a database that cannot be opened rejects instead of hanging', async () => {
      installFakeIndexedDb(true);
      await expect(openKv('flick', 'outbox').getAll()).rejects.toThrow('blocked');
    });
  });
});

describe('logger', () => {
  it('errors and warnings always reach the console, tagged', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.error('boom', 1);
    logger.warn('careful');
    expect(error).toHaveBeenCalledWith('[chat]', 'boom', 1);
    expect(warn).toHaveBeenCalledWith('[chat]', 'careful');
  });

  it('info and debug stay quiet in tests', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    logger.info('x');
    logger.debug('y');
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});

describe('conversation view', () => {
  const direct = makeConversation();
  const group = makeConversation({
    type: 'group',
    title: 'Team',
    peer: null,
    avatar_url: 'https://img/g.png',
  });

  it('titles and avatars for direct, group, missing peer and missing title', () => {
    expect(conversationTitle(direct)).toBe('Bob');
    expect(conversationTitle(group)).toBe('Team');
    expect(conversationTitle({ ...direct, peer: null })).toBe('Unknown');
    expect(conversationTitle({ ...group, title: null })).toBe('Group');
    expect(conversationAvatar(group)).toBe('https://img/g.png');
    expect(conversationAvatar(direct)).toBeNull();
    expect(conversationAvatar({ ...direct, peer: null })).toBeNull();
  });

  it('presence: online, last seen, unknown or hidden', () => {
    expect(presenceLabel(undefined)).toBe('');
    expect(presenceLabel({ online: true, last_seen_at: null })).toBe('Online');
    expect(presenceLabel({ online: false, last_seen_at: null })).toBe('');
    expect(
      presenceLabel({ online: false, last_seen_at: new Date(2020, 0, 5, 10, 0).toISOString() }),
    ).toBe('last seen Jan 5');
  });
});

describe('uploads', () => {
  let api: FakeApi;
  const presign = {
    attachment_id: 'att-1',
    url: 'https://s3.test/upload',
    fields: { key: 'k', policy: 'p' },
  };
  beforeEach(() => {
    ({ api } = installFakeServices());
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(endpoint === ENDPOINTS.media.presignUpload ? presign : undefined),
    );
  });
  const blob = new Blob(['hello'], { type: 'text/plain' });
  const options = { purpose: 'message' as const, mime: 'text/plain', fileName: 'a.txt' };

  it('presign -> POST the form (file last) -> complete, returns the attachment id', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadAttachment(blob, options)).resolves.toBe('att-1');
    expect(api.call).toHaveBeenNthCalledWith(1, ENDPOINTS.media.presignUpload, {
      body: { purpose: 'message', mime: 'text/plain', size: 5, file_name: 'a.txt' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: FormData },
    ];
    expect(url).toBe('https://s3.test/upload');
    expect([...init.body.keys()]).toEqual(['key', 'policy', 'file']);
    expect(api.call).toHaveBeenLastCalledWith(ENDPOINTS.media.complete, {
      params: { attachment_id: 'att-1' },
    });
  });

  it('a refused upload fails and never calls complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
    );
    await expect(uploadAttachment(blob, options)).rejects.toThrow('Upload failed (403)');
    expect(api.call.mock.calls.some((c) => c[0] === ENDPOINTS.media.complete)).toBe(false);
  });

  describe('with a progress callback (XMLHttpRequest)', () => {
    class FakeXhr {
      static last: FakeXhr;
      static count = 0;
      status = 200;
      upload: {
        onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
      } = {};
      onload?: () => void;
      onerror?: () => void;
      open = vi.fn();
      send = vi.fn(() => {
        FakeXhr.last = this;
        FakeXhr.count += 1;
      });
    }
    beforeEach(() => {
      FakeXhr.count = 0;
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
    });

    it('reports progress as a fraction and resolves on 2xx', async () => {
      const onProgress = vi.fn();
      const pending = uploadAttachment(blob, { ...options, onProgress });
      await vi.waitFor(() => {
        expect(FakeXhr.last).toBeDefined();
      });
      FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
      FakeXhr.last.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
      FakeXhr.last.onload?.();
      await expect(pending).resolves.toBe('att-1');
      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(0.25);
      expect(FakeXhr.last.open).toHaveBeenCalledWith('POST', 'https://s3.test/upload');
    });

    it('rejects on a bad status and on a network error', async () => {
      const first = uploadAttachment(blob, { ...options, onProgress: vi.fn() });
      await vi.waitFor(() => {
        expect(FakeXhr.last).toBeDefined();
      });
      FakeXhr.last.status = 500;
      FakeXhr.last.onload?.();
      await expect(first).rejects.toThrow('Upload failed (500)');

      const second = uploadAttachment(blob, { ...options, onProgress: vi.fn() });
      await vi.waitFor(() => {
        expect(FakeXhr.count).toBe(2);
      });
      FakeXhr.last.onerror?.();
      await expect(second).rejects.toThrow('Check your connection');
    });
  });
});

describe('image preparation', () => {
  const file = (size: number, type = 'image/jpeg'): File => {
    const f = new File(['x'], 'p.jpg', { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() });

  it('small files and GIFs go up as they are, with their real size', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap(800, 600))),
    );
    const small = file(100 * 1024);
    expect(await prepareImage(small)).toEqual({ blob: small, width: 800, height: 600 });
    const gif = file(5 * 1024 * 1024, 'image/gif');
    expect((await prepareImage(gif)).blob).toBe(gif);
  });

  it('a big photo is scaled to 1600px on the long side and re-encoded when that is smaller', async () => {
    const source = bitmap(4000, 3000);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(source)),
    );
    const jpeg = new Blob([new Uint8Array(200)], { type: 'image/jpeg' });
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(jpeg);
    });
    const big = file(5 * 1024 * 1024);
    const result = await prepareImage(big);
    expect(result).toEqual({ blob: jpeg, width: 1600, height: 1200 });
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 1600, 1200);
    expect(source.close).toHaveBeenCalled();
  });

  it('keeps the original when re-encoding does not make it smaller, or the canvas is unavailable', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap(2000, 1000))),
    );
    const big = file(400 * 1024);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob([new Uint8Array(500 * 1024)]));
    });
    expect((await prepareImage(big)).blob).toBe(big);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect((await prepareImage(big)).blob).toBe(big);
  });

  it('a photo smaller than the limit is not enlarged', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap(1000, 500))),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    let size = { w: 0, h: 0 };
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb,
    ) {
      size = { w: this.width, h: this.height };
      cb(new Blob([new Uint8Array(10)]));
    });
    await prepareImage(file(400 * 1024));
    expect(size).toEqual({ w: 1000, h: 500 });
  });

  it('falls back to <img> decoding when createImageBitmap fails', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('unsupported'))),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () => Promise.resolve(),
    });
    Object.defineProperty(HTMLImageElement.prototype, 'width', {
      configurable: true,
      get: () => 320,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'height', {
      configurable: true,
      get: () => 240,
    });
    const small = file(1000);
    expect(await prepareImage(small)).toEqual({ blob: small, width: 320, height: 240 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    Reflect.deleteProperty(HTMLImageElement.prototype, 'width');
    Reflect.deleteProperty(HTMLImageElement.prototype, 'height');
  });
});

describe('video metadata', () => {
  const run = (fire: (video: HTMLVideoElement) => void) => {
    URL.createObjectURL = vi.fn(() => 'blob:v');
    URL.revokeObjectURL = vi.fn();
    const created = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = created(tag);
      if (tag === 'video')
        queueMicrotask(() => {
          fire(el as HTMLVideoElement);
        });
      return el;
    });
    return readVideoMeta(new File(['x'], 'v.mp4', { type: 'video/mp4' }));
  };

  it('reads size and length, never zero', async () => {
    const meta = await run((v) => {
      Object.defineProperty(v, 'videoWidth', { value: 1280 });
      Object.defineProperty(v, 'videoHeight', { value: 720 });
      Object.defineProperty(v, 'duration', { value: 12.3456 });
      v.onloadedmetadata?.(new Event('loadedmetadata'));
    });
    expect(meta).toEqual({ width: 1280, height: 720, durationMs: 12346 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:v');
  });

  it('a video with unknown size or length reports 1 (the contract needs positive numbers)', async () => {
    const meta = await run((v) => {
      Object.defineProperty(v, 'duration', { value: Number.NaN });
      v.onloadedmetadata?.(new Event('loadedmetadata'));
    });
    expect(meta).toEqual({ width: 1, height: 1, durationMs: 1 });
  });

  it('an unreadable video rejects with a plain message', async () => {
    await expect(
      run((v) => {
        v.onerror?.(new Event('error'));
      }),
    ).rejects.toThrow('This video cannot be read.');
  });
});

describe('waveform', () => {
  it('reduceSamples: empty, shorter than the bars, scaled to the loudest, loudest per slice', () => {
    expect(reduceSamples([])).toEqual([]);
    expect(reduceSamples([0.5])).toEqual([100]);
    expect(reduceSamples([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(reduceSamples([0.25, -0.5, 1, 0.5], 2)).toEqual([50, 100]);
    expect(reduceSamples([-1, 0.5], 2)).toEqual([100, 50]);
  });

  it('a long clip reduces to exactly 48 bars in 0..100', () => {
    const samples = Array.from({ length: 48_000 }, (_, i) => Math.sin(i / 100));
    const bars = reduceSamples(samples);
    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(Math.max(...bars)).toBe(100);
    expect(bars.every((b) => Number.isInteger(b) && b >= 0 && b <= 100)).toBe(true);
  });

  it('computeWaveform decodes the recording, and returns [] when it cannot', async () => {
    const close = vi.fn(() => Promise.resolve());
    class OkContext {
      decodeAudioData = vi.fn(() =>
        Promise.resolve({ getChannelData: () => Float32Array.from([0, 1, 0.5, 0]) }),
      );
      close = close;
    }
    vi.stubGlobal('AudioContext', OkContext);
    const blob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) } as Blob;
    expect(await computeWaveform(blob, 2)).toEqual([100, 50]);
    expect(close).toHaveBeenCalled();

    class BadContext {
      decodeAudioData = vi.fn(() => Promise.reject(new Error('cannot decode')));
      close = vi.fn(() => Promise.resolve());
    }
    vi.stubGlobal('AudioContext', BadContext);
    expect(await computeWaveform(blob)).toEqual([]);
  });
});

describe('notification rules', () => {
  const NOW = Date.parse('2026-01-01T12:00:00.000Z');
  const msg = (over: Partial<MessageRecord> = {}): MessageRecord =>
    makeMessage({ sender_user_id: BOB, created_at: new Date(NOW - 1000).toISOString(), ...over });
  const input = (over: Partial<Parameters<typeof shouldNotify>[0]> = {}) => ({
    message: msg(),
    myId: ME,
    mutedUntil: null,
    tabHidden: true,
    now: NOW,
    ...over,
  });

  // [name, input override, expected]
  const table: [string, Partial<Parameters<typeof shouldNotify>[0]>, boolean][] = [
    ['hidden tab, live message from someone else', {}, true],
    ['tab is visible', { tabHidden: false }, false],
    ['my own message', { message: msg({ sender_user_id: ME }) }, false],
    ['server-written message (no sender)', { message: msg({ sender_user_id: null }) }, false],
    [
      'deleted message',
      { message: msg({ content: null, deleted_at: '2026-01-01T11:59:59.000Z' }) },
      false,
    ],
    [
      'a system line',
      {
        message: msg({
          content: { type: 'system', event: 'renamed', actor_user_id: BOB, target_user_ids: [] },
        }),
      },
      false,
    ],
    [
      'a call event',
      {
        message: msg({
          content: {
            type: 'call_event',
            call_id: nextId(),
            media: 'audio',
            outcome: 'missed',
            started_at: '2026-01-01T11:00:00.000Z',
            duration_s: 0,
          },
        }),
      },
      false,
    ],
    [
      'a poll vote',
      {
        message: msg({
          content: { type: 'poll_vote', poll_message_id: nextId(), option_indexes: [0] },
        }),
      },
      false,
    ],
    [
      'an old message from catching up',
      { message: msg({ created_at: new Date(NOW - MAX_LIVE_AGE_MS - 1).toISOString() }) },
      false,
    ],
    [
      'exactly at the age limit',
      { message: msg({ created_at: new Date(NOW - MAX_LIVE_AGE_MS).toISOString() }) },
      true,
    ],
    ['muted chat', { mutedUntil: '2999-01-01T00:00:00.000Z' }, false],
    ['mute that has expired', { mutedUntil: '2000-01-01T00:00:00.000Z' }, true],
    [
      'muted but I am mentioned',
      {
        mutedUntil: '2999-01-01T00:00:00.000Z',
        message: msg({ content: { type: 'text', text: 'hi @me', mentions: [ME] } }),
      },
      true,
    ],
    [
      'muted and someone else is mentioned',
      {
        mutedUntil: '2999-01-01T00:00:00.000Z',
        message: msg({ content: { type: 'text', text: 'hi', mentions: [nextId()] } }),
      },
      false,
    ],
  ];
  it.each(table)('shouldNotify: %s', (_n, over, expected) => {
    expect(shouldNotify(input(over))).toBe(expected);
  });

  it('isMuted / mentionsUser edge cases', () => {
    expect(isMuted(null, NOW)).toBe(false);
    expect(isMuted(new Date(NOW).toISOString(), NOW)).toBe(false); // exactly now is over
    expect(mentionsUser(null, ME)).toBe(false);
    expect(
      mentionsUser({ type: 'sticker', sticker_id: 's', url: 'https://x.test/s.png' }, ME),
    ).toBe(false);
  });

  it('canPlaySound: at most one per second', () => {
    expect(canPlaySound(null, 5)).toBe(true);
    expect(canPlaySound(1000, 1000 + SOUND_MIN_GAP_MS - 1)).toBe(false);
    expect(canPlaySound(1000, 1000 + SOUND_MIN_GAP_MS)).toBe(true);
  });

  const excerpts: [string, Parameters<typeof excerptOf>[0], string][] = [
    ['short text', { type: 'text', text: 'hi' }, 'hi'],
    ['image', { type: 'image', attachment_id: 'a', width: 1, height: 1 }, 'Photo'],
    ['video', { type: 'video', attachment_id: 'a', width: 1, height: 1, duration_ms: 1 }, 'Video'],
    [
      'voice',
      { type: 'voice', attachment_id: 'a', duration_ms: 1, waveform: [1] },
      'Voice message',
    ],
    ['file', { type: 'file', attachment_id: 'a', file_name: 'x', size: 1 }, 'File'],
    ['gif', { type: 'gif', gif_id: 'g', url: 'https://x.test/g.gif', width: 1, height: 1 }, 'GIF'],
    ['sticker', { type: 'sticker', sticker_id: 's', url: 'https://x.test/s.png' }, 'Sticker'],
    ['poll', { type: 'poll', question: 'q', options: ['a', 'b'], allow_multiple: false }, 'Poll'],
    [
      'anything else',
      { type: 'system', event: 'renamed', actor_user_id: null, target_user_ids: [] },
      'New message',
    ],
  ];
  it.each(excerpts)('excerptOf: %s', (_n, content, expected) => {
    expect(excerptOf(content)).toBe(expected);
  });

  it('excerptOf shortens long text to 100 characters ending in an ellipsis', () => {
    const out = excerptOf({ type: 'text', text: 'x'.repeat(500) });
    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
    expect(excerptOf({ type: 'text', text: 'y'.repeat(100) })).toBe('y'.repeat(100));
  });
});

describe('message sound', () => {
  it('a browser that refuses audio just stays silent', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(playMessageSound(99_000_000)).toBe(false);
  });

  it('plays two notes, then stays quiet for a second, then plays again', () => {
    const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = vi.fn();
      createGain = () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: (n: unknown) => n,
      });
      createOscillator = () => {
        const o = {
          frequency: { value: 0 },
          connect: (n: unknown) => n,
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(o);
        return o;
      };
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const t0 = 200_000_000;
    expect(playMessageSound(t0)).toBe(true);
    expect(oscillators).toHaveLength(2);
    expect(playMessageSound(t0 + 500)).toBe(false);
    expect(oscillators).toHaveLength(2);
    expect(playMessageSound(t0 + 1000)).toBe(true);
    expect(oscillators).toHaveLength(4);
  });
});

describe('notification preferences storage', () => {
  it('starts with sound on, and survives blocked storage when saving', () => {
    useNotificationPrefs.setState({ sound: true });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      useNotificationPrefs.getState().setSound(false);
    }).not.toThrow();
    expect(useNotificationPrefs.getState().sound).toBe(false);
  });
});

describe('opening a chat from a notification', () => {
  beforeEach(() => {
    usePendingOpen.setState({ conversationId: null });
    useChatStore.getState().reset();
  });

  it.each([
    ['/?c=abc', 'abc'],
    ['https://flick.test/chat?c=abc&x=1', 'abc'],
    ['/', null],
    ['/?c=', ''],
    ['http://[bad', null],
  ])('conversationIdFromUrl(%s)', (url, expected) => {
    expect(conversationIdFromUrl(url)).toBe(expected);
  });

  it('a cold start at ?c= parks the id and cleans the address bar', () => {
    window.history.pushState({}, '', '/chat?c=conv-1');
    consumeLaunchParam();
    expect(usePendingOpen.getState().conversationId).toBe('conv-1');
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/chat');
    window.history.pushState({}, '', '/');
  });

  it('no ?c= leaves things alone', () => {
    consumeLaunchParam();
    expect(usePendingOpen.getState().conversationId).toBeNull();
  });

  it('a message from the worker is used only when it is an open-url with a conversation', () => {
    handleServiceWorkerMessage(
      new MessageEvent('message', { data: { type: 'other', url: '/?c=x' } }),
    );
    handleServiceWorkerMessage(new MessageEvent('message', { data: { type: 'open-url', url: 5 } }));
    handleServiceWorkerMessage(new MessageEvent('message', { data: null }));
    handleServiceWorkerMessage(
      new MessageEvent('message', { data: { type: 'open-url', url: '/' } }),
    );
    expect(usePendingOpen.getState().conversationId).toBeNull();
    handleServiceWorkerMessage(
      new MessageEvent('message', { data: { type: 'open-url', url: '/?c=conv-2' } }),
    );
    expect(usePendingOpen.getState().conversationId).toBe('conv-2');
  });

  describe('opening it in the app', () => {
    it('waits for the chat list, then opens a known chat and forgets the request', () => {
      const conv = makeConversation({ id: nextId() });
      usePendingOpen.setState({ conversationId: conv.id });
      renderHook(() => {
        useOpenPendingConversation();
      });
      expect(useChatStore.getState().selectedId).toBeNull(); // list not ready
      installFakeServices();
      act(() => {
        useChatStore.setState({ listStatus: 'ready', conversations: { [conv.id]: conv } });
      });
      expect(useChatStore.getState().selectedId).toBe(conv.id);
      expect(usePendingOpen.getState().conversationId).toBeNull();
    });

    it('drops a stale id for a chat that is not in the list', () => {
      usePendingOpen.setState({ conversationId: 'gone' });
      useChatStore.setState({ listStatus: 'ready' });
      renderHook(() => {
        useOpenPendingConversation();
      });
      expect(useChatStore.getState().selectedId).toBeNull();
      expect(usePendingOpen.getState().conversationId).toBeNull();
    });
  });
});

describe('group call error messages', () => {
  const err = (status: number, code = 'X') =>
    new ApiError({ status, code, message: 'm', retryable: false });
  it.each([
    [err(503), 'Group calls are not set up on this server yet.'],
    [err(501), 'Group calls are not set up on this server yet.'],
    [err(400, 'FEATURE_DISABLED'), 'Group calls are not set up on this server yet.'],
    [err(409, 'GROUP_FULL'), 'This call is full.'],
    [err(403), 'You are not allowed to join this call.'],
    [err(404), 'This call or link no longer exists.'],
    [err(410), 'This call or link no longer exists.'],
    [err(429), 'Too many attempts. Wait a moment and try again.'],
    [err(0), 'No connection. Check your network and try again.'],
    [err(500), 'Could not join the call. Please try again.'],
    [new Error('x'), 'Could not join the call. Please try again.'],
    ['text', 'Could not join the call. Please try again.'],
  ])('%#', (error, message) => {
    expect(groupCallErrorMessage(error)).toBe(message);
  });
});

describe('avatar and toasts', () => {
  it('uses the default picture without a src and when the image fails, once', () => {
    const { container } = render(<Avatar name="Ann" src="https://img.test/a.png" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('alt', 'Ann');
    expect(img).toHaveAttribute('src', 'https://img.test/a.png');
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(img.getAttribute('src')).toBe('/avatar.png');
    const { container: bare } = render(<Avatar name="" />);
    expect(bare.querySelector('img')).toHaveAttribute('src', '/avatar.png');
  });

  it('shows no online dot unless asked; sizes map to classes', () => {
    const { container } = render(<Avatar name="" size="xl" online />);
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveClass('size-28');
  });

  it('notify shows success, error and info toasts as polite status messages', async () => {
    render(<AppToaster />);
    act(() => {
      notify.success('Saved');
      notify.error('Nope');
      notify.info('FYI');
    });
    for (const text of ['Saved', 'Nope', 'FYI']) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(3);
  });
});
