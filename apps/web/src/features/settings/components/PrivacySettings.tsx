import { type ServerSettings, useServerSettings } from '../useServerSettings';
import { Card, SelectRow, ToggleRow } from './controls';

type Audience = ServerSettings['last_seen'];

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'nobody', label: 'Nobody' },
];

const AUDIENCE_FIELDS = [
  { key: 'last_seen', label: 'Last seen and online' },
  { key: 'profile_photo', label: 'Profile photo' },
  { key: 'about', label: 'About' },
  { key: 'groups_add', label: 'Who can add me to groups' },
] as const;

/** Who sees what, kept on the server (so it also applies on your other devices). */
export const PrivacySettings = () => {
  const { settings, error, retry, change } = useServerSettings();

  return (
    <Card title="Privacy">
      {error && !settings && (
        <div role="alert" className="flex items-center justify-between gap-3">
          <p className="text-sm text-error">{error}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {!settings && !error && (
        <div className="space-y-4" role="status" aria-busy="true">
          <span className="sr-only">Loading your privacy settings</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-8 w-full rounded-lg" aria-hidden="true" />
          ))}
        </div>
      )}
      {settings && (
        <>
          {AUDIENCE_FIELDS.map(({ key, label }) => (
            <SelectRow
              key={key}
              label={label}
              hint={
                key === 'groups_add' ? 'Nobody: you can still join with an invite link.' : undefined
              }
              value={settings[key]}
              options={AUDIENCES}
              onChange={(value) => void change({ [key]: value })}
            />
          ))}
          <ToggleRow
            label="Read receipts"
            hint="If off, you will not send or see read receipts."
            checked={settings.read_receipts}
            onChange={(checked) => void change({ read_receipts: checked })}
          />
        </>
      )}
    </Card>
  );
};
