import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Avatar, Button, Modal, Spinner } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CallLinkSection } from '@/features/groupcall/components/CallLinkSection';
import { useChatStore, type Member } from '../useChatStore';
import { UserSearch } from './UserSearch';

const ROLES: Member['role'][] = ['member', 'admin', 'owner'];

/** Group info: rename, members with roles, add/remove people, leave. */
export const GroupInfoModal = ({
  conversation,
  open,
  onClose,
}: {
  conversation: ConversationSummary;
  open: boolean;
  onClose: () => void;
}) => {
  const id = conversation.id;
  const myId = useSessionStore((s) => s.user?.id);
  const members = useChatStore((s) => s.members[id]);
  const { loadMembers, addMembers, removeMember, setRole, renameGroup, leave } =
    useChatStore.getState();
  const [title, setTitle] = useState(conversation.title ?? '');
  const [adding, setAdding] = useState(false);
  const canManage = conversation.my_role !== 'member';

  useEffect(() => {
    if (open) void loadMembers(id);
  }, [open, id, loadMembers]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="group-info-title"
      className="glass-card scroll-slim mx-4 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="group-info-title" className="font-display text-xl font-bold">
          Group info
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {canManage && (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && title.trim() !== conversation.title)
              void renameGroup(id, title.trim());
          }}
        >
          <label className="sr-only" htmlFor="group-title">
            Group name
          </label>
          <input
            id="group-title"
            className="input-soft flex-1"
            value={title}
            maxLength={100}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <Button type="submit" variant="gradient">
            Rename
          </Button>
        </form>
      )}

      <h3 className="mb-2 text-sm font-semibold text-base-content/60">
        {conversation.member_count} members
      </h3>
      <div className="scroll-slim max-h-64 overflow-y-auto">
        {!members ? (
          <Spinner size="sm" label="Loading members" />
        ) : (
          <ul>
            {members.map((m) => {
              const isMe = m.user.id === myId;
              const editable = canManage && !isMe && m.role !== 'owner';
              return (
                <li key={m.user.id} className="flex items-center gap-3 rounded-xl p-2">
                  <Avatar src={m.user.avatar_url} name="" size="xs" />
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {m.user.display_name}
                    {isMe ? ' (you)' : ''}
                  </span>
                  {editable ? (
                    <>
                      <select
                        className="select select-bordered select-xs"
                        aria-label={`Role of ${m.user.display_name}`}
                        value={m.role}
                        onChange={(e) => {
                          void setRole(id, m.user.id, e.target.value as Member['role']);
                        }}
                      >
                        {ROLES.filter((r) => r !== 'owner' || conversation.my_role === 'owner').map(
                          (r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ),
                        )}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        aria-label={`Remove ${m.user.display_name}`}
                        onClick={() => void removeMember(id, m.user.id)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="chip text-xs">{m.role}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="mt-4">
          {adding ? (
            <UserSearch
              excludeIds={(members ?? []).map((m) => m.user.id)}
              actionLabel={(u) => `Add ${u.display_name} to the group`}
              buttonText="Add"
              disabledLabel="In this group"
              onPick={(user) => {
                void addMembers(id, [user.id]);
              }}
            />
          ) : (
            <Button
              variant="dashed"
              size="lg"
              onClick={() => {
                setAdding(true);
              }}
            >
              Add members
            </Button>
          )}
        </div>
      )}

      {canManage && <CallLinkSection conversationId={id} />}

      <button
        type="button"
        className="mt-4 w-full rounded-2xl py-2 font-semibold text-error hover:bg-error/10"
        onClick={() => {
          onClose();
          void leave(id);
        }}
      >
        Leave group
      </button>
    </Modal>
  );
};
