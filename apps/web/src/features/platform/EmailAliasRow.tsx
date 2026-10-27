// Settings > Account: the address that forwards email into Saved messages (hidden when off).
import { useEffect, useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getApi } from '@/lib/services';

export const EmailAliasRow = () => {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve()
      .then(() => getApi().call(ENDPOINTS.platform.emailAlias))
      .then(
        (r: { address?: string | null } | undefined) => {
          if (typeof r?.address === 'string') setAddress(r.address);
        },
        () => undefined,
      );
  }, []);
  if (!address) return null;
  const copy = (): void => {
    navigator.clipboard.writeText(address).then(
      () => {
        notify.success('Address copied.');
      },
      () => {
        notify.error("Couldn't copy the address.");
      },
    );
  };
  return (
    <div className="py-1">
      <p className="font-semibold">Email to Saved messages</p>
      <p className="text-sm text-base-content/60">
        Forward or send an email to this address and it appears in your Saved messages, with the
        subject on the first line. Only the text of the email is kept.
      </p>
      <div className="mt-2 flex min-h-[44px] items-center justify-between gap-3">
        <code className="min-w-0 truncate text-sm">{address}</code>
        <button
          type="button"
          className="btn btn-outline btn-sm min-h-[44px] rounded-2xl"
          onClick={copy}
        >
          Copy
        </button>
      </div>
    </div>
  );
};
