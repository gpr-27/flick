// Pure helpers for the live camera: picking a recording format, naming files, drawing a frame.

/** MP4 first (every phone plays it), then WebM. Undefined means this browser cannot record video. */
export const pickVideoMime = (): string | undefined =>
  ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) =>
    typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported(m) : false,
  );

/** "photo-2026-10-25-04-30-12.jpg": sortable, and never clashes with another capture. */
export const captureFileName = (kind: 'photo' | 'video', mime: string, at = new Date()): string => {
  const stamp = at.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const ext = kind === 'photo' ? 'jpg' : mime.includes('mp4') ? 'mp4' : 'webm';
  return `${kind}-${stamp}.${ext}`;
};

/** mm:ss for the recording timer. */
export const formatTimer = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const MAX_VIDEO_MS = 60_000;

/** The current frame of a playing <video> as a JPEG File. Null if the camera has no picture yet. */
export function takePhoto(video: HTMLVideoElement): Promise<File | null> {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(
          blob
            ? new File([blob], captureFileName('photo', 'image/jpeg'), { type: 'image/jpeg' })
            : null,
        );
      },
      'image/jpeg',
      0.9,
    );
  });
}
