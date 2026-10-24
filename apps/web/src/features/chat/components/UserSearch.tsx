import type { UserSummary } from '@chat/contracts';
import { PeopleDirectory } from '@/features/directory/PeopleDirectory';

/**
 * Pick a person: everyone on Flick A to Z, or search results when you type.
 * `onPick` gets the chosen user; people in `excludeIds` are shown but cannot be picked.
 */
export const UserSearch = ({
  onPick,
  excludeIds = [],
  actionLabel,
  buttonText = 'Message',
  disabledLabel = 'Already added',
}: {
  onPick: (user: UserSummary) => void;
  excludeIds?: readonly string[];
  actionLabel: (user: UserSummary) => string;
  buttonText?: string;
  disabledLabel?: string;
}) => (
  <PeopleDirectory
    onPick={onPick}
    actionLabel={actionLabel}
    buttonText={buttonText}
    disabledIds={excludeIds}
    disabledLabel={disabledLabel}
    listClassName="h-64"
    autoFocus
  />
);
