import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ENDPOINTS, type InvitePreview } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, Button, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useChatStore } from './useChatStore';

type Preview = z.infer<typeof InvitePreview>;
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: Preview }
  | { kind: 'invalid' }
  | { kind: 'requested' };

/** /join/:code. Shows the group behind an invite link and lets a signed-in user join it. */
const InviteView = ({ code }: { code: string }) => {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.conversations.previewInvite, { params: { code } })
      .then((preview) => {
        if (!cancelled) setState({ kind: 'ready', preview });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'invalid' });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const join = async (): Promise<void> => {
    setJoining(true);
    setError('');
    try {
      const res = await getApi().call(ENDPOINTS.conversations.joinInvite, { params: { code } });
      if (res.status === 'requested') {
        setState({ kind: 'requested' });
        return;
      }
      await useChatStore.getState().loadConversations();
      useChatStore.getState().select(res.conversation_id);
      navigate('/');
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't join the group."));
    } finally {
      setJoining(false);
    }
  };

  const home = (
    <Link to="/" className="btn btn-ghost btn-sm">
      Back to chats
    </Link>
  );

  return (
    <main className="app-bg flex min-h-dvh-screen items-center justify-center px-6 pt-16">
      <div className="surface-raised w-full max-w-sm space-y-4 rounded-2xl p-8 text-center">
        {state.kind === 'loading' && <Spinner size="lg" label="Checking the invite link" />}
        {state.kind === 'invalid' && (
          <>
            <h1 className="text-2xl font-semibold">Link not valid</h1>
            <p className="text-base-content/70">
              This invite link is wrong, expired or was revoked.
            </p>
            {home}
          </>
        )}
        {state.kind === 'requested' && (
          <>
            <h1 className="text-2xl font-semibold">Request sent</h1>
            <p className="text-base-content/70">An admin of the group has to approve you.</p>
            {home}
          </>
        )}
        {state.kind === 'ready' && (
          <>
            <Avatar src={state.preview.avatar_url} name="" size="xl" className="mx-auto" />
            <h1 className="text-2xl font-semibold">{state.preview.title}</h1>
            <p className="text-base-content/70">{state.preview.member_count} members</p>
            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            <Button variant="gradient" size="lg" loading={joining} onClick={() => void join()}>
              {state.preview.approval_required ? 'Request to join' : 'Join group'}
            </Button>
            {home}
          </>
        )}
      </div>
    </main>
  );
};

export const InvitePage = () => {
  const { code = '' } = useParams();
  return <InviteView key={code} code={code} />;
};

export default InvitePage;
