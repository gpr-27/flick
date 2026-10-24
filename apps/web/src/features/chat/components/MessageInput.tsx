import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  BarChart3,
  CalendarClock,
  Check,
  Eye,
  ImagePlus,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Send,
  Smile,
  Sticker,
  X,
} from 'lucide-react';
import type { ConversationSummary, MessageContent, MessageRecord } from '@chat/contracts';
import { PopoverMenu, cn, notify, useFocusTrap, type PopoverMenuItem } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { prepareImage } from '@/lib/imageCompress';
import { SuggestReplies } from '@/features/ai/SuggestReplies';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { ComposerExtras } from '@/features/content/ComposerExtras';
import { readVideoMeta } from '@/features/content/videoMeta';
import { ScheduleDialog } from '@/features/scheduled/ScheduleDialog';
import { MentionList } from '../../organise/MentionViews';
import { MENTION_LIST_ID, mentionOptionId, useMentionAutocomplete } from '../../organise/mentions';
import { useDraftStore } from '../../organise/drafts';
import { previewContent } from '../content/registry';
import { conversationTitle } from '../conversationView';
import { sendMessage } from '../outbox/useOutboxStore';
import { uploadAttachment } from '../upload';
import { useLongPress } from '../useLongPress';
import { useChatStore } from '../useChatStore';

const EMOJIS = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😍',
  '😘',
  '😎',
  '🤔',
  '🙄',
  '😴',
  '😭',
  '😅',
  '😉',
  '🥳',
  '🤩',
  '👍',
  '👎',
  '🙏',
  '👏',
  '🙌',
  '💪',
  '🔥',
  '✨',
  '🎉',
  '❤️',
  '💯',
  '👀',
  '😜',
  '🤝',
  '🫶',
  '🚀',
];
const EMOJI_COLUMNS = 8;
/** Send typing_stop after this long without typing (the server hides it after 6 s anyway). */
const TYPING_TIMEOUT_MS = 3000;

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/** Emoji grid: arrow keys move, Enter inserts, Escape closes (focus returns to the trigger). */
const EmojiPicker = ({ onPick, onClose }: EmojiPickerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, { onEscape: onClose });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: EMOJI_COLUMNS,
      ArrowUp: -EMOJI_COLUMNS,
    };
    const delta = deltas[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
    const index = buttons.findIndex((b) => b === document.activeElement);
    buttons[Math.min(buttons.length - 1, Math.max(0, index + delta))]?.focus();
  };

  return (
    <>
      <div className="fixed inset-0 z-10" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label="Emoji picker"
        onKeyDown={onKeyDown}
        className="glass-card absolute bottom-full left-3 z-20 mb-2 grid w-72 grid-cols-8 gap-1 rounded-2xl border border-base-content/10 p-2 shadow-xl"
      >
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onPick(emoji);
            }}
            aria-label={`Insert ${emoji}`}
            className="grid size-8 place-items-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-base-200 focus-visible:bg-base-200"
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
};

export interface MessageInputProps {
  conversation: ConversationSummary;
  /** The open thread, for ArrowUp-to-edit-last-message. */
  messages: readonly MessageRecord[];
}

interface Attachment {
  file: File;
  previewUrl: string | null;
}

const editableText = (message: MessageRecord): string => {
  const c = message.content;
  if (!c) return '';
  if (c.type === 'text') return c.text;
  return 'caption' in c ? (c.caption ?? '') : '';
};

export const MessageInput = ({ conversation, messages }: MessageInputProps) => {
  const id = conversation.id;
  // The unsent draft of this chat (MessageInput remounts per chat, see ChatContainer).
  const [text, setText] = useState(() => useDraftStore.getState().drafts[conversation.id] ?? '');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const myId = useSessionStore((s) => s.user?.id);
  const notifyTyping = useChatStore((s) => s.notifyTyping);
  const notifyStopTyping = useChatStore((s) => s.notifyStopTyping);
  const editMessage = useChatStore((s) => s.editMessage);
  const replyingTo = useChatStore((s) => s.replyingTo);
  const editing = useChatStore((s) => s.editing);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const setEditing = useChatStore((s) => s.setEditing);
  const users = useChatStore((s) => s.users);
  const setDraft = useDraftStore((s) => s.setDraft);
  const mention = useMentionAutocomplete(id);
  const caretRef = useRef<number | null>(null);

  // Keep the draft up to date (not while editing: that text belongs to a sent message).
  useEffect(() => {
    if (!editing) setDraft(id, text);
  }, [id, text, editing, setDraft]);

  // After picking a mention, put the caret after the inserted name.
  useEffect(() => {
    if (caretRef.current !== null) {
      textInputRef.current?.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [text]);

  // Entering edit mode loads the message text; entering reply/edit focuses the field.
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.message_id ?? null) !== editingId) {
    setEditingId(editing?.message_id ?? null);
    if (editing) setText(editableText(editing));
  }
  useEffect(() => {
    if (editing || replyingTo) textInputRef.current?.focus();
  }, [editing, replyingTo]);

  // Stop the typing signal when the conversation changes or we unmount.
  useEffect(
    () => () => {
      clearTimeout(typingTimerRef.current);
      notifyStopTyping(id);
    },
    [id, notifyStopTyping],
  );

  const cancelCompose = (): void => {
    if (editing) setText('');
    setEditing(null);
    setReplyingTo(null);
  };

  const handleTextChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setText(e.target.value);
    mention.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
    if (e.target.value) notifyTyping(id);
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      notifyStopTyping(id);
    }, TYPING_TIMEOUT_MS);
  };

  const pickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setViewOnce(false);
    setAttachment({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    });
  };

  const removeAttachment = (): void => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
    setUploadError(null);
    setViewOnce(false);
  };

  /** GIF, sticker, poll and voice messages are complete content: queue them straight away. */
  const sendContent = (content: MessageContent): void => {
    if (!myId) return;
    sendMessage(myId, id, {
      ...content,
      ...(replyingTo ? { reply_to: replyingTo.message_id } : {}),
    });
    setReplyingTo(null);
  };

  /** Upload first, then queue the message: the outbox only ever holds sendable messages. */
  const sendAttachment = async (userId: string, file: File, caption: string): Promise<void> => {
    const extras = {
      ...(caption ? { caption } : {}),
      ...(replyingTo ? { reply_to: replyingTo.message_id } : {}),
    };
    const onProgress = setProgress;
    const viewOnceExtra = viewOnce ? { view_once: true } : {};
    if (file.type.startsWith('image/')) {
      const image = await prepareImage(file);
      const attachmentId = await uploadAttachment(image.blob, {
        purpose: 'message',
        mime: image.blob.type || file.type,
        fileName: file.name,
        onProgress,
      });
      sendMessage(userId, id, {
        type: 'image',
        attachment_id: attachmentId,
        width: image.width,
        height: image.height,
        ...extras,
        ...viewOnceExtra,
      });
    } else if (file.type.startsWith('video/')) {
      const meta = await readVideoMeta(file);
      const attachmentId = await uploadAttachment(file, {
        purpose: 'message',
        mime: file.type,
        fileName: file.name,
        onProgress,
      });
      sendMessage(userId, id, {
        type: 'video',
        attachment_id: attachmentId,
        width: meta.width,
        height: meta.height,
        duration_ms: meta.durationMs,
        ...extras,
        ...viewOnceExtra,
      });
    } else {
      const attachmentId = await uploadAttachment(file, {
        purpose: 'message',
        mime: file.type || 'application/octet-stream',
        fileName: file.name,
        onProgress,
      });
      sendMessage(userId, id, {
        type: 'file',
        attachment_id: attachmentId,
        file_name: file.name,
        size: file.size,
        ...extras,
      });
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = text.trim();
    if (editing) {
      if (!trimmed) return;
      void editMessage(editing, trimmed);
      setText('');
      return;
    }
    if (uploading || !myId || (!trimmed && !attachment)) return;

    clearTimeout(typingTimerRef.current);
    notifyStopTyping(id);

    if (attachment) {
      setUploading(true);
      setProgress(0);
      setUploadError(null);
      sendAttachment(myId, attachment.file, trimmed)
        .then(() => {
          setText('');
          removeAttachment();
          setReplyingTo(null);
        })
        .catch((error: unknown) => {
          setUploadError(getErrorMessage(error, "Couldn't upload the file."));
        })
        .finally(() => {
          setUploading(false);
        });
    } else {
      // Queued (and shown as pending) at once; the outbox sends it when it can.
      const mentions = mention.idsIn(trimmed);
      sendMessage(myId, id, {
        type: 'text',
        text: trimmed,
        ...(replyingTo ? { reply_to: replyingTo.message_id } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
      });
      setText('');
      setReplyingTo(null);
    }
    setShowEmojis(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const picked = mention.onKeyDown(e, text);
    if (picked) {
      if (typeof picked === 'object') {
        setText(picked.text);
        caretRef.current = picked.caret;
      }
      return;
    }
    if (e.key === 'Escape' && (editing || replyingTo)) {
      e.preventDefault();
      cancelCompose();
      return;
    }
    // ArrowUp in an empty composer edits your last text message (Slack-style).
    if (e.key === 'ArrowUp' && !text && !editing && myId) {
      const last = [...messages]
        .reverse()
        .find((m) => m.sender_user_id === myId && m.content?.type === 'text');
      if (last) {
        e.preventDefault();
        setEditing(last);
      }
    }
  };

  // "Schedule send" works on typed text only (not edits or attachments).
  const openSchedule = (): void => {
    if (editing || attachment || !text.trim()) {
      notify.info('Type a message first, then choose Schedule send.');
      return;
    }
    setShowSchedule(true);
  };
  // Touch: hold Send. Mouse: right-click Send. Keyboard and phones: the clock button / "+" menu.
  const holdSend = useLongPress(openSchedule);

  // Phones: the secondary composer actions fold into one "+" menu (the inline buttons are
  // `max-sm:hidden`, the menu is `sm:hidden`); every handler is the same as the inline one.
  const icon = (Icon: typeof Smile): ReactNode => <Icon className="size-5" aria-hidden="true" />;
  const locked = Boolean(editing);
  const plusItems: PopoverMenuItem[] = [
    {
      label: 'Emoji',
      icon: icon(Smile),
      onClick: () => {
        setShowEmojis(true);
      },
    },
    {
      label: 'Photo or video',
      icon: icon(ImagePlus),
      disabled: locked,
      onClick: () => imageInputRef.current?.click(),
    },
    {
      label: 'File',
      icon: icon(Paperclip),
      disabled: locked,
      onClick: () => fileInputRef.current?.click(),
    },
    {
      label: 'GIFs and stickers',
      icon: icon(Sticker),
      disabled: locked || uploading,
      onClick: () => {
        setShowGifs(true);
      },
    },
    {
      label: 'Poll',
      icon: icon(BarChart3),
      disabled: locked || uploading,
      onClick: () => {
        setShowPoll(true);
      },
    },
    {
      label: 'Schedule send',
      icon: icon(CalendarClock),
      disabled: locked || uploading,
      onClick: openSchedule,
    },
  ];

  const sendDisabled = uploading || (!text.trim() && (!attachment || Boolean(editing)));
  const title = conversationTitle(conversation);
  const replyAuthor =
    replyingTo?.sender_user_id === myId
      ? 'yourself'
      : (users[replyingTo?.sender_user_id ?? '']?.display_name ?? title);
  const composeLabel = editing
    ? 'Editing message'
    : replyingTo
      ? `Replying to ${replyAuthor}`
      : null;

  return (
    <div className="glass relative border-t border-base-content/10 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
      {composeLabel && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border-l-4 border-primary bg-base-content/5 px-3 py-2">
          {editing ? (
            <Pencil className="size-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Reply className="size-4 shrink-0 text-primary" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary" id="compose-context">
              {composeLabel}
            </p>
            {replyingTo && (
              <p className="truncate text-xs text-base-content/60">
                {previewContent(replyingTo.content)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={cancelCompose}
            className="btn btn-circle btn-ghost btn-xs"
            aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {attachment && (
        <div className="mb-3 inline-flex">
          <div className="relative">
            {attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt="Selected image preview"
                className="size-20 rounded-2xl object-cover shadow-sm ring-2 ring-primary/20"
              />
            ) : (
              <span className="chip">{attachment.file.name}</span>
            )}
            {uploading && (
              <progress
                className="progress progress-primary mt-1 block w-20"
                value={Math.round(progress * 100)}
                max={100}
                aria-label="Upload progress"
              />
            )}
            <button
              type="button"
              onClick={removeAttachment}
              className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-base-300 shadow ring-1 ring-base-content/10 transition-colors hover:bg-error hover:text-error-content"
              aria-label="Remove attachment"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {attachment && uploadError && (
        <p role="alert" className="mb-2 flex items-center gap-2 text-sm font-semibold text-error">
          {uploadError}
          <button
            type="button"
            className="underline"
            onClick={() => formRef.current?.requestSubmit()}
          >
            Retry
          </button>
        </p>
      )}
      {attachment &&
        (attachment.file.type.startsWith('image/') ||
          attachment.file.type.startsWith('video/')) && (
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={viewOnce}
              onChange={(e) => {
                setViewOnce(e.target.checked);
              }}
            />
            <Eye className="size-4" aria-hidden="true" />
            Send as view once
          </label>
        )}

      {showEmojis && (
        <EmojiPicker
          onPick={(emoji) => {
            setText((prev) => prev + emoji);
          }}
          onClose={() => {
            setShowEmojis(false);
          }}
        />
      )}

      {mention.open && (
        <MentionList
          items={mention.items}
          active={mention.active}
          onPick={(user) => {
            const picked = mention.choose(user, text);
            if (picked) {
              setText(picked.text);
              caretRef.current = picked.caret;
              textInputRef.current?.focus();
            }
          }}
        />
      )}

      {!editing && (
        <SuggestReplies
          conversationId={id}
          onPick={(reply) => {
            setText(reply);
            textInputRef.current?.focus();
          }}
        />
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex items-center gap-2"
        aria-label="Send a message"
      >
        <PopoverMenu
          label="More actions"
          icon={<Plus className="size-6" aria-hidden="true" />}
          items={plusItems}
          up
          alignLeft
          className="sm:hidden"
        />
        <button
          type="button"
          onClick={() => {
            setShowEmojis((v) => !v);
          }}
          className={cn(
            'btn btn-circle btn-ghost btn-sm max-sm:hidden',
            showEmojis ? 'text-primary' : 'text-base-content/60',
          )}
          aria-label="Insert emoji"
          aria-expanded={showEmojis}
          aria-haspopup="dialog"
        >
          <Smile className="size-5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={Boolean(editing)}
          className="btn btn-circle btn-ghost btn-sm text-base-content/60 max-sm:hidden"
          aria-label="Attach photo or video"
        >
          <ImagePlus className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={Boolean(editing)}
          className="btn btn-circle btn-ghost btn-sm text-base-content/60 max-sm:hidden"
          aria-label="Attach file"
        >
          <Paperclip className="size-5" aria-hidden="true" />
        </button>
        <input
          type="file"
          accept="image/*,video/*"
          className="hidden"
          ref={imageInputRef}
          onChange={pickFile}
          tabIndex={-1}
          aria-hidden="true"
        />
        <ComposerExtras
          disabled={Boolean(editing) || uploading}
          onSend={sendContent}
          gifs={showGifs}
          onGifsChange={setShowGifs}
          poll={showPoll}
          onPollChange={setShowPoll}
        />
        <input
          type="file"
          className="hidden"
          ref={fileInputRef}
          onChange={pickFile}
          tabIndex={-1}
          aria-hidden="true"
        />

        <label htmlFor="composer-input" className="sr-only">
          {editing ? 'Edit your message' : `Message ${title}`}
        </label>
        <input
          id="composer-input"
          type="text"
          ref={textInputRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={editing ? 'Edit your message…' : 'Type a message…'}
          aria-describedby={composeLabel ? 'compose-context' : undefined}
          autoComplete="off"
          role="combobox"
          aria-expanded={mention.open}
          aria-controls={mention.open ? MENTION_LIST_ID : undefined}
          aria-activedescendant={mention.open ? mentionOptionId(mention.active) : undefined}
          aria-autocomplete="list"
          // 16px on phones: iOS Safari zooms the page when a smaller field gets focus.
          className="input-soft min-w-0 flex-1 max-sm:min-h-11 max-sm:text-base"
        />

        <button
          type="button"
          onClick={openSchedule}
          disabled={locked || uploading}
          className="btn btn-circle btn-ghost btn-sm text-base-content/60 max-sm:hidden"
          aria-label="Schedule send"
          title="Schedule send"
        >
          <CalendarClock className="size-5" aria-hidden="true" />
        </button>

        <button
          type="submit"
          disabled={sendDisabled}
          {...holdSend}
          onContextMenu={(e) => {
            // Right-click opens the schedule dialog; on touch the long press already did.
            e.preventDefault();
            if (!sendDisabled) openSchedule();
          }}
          className="btn-grad grid size-11 place-items-center rounded-full max-sm:order-2 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={editing ? 'Save edit' : 'Send message'}
        >
          {editing ? (
            <Check className="size-5" aria-hidden="true" />
          ) : (
            <Send className="size-5" aria-hidden="true" />
          )}
        </button>
      </form>
      {showSchedule && (
        <ScheduleDialog
          conversation={conversation}
          text={text}
          open
          onClose={() => {
            setShowSchedule(false);
          }}
          onScheduled={() => {
            setText('');
            setReplyingTo(null);
          }}
        />
      )}
    </div>
  );
};

export default MessageInput;
