/** Width, height and length of a video file, read by the browser (the message needs all three). */
export const readVideoMeta = (
  file: File,
): Promise<{ width: number; height: number; durationMs: number }> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (): void => {
      URL.revokeObjectURL(url);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth || 1,
        height: video.videoHeight || 1,
        durationMs: Math.max(1, Math.round(video.duration * 1000) || 1),
      };
      done();
      resolve(meta);
    };
    video.onerror = () => {
      done();
      reject(new Error('This video cannot be read.'));
    };
    video.src = url;
  });
