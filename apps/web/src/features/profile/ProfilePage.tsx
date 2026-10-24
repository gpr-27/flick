import { UserButton } from '@clerk/clerk-react';
import { Avatar } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';

/** Name and avatar from /users/me; account management and sign out live in Clerk's user button. */
export const ProfilePage = () => {
  const user = useSessionStore((s) => s.user);
  if (!user) return null;

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-16 pt-24">
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
          </div>
        </section>
      </div>
    </main>
  );
};

export default ProfilePage;
