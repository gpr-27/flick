import { useSetting } from '../useSettingsStore';
import { Card, ChoiceRow, ToggleRow } from './controls';

export const CallsSection = () => {
  const [cameraOff, setCameraOff] = useSetting('cameraOffByDefault');
  const [noise, setNoise] = useSetting('noiseSuppression');
  const [echo, setEcho] = useSetting('echoCancellation');
  const [quality, setQuality] = useSetting('videoQuality');
  const [relay, setRelay] = useSetting('relayOnly');

  return (
    <Card title="Calls">
      <ToggleRow
        label="Camera off by default"
        hint="Video calls start with your camera off. Turn it on from the call."
        checked={cameraOff}
        onChange={setCameraOff}
      />
      <ToggleRow
        label="Noise suppression"
        hint="Reduce background noise from your microphone."
        checked={noise}
        onChange={setNoise}
      />
      <ToggleRow
        label="Echo cancellation"
        hint="Stops the other person hearing themselves."
        checked={echo}
        onChange={setEcho}
      />
      <ChoiceRow
        label="Video quality"
        hint="Lower uses less data. Applies to calls you start or answer from now on."
        value={quality}
        onChange={setQuality}
        options={[
          { value: 'low', label: 'Low (400 kbps)' },
          { value: 'auto', label: 'Auto (1.2 Mbps)' },
          { value: 'high', label: 'High (2.5 Mbps)' },
        ]}
      />
      <ToggleRow
        label="Always relay calls"
        hint="Send calls through a server only. It hides your IP address from the other person, and can make calls a little slower."
        checked={relay}
        onChange={setRelay}
      />
    </Card>
  );
};
