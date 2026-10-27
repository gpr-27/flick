import { Markdown } from '@/features/content/richText/Markdown';
import { useEffect, useState } from 'react';
import { Modal, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { makePlan } from './writingApi';

type Plan = Awaited<ReturnType<typeof makePlan>>;

const slotLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });

/**
 * "Plan dinner with Ravi on Friday": a few free times (your reminders and scheduled messages count
 * as busy) and a drafted invitation. Picking a time puts the invitation in the message box.
 */
export const PlanDialog = ({
  open,
  request,
  conversationId,
  onUse,
  onClose,
}: {
  open: boolean;
  request: string;
  conversationId: string;
  onUse: (message: string) => void;
  onClose: () => void;
}) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new request starts from a clean slate (adjusted during render, not in an effect).
  const planKey = open && request.trim() ? `${conversationId}:${request}` : null;
  const [prevPlanKey, setPrevPlanKey] = useState(planKey);
  if (prevPlanKey !== planKey) {
    setPrevPlanKey(planKey);
    if (planKey !== null) {
      setPlan(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open || !request.trim()) return;
    let live = true;
    makePlan(request, conversationId)
      .then((p) => {
        if (live) setPlan(p);
      })
      .catch((e: unknown) => {
        if (live) setError(getErrorMessage(e, 'Flick could not plan that.'));
      });
    return () => {
      live = false;
    };
  }, [open, request, conversationId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Plan"
      overlayClassName="max-sm:items-end sm:p-4"
      className="w-full sm:w-[28rem]"
    >
      <div className="glass-card flex flex-col gap-3 rounded-t-3xl border border-base-content/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm shadow-2xl sm:rounded-2xl">
        <h2 className="text-base font-semibold">{plan?.title ?? 'Plan'}</h2>
        {!plan && !error && <Spinner size="sm" label="Planning" />}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {plan && (
          <>
            <p className="text-xs text-[var(--text-2)]">
              {plan.busy_count > 0
                ? `Times skip your ${plan.busy_count} reminder${plan.busy_count === 1 ? '' : 's'} and scheduled message${plan.busy_count === 1 ? '' : 's'}.`
                : 'Pick a time for the invitation.'}
            </p>
            <Markdown text={plan.invitation} className="rounded-xl bg-sunken p-3" />
            <div className="flex flex-col gap-2">
              {plan.slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn btn-outline h-12 justify-start"
                  onClick={() => {
                    onUse(`${plan.invitation}\n${slotLabel(s)}?`);
                    onClose();
                  }}
                >
                  {slotLabel(s)}
                </button>
              ))}
            </div>
          </>
        )}
        <button type="button" className="btn btn-ghost h-12" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
};
