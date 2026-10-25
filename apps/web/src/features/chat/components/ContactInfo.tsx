import { useEffect, useState, type ReactNode } from 'react';
import { Flag, MessageCircle, Phone, ShieldOff, Video, X } from 'lucide-react';
import { ENDPOINTS, type UserProfile, type UserSummary } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, ErrorState, Modal, Spinner, notify } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { ReportDialog } from '@/features/settings/components/ReportDialog';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { presenceLabel } from '../conversationView';
import { useChatStore, withLiveProfile } from '../useChatStore';

type Profile = z.infer<typeof UserProfile>;

const Action = ({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-xs font-semibold hover:bg-base-200 active:bg-base-200 disabled:opacity-40 ${danger ? 'text-error' : ''}`}
  >
    <span aria-hidden="true">{icon}</span>
    {label}
  </button>
);

/** A person's profile card: photo, name, @username, about, presence and what you can do. */
export const ContactInfo = ({
  userId,
  fallback,
  onClose,
}: {
  userId: string;
  /** What the caller already knows, shown while the profile loads. */
  fallback?: UserSummary | null;
  onClose: () => void;
}) => {
  const myId = useSessionStore((s) => s.user?.id);
  const callBusy = useCallStore((s) => s.callStatus !== 'idle');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.users.profile, { params: { user_id: userId } })
      .then(
        (p) => {
          if (!cancelled) setProfile(p);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load this profile."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const live = useChatStore((s) => s.profiles);
  const loaded = profile ?? fallback ?? null;
  const shown = loaded ? withLiveProfile(loaded, live) : null;
  const isMe = userId === myId;

  const toggleBlock = async (): Promise<void> => {
    if (!profile) return;
    setBlockBusy(true);
    try {
      if (profile.blocked_by_me) {
        await getApi().call(ENDPOINTS.moderation.unblock, { params: { user_id: userId } });
      } else {
        await getApi().call(ENDPOINTS.moderation.block, { body: { user_id: userId } });
      }
      setProfile({ ...profile, blocked_by_me: !profile.blocked_by_me });
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't update the block."));
    } finally {
      setBlockBusy(false);
    }
  };

  const message = (): void => {
    onClose();
    void useChatStore.getState().openDirect(userId);
  };

  const call = async (type: 'audio' | 'video'): Promise<void> => {
    if (!shown) return;
    try {
      let conversationId = Object.values(useChatStore.getState().conversations).find(
        (c) => c.type === 'direct' && c.peer?.id === userId,
      )?.id;
      conversationId ??= (
        await getApi().call(ENDPOINTS.conversations.createDirect, { body: { user_id: userId } })
      ).id;
      onClose();
      await useCallStore.getState().initiateCall(conversationId, shown, type);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't start the call."));
    }
  };

  const presence = profile
    ? presenceLabel({ online: profile.online, last_seen_at: profile.last_seen_at })
    : '';

  return (
    <>
      <Modal
        open
        onClose={onClose}
        labelledBy="contact-info-title"
        overlayClassName="items-end p-0 sm:items-center sm:p-4"
        className="w-full sm:max-w-sm"
      >
        <div className="glass-card scroll-slim max-h-[90dvh] overflow-y-auto rounded-t-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-circle btn-ghost btn-sm min-h-[44px] min-w-[44px]"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <Avatar src={shown?.avatar_url} name="" size="xl" online={Boolean(profile?.online)} />
            <h2 id="contact-info-title" className="mt-2 font-display text-xl font-bold">
              {shown?.display_name ?? 'Profile'}
            </h2>
            {shown && <p className="text-sm text-base-content/60">@{shown.username}</p>}
            {presence && <p className="text-sm text-base-content/60">{presence}</p>}
          </div>

          {error && !profile ? (
            <ErrorState
              message={error}
              onRetry={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            />
          ) : !profile ? (
            <div className="grid place-items-center py-8">
              <Spinner size="lg" label="Loading profile" />
            </div>
          ) : (
            <>
              {profile.about && (
                <section className="mt-4" aria-label="About">
                  <h3 className="text-sm font-semibold text-base-content/60">About</h3>
                  <p className="whitespace-pre-wrap break-words">{profile.about}</p>
                </section>
              )}
              {!isMe && (
                <div className="mt-5 grid grid-cols-3 gap-1">
                  <Action
                    icon={<MessageCircle className="size-5" />}
                    label="Message"
                    onClick={message}
                  />
                  <Action
                    icon={<Phone className="size-5" />}
                    label="Voice call"
                    disabled={callBusy}
                    onClick={() => void call('audio')}
                  />
                  <Action
                    icon={<Video className="size-5" />}
                    label="Video call"
                    disabled={callBusy}
                    onClick={() => void call('video')}
                  />
                  <Action
                    icon={<ShieldOff className="size-5" />}
                    label={profile.blocked_by_me ? 'Unblock' : 'Block'}
                    danger={!profile.blocked_by_me}
                    disabled={blockBusy}
                    onClick={() => void toggleBlock()}
                  />
                  <Action
                    icon={<Flag className="size-5" />}
                    label="Report"
                    danger
                    onClick={() => {
                      setReporting(true);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
      <ReportDialog
        target={reporting ? { user_id: userId } : null}
        onClose={() => {
          setReporting(false);
        }}
      />
    </>
  );
};
