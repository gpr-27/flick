import { useState } from 'react';
import { FLICK_BOT_USER_ID } from '@chat/contracts';
import { InstallButton } from '@/pwa/InstallButton';
import { SHORTCUTS } from '../shortcuts';
import { ActionButton, Card } from './controls';
import { ReportDialog } from './ReportDialog';

const REPO_URL = 'https://github.com/gpr-27/flick';

export const KeyboardShortcuts = () => (
  <Card title="Keyboard shortcuts" className="max-lg:hidden">
    <dl className="space-y-2 text-sm">
      {SHORTCUTS.map((s) => (
        <div key={s.keys} className="flex items-baseline justify-between gap-4">
          <dt>
            <kbd className="kbd kbd-sm">{s.keys}</kbd>
          </dt>
          <dd className="text-right text-base-content/70">{s.does}</dd>
        </div>
      ))}
    </dl>
  </Card>
);

export const AboutSection = () => {
  const [reporting, setReporting] = useState(false);
  return (
    <>
      <KeyboardShortcuts />
      <Card title="About Flick">
        <p className="min-h-[44px] py-1 text-sm">
          <span className="font-semibold">Version</span>{' '}
          <span data-testid="app-version">{__APP_VERSION__}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm min-h-[44px] rounded-2xl"
          >
            Flick on GitHub
          </a>
          <ActionButton
            onClick={() => {
              setReporting(true);
            }}
          >
            Report a problem
          </ActionButton>
          <InstallButton className="min-h-[44px]" />
        </div>
        <ReportDialog
          target={reporting ? { user_id: FLICK_BOT_USER_ID } : null}
          title="Report a problem"
          canBlock={false}
          onClose={() => {
            setReporting(false);
          }}
        />
      </Card>
    </>
  );
};
