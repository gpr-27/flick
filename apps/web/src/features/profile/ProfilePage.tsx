import { UserButton } from '@clerk/clerk-react';
import { Avatar, ErrorState } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { AboutEditor } from './AboutEditor';

/** Name and avatar from /users/me; account management and sign out live in Clerk's user button. */
export const ProfilePage = () => {
  const user = useSessionStore((s) => s.user);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const load = useSessionStore((s) => s.load);
  if (!user) {
    return (
      <main className="app-bg grid min-h-dvh-screen place-items-center px-4 pb-16 pt-[calc(6rem+env(safe-area-inset-top))]">
        <div className="blobs" aria-hidden="true" />
        {status === 'booting' && !error ? (
          <div className="glass-card w-full max-w-sm space-y-3 rounded-3xl p-6" role="status">
            <span className="sr-only">Loading your profile</span>
            <div className="skeleton mx-auto size-28 rounded-full" aria-hidden="true" />
            <div className="skeleton mx-auto h-6 w-40 rounded-lg" aria-hidden="true" />
            <div className="skeleton mx-auto h-4 w-24 rounded-lg" aria-hidden="true" />
          </div>
        ) : (
          <ErrorState
            variant="card"
            title="Profile unavailable"
            message={error ?? 'Sign in again to see your profile.'}
            onRetry={() => void load()}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-[max(4rem,calc(1rem+env(safe-area-inset-bottom)))] pt-[calc(6rem+env(safe-area-inset-top))]">
      <div className="blobs" aria-hidden="true" />
      <div className="mx-auto max-w-lg animate-fade-in-up">
        <section className="glass-card rounded-3xl p-6" aria-labelledby="profile-title">
          <div className="flex flex-col items-center gap-2">
            <Avatar src={user.avatar_url} name={user.display_name} size="xl" />
            <h1 id="profile-title" className="font-display text-2xl font-bold">
              {user.display_name}
            </h1>
            <p className="text-sm text-base-content/60">@{user.username}</p>
            <UserButton />
            <AboutEditor />
          </div>
        </section>
      </div>
    </main>
  );
};

export default ProfilePage;
