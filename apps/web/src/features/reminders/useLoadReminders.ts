import { useEffect } from 'react';
import { useReminderStore } from './reminderStore';

/** Loads the reminders once per sign-in, so the marks on messages and the list are ready. */
export const useLoadReminders = (): void => {
  useEffect(() => {
    void useReminderStore.getState().ensureLoaded();
  }, []);
};
