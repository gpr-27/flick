import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Avatar, Button, Modal, Spinner, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CallLinkSection } from '@/features/groupcall/components/CallLinkSection';
import { uploadAttachment } from '../upload';
import { useChatStore, type Member } from '../useChatStore';
import { InviteLinkSection } from './InviteLinkSection';
import { SharedTab } from './SharedTab';
import { UserSearch } from './UserSearch';

const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const SWITCHES = [
  ['only_admins_send', 'Only admins can send messages'],
  ['only_admins_edit_info', 'Only admins can edit group info'],
  ['approval_required', 'Admins approve new members who join by link'],
] as const;

/** Group info: photo, name, description, members with roles, switches, links, shared files, leave. */
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
  const { loadMembers, addMembers, removeMember, setRole, updateGroup, leave } =
    useChatStore.getState();
  const [title, setTitle] = useState(conversation.title ?? '');
  const [description, setDescription] = useState(conversation.description ?? '');
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'info' | 'shared'>('info');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const isAdmin = conversation.my_role !== 'member';
  const canEditInfo = isAdmin || !conversation.settings.only_admins_edit_info;

  useEffect(() => {
    if (open) void loadMembers(id);
  }, [open, id, loadMembers]);

  const changePhoto = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const attachmentId = await uploadAttachment(file, {
        purpose: 'group_avatar',
        mime: file.type,
        fileName: file.name,
      });
      await updateGroup(id, { avatar_attachment_id: attachmentId });
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't upload the photo."));
    } finally {
      setUploading(false);
    }
  };

  const saveInfo = (): void => {
    const patch: { title?: string; description?: string } = {};
    if (title.trim() && title.trim() !== conversation.title) patch.title = title.trim();
    if (description.trim() !== (conversation.description ?? '')) {
      patch.description = description.trim();
    }
    if (Object.keys(patch).length > 0) void updateGroup(id, patch);
  };

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

      <div role="tablist" aria-label="Group info sections" className="mb-4 flex gap-2">
        {(
          [
            ['info', 'Info'],
            ['shared', 'Media, links and files'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`btn btn-sm rounded-full ${tab === key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'shared' ? (
        <SharedTab conversationId={id} />
      ) : (
        <>
          <div className="mb-4 flex flex-col items-center gap-2">
            <Avatar src={conversation.avatar_url} name="Group photo" size="xl" />
            {canEditInfo && (
              <>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="Group photo file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void changePhoto(file);
                  }}
                />
                <Button
                  variant="dashed"
                  loading={uploading}
                  icon={<Camera className="size-4" aria-hidden="true" />}
                  onClick={() => photoInput.current?.click()}
                >
                  Change photo
                </Button>
              </>
            )}
          </div>

          {canEditInfo ? (
            <form
              className="mb-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveInfo();
              }}
            >
              <label className="sr-only" htmlFor="group-title">
                Group name
              </label>
              <input
                id="group-title"
                className="input-soft w-full"
                value={title}
                maxLength={100}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
              <label className="sr-only" htmlFor="group-description">
                Group description
              </label>
              <textarea
                id="group-description"
                className="input-soft w-full"
                rows={3}
                placeholder="Add a group description"
                value={description}
                maxLength={500}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
              />
              <Button type="submit" variant="gradient">
                Save
              </Button>
            </form>
          ) : (
            <div className="mb-4 text-center">
              <p className="font-display text-lg font-bold">{conversation.title}</p>
              {conversation.description && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-base-content/70">
                  {conversation.description}
                </p>
              )}
            </div>
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
                  const editable = isAdmin && !isMe && m.role !== 'owner';
                  const name = m.user.display_name;
                  return (
                    <li key={m.user.id} className="flex items-center gap-2 rounded-xl p-2">
                      <Avatar src={m.user.avatar_url} name="" size="xs" />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {name}
                        {isMe ? ' (you)' : ''}
                      </span>
                      {m.role !== 'member' && (
                        <span className="chip text-xs" data-role={m.role}>
                          {ROLE_LABEL[m.role]}
                        </span>
                      )}
                      {editable && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            aria-label={
                              m.role === 'admin'
                                ? `Remove admin from ${name}`
                                : `Make ${name} admin`
                            }
                            onClick={() =>
                              void setRole(id, m.user.id, m.role === 'admin' ? 'member' : 'admin')
                            }
                          >
                            {m.role === 'admin' ? 'Demote' : 'Make admin'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            aria-label={`Remove ${name}`}
                            onClick={() => void removeMember(id, m.user.id)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {isAdmin && (
            <div className="mt-4">
              {adding ? (
                <UserSearch
                  excludeIds={(members ?? []).map((m) => m.user.id)}
                  actionLabel={(u) => `Add ${u.display_name} to the group`}
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

          {isAdmin && (
            <section className="mt-4" aria-labelledby="group-settings-title">
              <h3
                id="group-settings-title"
                className="mb-2 text-sm font-semibold text-base-content/60"
              >
                Group settings
              </h3>
              {SWITCHES.map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center justify-between py-1">
                  <span className="text-sm">{label}</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={conversation.settings[key]}
                    onChange={(e) => {
                      void updateGroup(id, { settings: { [key]: e.target.checked } });
                    }}
                  />
                </label>
              ))}
            </section>
          )}

          {isAdmin && <InviteLinkSection conversationId={id} />}
          {isAdmin && <CallLinkSection conversationId={id} />}

          {confirmLeave ? (
            <div role="alertdialog" aria-label="Leave this group?" className="mt-4 text-center">
              <p className="mb-2 text-sm">Leave this group? You will stop getting its messages.</p>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setConfirmLeave(false);
                  }}
                >
                  Stay
                </button>
                <button
                  type="button"
                  className="btn btn-error btn-sm"
                  onClick={() => {
                    onClose();
                    void leave(id);
                  }}
                >
                  Leave
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-4 w-full rounded-2xl py-2 font-semibold text-error hover:bg-error/10"
              onClick={() => {
                setConfirmLeave(true);
              }}
            >
              Leave group
            </button>
          )}
        </>
      )}
    </Modal>
  );
};
