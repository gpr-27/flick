// The small icon in front of a chat's last-message line for photos, voice notes, video and polls.
import {
  BarChart3,
  Camera,
  File as FileIcon,
  Image as ImageIcon,
  Mic,
  Phone,
  Smile,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { MessageContent } from '@chat/contracts';

const ICONS: Partial<Record<MessageContent['type'], LucideIcon>> = {
  image: Camera,
  video: Video,
  voice: Mic,
  poll: BarChart3,
  file: FileIcon,
  gif: ImageIcon,
  sticker: Smile,
  call_event: Phone,
};

/** Null for plain text (no icon). */
export const PreviewIcon = ({ content }: { content: MessageContent | null }) => {
  const Icon = content ? ICONS[content.type] : undefined;
  return Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null;
};
