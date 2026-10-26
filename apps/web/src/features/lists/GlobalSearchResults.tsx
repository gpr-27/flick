import type { z } from 'zod';
import type { SearchHit as SearchHitSchema } from '@chat/contracts';
import { useEffect, useState } from 'react';
import { ENDPOINTS, type ConversationSummary, type UserSummary } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { Snippet } from '../search/Snippet';
import { conversationTitle } from '../chat/conversationView';
import { useChatStore, userName } from '../chat/useChatStore';
import { useJumpStore } from '../organise/jump';
import { AskFlickRow } from '../understand/AskFlickRow';

type Hit = z.infer<typeof SearchHitSchema>;

const Heading = ({ children }: { children: string }) => (
  <h3 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase text-base-content/50">
    {children}
  </h3>
);

/**
 * Below the chat list while the search box has text: the chats that match (the list above),
 * people on Flick, and messages. Chats come from the list itself; this adds the other two groups.
 */
export const GlobalSearchResults = ({
  query,
  chats,
  onOpenChat,
}: {
  query: string;
  chats: readonly ConversationSummary[];
  onOpenChat: (id: string) => void;
}) => {
  const [people, setPeople] = useState<UserSummary[]>([]);
  const [messages, setMessages] = useState<Hit[]>([]);
  const conversations = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.users);
  const openDirect = useChatStore((s) => s.openDirect);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      void Promise.all([
        getApi()
          .call(ENDPOINTS.users.search, { query: { q, limit: 5 } })
          .catch(() => null),
        getApi()
          .call(ENDPOINTS.messages.search, { query: { q, limit: 5 } })
          .catch(() => null),
      ]).then(([p, m]) => {
        if (stale) return;
        setPeople(p?.items ?? []);
        setMessages(m?.items ?? []);
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  if (q.length < 2) return null;
  return (
    <div aria-label="Search results" className="pb-4">
      <AskFlickRow query={q} />
      {chats.length > 0 && (
        <>
          <Heading>Chats</Heading>
          <ul>
            {chats.slice(0, 5).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full px-4 py-2 text-left hover:bg-base-content/5"
                  onClick={() => {
                    onOpenChat(c.id);
                  }}
                >
                  {conversationTitle(c)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {people.length > 0 && (
        <>
          <Heading>People</Heading>
          <ul>
            {people.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="w-full px-4 py-2 text-left hover:bg-base-content/5"
                  onClick={() => {
                    void openDirect(u.id);
                  }}
                >
                  {u.display_name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {messages.length > 0 && (
        <>
          <Heading>Messages</Heading>
          <ul>
            {messages.map(({ message, snippet }) => {
              const conv = conversations[message.conversation_id];
              return (
                <li key={message.message_id}>
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left hover:bg-base-content/5"
                    onClick={() => {
                      useJumpStore.getState().jumpTo(message);
                    }}
                  >
                    <span className="block text-xs text-base-content/60">
                      {conv ? conversationTitle(conv) : 'Chat'} ·{' '}
                      {userName(users, message.sender_user_id)}
                    </span>
                    <span className="block break-words text-sm">
                      <Snippet snippet={snippet} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};
