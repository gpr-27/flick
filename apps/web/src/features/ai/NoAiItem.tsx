import { useEffect, useState } from 'react';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getChatAiAllowed, setChatAiAllowed } from './aiControls';

/** Chat menu item: "No-AI mode" stops Flick from reading this chat (the server enforces it). */
export const NoAiItem = ({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) => {
  const [allow, setAllow] = useState(true);
  useEffect(() => {
    let live = true;
    getChatAiAllowed(conversationId)
      .then((v) => live && setAllow(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conversationId]);

  const toggle = (): void => {
    onDone();
    setChatAiAllowed(conversationId, !allow)
      .then((v) => {
        setAllow(v);
        notify.success(v ? 'Flick can read this chat again.' : 'No-AI mode is on for this chat.');
      })
      .catch((e: unknown) => {
        notify.error(getErrorMessage(e, "Couldn't change this."));
      });
  };

  return (
    <button
      type="button"
      role="menuitem"
      onClick={toggle}
      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none max-sm:min-h-[44px]"
    >
      {allow ? 'No-AI mode: turn on' : 'No-AI mode is on: turn off'}
    </button>
  );
};
