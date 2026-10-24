// Files go straight to object storage, never through the API or the socket:
//   presign (API) -> POST the file to the returned URL (S3) -> complete (API checks size + type)
// The returned attachment id is what an image/file message refers to.
import { ENDPOINTS, type UploadPurpose } from '@chat/contracts';
import type { z } from 'zod';
import { getApi } from '@/lib/services';

/** fetch has no upload progress, so XMLHttpRequest is used when the caller wants a progress bar. */
const postWithProgress = (
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => {
      reject(new Error('Upload failed. Check your connection.'));
    };
    xhr.send(form);
  });

export const uploadAttachment = async (
  blob: Blob,
  options: {
    purpose: z.infer<typeof UploadPurpose>;
    mime: string;
    fileName: string;
    onProgress?: (fraction: number) => void;
  },
): Promise<string> => {
  const api = getApi();
  const presign = await api.call(ENDPOINTS.media.presignUpload, {
    body: {
      purpose: options.purpose,
      mime: options.mime,
      size: blob.size,
      file_name: options.fileName,
    },
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(presign.fields)) form.append(name, value);
  form.append('file', blob, options.fileName); // S3 requires the file field to come last
  if (options.onProgress) {
    await postWithProgress(presign.url, form, options.onProgress);
  } else {
    const res = await fetch(presign.url, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  }
  await api.call(ENDPOINTS.media.complete, { params: { attachment_id: presign.attachment_id } });
  return presign.attachment_id;
};
