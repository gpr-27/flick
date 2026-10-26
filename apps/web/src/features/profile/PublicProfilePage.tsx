import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ENDPOINTS, type UserProfile } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, Spinner } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { ApiError } from '@/lib/api';
import { getApi } from '@/lib/services';

type Profile = z.infer<typeof UserProfile>;

/** The page behind a shared link, /u/<username>: photo, name, About and a Message button. */
export const PublicProfilePage = () => {
  const { username = '' } = useParams();
  // A new link starts with a clean page.
  return <ProfileView key={username} username={username} />;
};

const ProfileView = ({ username }: { username: string }) => {
  const navigate = useNavigate();
  const myId = useSessionStore((s) => s.user?.id);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.users.byUsername, { params: { username } })
      .then(
        (p) => {
          if (!cancelled) setProfile(p);
        },
        (e: unknown) => {
          if (!cancelled)
            setError(
              e instanceof ApiError && e.status === 404
                ? 'We could not find that person.'
                : "Couldn't load this profile.",
            );
        },
      );
    return () => {
      cancelled = true;
    };
  }, [username]);

  const message = async (): Promise<void> => {
    if (!profile) return;
    await useChatStore.getState().openDirect(profile.id);
    navigate('/');
  };

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-16 pt-24">
      <section className="surface-raised mx-auto max-w-sm animate-fade-in-up rounded-2xl p-6 text-center">
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {!profile && !error && <Spinner size="lg" label="Loading profile" className="mx-auto" />}
        {profile && (
          <div className="flex flex-col items-center gap-2">
            <Avatar src={profile.avatar_url} name={profile.display_name} size="xl" />
            <h1 className="text-2xl font-semibold">{profile.display_name}</h1>
            <p className="text-sm text-base-content/60">@{profile.username}</p>
            {profile.about && <p className="text-sm">{profile.about}</p>}
            {profile.id !== myId && (
              <button
                type="button"
                className="btn btn-primary mt-2 min-h-[44px] rounded-2xl px-8"
                onClick={() => void message()}
              >
                Message
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
};

export default PublicProfilePage;
