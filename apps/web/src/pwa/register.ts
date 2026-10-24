// Registers the service worker once at startup. registerType is "prompt": a new worker waits
// until the user taps Reload, so a running chat is never reloaded under them.
import { registerSW } from 'virtual:pwa-register';
import { listenForInstall } from './install';
import { consumeLaunchParam, handleServiceWorkerMessage } from './openFromNotification';
import { useUpdateStore } from './update';

export const startPwa = (): void => {
  consumeLaunchParam();
  listenForInstall();
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  const updateSW = registerSW({
    onNeedRefresh: () => {
      useUpdateStore.setState({ updateReady: true });
    },
  });
  useUpdateStore.setState({
    applyUpdate: () => {
      void updateSW(true);
    },
  });
};
