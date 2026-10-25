import { TIMER_OPTIONS } from '@/features/content/disappearing';
import { useSetting } from '../useSettingsStore';
import { Card, ChoiceRow, SelectRow, ToggleRow } from './controls';

export const ChatsSection = () => {
  const [enterSends, setEnterSends] = useSetting('enterSends');
  const [showTyping, setShowTyping] = useSetting('showTyping');
  const [linkPreviews, setLinkPreviews] = useSetting('linkPreviews');
  const [download, setDownload] = useSetting('mediaAutoDownload');
  const [timer, setTimer] = useSetting('defaultDisappearing');
  const [keepArchived, setKeepArchived] = useSetting('keepArchived');

  return (
    <Card title="Chats">
      <ToggleRow
        label="Enter sends"
        hint="On: Enter sends, Shift + Enter adds a line. Off: Enter adds a line and only Ctrl or Cmd + Enter sends."
        checked={enterSends}
        onChange={setEnterSends}
      />
      <ToggleRow
        label="Typing indicator"
        hint="Show when others are typing, and let them see when you are."
        checked={showTyping}
        onChange={setShowTyping}
      />
      <ToggleRow
        label="Link previews"
        hint="Show a card for the first link in a message."
        checked={linkPreviews}
        onChange={setLinkPreviews}
      />
      <ChoiceRow
        label="Media auto-download"
        hint="Photos, videos and voice messages. Otherwise tap to download."
        value={download}
        onChange={setDownload}
        options={[
          { value: 'always', label: 'Always' },
          { value: 'wifi', label: 'Wi-Fi only' },
          { value: 'never', label: 'Never' },
        ]}
      />
      <SelectRow
        label="Default disappearing messages"
        hint="For chats you start from now on."
        value={timer}
        onChange={setTimer}
        options={TIMER_OPTIONS.map((o) => ({ value: o.seconds, label: o.label }))}
      />
      <ToggleRow
        label="Keep archived chats archived"
        hint="Off: a new message brings an archived chat back to your list."
        checked={keepArchived}
        onChange={setKeepArchived}
      />
    </Card>
  );
};
