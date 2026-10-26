import { z } from 'zod';
import { Id } from '../common.js';

/** A per-user chat folder or coloured tag, with the chats in it. */
export const ChatList = z.object({
  id: Id,
  kind: z.enum(['folder', 'tag']),
  name: z.string().min(1).max(30),
  color: z.string().max(20).nullable(),
  conversation_ids: z.array(Id),
});
export const ChatListsResponse = z.object({ items: z.array(ChatList) });
export const CreateChatListRequest = z.object({
  kind: z.enum(['folder', 'tag']),
  name: z.string().trim().min(1).max(30),
  color: z.string().max(20).optional(),
});
export const UpdateChatListRequest = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: z.string().max(20).optional(),
  conversation_ids: z.array(Id).max(500).optional(),
});
export const ChatListParams = z.object({ list_id: Id });
export type ChatListItem = z.infer<typeof ChatList>;
