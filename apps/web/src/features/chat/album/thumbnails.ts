// Small previews for the tray. They are made one or two at a time, and only for tiles that are
// on screen, so choosing 20 phone photos never freezes the page.
import { makeThumbnail } from '@/lib/imageCompress';

export interface Thumbnail {
  /** An object URL the caller must revoke. */
  url: string;
  durationMs?: number;
}

const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];

const turn = async <T>(job: () => Promise<T>): Promise<T> => {
  if (running >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await job();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
};

/** A frame near the start of a video, plus its length. */
const videoFrame = (file: File, maxSide: number): Promise<{ blob: Blob; durationMs: number }> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const source = URL.createObjectURL(file);
    const cleanup = (): void => {
      URL.revokeObjectURL(source);
      video.removeAttribute('src');
      video.load();
    };
    const fail = (): void => {
      cleanup();
      reject(new Error('This video cannot be read.'));
    };
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onerror = fail;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    };
    video.onseeked = () => {
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const durationMs = Math.max(1, Math.round(video.duration * 1000) || 1);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (blob) resolve({ blob, durationMs });
          else reject(new Error('Could not make a thumbnail'));
        },
        'image/jpeg',
        0.7,
      );
    };
    video.src = source;
  });

/** Makes the preview of an image or video file. Rejects when the browser cannot decode it. */
export const createThumbnail = (file: File, kind: 'image' | 'video'): Promise<Thumbnail> =>
  turn(async () => {
    if (kind === 'video') {
      const { blob, durationMs } = await videoFrame(file, 160);
      return { url: URL.createObjectURL(blob), durationMs };
    }
    return { url: URL.createObjectURL(await makeThumbnail(file)) };
  });

/** 83000 -> "1:23". */
export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
};
