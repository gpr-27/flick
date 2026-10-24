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
}

export const useInstallStore = create<InstallState>()(() => ({ event: null, installed: false }));

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
