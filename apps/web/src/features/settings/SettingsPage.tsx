// Settings. On laptops a list of sections on the left and the chosen section on the right; on
// phones the same sections as an accordion (tap a heading to open it). Each section is a small
// file in ./components and changes settings through useSettingsStore or the server.
import { useState, type ReactNode } from 'react';
import {
  Bell,
  ChevronDown,
  Info,
  MessageSquare,
  Palette,
  Phone,
  Shield,
  Sparkles,
  Database,
  GraduationCap,
  User,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/components/ui';
import { BlockedUsers } from './components/BlockedUsers';
import { AboutSection } from './components/AboutSection';
import { AccountSection } from './components/AccountSection';
import { AiSection } from './components/AiSection';
import { AppearanceSection } from './components/AppearanceSection';
import { CallsSection } from './components/CallsSection';
import { ChatsSection } from './components/ChatsSection';
import { NotificationsSection } from './components/NotificationsSection';
import { PrivacySettings } from './components/PrivacySettings';
import { ScreenLockSettings } from './components/ScreenLockSettings';
import { StorageSection } from './components/StorageSection';
import { GuideSettings } from '@/features/guide/GuideSettings';
import { useFeatureGuide, useMarkUsedWhen } from '@/features/guide/useFeatureGuide';
import { useIsWide } from './useIsWide';

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  content: () => ReactNode;
}

const SECTIONS: Section[] = [
  { id: 'account', title: 'Account', icon: User, content: () => <AccountSection /> },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: Bell,
    content: () => <NotificationsSection />,
  },
  { id: 'appearance', title: 'Appearance', icon: Palette, content: () => <AppearanceSection /> },
  { id: 'chats', title: 'Chats', icon: MessageSquare, content: () => <ChatsSection /> },
  { id: 'calls', title: 'Calls', icon: Phone, content: () => <CallsSection /> },
  {
    id: 'privacy',
    title: 'Privacy',
    icon: Shield,
    content: () => (
      <div className="space-y-4">
        <PrivacySettings />
        <ScreenLockSettings />
        <BlockedUsers />
      </div>
    ),
  },
  { id: 'ai', title: 'Flick assistant', icon: Sparkles, content: () => <AiSection /> },
  { id: 'guide', title: 'Guide and tips', icon: GraduationCap, content: () => <GuideSettings /> },
  { id: 'storage', title: 'Storage and data', icon: Database, content: () => <StorageSection /> },
  {
    id: 'about',
    title: 'Shortcuts and about',
    icon: Info,
    content: () => (
      <div className="space-y-4">
        <AboutSection />
      </div>
    ),
  },
];

export const SettingsPage = () => {
  const wide = useIsWide();
  // Laptops always show one section; phones can have all of them closed.
  const [active, setActive] = useState<string | null>(null);
  const shown = wide ? (active ?? 'account') : active;
  useFeatureGuide('settings.page');
  useMarkUsedWhen('settings.page', active !== null);

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-[max(4rem,calc(1rem+env(safe-area-inset-bottom)))] pt-[calc(6rem+env(safe-area-inset-top))]">
      <div className="blobs" aria-hidden="true" />
      <div className="mx-auto max-w-5xl animate-fade-in-up">
        <h1 className="mb-4 font-display text-2xl font-bold">Settings</h1>

        {wide ? (
          <div className="grid grid-cols-[14rem_1fr] items-start gap-6">
            <nav
              aria-label="Settings sections"
              className="glass-card sticky top-24 rounded-3xl p-2"
            >
              <ul>
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={shown === s.id ? 'page' : undefined}
                      data-guide={`settings.${s.id}`}
                      onClick={() => {
                        setActive(s.id);
                      }}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-3 text-left font-semibold transition-colors',
                        shown === s.id ? 'bg-primary/15 text-primary' : 'hover:bg-base-content/5',
                      )}
                    >
                      <s.icon className="size-5 shrink-0" aria-hidden="true" />
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div>{SECTIONS.find((s) => s.id === shown)?.content()}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {SECTIONS.map((s) => {
              const open = shown === s.id;
              return (
                <div key={s.id}>
                  <h2>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`settings-${s.id}`}
                      data-guide={`settings.${s.id}`}
                      onClick={() => {
                        setActive(open ? null : s.id);
                      }}
                      className="glass-card flex min-h-14 w-full items-center gap-3 rounded-3xl px-5 text-left font-display text-lg font-bold"
                    >
                      <s.icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="flex-1">{s.title}</span>
                      <ChevronDown
                        className={cn('size-5 transition-transform', open && 'rotate-180')}
                        aria-hidden="true"
                      />
                    </button>
                  </h2>
                  {open && (
                    <div id={`settings-${s.id}`} className="mt-3 space-y-4">
                      {s.content()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
};

export default SettingsPage;
