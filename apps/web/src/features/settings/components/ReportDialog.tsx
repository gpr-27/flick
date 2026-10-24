// Report a user or a message with POST /reports. Used by the blocked-users list; a chat screen
// opens it with { user_id } or { conversation_id, message_id }.
import { useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

export interface ReportTarget {
  user_id?: string;
  conversation_id?: string;
  message_id?: string;
}

const REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'violence', label: 'Violence' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'scam', label: 'Scam' },
  { value: 'other', label: 'Something else' },
] as const;

type Reason = (typeof REASONS)[number]['value'];

interface ReportDialogProps {
  target: ReportTarget | null;
  onClose: () => void;
  /** The heading; "Report a problem" when the dialog is opened from About. */
  title?: string;
  /** Offer "Also block this user". Off for the Flick account itself. */
  canBlock?: boolean;
}

export const ReportDialog = ({
  target,
  onClose,
  title = 'Report',
  canBlock = true,
}: ReportDialogProps) => {
  const [reason, setReason] = useState<Reason>('spam');
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async (): Promise<void> => {
    if (!target) return;
    setSending(true);
    try {
      await getApi().call(ENDPOINTS.moderation.report, {
        body: { ...target, reason, block, ...(details.trim() ? { details: details.trim() } : {}) },
      });
      notify.success('Thanks, your report was sent.');
      setDetails('');
      setBlock(false);
      onClose();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't send the report."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={target !== null} onClose={onClose} labelledBy="report-title">
      <div className="glass-card w-full max-w-sm space-y-4 rounded-3xl p-6">
        <h2 id="report-title" className="font-display text-lg font-bold">
          {title}
        </h2>
        <label className="block text-sm font-semibold">
          Reason
          <select
            className="select select-bordered mt-1 w-full"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as Reason);
            }}
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Details (optional)
          <textarea
            className="textarea textarea-bordered mt-1 w-full"
            maxLength={2000}
            value={details}
            onChange={(e) => {
              setDetails(e.target.value);
            }}
          />
        </label>
        {target?.user_id && canBlock && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={block}
              onChange={(e) => {
                setBlock(e.target.checked);
              }}
            />
            Also block this user
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={sending}
            onClick={() => void submit()}
          >
            Send report
          </button>
        </div>
      </div>
    </Modal>
  );
};
