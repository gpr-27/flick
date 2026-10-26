import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { DROP_FILE_EVENT } from './DropOverlay';
import { MediaTools } from '@/features/content/tools/MediaTools';
import { ProgressRing } from './ProgressRing';
import {
  BarChart3,
  CalendarClock,
  Camera,
  Check,
  Eye,
  ImagePlus,
  Paperclip,
  Pencil,
  Reply,
  Send,
  Smile,
  Sticker,
  Type,
  X,
} from 'lucide-react';
import type { ConversationSummary, MessageContent, MessageRecord } from '@chat/contracts';
import { cn, notify, useFocusTrap, type PopoverMenuItem } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { prepareImage } from '@/lib/imageCompress';
import { SuggestReplies } from '@/features/ai/SuggestReplies';
import { ToneHint } from '@/features/ai/ToneHint';
import { GhostText } from '@/features/ai/writing/GhostText';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { WriteThisWithFlick } from '@/features/ai/WriteThisWithFlick';
import { flickInstruction } from '@/features/ai/flickInstruction';
import { INSERT_TEXT_EVENT } from '@/features/ai/DescribeImageDialog';
import { DescribeMessageBar } from '@/features/ai/DescribeMessageBar';
import { SendInLanguage } from '@/features/translation/SendInLanguage';
import { replaceRange } from '@/features/ai/composeVersions';
import { SelectionPolish } from '@/features/ai/SelectionPolish';
import { useTextSelection } from '@/features/ai/useTextSelection';
import { SparklePenIcon } from '@/features/ai/SparklePenIcon';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CameraCapture } from '@/features/content/camera/CameraCapture';
import { VoiceComposer } from '@/features/content/voice/VoiceComposer';
import { ComposerExtras } from '@/features/content/ComposerExtras';
import {
  cleanOutgoing,
  counterState,
  dragHasFiles,
  expandSlashCommand,
  imageFromClipboard,
} from '@/features/content/composerTools';
import { FormatToolbar } from '@/features/content/FormatToolbar';
import { applyFormat, shortcutKind, type FormatKind } from '@/features/content/markdownFormat';
import { MessagePreview } from '@/features/content/MessagePreview';
import { tableFromClipboard } from '@/features/content/pasteTable';
import { ShortcodeList } from '@/features/content/ShortcodeList';
import {
  SHORTCODE_LIST_ID,
  completeShortcode,
  shortcodeOptionId,
  useShortcodeAutocomplete,
} from '@/features/content/shortcodes';
import { readVideoMeta } from '@/features/content/videoMeta';
import {
  useFeatureGuide,
  useFeatureGuides,
  useMarkUsedWhen,
} from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { ScheduleDialog } from '@/features/scheduled/ScheduleDialog';
import { ComposerLinkPreview } from '@/features/content/ComposerLinkPreview';
import { useSlashCommands } from '../slash/useSlashCommands';
import { useServerDraft } from '../../organise/useServerDraft';
import { MentionList } from '../../organise/MentionViews';
import { MENTION_LIST_ID, mentionOptionId, useMentionAutocomplete } from '../../organise/mentions';
import { useDraftStore } from '../../organise/drafts';
import { enterAction } from '../../settings/policy';
import { useSettingsStore } from '../../settings/useSettingsStore';
import { previewContent } from '../content/registry';
import { conversationTitle } from '../conversationView';
import { isFlickBot, isFlickChat } from '@/features/ai/isFlickBot';
import { sendMessage } from '../outbox/useOutboxStore';
import { ALL_EMOJIS, pushRecentEmoji, readRecentEmojis, searchEmojis } from '../emoji/emojiSearch';
import {
  ANY_FILE_ACCEPT,
  assertFitsLimit,
  attachmentKindFor,
  FileTooLargeError,
  mimeForFile,
  uploadAttachment,
  uploadLimitFor,
} from '../upload';
import { useLongPress } from '../useLongPress';
import { isEditableImage, editedFiles, sendAsFile } from '../../photoeditor/editPhoto';
import { PhotoEditor } from '../../photoeditor/PhotoEditor';
import { useChatStore } from '../useChatStore';
import { ComposerToolsSheet } from './ComposerToolsSheet';

const EMOJIS = ALL_EMOJIS;
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
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(readRecentEmojis);
  // Searching shows the matches; otherwise the recently used come first.
  const shown = query.trim()
    ? searchEmojis(query)
    : [...recent, ...EMOJIS.filter((e) => !recent.includes(e))];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: EMOJI_COLUMNS,
      ArrowUp: -EMOJI_COLUMNS,
    };
    const delta = deltas[e.key];
    if (delta === undefined) return;
    // In the search box only Down leaves it (to the first emoji); the other arrows move the caret.
    if (e.target instanceof HTMLInputElement && e.key !== 'ArrowDown') return;
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
        className="surface-raised absolute bottom-full left-3 z-20 mb-2 grid max-h-72 w-72 grid-cols-8 gap-1 overflow-y-auto rounded-2xl p-2"
      >
        {shown.length === 0 && (
          <p className="col-span-8 py-2 text-center text-sm text-[var(--text-2)]">No emoji found</p>
        )}
        {shown.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              setRecent(pushRecentEmoji(emoji));
              onPick(emoji);
            }}
            aria-label={`Insert ${emoji}`}
            className="grid size-8 place-items-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-base-200 focus-visible:bg-base-200"
          >
            {emoji}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="input-soft order-first col-span-8 mb-1 h-8 text-sm max-sm:text-base"
        />
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

/** An uploaded file waiting for its caption: builds the message to send. */
type Prepared = (extras: {
  caption?: string;
  reply_to?: string;
  view_once?: boolean;
}) => MessageContent;

/** A table that was pasted as markdown: where it went, so "Undo" can put the plain text back. */
interface PastedTable {
  start: number;
  markdown: string;
  plain: string;
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
  // An attached file uploads at once, in the background, so Send is instant (or, if the upload is
  // still running, sends the moment it finishes).
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'ready' | 'failed'>(
    'idle',
  );
  const [sendQueued, setSendQueued] = useState(false);
  const uploading = uploadStatus === 'uploading';
  const [progress, setProgress] = useState(0);
  const uploadSeq = useRef(0); // answers from an older upload are ignored
  const queuedSend = useRef<{ caption: string; replyTo?: string; viewOnce: boolean } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const preparedRef = useRef<Prepared | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [showWrite, setShowWrite] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pastedTable, setPastedTable] = useState<PastedTable | null>(null);
  const [photoToEdit, setPhotoToEdit] = useState<File | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const myId = useSessionStore((s) => s.user?.id);
  const notifyTyping = useChatStore((s) => s.notifyTyping);
  const enterSends = useSettingsStore((s) => s.enterSends);
  const notifyStopTyping = useChatStore((s) => s.notifyStopTyping);
  const editMessage = useChatStore((s) => s.editMessage);
  const replyingTo = useChatStore((s) => s.replyingTo);
  const editing = useChatStore((s) => s.editing);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const setEditing = useChatStore((s) => s.setEditing);
  const users = useChatStore((s) => s.users);
  const setDraft = useDraftStore((s) => s.setDraft);
  const aiEnabled = useAiEnabled();
  // "Write with Flick" is not offered where AI is known to be off, or in the chat with Flick itself.
  const aiOn = aiEnabled !== false && !isFlickChat(conversation);
  const mention = useMentionAutocomplete(id, conversation.type === 'group');
  // The sender can turn the link preview off for this message (the X on the preview).
  const [noPreview, setNoPreview] = useState(false);
  const shortcodes = useShortcodeAutocomplete();
  const caretRef = useRef<number | null>(null);
  // Selection to restore after the toolbar changed the text.
  const selectionRef = useRef<[number, number] | null>(null);

  // First-open tips for the composer's tools (see features/guide). Each is dropped for good once
  // the person has used the tool (markUsed below).
  useFeatureGuides(
    [
      'composer.basics',
      'composer.attach',
      'composer.camera',
      'composer.voice',
      'composer.format',
      'composer.schedule',
      'composer.gif',
      'composer.poll',
      'composer.emoji',
    ],
    !editing,
  );
  useFeatureGuide('ai.group', conversation.type === 'group' && !editing);
  useFeatureGuide(
    'composer.viewonce',
    Boolean(
      attachment &&
      (attachment.file.type.startsWith('image/') || attachment.file.type.startsWith('video/')),
    ),
  );
  useMarkUsedWhen('composer.emoji', showEmojis);
  useMarkUsedWhen('composer.gif', showGifs);
  useMarkUsedWhen('composer.poll', showPoll);
  useMarkUsedWhen('composer.format', showFormat);
  useMarkUsedWhen('composer.camera', showCamera);
  useMarkUsedWhen('composer.schedule', showSchedule);

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

  useEffect(() => {
    if (selectionRef.current) {
      textInputRef.current?.setSelectionRange(...selectionRef.current);
      selectionRef.current = null;
    }
  }, [text]);

  // The field grows with its text; past about 8 lines (max-h in the class) it scrolls instead.
  useLayoutEffect(() => {
    const field = textInputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${String(field.scrollHeight)}px`;
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

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    let value = e.target.value;
    let caret = e.target.selectionStart;
    // "/flick" becomes "@flick "; a typed ":smile:" becomes the emoji.
    const edit = expandSlashCommand(value) ?? completeShortcode(value, caret);
    if (edit) {
      value = edit.text;
      caret = edit.caret;
      caretRef.current = caret;
    }
    setText(value);
    setPastedTable(null);
    mention.update(value, caret);
    shortcodes.update(value, caret);
    if (value) notifyTyping(id);
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      notifyStopTyping(id);
    }, TYPING_TIMEOUT_MS);
  };

  const removeAttachment = (): void => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    uploadSeq.current += 1; // whatever the running upload answers is dropped
    queuedSend.current = null;
    setSendQueued(false);
    setUploadStatus('idle');
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

  /** Compress (images) and upload the file; the result builds the message once the caption is known. */
  const prepareUpload = async (file: File, onProgress: (f: number) => void): Promise<Prepared> => {
    assertFitsLimit(file.size); // before reading or compressing anything
    const kind = sendAsFile.has(file) ? 'file' : attachmentKindFor(file);
    if (kind === 'image') {
      const image = await prepareImage(file);
      const attachmentId = await uploadAttachment(image.blob, {
        purpose: 'message',
        mime: image.blob.type || mimeForFile(file),
        fileName: file.name,
        onProgress,
      });
      return (x) => ({
        type: 'image',
        attachment_id: attachmentId,
        width: image.width,
        height: image.height,
        ...(x.caption ? { caption: x.caption } : {}),
        ...(x.reply_to ? { reply_to: x.reply_to } : {}),
        ...(x.view_once ? { view_once: true } : {}),
      });
    }
    if (kind === 'video') {
      const meta = await readVideoMeta(file);
      const attachmentId = await uploadAttachment(file, {
        purpose: 'message',
        mime: mimeForFile(file),
        fileName: file.name,
        onProgress,
      });
      return (x) => ({
        type: 'video',
        attachment_id: attachmentId,
        width: meta.width,
        height: meta.height,
        duration_ms: meta.durationMs,
        ...(x.caption ? { caption: x.caption } : {}),
        ...(x.reply_to ? { reply_to: x.reply_to } : {}),
        ...(x.view_once ? { view_once: true } : {}),
      });
    }
    const attachmentId = await uploadAttachment(file, {
      purpose: 'message',
      mime: mimeForFile(file),
      fileName: file.name,
      onProgress,
    });
    return (x) => ({
      type: 'file',
      attachment_id: attachmentId,
      file_name: file.name,
      size: file.size,
      ...(x.caption ? { caption: x.caption } : {}),
      ...(x.reply_to ? { reply_to: x.reply_to } : {}),
    });
  };

  /** Queue the finished upload as a message, then clear the composer. */
  const finishSend = (
    prepared: Prepared,
    q: { caption: string; replyTo?: string; viewOnce: boolean },
  ): void => {
    if (!myId) return;
    sendMessage(
      myId,
      id,
      prepared({
        caption: q.caption,
        ...(q.replyTo ? { reply_to: q.replyTo } : {}),
        view_once: q.viewOnce,
      }),
    );
    setText('');
    setReplyingTo(null);
    removeAttachment();
  };

  /** Starts uploading now. If Send was already pressed, the message goes out when this finishes. */
  const startUpload = (file: File): void => {
    uploadSeq.current += 1;
    const seq = uploadSeq.current;
    setUploadStatus('uploading');
    setProgress(0);
    setUploadError(null);
    prepareUpload(file, (fraction) => {
      if (uploadSeq.current === seq) setProgress(fraction);
    })
      .then((prepared) => {
        if (uploadSeq.current !== seq) return;
        preparedRef.current = prepared;
        setUploadStatus('ready');
        const queued = queuedSend.current;
        if (queued) finishSend(prepared, queued);
      })
      .catch((error: unknown) => {
        if (uploadSeq.current !== seq) return;
        queuedSend.current = null;
        setSendQueued(false);
        setUploadStatus('failed');
        setUploadError(
          error instanceof FileTooLargeError
            ? error.message
            : getErrorMessage(error, "Couldn't upload the file."),
        );
      });
  };

  /** Every way of getting a file in (picker, camera, paste, drop) ends up here. */
  const attachFile = (file: File, openEditor = false): void => {
    // Photos open the editor first (rotate, crop, caption); its result comes back here.
    if (openEditor && isEditableImage(file) && !editedFiles.has(file)) {
      setPhotoToEdit(file);
      return;
    }
    markUsed('composer.attach');
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    // Photos, videos and audio get a preview you can look at (or play) before sending.
    const previewable = /^(image|video|audio)\//.test(file.type);
    const previewUrl = previewable ? URL.createObjectURL(file) : null;
    previewUrlRef.current = previewUrl;
    queuedSend.current = null;
    setSendQueued(false);
    setViewOnce(false);
    setAttachment({ file, previewUrl });
    startUpload(file);
  };

  const pickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) attachFile(file, true);
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const image = imageFromClipboard(e.clipboardData);
    if (image && !editing) {
      e.preventDefault();
      attachFile(image);
      return;
    }
    const table = tableFromClipboard(e.clipboardData);
    if (!table) return;
    // A spreadsheet table becomes a markdown table, on lines of its own.
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    const lead = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
    const markdown = `${lead}${table}\n`;
    setText(text.slice(0, start) + markdown + text.slice(end));
    selectionRef.current = [start + markdown.length, start + markdown.length];
    setPastedTable({ start, markdown, plain: e.clipboardData.getData('text/plain') });
  };

  const undoPastedTable = (): void => {
    if (pastedTable) {
      const { start, markdown, plain } = pastedTable;
      if (text.slice(start, start + markdown.length) === markdown) {
        setText(text.slice(0, start) + plain + text.slice(start + markdown.length));
        selectionRef.current = [start + plain.length, start + plain.length];
      }
    }
    setPastedTable(null);
    textInputRef.current?.focus();
  };

  /** Put markdown around the selected text (toolbar buttons and Ctrl/Cmd+B, I, E). */
  const format = (kind: FormatKind): void => {
    const field = textInputRef.current;
    if (!field) return;
    const result = applyFormat(kind, text, field.selectionStart, field.selectionEnd);
    setText(result.text);
    selectionRef.current = [result.start, result.end];
    setPastedTable(null);
    field.focus();
  };

  // A file dropped on the "Drop to send" overlay over the chat area.
  useEffect(() => {
    const onDropFile = (e: Event): void => {
      if (!editing) attachFile((e as CustomEvent<File>).detail);
    };
    window.addEventListener(DROP_FILE_EVENT, onDropFile);
    return () => {
      window.removeEventListener(DROP_FILE_EVENT, onDropFile);
    };
  });

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (editing || !dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDragging(true);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (editing || !file) return;
    e.preventDefault();
    attachFile(file);
  };

  const slash = useSlashCommands({
    text,
    setText,
    conversationId: id,
    onPoll: () => {
      setShowPoll(true);
    },
    onSchedule: () => {
      setShowSchedule(true);
    },
    onWrite: () => {
      setShowWrite(true);
    },
  });
  useServerDraft(id, text, setText, !editing);
  // An empty box forgets "no link preview" (adjusted during render, not in an effect).
  if (!text && noPreview) setNoPreview(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = cleanOutgoing(text);
    if (editing) {
      if (!trimmed) return;
      void editMessage(editing, trimmed);
      setText('');
      return;
    }
    if (!attachment && slash.runTyped(trimmed)) return;
    if (sendQueued || !myId || (!trimmed && !attachment)) return;
    markUsed('composer.basics');
    if (/@flick\b/i.test(trimmed) || replyingToBot) markUsed('ai.group');

    clearTimeout(typingTimerRef.current);
    notifyStopTyping(id);

    if (attachment) {
      const q = {
        caption: trimmed,
        ...(replyingTo ? { replyTo: replyingTo.message_id } : {}),
        viewOnce,
      };
      if (uploadStatus === 'ready' && preparedRef.current) {
        finishSend(preparedRef.current, q); // already uploaded: sent instantly
      } else {
        // Still uploading (or a retry after a failure): send as soon as the upload is done.
        queuedSend.current = q;
        setSendQueued(true);
        if (uploadStatus === 'failed') startUpload(attachment.file);
      }
    } else {
      // Queued (and shown as pending) at once; the outbox sends it when it can.
      const mentions = mention.idsIn(trimmed);
      sendMessage(myId, id, {
        type: 'text',
        text: trimmed,
        ...(replyingTo ? { reply_to: replyingTo.message_id } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(noPreview ? { no_preview: true } : {}),
      });
      setText('');
      setReplyingTo(null);
    }
    setShowEmojis(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slash.onKeyDown(e)) return;
    const picked = mention.onKeyDown(e, text) || shortcodes.onKeyDown(e, text);
    if (picked) {
      if (typeof picked === 'object') {
        setText(picked.text);
        caretRef.current = picked.caret;
      }
      return;
    }
    const shortcut = shortcutKind(e);
    if (shortcut) {
      e.preventDefault();
      format(shortcut);
      return;
    }
    // Settings > Chats > "Enter sends": Enter sends and Shift+Enter makes a new line; with it off,
    // Enter makes a new line and only Ctrl/Cmd + Enter sends. (Not while an IME is composing.)
    if (
      enterAction(enterSends, {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
      }) === 'send'
    ) {
      e.preventDefault();
      formRef.current?.requestSubmit();
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
      label: 'Camera',
      icon: icon(Camera),
      disabled: locked,
      onClick: () => {
        setShowCamera(true);
      },
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
    {
      label: 'Formatting',
      icon: icon(Type),
      onClick: () => {
        setShowFormat((v) => !v);
      },
    },
    ...(aiOn
      ? [
          {
            label: 'Write with Flick',
            icon: <SparklePenIcon className="size-5" />,
            onClick: () => {
              setShowWrite(true);
            },
          },
        ]
      : []),
  ];

  // Ctrl/Cmd+J opens and closes the "Describe your message" bar.
  useEffect(() => {
    if (!aiOn) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setShowWrite((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [aiOn]);

  // Text selected in the box can be polished or rewritten on its own.
  const selection = useTextSelection(textInputRef, aiOn && !editing, text);
  const replaceSelection = (replacement: string): void => {
    if (!selection) return;
    const { start, end } = selection;
    const chosen = text.slice(start, end);
    setText((prev) =>
      prev.slice(start, end) === chosen ? replaceRange(prev, start, end, replacement) : prev,
    );
    selectionRef.current = [start, start + replacement.length];
    textInputRef.current?.focus();
  };
  // "Reply with this" in the Explain with Flick dialog puts its answer in this box.
  useEffect(() => {
    const onInsert = (e: Event): void => {
      const detail = (e as CustomEvent<{ conversationId: string; text: string }>).detail;
      if (detail.conversationId !== conversation.id) return;
      setText(detail.text);
      textInputRef.current?.focus();
    };
    window.addEventListener(INSERT_TEXT_EVENT, onInsert);
    return () => {
      window.removeEventListener(INSERT_TEXT_EVENT, onInsert);
    };
  }, [conversation.id]);
  // The chat has something from someone else to reply to ("Reply to this…").
  const canReply = messages.some(
    (m) => m.content !== null && m.sender_user_id !== null && m.sender_user_id !== myId,
  );
  // "@flick <instruction>" in a person-to-person chat: offer to write it instead of sending it.
  const instruction =
    aiOn &&
    !editing &&
    conversation.type === 'direct' &&
    !conversation.is_saved &&
    conversation.peer
      ? flickInstruction(text)
      : null;

  const counter = counterState(text.length);
  const sendDisabled =
    sendQueued || Boolean(counter?.over) || (!text.trim() && (!attachment || Boolean(editing)));
  // On a phone the bar has room for the box only if it shows one of microphone / Send, not both:
  // the microphone while there is nothing to send, Send once there is.
  const hasContent = text.trim() !== '' || attachment !== null || Boolean(editing);
  const title = conversationTitle(conversation);
  const replyAuthor =
    replyingTo?.sender_user_id === myId
      ? 'yourself'
      : (users[replyingTo?.sender_user_id ?? '']?.display_name ?? title);
  const replyingToBot = replyingTo ? isFlickBot(replyingTo.sender_user_id, null) : false;
  const composeLabel = editing
    ? 'Editing message'
    : replyingTo
      ? `Replying to ${replyAuthor}`
      : null;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'relative border-t border-base-content/10 bg-base-100 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        dragging && 'ring-2 ring-inset ring-primary',
      )}
    >
      {dragging && (
        <p className="pointer-events-none absolute inset-x-0 top-1 text-center text-xs font-semibold text-primary">
          Drop a file to attach it
        </p>
      )}
      {photoToEdit && (
        <PhotoEditor
          file={photoToEdit}
          onCancel={() => {
            setPhotoToEdit(null);
          }}
          onSend={(edited, caption) => {
            setPhotoToEdit(null);
            if (caption) setText(caption);
            attachFile(edited);
          }}
        />
      )}
      {composeLabel && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border-l-[3px] border-primary bg-[var(--bg-active)] px-3 py-2">
          {editing ? (
            <Pencil className="size-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Reply className="size-4 shrink-0 text-primary" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary-text" id="compose-context">
              {composeLabel}
            </p>
            {replyingTo && (
              <p className="truncate text-sm text-[var(--text-2)]">
                {previewContent(replyingTo.content)}
              </p>
            )}
            {replyingToBot && conversation.type === 'group' && (
              <p className="text-xs font-medium text-primary-text">Flick will answer your reply</p>
            )}
          </div>
          <button
            type="button"
            onClick={cancelCompose}
            className="btn btn-circle btn-ghost btn-sm"
            aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {attachment && (
        <div className="mb-3 inline-flex">
          <div className="relative">
            {attachment.previewUrl && attachment.file.type.startsWith('video/') ? (
              <video
                src={attachment.previewUrl}
                controls
                muted
                playsInline
                preload="metadata"
                aria-label="Video preview"
                className="max-h-44 max-w-[min(18rem,70vw)] rounded-2xl bg-black object-contain"
              />
            ) : attachment.previewUrl && attachment.file.type.startsWith('audio/') ? (
              <audio
                src={attachment.previewUrl}
                controls
                preload="metadata"
                aria-label="Audio preview"
                className="h-10 max-w-[min(18rem,70vw)]"
              />
            ) : attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt="Selected image preview"
                className="size-20 rounded-2xl object-cover"
              />
            ) : (
              <span className="chip">{attachment.file.name}</span>
            )}
            {uploading && (
              <>
                <ProgressRing fraction={progress} />
                <span role="status" className="mt-0.5 block text-xs text-[var(--text-2)]">
                  {sendQueued
                    ? 'Sending when ready…'
                    : `Uploading ${String(Math.round(progress * 100))}%`}
                </span>
              </>
            )}
            {uploadStatus === 'ready' && !sendQueued && (
              <span role="status" className="mt-1 block text-xs text-success">
                Ready to send
              </span>
            )}
            <button
              type="button"
              onClick={removeAttachment}
              className="tap-target absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-base-300 shadow ring-1 ring-base-content/10 transition-colors hover:bg-error hover:text-error-content"
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
          {attachment.file.size <= uploadLimitFor('message') && (
            <button
              type="button"
              className="underline"
              onClick={() => formRef.current?.requestSubmit()}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {attachment &&
        (attachment.file.type.startsWith('image/') ||
          attachment.file.type.startsWith('video/')) && (
          <label className="mb-2 flex items-center gap-2 text-sm" data-guide="composer.viewonce">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={viewOnce}
              onChange={(e) => {
                setViewOnce(e.target.checked);
                if (e.target.checked) markUsed('composer.viewonce');
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

      {shortcodes.open && !mention.open && (
        <ShortcodeList
          items={shortcodes.items}
          active={shortcodes.active}
          onPick={(item) => {
            const picked = shortcodes.choose(item, text);
            if (picked) {
              setText(picked.text);
              caretRef.current = picked.caret;
              textInputRef.current?.focus();
            }
          }}
        />
      )}

      {showFormat && (
        <div className="flex items-start justify-between gap-2">
          <FormatToolbar onFormat={format} />
          <button
            type="button"
            aria-pressed={showPreview}
            onClick={() => {
              setShowPreview((v) => !v);
            }}
            className={cn('btn btn-sm', showPreview ? 'btn-primary' : 'btn-ghost')}
          >
            Preview
          </button>
        </div>
      )}
      {showFormat && showPreview && <MessagePreview text={cleanOutgoing(text)} />}

      {pastedTable && (
        <p className="mb-2 flex items-center gap-2 text-sm text-[var(--text-2)]">
          Pasted as table
          <button type="button" className="font-semibold underline" onClick={undoPastedTable}>
            Undo
          </button>
        </p>
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

      {slash.node}

      {!editing && !attachment && (
        <ComposerLinkPreview
          text={text}
          onDismiss={() => {
            setNoPreview(true);
          }}
        />
      )}

      {instruction && (
        <WriteThisWithFlick
          instruction={instruction}
          onWritten={(written) => {
            setText(written);
            textInputRef.current?.focus();
          }}
        />
      )}

      {aiOn && !editing && (
        <GhostText
          text={text}
          conversationId={id}
          onAccept={(next) => {
            setText(next);
            textInputRef.current?.focus();
          }}
        />
      )}

      <ToneHint
        text={text}
        onUse={(softer) => {
          setText(softer);
          textInputRef.current?.focus();
        }}
      />

      {aiOn && !editing && (
        <SendInLanguage
          text={text}
          onSend={(c) => {
            sendContent(c);
            setText('');
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

      {showWrite && aiOn && (
        <DescribeMessageBar
          text={text}
          conversationId={id}
          canReply={canReply}
          initialPrompt={slash.writePrompt}
          isGroup={conversation.type === 'group'}
          onSendContent={sendContent}
          onSetText={(next) => {
            setText(next);
            setPastedTable(null);
          }}
          onClose={() => {
            setShowWrite(false);
            textInputRef.current?.focus();
          }}
        />
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative flex items-end gap-1.5 sm:gap-2"
        aria-label="Send a message"
      >
        {selection && (
          <SelectionPolish
            selected={text.slice(selection.start, selection.end)}
            onReplace={replaceSelection}
            className="absolute bottom-full left-2 mb-1 sm:left-14"
          />
        )}
        <ComposerToolsSheet
          items={plusItems}
          className="self-end sm:hidden"
          guideId="composer.attach composer.camera composer.emoji composer.gif composer.poll composer.format composer.schedule"
        />
        <ComposerExtras
          disabled={Boolean(editing) || uploading}
          onSend={sendContent}
          gifs={showGifs}
          onGifsChange={setShowGifs}
          poll={showPoll}
          onPollChange={setShowPoll}
        >
          <MediaTools
            conversationId={id}
            disabled={Boolean(editing) || uploading}
            onSend={sendContent}
          />
          <button
            type="button"
            onClick={() => {
              setShowEmojis((v) => !v);
            }}
            className={cn(
              'btn btn-circle btn-ghost btn-sm',
              showEmojis ? 'text-primary-text' : 'text-[var(--text-2)] hover:text-base-content',
            )}
            aria-label="Insert emoji"
            data-guide="composer.emoji"
            aria-expanded={showEmojis}
            aria-haspopup="dialog"
          >
            <Smile className="size-[22px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={Boolean(editing)}
            className="btn btn-circle btn-ghost btn-sm text-[var(--text-2)] hover:text-base-content"
            aria-label="Attach photo or video"
            data-guide="composer.attach"
          >
            <ImagePlus className="size-[22px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCamera(true);
            }}
            disabled={Boolean(editing)}
            className="btn btn-circle btn-ghost btn-sm text-[var(--text-2)] hover:text-base-content"
            aria-label="Open camera"
            data-guide="composer.camera"
          >
            <Camera className="size-[22px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(editing)}
            className="btn btn-circle btn-ghost btn-sm text-[var(--text-2)] hover:text-base-content"
            aria-label="Attach file"
          >
            <Paperclip className="size-[22px]" aria-hidden="true" />
          </button>
        </ComposerExtras>
        <input
          type="file"
          accept="image/*,video/*"
          className="hidden"
          ref={imageInputRef}
          onChange={pickFile}
          tabIndex={-1}
          aria-hidden="true"
        />
        <input
          type="file"
          accept={ANY_FILE_ACCEPT}
          className="hidden"
          ref={fileInputRef}
          onChange={pickFile}
          tabIndex={-1}
          aria-hidden="true"
        />

        <label htmlFor="composer-input" className="sr-only">
          {editing ? 'Edit your message' : `Message ${title}`}
        </label>
        <textarea
          id="composer-input"
          data-guide="composer"
          rows={1}
          enterKeyHint="send"
          ref={textInputRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={editing ? 'Edit your message…' : 'Type a message…'}
          aria-describedby={composeLabel ? 'compose-context' : undefined}
          autoComplete="off"
          aria-controls={
            mention.open ? MENTION_LIST_ID : shortcodes.open ? SHORTCODE_LIST_ID : undefined
          }
          aria-activedescendant={
            mention.open
              ? mentionOptionId(mention.active)
              : shortcodes.open
                ? shortcodeOptionId(shortcodes.active)
                : undefined
          }
          aria-autocomplete="list"
          // 16px on phones: iOS Safari zooms the page when a smaller field gets focus.
          // 44px tall for one line (same as the round buttons beside it), about 8 lines at most,
          // then it scrolls. Spaces and line breaks are kept as typed.
          className="max-h-48 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto whitespace-pre-wrap rounded-[22px] border border-transparent bg-[var(--bg-sunken)] px-4 py-[9px] leading-6 text-[var(--text-1)] outline-none transition-colors placeholder:text-[var(--text-3)] hover:border-[var(--border-strong)] focus:border-primary focus:bg-base-100 focus:shadow-[0_0_0_3px_oklch(var(--p)/.22)] max-sm:text-base"
        />
        <div
          role="group"
          aria-label="Message tools"
          className="flex h-11 shrink-0 items-center gap-0.5 self-end max-sm:hidden"
        >
          <button
            type="button"
            onClick={() => {
              setShowFormat((v) => !v);
            }}
            className={cn(
              'btn btn-circle btn-ghost btn-sm max-sm:hidden',
              showFormat ? 'text-primary-text' : 'text-[var(--text-2)] hover:text-base-content',
            )}
            aria-label="Formatting"
            aria-pressed={showFormat}
            data-guide="composer.format"
          >
            <Type className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={openSchedule}
            disabled={locked || uploading}
            className="btn btn-circle btn-ghost btn-sm text-[var(--text-2)] hover:text-base-content max-sm:hidden"
            aria-label="Schedule send"
            title="Schedule send"
            data-guide="composer.schedule"
          >
            <CalendarClock className="size-5" aria-hidden="true" />
          </button>
          {aiOn && (
            <button
              type="button"
              onClick={() => {
                setShowWrite((v) => !v);
              }}
              className={cn(
                'btn btn-circle btn-ghost btn-sm max-sm:hidden',
                showWrite
                  ? 'bg-active text-primary-text'
                  : 'text-[var(--text-2)] hover:text-base-content',
              )}
              aria-label="Write with Flick"
              title="Write with Flick"
              aria-expanded={showWrite}
              aria-keyshortcuts="Control+J Meta+J"
              data-guide="ai.write"
            >
              <SparklePenIcon className="size-5" />
            </button>
          )}
        </div>

        {/* One round button at the end: the microphone while there is nothing to send, Send once there is. */}
        {hasContent ? (
          <button
            type="submit"
            disabled={sendDisabled}
            {...holdSend}
            onContextMenu={(e) => {
              // Right-click opens the schedule dialog; on touch the long press already did.
              e.preventDefault();
              if (!sendDisabled) openSchedule();
            }}
            className="btn-grad grid size-11 shrink-0 place-items-center self-end rounded-full transition-transform active:scale-95 disabled:cursor-not-allowed disabled:bg-none disabled:bg-base-content/15 disabled:text-base-content/40 disabled:opacity-100"
            aria-label={editing ? 'Save edit' : 'Send message'}
            data-guide="composer.send"
          >
            {editing ? (
              <Check className="size-5" aria-hidden="true" />
            ) : (
              <Send className="size-5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <VoiceComposer
            disabled={Boolean(editing) || uploading}
            onSend={sendContent}
            buttonClassName="size-11 min-h-11 min-w-11 shrink-0 self-end bg-primary text-primary-content shadow-[var(--shadow-1)] hover:brightness-95"
          />
        )}
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
      {counter && (
        <p
          role="status"
          className={cn(
            'mt-1 text-right text-xs',
            counter.over ? 'font-semibold text-error' : 'text-base-content/60',
          )}
        >
          {counter.over
            ? `${String(-counter.left)} characters too many`
            : `${String(counter.left)} characters left`}
        </p>
      )}
      {showCamera && (
        <CameraCapture
          open
          onClose={() => {
            setShowCamera(false);
          }}
          onCapture={attachFile}
        />
      )}
    </div>
  );
};

export default MessageInput;
