import { useState, type FormEvent } from 'react';
import { ENDPOINTS, LIMITS } from '@chat/contracts';
import { Button, notify } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

/** The short "about" line other people see on your profile (who sees it is a privacy setting). */
export const AboutEditor = () => {
  const saved = useSessionStore((s) => s.user?.about ?? '');
  const setUser = useSessionStore((s) => s.setUser);
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const changed = value.trim() !== saved;

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      // An empty line clears it.
      const me = await getApi().call(ENDPOINTS.users.updateMe, {
        body: { about: value.trim() || null },
      });
      setUser(me);
      setValue(me.about ?? '');
      notify.success('About saved');
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't save your about line."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="mt-6 w-full space-y-2 text-left">
      <label htmlFor="about-input" className="block text-sm font-semibold">
        About
      </label>
      <input
        id="about-input"
        type="text"
        className="input-soft w-full max-sm:text-base"
        value={value}
        maxLength={LIMITS.MAX_ABOUT_LENGTH}
        placeholder="Hey there, I'm on Flick"
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-base-content/60">
          {value.length}/{LIMITS.MAX_ABOUT_LENGTH}
        </span>
        <Button variant="gradient" type="submit" loading={saving} disabled={!changed || saving}>
          Save
        </Button>
      </div>
    </form>
  );
};
