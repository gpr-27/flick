import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Phone, Video } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { getApi } from '@/lib/services';
import { groupCallErrorMessage } from './errors';
import type { CallLink } from './types';
import { useGroupCallStore } from './useGroupCallStore';

type LinkState =
  | { kind: 'loading' }
  | { kind: 'ready'; link: CallLink }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

const resolve = async (code: string): Promise<LinkState> => {
  try {
    const link = await getApi().call(ENDPOINTS.calls.getLink, { params: { code } });
    return Date.parse(link.expires_at) <= Date.now()
      ? { kind: 'expired' }
      : { kind: 'ready', link };
  } catch (error) {
    // A malformed code never reaches the server (the params schema rejects it).
    if (!(error instanceof ApiError) || error.status === 404) return { kind: 'invalid' };
    if (error.status === 410) return { kind: 'expired' };
    return { kind: 'error', message: groupCallErrorMessage(error) };
  }
};

const Card = ({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) => (
  <main className="app-bg flex min-h-dvh-screen items-center justify-center px-6 pt-16">
    <div className="glass-card w-full max-w-sm space-y-4 rounded-3xl p-8 text-center">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      {body && <p className="text-base-content/70">{body}</p>}
      {children}
    </div>
  </main>
);

/** /call/:token. Only mounted for signed-in users; the sign-in page comes first otherwise. */
const CallLinkView = ({ token }: { token: string }) => {
  const [state, setState] = useState<LinkState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const callStatus = useGroupCallStore((s) => s.status);

  useEffect(() => {
    let cancelled = false;
    void resolve(token).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const home = (
    <Link to="/" className="btn btn-ghost btn-sm">
      Back to chats
    </Link>
  );

  switch (state.kind) {
    case 'loading':
      return (
        <Card title="Checking the call link…">
          <Spinner size="lg" label="Checking the call link" />
        </Card>
      );
    case 'invalid':
      return (
        <Card title="Link not found" body="This call link is wrong or was revoked.">
          {home}
        </Card>
      );
    case 'expired':
      return (
        <Card title="Link expired" body="Ask the person who sent it for a new call link.">
          {home}
        </Card>
      );
    case 'error':
      return (
        <Card title="Can't open this link" body={state.message}>
          <Button
            variant="gradient"
            onClick={() => {
              setState({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </Card>
      );
    case 'ready': {
      const Icon = state.link.media === 'video' ? Video : Phone;
      return (
        <Card
          title={state.link.media === 'video' ? 'Video call' : 'Voice call'}
          body="You were invited to a group call."
        >
          <Button
            variant="gradient"
            size="lg"
            loading={callStatus === 'joining'}
            icon={<Icon className="size-5" aria-hidden="true" />}
            onClick={() => void useGroupCallStore.getState().join({ call_link: token })}
          >
            Join call
          </Button>
          {home}
        </Card>
      );
    }
  }
};

export const CallLinkPage = () => {
  const { token = '' } = useParams();
  // Keyed so a different link starts again from "loading".
  return <CallLinkView key={token} token={token} />;
};

export default CallLinkPage;
