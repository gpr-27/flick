// A small card at the top of the chat list: "New here? Take a 1-minute tour" for someone who has
// been around a while (never forced on them), or "Resume tour" after the tour was closed halfway.
import { GraduationCap } from 'lucide-react';
import { useGuideStore } from './useGuideStore';
import { WELCOME_CARD_ID, resumeWelcome, startWelcome, useWelcomeState } from './welcomeRules';

export const WelcomeCard = () => {
  const { offer, resume } = useWelcomeState();
  const active = useGuideStore((s) => s.active !== null);
  if (active || (!offer && !resume)) return null;
  const { markSeen, dismissResume } = useGuideStore.getState();

  return (
    <section
      aria-label="Tour of Flick"
      className="mx-3 mt-3 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/10 p-3"
    >
      <GraduationCap className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{resume ? 'Pick up the tour' : 'New here?'}</p>
        <p className="text-base text-base-content/70">
          {resume
            ? 'You stopped part of the way through. Carry on where you left off.'
            : 'Take a 1-minute tour to see how everything works.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm min-h-[44px] text-base"
            onClick={resume ? resumeWelcome : startWelcome}
          >
            {resume ? 'Resume tour' : 'Take the tour'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-[44px] text-base"
            onClick={() => {
              if (resume) dismissResume();
              else markSeen(WELCOME_CARD_ID);
            }}
          >
            {resume ? 'Dismiss' : 'Not now'}
          </button>
        </div>
      </div>
    </section>
  );
};
