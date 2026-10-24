import { useEffect } from 'react';
import { startRingtone, stopRingtone } from './ringtone';
import { useCallStore } from './useCallStore';

/**
 * Plays the right sound for the call state: a ring while someone is calling you, a soft
 * ringback tone while you wait for them to answer, silence otherwise (including once connected).
 * Mount once, near the call screens.
 */
export const useCallSounds = (): void => {
  const status = useCallStore((s) => s.callStatus);
  useEffect(() => {
    if (status === 'ringing') startRingtone('ring');
    else if (status === 'calling') startRingtone('ringback');
    else stopRingtone();
    return stopRingtone;
  }, [status]);
};
