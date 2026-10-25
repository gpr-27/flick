// The words of the "Delete this chat?" dialog for one or several chats.
import type { ConversationSummary } from '@chat/contracts';
import { conversationTitle } from '../chat/conversationView';
import { isClearOnly } from './rowActions';

export interface Wording {
  title: string;
  body: string;
  confirm: string;
}

/** What the dialog says for these chats (one or several; groups are left first). */
export const dialogWording = (chats: readonly ConversationSummary[]): Wording => {
  const only = chats.length === 1 ? chats[0] : undefined;
  if (only && isClearOnly(only)) {
    return {
      title: 'Clear this chat?',
      body: 'Its messages are removed from this device and your account. The chat itself stays.',
      confirm: 'Clear',
    };
  }
  if (only?.type === 'group') {
    return {
      title: `Leave and delete ${conversationTitle(only)}?`,
      body: 'You leave the group and your copy of its messages is removed from this device and your account. The other members keep theirs.',
      confirm: 'Leave and delete',
    };
  }
  if (only) {
    return {
      title: 'Delete this chat?',
      body: 'Your copy of the messages is removed from this device and your account; the other people keep theirs.',
      confirm: 'Delete',
    };
  }
  const groups = chats.some((c) => c.type === 'group');
  return {
    title: `Delete ${chats.length} chats?`,
    body: `Your copy of the messages is removed from this device and your account; the other people keep theirs.${groups ? ' Groups are left first.' : ''}`,
    confirm: 'Delete',
  };
};
