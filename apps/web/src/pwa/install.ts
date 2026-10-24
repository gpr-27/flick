// "Install app" support. Browsers fire `beforeinstallprompt` once, early, when the app is
// installable; we keep the event and replay it when the user clicks our button.
import { create } from 'zustand';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  event: BeforeInstallPromptEvent | null;
  installed: boolean;
  /** The "how to install" guide is open (phones whose browser offers no install button). */
  guideOpen: boolean;
}

export const useInstallStore = create<InstallState>()(() => ({
  event: null,
  installed: false,
  guideOpen: false,
}));

// ── what kind of device and browser this is ─────────────────────────────────────────────

/** True when Flick already runs as an installed app (no browser bar), on any platform. */
export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone and iPad. Recent iPads report themselves as a Mac, so a touch screen gives them away. */
export const isIos = (ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean =>
  /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && touchPoints > 1);

export const isAndroid = (ua = navigator.userAgent): boolean => /Android/i.test(ua);

/** Browsers built into other apps (Instagram, WhatsApp, Facebook...). They cannot install web apps. */
export const isInAppBrowser = (ua = navigator.userAgent): boolean =>
  /FBAN|FBAV|Instagram|WhatsApp|Snapchat|Line\/|MicroMessenger|; wv\)/i.test(ua);

/**
 * How this device can install Flick:
 *   prompt  the browser gave us an install dialog (Chrome on Android, Edge, desktop Chrome)
 *   guide   no dialog is offered, so we show steps (iPhone and iPad, other Android browsers)
 *   none    already installed, or not a phone (desktop browsers without the dialog)
 */
export type InstallMode = 'prompt' | 'guide' | 'none';

export const installModeFor = (state: Pick<InstallState, 'event' | 'installed'>): InstallMode => {
  if (state.installed || isStandalone()) return 'none';
  if (state.event) return 'prompt';
  return isIos() || isAndroid() ? 'guide' : 'none';
};

/** The current install mode, kept up to date as the browser's install event arrives. */
export const useInstallMode = (): InstallMode =>
  useInstallStore((s) => installModeFor({ event: s.event, installed: s.installed }));

export const openInstallGuide = (): void => {
  useInstallStore.setState({ guideOpen: true });
};
export const closeInstallGuide = (): void => {
  useInstallStore.setState({ guideOpen: false });
};

/** What the "Install app" button does: the browser's dialog if there is one, else the steps. */
export const startInstall = async (): Promise<void> => {
  if (useInstallStore.getState().event) await promptInstall();
  else openInstallGuide();
};

/** Start listening (call once at startup, before React renders, so the event is not missed). */
export const listenForInstall = (target: Window = window): (() => void) => {
  const onPrompt = (e: Event): void => {
    e.preventDefault(); // stop the browser's own mini-infobar; we show our button instead
    useInstallStore.setState({ event: e as BeforeInstallPromptEvent });
  };
  const onInstalled = (): void => {
    useInstallStore.setState({ event: null, installed: true });
  };
  target.addEventListener('beforeinstallprompt', onPrompt);
  target.addEventListener('appinstalled', onInstalled);
  return () => {
    target.removeEventListener('beforeinstallprompt', onPrompt);
    target.removeEventListener('appinstalled', onInstalled);
  };
};

/** Shows the browser's install dialog. The event can be used only once, so it is dropped after. */
export const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
  const { event } = useInstallStore.getState();
  if (!event) return 'unavailable';
  useInstallStore.setState({ event: null });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
};
