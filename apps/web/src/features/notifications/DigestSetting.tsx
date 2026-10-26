import { useState } from 'react';
import { DIGEST_CHOICES, getDigestHours, setDigestHours } from './digest';

/** "Batch quiet notifications": one summary line per chat every N hours. */
export const DigestSetting = () => {
  const [hours, setHours] = useState(getDigestHours());
  return (
    <label className="mt-3 flex min-h-[44px] items-center justify-between gap-4">
      <span>
        <span className="block font-semibold">Notification digest</span>
        <span className="block text-sm text-base-content/60">
          Batch non-urgent notifications. Mentions and urgent messages still come straight through.
        </span>
      </span>
      <select
        aria-label="Notification digest"
        className="select select-bordered select-sm"
        value={hours}
        onChange={(e) => {
          const n = Number(e.target.value);
          setHours(n);
          setDigestHours(n);
        }}
      >
        {DIGEST_CHOICES.map((n) => (
          <option key={n} value={n}>
            {n === 0 ? 'Off' : `Every ${n} h`}
          </option>
        ))}
      </select>
    </label>
  );
};
