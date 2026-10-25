import { useState } from 'react';
import { mayAutoDownload } from './policy';
import { useSettingsStore } from './useSettingsStore';

/**
 * Photos, videos and voice notes ask this before they fetch anything: `go` is true when the
 * "Media auto-download" setting allows it on this connection, or after the person taps "Download".
 */
export const useMediaGate = (): { go: boolean; load: () => void } => {
  const setting = useSettingsStore((s) => s.mediaAutoDownload);
  const [manual, setManual] = useState(false);
  return {
    go: manual || mayAutoDownload(setting),
    load: () => {
      setManual(true);
    },
  };
};
