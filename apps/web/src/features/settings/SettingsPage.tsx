// Settings. On laptops a list of sections on the left and the chosen section on the right; on
// phones the same sections as an accordion (tap a heading to open it). Each section is a small
// file in ./components and changes settings through useSettingsStore or the server.
import { TranslationSettings } from '@/features/translation/TranslationSettings';
import { useState, type ReactNode } from 'react';
import {
  Bell,
  ChevronRight,
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
  /** Icon tile colour (white icon on it). */
  tile: string;
  group: string;
  content: () => ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'account',
    tile: 'bg-primary',
    group: 'Account',
    title: 'Account',
    icon: User,
    content: () => <AccountSection />,
  },
  {
    id: 'notifications',
    tile: 'bg-[#E0457B]',
    group: 'Preferences',
    title: 'Notifications',
    icon: Bell,
    content: () => <NotificationsSection />,
  },
  {
    id: 'appearance',
    tile: 'bg-[#3B82F6]',
    group: 'Preferences',
    title: 'Appearance',
    icon: Palette,
    content: () => <AppearanceSection />,
  },
  {
    id: 'chats',
    tile: 'bg-[#22B07D]',
    group: 'Preferences',
    title: 'Chats',
    icon: MessageSquare,
    content: () => <ChatsSection />,
  },
  {
    id: 'calls',
    tile: 'bg-[#22B07D]',
    group: 'Preferences',
    title: 'Calls',
    icon: Phone,
    content: () => <CallsSection />,
  },
  {
    id: 'privacy',
    tile: 'bg-primary',
    group: 'Account',
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
  {
    id: 'ai',
    tile: 'bg-[#E08A1E]',
    group: 'Flick',
    title: 'Flick assistant',
    icon: Sparkles,
    content: () => (
      <div className="space-y-4">
        <AiSection />
        <TranslationSettings />
      </div>
    ),
  },
  {
    id: 'guide',
    tile: 'bg-[#E08A1E]',
    group: 'Flick',
    title: 'Guide and tips',
    icon: GraduationCap,
    content: () => <GuideSettings />,
  },
  {
    id: 'storage',
    tile: 'bg-[#3B82F6]',
    group: 'Data',
    title: 'Storage and data',
    icon: Database,
    content: () => <StorageSection />,
  },
  {
    id: 'about',
    tile: 'bg-[#6B6686]',
    group: 'Data',
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

  const groups = SECTIONS.reduce<{ name: string; items: Section[] }[]>((acc, s) => {
    const g = acc.find((x) => x.name === s.group);
    if (g) g.items.push(s);
    else acc.push({ name: s.group, items: [s] });
    return acc;
  }, []);
  const tileOf = (s: Section) => (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg text-white [&>svg]:size-[18px]',
        s.tile,
      )}
    >
      <s.icon aria-hidden="true" />
    </span>
  );

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-[max(4rem,calc(1rem+env(safe-area-inset-bottom)))] pt-[calc(4.5rem+env(safe-area-inset-top))] sm:pt-[calc(5rem+env(safe-area-inset-top))]">
      <div className="mx-auto max-w-5xl animate-fade-in-up">
        <h1 className="mb-2 text-[22px] font-bold">Settings</h1>

        {wide ? (
          <div className="grid grid-cols-[14rem_1fr] items-start gap-6">
            <nav aria-label="Settings sections" className="sticky top-24">
              <ul className="space-y-0.5">
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
                        'flex h-10 min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors',
                        shown === s.id
                          ? 'bg-[var(--bg-active)] text-primary-text'
                          : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]',
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
          <div>
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <p className="px-4 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-2)]">
                  {g.name}
                </p>
                <ul className="divide-y divide-base-content/5 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100">
                  {g.items.map((s) => {
                    const open = shown === s.id;
                    return (
                      <li key={s.id}>
                        <h2>
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={`settings-${s.id}`}
                            data-guide={`settings.${s.id}`}
                            onClick={() => {
                              setActive(open ? null : s.id);
                            }}
                            className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-base hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)]"
                          >
                            {tileOf(s)}
                            <span className="flex-1">{s.title}</span>
                            <ChevronRight
                              className={cn(
                                'size-5 shrink-0 text-[var(--text-3)] transition-transform',
                                open && 'rotate-90',
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        </h2>
                        {open && (
                          <div id={`settings-${s.id}`} className="space-y-4 bg-base-200 p-3">
                            {s.content()}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default SettingsPage;
