// What the selection bar may do with the ticked messages. Pure, so the rules are easy to test.
import type { MessageRecord } from '@chat/contracts';
import { forwardContent } from '../../organise/messageActions';

export interface SelectionPlan {
  count: number;
  /** The texts of the text messages, oldest first, one per line. Null when none has text. */
  copyText: string | null;
  /** Only these can be sent on (a poll or a call line cannot). */
  forwardable: MessageRecord[];
  /** "star" when at least one is not starred yet, otherwise "unstar" (the whole set flips). */
  starAction: 'star' | 'unstar';
  /** The messages whose star must change for the action above. */
  starTargets: MessageRecord[];
  /** "For everyone" is offered only when every ticked message is mine. */
  canDeleteForEveryone: boolean;
}

export const planSelection = (selected: readonly MessageRecord[], myId: string): SelectionPlan => {
  const texts = selected.flatMap((m) => (m.content?.type === 'text' ? [m.content.text] : []));
  const allStarred = selected.length > 0 && selected.every((m) => m.starred);
  return {
    count: selected.length,
    copyText: texts.length > 0 ? texts.join('\n') : null,
    forwardable: selected.filter((m) => forwardContent(m.content) !== null),
    starAction: allStarred ? 'unstar' : 'star',
    starTargets: selected.filter((m) => m.starred === allStarred),
    canDeleteForEveryone: selected.length > 0 && selected.every((m) => m.sender_user_id === myId),
  };
};
