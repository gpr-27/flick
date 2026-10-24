// How each message content type is drawn. One entry per type, keyed by `content.type`.
//
// Adding a feature (polls, GIFs, voice notes, ...) means adding ONE entry here; no
// other file changes. A type with no entry falls back to a plain "unsupported" line, so a newer
// server never breaks an older client.
import { File as FileIcon, ImageOff, Phone, PhoneMissed, Video } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { ContentType, MessageContent } from '@chat/contracts';
import { ReloadButton, Spinner } from '@/components/ui';
import { RemoteImage, VideoView } from '@/features/content/MediaViews';
import { LinkPreviewCard } from '@/features/content/LinkPreviewCard';
import { firstUrl } from '@/features/content/urls';
import { PollView } from '@/features/content/polls/PollView';
import { ViewOnce } from '@/features/content/ViewOnce';
import { VoicePlayer } from '@/features/content/voice/VoicePlayer';
import { MentionText } from '../../organise/MentionViews';
import { useChatStore, userName } from '../useChatStore';
import { getAttachmentUrl, refreshAttachmentUrl, useAttachmentUrl } from './attachments';

export interface ContentContext {
  /** Open an image attachment in the lightbox. */
  onOpenImage: (attachmentId: string) => void;
  /** Which message is being drawn; polls and view-once need it. */
  message?: { id: string; conversationId: string; isMine: boolean };
}

type Of<T extends ContentType> = Extract<MessageContent, { type: T }>;

export interface ContentRenderer<T extends ContentType> {
  render: (content: Of<T>, context: ContentContext) => ReactNode;
  /** One line for the chat list and reply quotes. */
  preview: (content: Of<T>) => string;
}

const formatBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

// ── text ──────────────────────────────────────────────────────────────────

const TextView = ({ content }: { content: Of<'text'> }) => {
  const users = useChatStore((s) => s.users);
  // "@flick" is the AI bot, which may not be in the user cache.
  const known = useMemo(
    () => new Set(['flick', ...Object.values(users).map((u) => u.username)]),
    [users],
  );
  const url = firstUrl(content.text);
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
        <MentionText text={content.text} known={known} />
      </p>
      {url && <LinkPreviewCard url={url} />}
    </>
  );
};

const text: ContentRenderer<'text'> = {
  render: (c) => <TextView content={c} />,
  preview: (c) => c.text,
};

// ── image ─────────────────────────────────────────────────────────────────

const ImageView = ({ content, context }: { content: Of<'image'>; context: ContentContext }) => {
  const { url, failed, fail, reload } = useAttachmentUrl(content.attachment_id);
  const box = { aspectRatio: `${content.width} / ${content.height}` };
  return (
    <div>
      {url ? (
        <button
          type="button"
          onClick={() => {
            context.onOpenImage(content.attachment_id);
          }}
          className="block cursor-zoom-in"
          aria-label="Open image"
        >
          <img
            src={url}
            alt={content.caption ?? 'Image'}
            loading="lazy"
            onError={fail}
            width={content.width}
            height={content.height}
            style={box}
            className="block h-auto max-h-80 w-auto max-w-[18rem] rounded-xl object-contain"
          />
        </button>
      ) : (
        <div
          style={box}
          className="grid max-h-80 w-56 place-items-center rounded-xl bg-base-content/10 text-base-content/50"
        >
          {failed ? (
            <div className="flex flex-col items-center gap-1">
              <ImageOff className="size-6" aria-label="Image unavailable" />
              <ReloadButton onClick={reload} label="Reload image" />
            </div>
          ) : (
            <Spinner size="sm" label="Loading image" />
          )}
        </div>
      )}
      {content.caption && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {content.caption}
        </p>
      )}
    </div>
  );
};

const image: ContentRenderer<'image'> = {
  render: (c, context) => <ImageView content={c} context={context} />,
  preview: (c) => (c.caption ? `Photo: ${c.caption}` : 'Photo'),
};

// ── file ──────────────────────────────────────────────────────────────────

const FileView = ({ content }: { content: Of<'file'> }) => {
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // After a failure always ask for a fresh signed link instead of the cached one.
          const load = failed ? refreshAttachmentUrl : getAttachmentUrl;
          void load(content.attachment_id).then(
            (url) => {
              setFailed(false);
              window.open(url, '_blank', 'noopener');
            },
            () => {
              setFailed(true);
            },
          );
        }}
        className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-left"
        aria-label={`Download ${content.file_name}`}
      >
        <FileIcon className="size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{content.file_name}</span>
          <span className="block text-xs opacity-70">{formatBytes(content.size)}</span>
        </span>
      </button>
      {failed && (
        <p role="alert" className="mt-1 text-xs">
          Couldn&apos;t get this file. Tap the file to try again with a fresh link.
        </p>
      )}
      {content.caption && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {content.caption}
        </p>
      )}
    </div>
  );
};

const file: ContentRenderer<'file'> = {
  render: (c) => <FileView content={c} />,
  preview: (c) => c.file_name,
};

// ── video, voice, gif, sticker, poll ─────────────────────────────────────

const video: ContentRenderer<'video'> = {
  render: (c) => (
    <VideoView
      attachmentId={c.attachment_id}
      width={c.width}
      height={c.height}
      caption={c.caption}
    />
  ),
  preview: (c) => (c.caption ? `Video: ${c.caption}` : 'Video'),
};

const voice: ContentRenderer<'voice'> = {
  render: (c) => (
    <VoicePlayer attachmentId={c.attachment_id} durationMs={c.duration_ms} waveform={c.waveform} />
  ),
  preview: () => 'Voice message',
};

const gif: ContentRenderer<'gif'> = {
  render: (c) => (
    <RemoteImage url={c.url} label="GIF" width={c.width} height={c.height} caption={c.caption} />
  ),
  preview: () => 'GIF',
};

const sticker: ContentRenderer<'sticker'> = {
  render: (c) => <RemoteImage url={c.url} label="Sticker" sticker />,
  preview: () => 'Sticker',
};

const poll: ContentRenderer<'poll'> = {
  render: (c, context) =>
    context.message ? (
      <PollView
        poll={c}
        conversationId={context.message.conversationId}
        messageId={context.message.id}
      />
    ) : null,
  preview: (c) => `Poll: ${c.question}`,
};

// ── written by the server ─────────────────────────────────────────────────

const SYSTEM_TEXT: Record<Of<'system'>['event'], string> = {
  group_created: 'created the group',
  member_added: 'added',
  member_removed: 'removed',
  member_left: 'left',
  role_changed: 'changed the role of',
  renamed: 'renamed the group',
  timer_changed: 'changed the disappearing-messages timer',
};

const systemText = (c: Of<'system'>, users: Parameters<typeof userName>[0]): string => {
  const actor = userName(users, c.actor_user_id);
  const targets = c.target_user_ids.map((id) => userName(users, id)).join(', ');
  return `${actor} ${SYSTEM_TEXT[c.event]}${targets ? ` ${targets}` : ''}`;
};

const SystemView = ({ content }: { content: Of<'system'> }) => {
  const users = useChatStore((s) => s.users);
  return <p className="text-center text-xs italic opacity-80">{systemText(content, users)}</p>;
};

const system: ContentRenderer<'system'> = {
  render: (c) => <SystemView content={c} />,
  preview: (c) => SYSTEM_TEXT[c.event],
};

const callLabel = (c: Of<'call_event'>): string => {
  const kind = c.group ? 'group call' : c.media === 'video' ? 'video call' : 'voice call';
  if (c.outcome === 'started') return `Started a ${kind}`;
  if (c.outcome === 'missed') return `Missed ${kind}`;
  if (c.outcome === 'declined') return `Declined ${kind}`;
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}, ${Math.max(1, Math.round(c.duration_s / 60))} min`;
};

const callEvent: ContentRenderer<'call_event'> = {
  render: (c) => {
    const Icon = c.outcome === 'missed' ? PhoneMissed : c.media === 'video' ? Video : Phone;
    return (
      <p className="flex items-center gap-2 text-sm">
        <Icon className="size-4" aria-hidden="true" />
        {callLabel(c)}
      </p>
    );
  },
  preview: callLabel,
};

// ── the registry ──────────────────────────────────────────────────────────

type Registry = { [T in ContentType]?: ContentRenderer<T> };

const registry: Registry = {
  text,
  image,
  video,
  file,
  voice,
  gif,
  sticker,
  poll,
  system,
  call_event: callEvent,
};

const VIEW_ONCE_NOUN: Partial<Record<ContentType, string>> = {
  image: 'photo',
  video: 'video',
  voice: 'voice message',
};

const rendererFor = (content: MessageContent): ContentRenderer<ContentType> | undefined =>
  registry[content.type] as ContentRenderer<ContentType> | undefined;

export const renderContent = (content: MessageContent, context: ContentContext): ReactNode => {
  const inner = rendererFor(content)?.render(content, context) ?? (
    <p className="text-sm italic opacity-70">
      This message type is not supported in your version of Flick.
    </p>
  );
  const noun = VIEW_ONCE_NOUN[content.type];
  if (!content.view_once || !noun || !context.message) return inner;
  return (
    <ViewOnce
      conversationId={context.message.conversationId}
      messageId={context.message.id}
      isMine={context.message.isMine}
      noun={noun}
    >
      {inner}
    </ViewOnce>
  );
};

export const previewContent = (content: MessageContent | null): string => {
  if (!content) return 'This message was deleted';
  return rendererFor(content)?.preview(content) ?? 'Unsupported message';
};
