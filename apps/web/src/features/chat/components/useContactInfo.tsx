import { useState } from 'react';
import type { UserSummary } from '@chat/contracts';
import { ContactInfo } from './ContactInfo';

/** Holds which person is open: `open(user)` from any tap, and render `dialog` once. */
export const useContactInfo = () => {
  const [target, setTarget] = useState<{ id: string; user: UserSummary | null } | null>(null);
  return {
    open: (user: UserSummary | string): void => {
      setTarget(typeof user === 'string' ? { id: user, user: null } : { id: user.id, user });
    },
    dialog: target ? (
      <ContactInfo
        userId={target.id}
        fallback={target.user}
        onClose={() => {
          setTarget(null);
        }}
      />
    ) : null,
  };
};
