// The state of the media tray: the picked files, their uploads (3 at a time) and the sending of
// the messages in album order. The state lives in a ref as well as in React state, so uploads that
// finish later always see the latest list instead of a stale copy.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageContent } from '@chat/contracts';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { randomId } from '@/lib/ids';
import { attachmentKindFor, FileTooLargeError } from '../upload';
import { trimPicked } from './albumLimits';
import {
  allSent,
  assignBatch,
  buildContent,
  canSend,
  nextToSend,
  nextToUpload,
  progressCounts,
  type ItemKind,
  type PlanItem,
} from './albumPlan';
import { onBeforeUnload, reportUploads } from './uploadGuard';
import { uploadItem } from './uploadItem';

export interface DraftItem extends PlanItem {
  file: File;
  /** What the file is on its own; `kind` is `file` for every item while "send as files" is on. */
  baseKind: ItemKind;
  /** 0 to 1. */
  progress: number;
  error?: string | undefined;
}

export interface AlbumDraftOptions {
  /** Writes a finished message to the outbox. */
  send: (content: MessageContent) => void;
  /** Tests replace the real upload. */
  upload?: typeof uploadItem;
  newId?: () => string;
}

export interface AlbumDraft {
  items: DraftItem[];
  /** The tray is open. */
  active: boolean;
  asFiles: boolean;
  /** Why files were left out of the last pick; shown in the tray until dismissed. */
  notices: string[];
  /** For the live region: progress and limit messages. */
  announcement: string;
  /** Uploads that have not finished (waiting or running) among items that are not yet sent. */
  uploadsInProgress: number;
  canSend: boolean;
  addFiles: (files: readonly File[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  setAsFiles: (value: boolean) => void;
  /** Press Send: gives the items their place in the album and sends them as they are ready. */
  submit: (options: { caption: string; replyTo: string | null }) => boolean;
  /** Drop everything that has not been sent. */
  discard: () => void;
  dismissNotices: () => void;
}

const withoutId = <T extends { id: string }>(list: readonly T[], id: string): T[] =>
  list.filter((i) => i.id !== id);

export const useAlbumDraft = (options: AlbumDraftOptions): AlbumDraft => {
  const [items, setItemsState] = useState<DraftItem[]>([]);
  const itemsRef = useRef<DraftItem[]>([]);
  const [asFiles, setAsFilesState] = useState(false);
  const asFilesRef = useRef(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const controllers = useRef(new Map<string, AbortController>());
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const commit = (next: DraftItem[]): void => {
    itemsRef.current = next;
    setItemsState(next);
  };
  const patch = (id: string, change: Partial<DraftItem>): void => {
    commit(itemsRef.current.map((i) => (i.id === id ? { ...i, ...change } : i)));
  };
  const abort = (id: string): void => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
  };

  // Leaving the chat stops the files that were never sent; the ones whose Send was pressed finish
  // and are sent (the outbox then owns them).
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const item of itemsRef.current) if (!item.batch) running.get(item.id)?.abort();
    };
  }, []);

  // Tell the leave guard (chat switch, closing the tab) how many uploads are in flight. Only the
  // ones never sent are cancelled by leaving; uploads after Send keep going in the background.
  const running = items.filter((i) => i.status === 'waiting' || i.status === 'uploading');
  const runningCount = running.length;
  const cancellableCount = running.filter((i) => !i.batch).length;
  useEffect(() => {
    reportUploads({ cancellable: cancellableCount, running: runningCount });
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [cancellableCount, runningCount]);
  useEffect(
    () => () => {
      reportUploads({ cancellable: 0, running: 0 });
    },
    [],
  );

  const startUpload = (item: DraftItem): void => {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    patch(item.id, { status: 'uploading', progress: 0, error: undefined });
    const upload = optionsRef.current.upload ?? uploadItem;
    upload(item.file, item.kind, {
      signal: controller.signal,
      onProgress: (fraction) => {
        if (controller.signal.aborted) return;
        const current = itemsRef.current.find((i) => i.id === item.id);
        // Whole percents only: a re-render for every network event would make a long list janky.
        if (current && Math.round(fraction * 100) !== Math.round(current.progress * 100)) {
          patch(item.id, { progress: fraction });
        }
      },
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(item.id);
        patch(item.id, { status: 'ready', result, progress: 1 });
        const counts = progressCounts(itemsRef.current);
        setAnnouncement(`${String(counts.done)} of ${String(counts.total)} ready`);
        pump();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        controllers.current.delete(item.id);
        const message =
          error instanceof FileTooLargeError
            ? error.message
            : getErrorMessage(error, "Couldn't upload this file.");
        patch(item.id, { status: 'failed', error: message });
        setAnnouncement(`${item.fileName} failed to upload. ${message}`);
        pump();
      });
  };

  /** Send what may go, start what may start, and close the tray when everything is sent. */
  const pump = (): void => {
    for (const item of nextToSend(itemsRef.current)) {
      optionsRef.current.send(buildContent(item));
      patch(item.id, { status: 'sent' });
    }
    for (const item of nextToUpload(itemsRef.current)) startUpload(item);
    const list = itemsRef.current;
    const waitingForSend = list.some(
      (i) =>
        i.batch && (i.status === 'waiting' || i.status === 'uploading' || i.status === 'ready'),
    );
    if (!waitingForSend && list.some((i) => i.status === 'sent')) {
      const rest = list.filter((i) => i.status !== 'sent');
      commit(rest);
      if (rest.length === 0) setAnnouncement('Sent');
    }
  };

  const addFiles = useCallback((files: readonly File[]): void => {
    if (files.length === 0) return;
    const held = itemsRef.current.filter((i) => i.status !== 'sent');
    const result = trimPicked(
      { count: held.length, bytes: held.reduce((sum, i) => sum + i.fileSize, 0) },
      files,
    );
    if (result.notices.length > 0) {
      setNotices(result.notices);
      setAnnouncement(result.notices.join(' '));
      // No tray to show them in: a toast.
      if (held.length === 0 && result.accepted.length === 0) notify.error(result.notices.join(' '));
    } else {
      setNotices([]);
    }
    if (result.accepted.length === 0) return;
    const added = result.accepted.map<DraftItem>((file) => {
      const baseKind = attachmentKindFor(file);
      return {
        id: randomId(),
        file,
        baseKind,
        kind: asFilesRef.current ? 'file' : baseKind,
        status: 'waiting',
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
      };
    });
    commit([...itemsRef.current, ...added]);
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = useCallback((id: string): void => {
    abort(id);
    commit(withoutId(itemsRef.current, id));
    setNotices([]);
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback((id: string): void => {
    patch(id, { status: 'waiting', error: undefined, progress: 0 });
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAsFiles = useCallback((value: boolean): void => {
    asFilesRef.current = value;
    setAsFilesState(value);
    commit(
      itemsRef.current.map((item) => {
        if (item.batch || item.status === 'sent') return item;
        const kind: ItemKind = value ? 'file' : item.baseKind;
        if (kind === item.kind) return item;
        // A photo was shrunk for sending as a photo: the original has to go up again. Videos are
        // sent unchanged either way, so what was uploaded stays valid.
        if (item.baseKind === 'image' && (item.status === 'ready' || item.status === 'uploading')) {
          abort(item.id);
          return { ...item, kind, status: 'waiting', progress: 0, result: undefined };
        }
        return { ...item, kind };
      }),
    );
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    (send: { caption: string; replyTo: string | null }): boolean => {
      if (!canSend(itemsRef.current)) return false;
      const newId = optionsRef.current.newId ?? randomId;
      commit(assignBatch(itemsRef.current, { batchId: newId(), albumId: newId(), ...send }));
      setNotices([]);
      pump();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const discard = useCallback((): void => {
    for (const item of itemsRef.current) abort(item.id);
    commit([]);
    setNotices([]);
    setAnnouncement('Cancelled');
  }, []);

  const dismissNotices = useCallback((): void => {
    setNotices([]);
  }, []);

  return {
    items,
    active: items.length > 0,
    asFiles,
    notices,
    announcement,
    uploadsInProgress: items.filter((i) => i.status === 'waiting' || i.status === 'uploading')
      .length,
    canSend: canSend(items) && !allSent(items),
    addFiles,
    remove,
    retry,
    setAsFiles,
    submit,
    discard,
    dismissNotices,
  };
};
