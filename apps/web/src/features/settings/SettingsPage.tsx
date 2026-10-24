import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { InstallButton } from '@/pwa/InstallButton';
import { BlockedUsers } from './components/BlockedUsers';
import { PrivacySettings } from './components/PrivacySettings';

export const SettingsPage = () => (
  <main className="app-bg min-h-dvh-screen px-4 pb-[max(4rem,calc(1rem+env(safe-area-inset-bottom)))] pt-[calc(6rem+env(safe-area-inset-top))]">
    <div className="blobs" aria-hidden="true" />
    <div className="mx-auto max-w-lg animate-fade-in-up space-y-4">
      <h1 className="font-display text-2xl font-bold">Settings</h1>
      <NotificationSettings />
      <PrivacySettings />
      <BlockedUsers />
      <div className="flex justify-center">
        <InstallButton />
      </div>
    </div>
  </main>
);

export default SettingsPage;
