import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, Modal } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import type { LinkAssessment } from './linkSafety';

/** Shown before a suspicious link opens: why it looks risky, optional AI check, open anyway or cancel. */
export const LinkWarning = ({
  href,
  risk,
  onClose,
}: {
  href: string;
  risk: LinkAssessment;
  onClose: () => void;
}) => {
  const aiOn = useAiEnabled();
  const [verdict, setVerdict] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const res = await getApi().call(ENDPOINTS.groupTools.linkCheck, { body: { url: href } });
      setVerdict(res.text);
    } catch (error) {
      setVerdict(getErrorMessage(error, "Couldn't check this link."));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="link-warning-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-2 flex items-center gap-2 text-warning">
        <ShieldAlert className="size-6" aria-hidden="true" />
        <h2 id="link-warning-title" className="font-display text-lg font-bold">
          {risk.level === 'danger' ? 'This link looks dangerous' : 'Be careful with this link'}
        </h2>
      </div>
      <p className="mb-2 break-all rounded-xl bg-base-content/5 p-2 text-xs">{href}</p>
      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
        {risk.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {verdict && (
        <p role="status" className="mb-3 rounded-xl bg-primary/10 p-2 text-sm">
          {verdict}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {aiOn && !verdict && (
          <Button variant="ghost" loading={checking} onClick={() => void check()}>
            Check with AI
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="btn btn-error btn-sm"
          onClick={onClose}
        >
          Open anyway
        </a>
      </div>
    </Modal>
  );
};
