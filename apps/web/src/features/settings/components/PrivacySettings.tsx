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
  const { settings, error, change } = useServerSettings();

  return (
    <Card title="Privacy">
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {!settings && !error && <p className="text-sm text-base-content/60">Loading...</p>}
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
