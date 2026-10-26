// "Export chat": reads the whole history page by page and saves it as a .txt transcript
// (or JSON). Runs in the browser with the same API client as the rest of the app.
import { ENDPOINTS, LIMITS, type MessageRecord } from '@chat/contracts';
import { previewContent } from '@/features/chat/content/registry';
import { getAttachmentUrl } from '@/features/chat/content/attachments';
import { getApi } from '@/lib/services';

/** Safety stop: 200 pages of 100 messages. */
const MAX_PAGES = 200;

/** Reads every message, oldest first. `onProgress` gets the running count. */
export async function fetchAllMessages(
  conversationId: string,
  onProgress: (count: number) => void = () => undefined,
): Promise<MessageRecord[]> {
  const all: MessageRecord[] = [];
  let beforeSeq: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await getApi().call(ENDPOINTS.messages.history, {
      params: { conversation_id: conversationId },
      query: { limit: LIMITS.MAX_PAGE_SIZE, ...(beforeSeq ? { before_seq: beforeSeq } : {}) },
    });
    all.push(...res.items);
    onProgress(all.length);
    const lowest = Math.min(...res.items.map((m) => m.seq));
    if (res.items.length < LIMITS.MAX_PAGE_SIZE || lowest <= 1) break;
    beforeSeq = lowest;
  }
  return all.sort((a, b) => a.seq - b.seq);
}

/** The words of one message: its text, or the attachment name / kind. */
export function messageLine(m: MessageRecord): string {
  const c = m.content;
  if (m.deleted_at || !c) return '(message deleted)';
  if (c.type === 'text') return c.text;
  if (c.type === 'file') return `[File: ${c.file_name}]${c.caption ? ` ${c.caption}` : ''}`;
  if (c.type === 'image' || c.type === 'video') {
    return `[${c.type === 'image' ? 'Image' : 'Video'}]${c.caption ? ` ${c.caption}` : ''}`;
  }
  return previewContent(c);
}

const stamp = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "2025-01-31 18:04 - Alice: hello" per message; multi-line texts keep their line breaks. */
export function transcript(
  messages: MessageRecord[],
  nameOf: (userId: string | null) => string,
): string {
  return messages
    .map(
      (m) =>
        `${stamp(m.created_at)} - ${m.sender_user_id ? nameOf(m.sender_user_id) : 'System'}: ${messageLine(m)}`,
    )
    .join('\n');
}

// ── zip export ───────────────────────────────────────────────────────────

export interface AttachmentRef {
  attachmentId: string;
  /** Unique name inside the zip, e.g. "attachments/0003-photo.jpg". */
  path: string;
}

const EXT: Record<string, string> = { image: 'jpg', video: 'mp4', voice: 'm4a', gif: 'gif' };

/** Every message attachment (photo, video, voice, file) with a unique path in the zip. */
export function attachmentRefs(messages: MessageRecord[]): AttachmentRef[] {
  const refs: AttachmentRef[] = [];
  for (const m of messages) {
    const c = m.content;
    if (m.deleted_at || !c) continue;
    if (c.type !== 'image' && c.type !== 'video' && c.type !== 'voice' && c.type !== 'file')
      continue;
    const name =
      c.type === 'file'
        ? c.file_name.replace(/[^\w.-]+/g, '_')
        : `${c.type}.${EXT[c.type] ?? 'bin'}`;
    refs.push({
      attachmentId: c.attachment_id,
      path: `attachments/${String(m.seq).padStart(5, '0')}-${name}`,
    });
  }
  return refs;
}

/** The transcript plus the files that could be fetched, as one .zip. */
export async function buildZip(
  transcriptText: string,
  files: { path: string; data: Uint8Array }[],
): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const entries: Record<string, Uint8Array> = { 'chat.txt': strToU8(transcriptText) };
  for (const f of files) entries[f.path] = f.data;
  const zipped = zipSync(entries, { level: 0 }); // media is already compressed
  return new Blob([zipped], { type: 'application/zip' });
}

/** Downloads each attachment (skipping any that fail) and builds the zip. */
export async function exportZip(
  messages: MessageRecord[],
  transcriptText: string,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<Blob> {
  const refs = attachmentRefs(messages);
  const files: { path: string; data: Uint8Array }[] = [];
  let done = 0;
  for (const ref of refs) {
    try {
      const res = await fetch(await getAttachmentUrl(ref.attachmentId));
      if (res.ok) files.push({ path: ref.path, data: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      /* skip this file; the transcript still names it */
    }
    onProgress(++done, refs.length);
  }
  return buildZip(transcriptText, files);
}
