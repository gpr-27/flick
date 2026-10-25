import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import type { NotificationItem } from '@chat/contracts';
import { Avatar, Button, EmptyState, ErrorState, Spinner, cn, notify } from '@/components/ui';
import { useChatStore } from '@/features/chat/useChatStore';
import { useJumpStore } from '@/features/organise/jump';
import { KIND_LABELS, groupByDay } from './dayGroups';
import { useNotificationStore } from './useNotificationStore';

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const Row = ({
  item,
  onOpen,
}: {
  item: NotificationItem;
  onOpen: (i: NotificationItem) => void;
}) => {
  const tag = KIND_LABELS[item.kind];
  const title = item.chat_name ?? 'Notification';
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onOpen(item);
        }}
        data-unread={!item.read}
        className={cn(
          'flex min-h-[44px] w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-base-content/5',
          !item.read && 'bg-primary/10',
        )}
      >
        <Avatar src={item.sender_avatar_url} name="" size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate', !item.read ? 'font-bold' : 'font-semibold')}>
              {title}
            </span>
            {tag && <span className="badge badge-primary badge-sm shrink-0">{tag}</span>}
            <span className="ml-auto shrink-0 text-xs text-base-content/60">
              {timeOf(item.created_at)}
            </span>
          </span>
          <span className="block truncate text-sm text-base-content/70">
            {item.is_group && item.sender_name ? `${item.sender_name}: ` : ''}
            {item.preview ?? 'This message is no longer available.'}
          </span>
        </span>
        {!item.read && (
          <span className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
        )}
      </button>
    </li>
  );
};

/** The notification centre: the alerts the person got, newest first, grouped by day. */
export const NotificationsPage = () => {
  const { items, next, unread, status, error, loadingMore } = useNotificationStore();
  const navigate = useNavigate();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void useNotificationStore.getState().load();
  }, []);

  const open = (item: NotificationItem): void => {
    void useNotificationStore.getState().markRead(item.id);
    if (!item.conversation_id) return;
    navigate('/');
    if (item.available && item.message_id && item.seq !== null) {
      useJumpStore.getState().jumpTo({
        conversation_id: item.conversation_id,
        message_id: item.message_id,
        seq: item.seq,
      });
    } else {
      useChatStore.getState().select(item.conversation_id);
      if (item.message_id) notify.info("That message isn't available any more.");
    }
  };

  let body;
  if (status === 'loading' || status === 'idle') {
    body = (
      <div className="flex justify-center py-16">
        <Spinner size="lg" label="Loading notifications" />
      </div>
    );
  } else if (status === 'error') {
    body = (
      <ErrorState
        title="Couldn't load notifications"
        message={error}
        onRetry={() => void useNotificationStore.getState().load()}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<Bell className="size-10" />}
        title="No notifications yet"
        description="Messages you were alerted about show up here for 30 days."
      />
    );
  } else {
    body = (
      <>
        {groupByDay(items).map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-2">
            <h2 className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-base-content/50">
              {group.label}
            </h2>
            <ul>
              {group.items.map((item) => (
                <Row key={item.id} item={item} onOpen={open} />
              ))}
            </ul>
          </section>
        ))}
        {next && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="dashed"
              loading={loadingMore}
              onClick={() => void useNotificationStore.getState().loadMore()}
            >
              Load more
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-8 pt-20">
      <div className="glass-card mx-auto max-w-xl rounded-3xl p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-xl font-bold">Notifications</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm min-h-[44px]"
              disabled={unread === 0}
              onClick={() => void useNotificationStore.getState().markAllRead()}
            >
              Mark all as read
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm min-h-[44px] text-error"
              disabled={items.length === 0}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                setConfirmClear(false);
                void useNotificationStore.getState().clear();
              }}
              onBlur={() => {
                setConfirmClear(false);
              }}
            >
              {confirmClear ? 'Tap again to clear' : 'Clear'}
            </button>
            <Link to="/" className="btn btn-ghost btn-sm min-h-[44px]">
              Chats
            </Link>
          </div>
        </div>
        {body}
      </div>
    </main>
  );
};

export default NotificationsPage;
