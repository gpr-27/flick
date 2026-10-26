import { WriteBioButton } from '@/features/ai/writing/WriteBioButton';
import { useUser } from '@clerk/clerk-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserButton } from '@clerk/clerk-react';
import { Camera, Copy, Image as ImageIcon, QrCode, Share2, Trash2 } from 'lucide-react';
import { ENDPOINTS, type UpdateMeRequest, type UserStats } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, ErrorState, Modal, PopoverMenu, cn } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { useFeatureGuide, useMarkUsedWhen } from '@/features/guide/useFeatureGuide';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { uploadAttachment } from '@/features/chat/upload';
import { CameraCapture } from '@/features/content/camera/CameraCapture';
import { ApiError, getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { AvatarCropper } from './AvatarCropper';
import { looksLikeImage } from './decodeImage';
import { squareJpegFromUrl } from './signInPhoto';
import {
  ABOUT_MAX,
  DISPLAY_NAME_MAX,
  STATUS_PRESETS,
  USERNAME_MAX,
  completeness,
  copyText,
  profileLink,
  shareProfile,
  validateAbout,
  validateDisplayName,
  validateUsername,
} from './profileLogic';
import { ProfileQrDialog } from './ProfileQrDialog';
import { useUnsavedGuard } from './useUnsavedGuard';
import { useUsernameCheck, type UsernameStatus } from './useUsernameCheck';

type Stats = z.infer<typeof UserStats>;
type AvatarDraft =
  { kind: 'unchanged' } | { kind: 'new'; blob: Blob; previewUrl: string } | { kind: 'removed' };

const USERNAME_NOTE: Partial<Record<UsernameStatus, { text: string; good: boolean }>> = {
  checking: { text: 'Checking...', good: true },
  available: { text: 'Available', good: true },
  taken: { text: 'That username is taken.', good: false },
  unknown: { text: 'Could not check right now. Saving will tell you.', good: true },
};

const date = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Not yet';

/** Edit your name, username, About and photo; see your stats; share your profile. */
export const ProfilePage = () => {
  const user = useSessionStore((s) => s.user);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const load = useSessionStore((s) => s.load);
  const setUser = useSessionStore((s) => s.setUser);
  const [name, setName] = useState(user?.display_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [qrOpen, setQrOpen] = useState(false);
  const [about, setAbout] = useState(user?.about ?? '');
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: 'unchanged' });
  // The photo on the sign-in account (set in Clerk's menu). Flick keeps its own copy, so this
  // copies it across when Flick has no photo yet; Save then uploads it like any other photo.
  const { user: signInUser } = useUser();
  const signInPhotoUrl = signInUser?.hasImage ? signInUser.imageUrl : null;
  const [copyingPhoto, setCopyingPhoto] = useState(false);

  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.users.stats)
      .then(
        (s) => {
          if (!cancelled) setStats(s);
        },
        () => undefined, // the numbers are a nicety; the page works without them
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const usernameStatus = useUsernameCheck(username, user?.username ?? '');

  // What would be sent: only the fields that changed.
  const changes = useMemo(() => {
    if (!user) return {};
    const body: z.input<typeof UpdateMeRequest> = {};
    if (name.trim() !== user.display_name) body.display_name = name.trim();
    if (username.toLowerCase() !== user.username) body.username = username;
    if ((about.trim() || null) !== user.about) body.about = about.trim() || null;
    return body;
  }, [user, name, username, about]);
  const dirty = Object.keys(changes).length > 0 || avatar.kind !== 'unchanged';
  const guard = useUnsavedGuard(dirty);
  useFeatureGuide('profile.page', Boolean(user));
  // Choosing a photo or changing any field counts as using the profile page.
  useMarkUsedWhen('profile.page', dirty);

  if (!user) {
    return (
      <main className="app-bg grid min-h-dvh-screen place-items-center px-4 pb-16 pt-[calc(6rem+env(safe-area-inset-top))]">
        {status === 'booting' && !error ? (
          <div className="surface-raised w-full max-w-sm space-y-3 rounded-2xl p-6" role="status">
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

  const nameError = validateDisplayName(name);
  const usernameError = username === user.username ? null : validateUsername(username);
  const aboutError = validateAbout(about);
  const blocked = usernameStatus === 'taken' || usernameStatus === 'checking';
  const canSave = dirty && !saving && !nameError && !usernameError && !aboutError && !blocked;

  const shownAvatar =
    avatar.kind === 'new' ? avatar.previewUrl : avatar.kind === 'removed' ? null : user.avatar_url;
  const progress = completeness({
    display_name: name,
    username,
    about: about.trim() || null,
    avatar_url: shownAvatar,
  });
  const link = profileLink(window.location.origin, user.username);

  const pickPhoto = (file: File | undefined): void => {
    if (file && looksLikeImage(file)) setCropFile(file);
    else if (file) notify.error('Please pick a picture.');
  };

  const useCropped = (blob: Blob): void => {
    if (avatar.kind === 'new') URL.revokeObjectURL(avatar.previewUrl);
    setAvatar({ kind: 'new', blob, previewUrl: URL.createObjectURL(blob) });
    setCropFile(null);
  };

  const copySignInPhoto = async (): Promise<void> => {
    if (!signInPhotoUrl) return;
    setCopyingPhoto(true);
    try {
      const blob = await squareJpegFromUrl(signInPhotoUrl);
      if (avatar.kind === 'new') URL.revokeObjectURL(avatar.previewUrl);
      setAvatar({ kind: 'new', blob, previewUrl: URL.createObjectURL(blob) });
    } catch (error) {
      setServerError(getErrorMessage(error, "Couldn't copy your sign-in photo."));
    } finally {
      setCopyingPhoto(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setServerError(null);
    const previous = user;
    try {
      const body = { ...changes };
      if (avatar.kind === 'new') {
        body.avatar_attachment_id = await uploadAttachment(avatar.blob, {
          purpose: 'avatar',
          mime: 'image/jpeg',
          fileName: 'avatar.jpg',
        });
      } else if (avatar.kind === 'removed') {
        body.avatar_attachment_id = null;
      }
      // Show the new text at once; the server's answer replaces it, a refusal puts it back.
      setUser({
        ...user,
        display_name: body.display_name ?? user.display_name,
        about: body.about === undefined ? user.about : body.about,
      });
      const me = await getApi().call(ENDPOINTS.users.updateMe, { body });
      setUser(me);
      setName(me.display_name);
      setUsername(me.username);
      setAbout(me.about ?? '');
      setAvatar({ kind: 'unchanged' });
      notify.success('Profile saved.');
    } catch (error) {
      setUser(previous);
      if (error instanceof ApiError && error.status === 409) {
        setServerError('That username is taken. Try another one.');
      } else {
        notify.error(getErrorMessage(error, "Couldn't save your profile."));
      }
    } finally {
      setSaving(false);
    }
  };

  const share = async (): Promise<void> => {
    const result = await shareProfile(link, user.display_name);
    if (result === 'copied') notify.success('Profile link copied.');
    else if (result === 'failed') notify.error("Couldn't share. Copy the link yourself: " + link);
  };

  const copyUsername = async (): Promise<void> => {
    if ((await copyText(`@${user.username}`)) === 'copied') notify.success('Username copied.');
    else notify.error("Couldn't copy.");
  };

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-[max(4rem,calc(1rem+env(safe-area-inset-bottom)))] pt-[calc(4.5rem+env(safe-area-inset-top))] sm:pt-[calc(5rem+env(safe-area-inset-top))]">
      <div className="mx-auto grid max-w-5xl animate-fade-in-up gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <section
            className="glass-card overflow-hidden rounded-2xl"
            aria-labelledby="profile-title"
          >
            <div
              className="h-20 bg-gradient-to-br from-primary to-secondary opacity-90"
              aria-hidden="true"
            />
            <div className="-mt-12 flex flex-col items-center gap-2 px-5 pb-6">
              <div className="relative">
                <Avatar
                  src={shownAvatar}
                  name={user.display_name}
                  size="xl"
                  imgClassName="ring-4 ring-base-100 shadow-[var(--shadow-1)]"
                />
                <PopoverMenu
                  guideId="profile.photo"
                  label="Change photo"
                  icon={<Camera className="size-5" aria-hidden="true" />}
                  className="absolute -bottom-1 -right-1 rounded-full border-4 border-base-100 bg-primary text-primary-content shadow"
                  items={[
                    {
                      label: 'Choose a photo',
                      icon: <ImageIcon className="size-5" aria-hidden="true" />,
                      onClick: () => fileRef.current?.click(),
                    },
                    ...(signInPhotoUrl
                      ? [
                          {
                            label: 'Use my sign-in photo',
                            icon: <ImageIcon className="size-5" aria-hidden="true" />,
                            disabled: copyingPhoto,
                            onClick: () => {
                              void copySignInPhoto();
                            },
                          },
                        ]
                      : []),
                    {
                      label: 'Take a photo',
                      icon: <Camera className="size-5" aria-hidden="true" />,
                      onClick: () => {
                        setShowCamera(true);
                      },
                    },
                    {
                      label: 'Remove photo',
                      icon: <Trash2 className="size-5" aria-hidden="true" />,
                      disabled: !shownAvatar,
                      onClick: () => {
                        setAvatar({ kind: 'removed' });
                      },
                    },
                  ]}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Choose a photo"
                  onChange={(e) => {
                    pickPhoto(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              <h1 id="profile-title" className="text-[22px] font-bold">
                {user.display_name}
              </h1>
              <p className="text-sm text-[var(--text-2)]">@{user.username}</p>
              {user.about && <p className="text-center text-sm">{user.about}</p>}
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm min-h-[44px] gap-2 rounded-xl"
                  onClick={() => void share()}
                >
                  <Share2 className="size-4" aria-hidden="true" /> Share profile
                </button>
                <button
                  type="button"
                  className="btn btn-sm min-h-[44px] gap-2 rounded-xl border-0 bg-base-300 hover:bg-base-content/10"
                  onClick={() => void copyUsername()}
                >
                  <Copy className="size-4" aria-hidden="true" /> Copy @username
                </button>
                <button
                  type="button"
                  className="btn btn-sm min-h-[44px] gap-2 rounded-xl border-0 bg-base-300 hover:bg-base-content/10"
                  onClick={() => {
                    setQrOpen(true);
                  }}
                >
                  <QrCode className="size-4" aria-hidden="true" /> QR code
                </button>
                <ProfileQrDialog
                  open={qrOpen}
                  link={link}
                  username={user.username}
                  onClose={() => {
                    setQrOpen(false);
                  }}
                />
              </div>
            </div>
          </section>

          <section className="glass-card rounded-2xl p-5" aria-label="Your stats">
            <dl className="grid grid-cols-3 text-center">
              {[
                ['Chats', stats?.chats],
                ['Groups', stats?.groups],
                ['Days on Flick', stats?.days_on_flick],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="text-2xl font-semibold">{value ?? '-'}</dd>
                  <dt className="text-xs text-[var(--text-2)]">{label}</dt>
                </div>
              ))}
            </dl>
          </section>

          <section className="glass-card rounded-2xl p-5" aria-label="Profile completeness">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Profile completeness</span>
              <span>{progress.percent}%</span>
            </div>
            <progress
              className="progress progress-primary mt-2 w-full"
              value={progress.percent}
              max={100}
              aria-label="Profile completeness"
            />
            <p className="mt-2 text-sm text-[var(--text-2)]">{progress.hint}</p>
          </section>
        </div>

        <form
          data-guide="profile.edit"
          className="glass-card space-y-5 rounded-2xl p-5 sm:p-6"
          aria-label="Edit profile"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save();
          }}
        >
          <h2 className="text-[17px] font-semibold">Edit profile</h2>

          <div className="text-sm font-semibold">
            <label htmlFor="name-input">Display name</label>
            <input
              id="name-input"
              className="input-soft mt-1 min-h-[44px] w-full"
              value={name}
              maxLength={DISPLAY_NAME_MAX + 10}
              onChange={(e) => {
                setName(e.target.value);
              }}
              aria-invalid={nameError !== null}
              aria-describedby="name-note"
            />
            <span
              id="name-note"
              role={nameError ? 'alert' : undefined}
              className={cn(
                'mt-1 block text-xs font-normal',
                nameError ? 'text-error' : 'text-[var(--text-2)]',
              )}
            >
              {nameError ?? `${String(name.trim().length)}/${String(DISPLAY_NAME_MAX)}`}
            </span>
            <span className="mt-1 block text-xs font-normal text-[var(--text-2)]">
              This is your Flick name. It does not change your sign-in account.
            </span>
          </div>

          <div className="text-sm font-semibold">
            <label htmlFor="username-input">Username</label>
            <input
              id="username-input"
              className="input-soft mt-1 min-h-[44px] w-full"
              value={username}
              maxLength={USERNAME_MAX + 10}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setUsername(e.target.value);
                setServerError(null);
              }}
              aria-invalid={usernameError !== null || usernameStatus === 'taken'}
              aria-describedby="username-note"
            />
            <span
              id="username-note"
              role={usernameError || serverError || usernameStatus === 'taken' ? 'alert' : 'status'}
              className={cn(
                'mt-1 block text-xs font-normal',
                usernameError || serverError || USERNAME_NOTE[usernameStatus]?.good === false
                  ? 'text-error'
                  : 'text-[var(--text-2)]',
              )}
            >
              {usernameError ??
                serverError ??
                USERNAME_NOTE[usernameStatus]?.text ??
                '3 to 32 letters, numbers, _ or .'}
            </span>
          </div>

          <div>
            <label className="block text-sm font-semibold" htmlFor="about-input">
              About
            </label>
            <textarea
              id="about-input"
              className="textarea textarea-bordered mt-1 min-h-24 w-full"
              value={about}
              onChange={(e) => {
                setAbout(e.target.value);
              }}
              aria-invalid={aboutError !== null}
              aria-describedby="about-count"
            />
            <p
              id="about-count"
              className={cn('text-xs', aboutError ? 'text-error' : 'text-[var(--text-2)]')}
            >
              {about.length}/{ABOUT_MAX}
              {aboutError ? ` - ${aboutError}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick statuses">
              <WriteBioButton
                about={about}
                hint={user.display_name}
                max={ABOUT_MAX}
                onWrite={setAbout}
              />
              {STATUS_PRESETS.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="chip min-h-[44px] rounded-full px-3 text-sm"
                  onClick={() => {
                    setAbout(status);
                  }}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--text-2)]">Email</dt>
              <dd className="truncate font-semibold">{user.email ?? 'None'}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-2)]">Member since</dt>
              <dd className="font-semibold">{date(user.created_at)}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-2)]">Last active</dt>
              <dd className="font-semibold">{date(stats?.last_active_at)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-[var(--text-2)]">
              Your password and sign-in details are managed in this menu <UserButton />
            </p>
            <button
              type="submit"
              className="btn btn-primary min-h-[44px] rounded-2xl px-8"
              disabled={!canSave}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      <CameraCapture
        open={showCamera}
        photoOnly
        onClose={() => {
          setShowCamera(false);
        }}
        onCapture={pickPhoto}
      />

      <AvatarCropper
        file={cropFile}
        onCancel={() => {
          setCropFile(null);
        }}
        onDone={useCropped}
      />

      <Modal
        open={guard.pending !== null}
        onClose={guard.stay}
        labelledBy="discard-title"
        className="surface-raised mx-4 w-full max-w-sm space-y-3 rounded-2xl p-6 animate-scale-in"
      >
        <h2 id="discard-title" className="text-[17px] font-semibold">
          Discard your changes?
        </h2>
        <p className="text-sm">You have changes that are not saved.</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost min-h-[44px] rounded-2xl"
            onClick={guard.stay}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="btn btn-error min-h-[44px] rounded-2xl"
            onClick={guard.leave}
          >
            Discard
          </button>
        </div>
      </Modal>
    </main>
  );
};

export default ProfilePage;
