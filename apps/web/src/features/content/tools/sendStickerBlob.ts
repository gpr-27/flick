import type { MessageContent } from '@chat/contracts';
import { uploadAttachment } from '@/features/chat/upload';

export const sendStickerBlob = async (
  blob: Blob,
  onSend: (c: MessageContent) => void,
): Promise<void> => {
  const id = await uploadAttachment(blob, {
    purpose: 'message',
    mime: 'image/png',
    fileName: 'sticker.png',
  });
  onSend({ type: 'image', attachment_id: id, width: 384, height: 384, sticker: true });
};
