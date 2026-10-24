import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ENDPOINTS, type UserProfile, type UserSummary } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, Modal, Spinner } from '@/components/ui';
import { presenceLabel } from '@/features/chat/conversationView';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

type Profile = z.infer<typeof UserProfile>;

/**
 * Someone's profile: name, "about" and last seen. The server already leaves out what their
 * privacy settings hide (about, photo, last seen come back null), so a null is shown as absent.
 */
export const ProfilePopup = (props: { user: UserSummary; open: boolean; onClose: () => void }) =>
  props.open ? <ProfileContent user={props.user} onClose={props.onClose} /> : null;

// Mounted only while the popup is open, so every opening loads a fresh profile.
const ProfileContent = ({ user, onClose }: { user: UserSummary; onClose: () => void }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.users.profile, { params: { user_id: user.id } })
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
  }, [user.id]);

  const status = profile
    ? presenceLabel({ online: profile.online, last_seen_at: profile.last_seen_at })
    : '';

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="profile-popup-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <Avatar src={profile ? profile.avatar_url : user.avatar_url} name="" size="lg" />
        <h2 id="profile-popup-title" className="mt-2 font-display text-xl font-bold">
          {user.display_name}
        </h2>
        <p className="text-sm text-base-content/60">@{user.username}</p>
        {status && <p className="text-sm text-base-content/60">{status}</p>}
      </div>

      <div className="mt-4">
        {error ? (
          <p role="alert" className="text-center text-sm text-error">
            {error}
          </p>
        ) : !profile ? (
          <div className="flex justify-center">
            <Spinner size="sm" label="Loading" />
          </div>
        ) : profile.about ? (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
              About
            </h3>
            <p className="mt-1 break-words">{profile.about}</p>
          </>
        ) : null}
      </div>
    </Modal>
  );
};
