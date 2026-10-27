// How each message content type is drawn. One entry per type, keyed by `content.type`.
//
// Adding a feature (polls, GIFs, voice notes, ...) means adding ONE entry here; no
// other file changes. A type with no entry falls back to a plain "unsupported" line, so a newer
// server never breaks an older client.
import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { File as FileIcon, ImageOff, Phone, PhoneMissed, Video } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { albumLabel, type ContentType, type MessageContent } from '@chat/contracts';
import { ReloadButton, Spinner } from '@/components/ui';
import { RemoteImage, VideoView } from '@/features/content/MediaViews';
import { LinkPreviewCard } from '@/features/content/LinkPreviewCard';
import { firstUrl } from '@/features/content/urls';
import { RichTextCard } from '@/features/content/rich/RichCards';
import { isRichText } from '@/features/content/rich/richMessages';
import { PollView } from '@/features/content/polls/PollView';
import { EventCard } from '@/features/productivity/EventCard';
import { ChecklistView, ExpenseView, GameView } from '@/features/grouptools/cards';
import { ViewOnce } from '@/features/content/ViewOnce';
import { TapToDownload } from '@/features/settings/MediaGate';
import { useMediaGate } from '@/features/settings/useMediaGate';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { VoicePlayer } from '@/features/content/voice/VoicePlayer';
import { DocPreview } from '@/features/docpreview/DocPreview';
import { previewKindFor } from '@/features/docpreview/previewKind';
import { RichText } from '@/features/content/richText/RichText';
import { useSessionStore } from '@/features/auth/useSessionStore';
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

/** "4 photos", "3 photos and 2 videos": an album reads as one thing in the chat list, not as its last item. */
export const albumPreview = (
  album: { count: number; videos?: number | undefined },
  caption?: string,
): string => (caption ? `${albumLabel(album)}: ${caption}` : albumLabel(album));

const formatBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

// ── text ──────────────────────────────────────────────────────────────────

/** Past this many characters or lines a message starts collapsed behind "Read more". */
const LONG_TEXT_CHARS = 600;
const LONG_TEXT_LINES = 12;
export const isLongText = (text: string): boolean =>
  text.length > LONG_TEXT_CHARS || text.split('\n').length > LONG_TEXT_LINES;

/** The collapsed start of a long text: at most 12 lines and 600 characters, so a 65,000-character message costs almost nothing to draw. */
export const collapsedText = (text: string): string => {
  const cut = text.split('\n', LONG_TEXT_LINES).join('\n').slice(0, LONG_TEXT_CHARS);
  return `${cut.trimEnd()}…`;
};

const TextView = ({ content }: { content: Of<'text'> }) => {
  const users = useChatStore((s) => s.users);
  // "@flick" is the AI bot, which may not be in the user cache.
  const known = useMemo(
    () => new Set(['flick', 'everyone', ...Object.values(users).map((u) => u.username)]),
    [users],
  );
  const linkPreviews = useSettingsStore((s) => s.linkPreviews);
  const url = firstUrl(content.text);
  const long = isLongText(content.text);
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div>
        <RichText
          text={long && !expanded ? collapsedText(content.text) : content.text}
          renderText={(part) => <MentionText text={part} known={known} />}
        />
      </div>
      {long && (
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
          }}
          className="mt-1 text-xs font-semibold underline"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      {url && linkPreviews && !content.no_preview && <LinkPreviewCard url={url} />}
    </>
  );
};

/**
 * "Send in <language>": the bubble shows the translation everyone reads. The sender sees what they
 * wrote on a small "Original:" line; readers get a "Show original" toggle.
 */
const OriginalText = ({ content, isMine }: { content: Of<'text'>; isMine: boolean }) => {
  const [open, setOpen] = useState(false);
  if (!content.original_text) return null;
  if (isMine || open) {
    return (
      <p className="mt-1 whitespace-pre-wrap break-words border-t border-current/20 pt-1 text-xs opacity-70">
        <span className="font-semibold">Original: </span>
        {content.original_text}
        {!isMine && (
          <button
            type="button"
            className="ml-2 font-semibold underline"
            onClick={() => {
              setOpen(false);
            }}
          >
            Hide
          </button>
        )}
      </p>
    );
  }
  return (
    <button
      type="button"
      className="mt-1 block text-xs font-semibold underline opacity-70"
      onClick={() => {
        setOpen(true);
      }}
    >
      Show original{content.translated_to ? ` (translated to ${content.translated_to})` : ''}
    </button>
  );
};

const text: ContentRenderer<'text'> = {
  render: (c, ctx) => (
    <>
      {isRichText(c.text) ? (
        <RichTextCard
          text={c.text}
          isMine={ctx.message?.isMine ?? false}
          conversationId={ctx.message?.conversationId}
        />
      ) : (
        <TextView content={c} />
      )}
      <OriginalText content={c} isMine={ctx.message?.isMine ?? false} />
    </>
  ),
  preview: (c) => c.text,
};

// ── image ─────────────────────────────────────────────────────────────────

const ImageView = ({ content, context }: { content: Of<'image'>; context: ContentContext }) => {
  const gate = useMediaGate();
  const { url, failed, fail, reload } = useAttachmentUrl(content.attachment_id, gate.go);
  const box = { aspectRatio: `${content.width} / ${content.height}` };
  return (
    <div>
      {!gate.go ? (
        <TapToDownload noun="photo" onClick={gate.load} />
      ) : url ? (
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
            className={
              content.sticker
                ? 'block h-auto max-h-40 w-auto max-w-40 object-contain'
                : 'block h-auto max-h-80 w-auto max-w-[18rem] rounded-xl object-contain'
            }
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
        <p className="mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-relaxed">
          {content.caption}
        </p>
      )}
    </div>
  );
};

const image: ContentRenderer<'image'> = {
  render: (c, context) => <ImageView content={c} context={context} />,
  preview: (c) =>
    c.album && c.album.count > 1
      ? albumPreview(c.album, c.caption)
      : c.sticker
        ? 'Sticker'
        : c.caption
          ? `Photo: ${c.caption}`
          : 'Photo',
};

// ── file ──────────────────────────────────────────────────────────────────

const FileView = ({ content }: { content: Of<'file'> }) => {
  const [failed, setFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewKind = previewKindFor(content.file_name);
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
        className="flex items-center gap-2 rounded-xl bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-3 py-2 text-left"
        aria-label={`Download ${content.file_name}`}
      >
        <FileIcon className="size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{content.file_name}</span>
          <span className="block text-xs opacity-90">{formatBytes(content.size)}</span>
        </span>
      </button>
      {previewKind && (
        <button
          type="button"
          className="mt-1 text-xs font-semibold underline"
          onClick={() => {
            setPreviewing(true);
          }}
        >
          Preview
        </button>
      )}
      {previewing && previewKind && (
        <DocPreview
          attachmentId={content.attachment_id}
          fileName={content.file_name}
          kind={previewKind}
          onClose={() => {
            setPreviewing(false);
          }}
        />
      )}
      {failed && (
        <p role="alert" className="mt-1 text-xs">
          Couldn&apos;t get this file. Tap the file to try again with a fresh link.
        </p>
      )}
      {content.caption && (
        <p className="mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-relaxed">
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
    <>
      <VideoView
        attachmentId={c.attachment_id}
        width={c.width}
        height={c.height}
        caption={c.caption}
        round={c.round}
      />
    </>
  ),
  preview: (c) =>
    c.album && c.album.count > 1
      ? albumPreview(c.album, c.caption)
      : c.round
        ? 'Video note'
        : c.caption
          ? `Video: ${c.caption}`
          : 'Video',
};

const voice: ContentRenderer<'voice'> = {
  render: (c, ctx) => (
    <>
      {c.voicemail && <p className="mb-1 text-xs font-semibold opacity-80">Voicemail</p>}
      <VoicePlayer
        attachmentId={c.attachment_id}
        durationMs={c.duration_ms}
        waveform={c.waveform}
        conversationId={ctx.message?.conversationId}
      />
    </>
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
        isMine={context.message.isMine}
      />
    ) : null,
  preview: (c) => `Poll: ${c.question}`,
};

const event: ContentRenderer<'event'> = {
  render: (c, context) => (
    <EventCard
      title={c.title}
      startsAt={c.starts_at}
      place={c.place}
      messageId={context.message?.id}
    />
  ),
  preview: (c) => `Event: ${c.title}`,
};

const cardOf = (context: ContentContext) =>
  context.message && { id: context.message.id, conversationId: context.message.conversationId };

const checklist: ContentRenderer<'checklist'> = {
  render: (c, context) => <ChecklistView card={c} message={cardOf(context)} />,
  preview: (c) => `Checklist: ${c.title}`,
};

const expense: ContentRenderer<'expense'> = {
  render: (c) => <ExpenseView card={c} />,
  preview: (c) => `Expense: ${c.description}`,
};

const game: ContentRenderer<'game'> = {
  render: (c, context) => <GameView card={c} message={cardOf(context)} />,
  preview: (c) => (c.game === 'tictactoe' ? 'Game: tic-tac-toe' : 'Game: would you rather'),
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

const systemText = (
  c: Of<'system'>,
  users: Parameters<typeof userName>[0],
  myId: string | undefined,
): string => {
  // The user cache holds other people, not me, so my own part would read "Someone".
  const actor =
    c.actor_user_id && c.actor_user_id === myId ? 'You' : userName(users, c.actor_user_id);
  const targets = c.target_user_ids
    .map((id) => (id === myId ? 'you' : userName(users, id)))
    .join(', ');
  return `${actor} ${SYSTEM_TEXT[c.event]}${targets ? ` ${targets}` : ''}`;
};

const SystemView = ({ content }: { content: Of<'system'> }) => {
  const users = useChatStore((s) => s.users);
  const myId = useSessionStore((s) => s.user?.id);
  return (
    <p className="text-center text-xs italic opacity-80">{systemText(content, users, myId)}</p>
  );
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
  checklist,
  expense,
  game,
  event,
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
  // One plain line: the markdown symbols a text message carries are dropped.
  return stripMarkdown(rendererFor(content)?.preview(content) ?? 'Unsupported message');
};
