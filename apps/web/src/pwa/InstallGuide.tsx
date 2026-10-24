import { Download, MoreVertical, PlusSquare, Share } from 'lucide-react';
import { Modal } from '@/components/ui';
import { closeInstallGuide, isAndroid, isInAppBrowser, isIos, useInstallStore } from './install';

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex items-start gap-3">
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
      {n}
    </span>
    <span className="pt-0.5 text-base">{children}</span>
  </li>
);

/** The steps for this phone, as a bottom sheet. Mounted once; opened from the Install buttons. */
export const InstallGuide = () => {
  const open = useInstallStore((s) => s.guideOpen);
  const ios = isIos();
  const inApp = isInAppBrowser();

  let steps: React.ReactNode;
  if (inApp) {
    // Instagram, WhatsApp and similar open links in their own viewer, which cannot install apps.
    steps = (
      <>
        <Step n={1}>
          Open the <strong>⋯</strong> or <strong>share</strong> button in this window.
        </Step>
        <Step n={2}>
          Choose <strong>Open in {ios ? 'Safari' : 'Chrome'}</strong> (or &ldquo;Open in
          browser&rdquo;).
        </Step>
        <Step n={3}>Then tap Install app again.</Step>
      </>
    );
  } else if (ios) {
    steps = (
      <>
        <Step n={1}>
          Tap the <Share className="mx-1 inline size-4" aria-label="Share" role="img" />{' '}
          <strong>Share</strong> button at the bottom of Safari.
        </Step>
        <Step n={2}>
          Scroll down and tap <PlusSquare className="mx-1 inline size-4" aria-hidden="true" />
          <strong>Add to Home Screen</strong>.
        </Step>
        <Step n={3}>
          Tap <strong>Add</strong>. Flick now opens full screen, like any other app.
        </Step>
      </>
    );
  } else if (isAndroid()) {
    steps = (
      <>
        <Step n={1}>
          Tap the <MoreVertical className="mx-1 inline size-4" aria-label="Menu" role="img" />{' '}
          <strong>menu</strong> in your browser.
        </Step>
        <Step n={2}>
          Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
        </Step>
        <Step n={3}>
          Tap <strong>Install</strong>. Flick opens full screen from your home screen.
        </Step>
      </>
    );
  } else {
    steps = (
      <Step n={1}>
        Use your browser&rsquo;s menu and choose <strong>Install</strong> or{' '}
        <strong>Add to Home screen</strong>.
      </Step>
    );
  }

  return (
    <Modal
      open={open}
      onClose={closeInstallGuide}
      label="Install Flick"
      overlayClassName="items-end p-0 sm:items-center sm:p-4"
      className="w-full sm:w-96"
    >
      <div className="glass-card flex flex-col gap-4 rounded-t-3xl border border-base-content/10 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Download className="size-5 text-primary" aria-hidden="true" /> Install Flick
        </h2>
        <p className="text-sm text-base-content/70">
          A home-screen app opens faster, runs full screen and can send you notifications.
        </p>
        <ol className="flex flex-col gap-3">{steps}</ol>
        <button type="button" className="btn btn-primary h-12" onClick={closeInstallGuide}>
          Got it
        </button>
      </div>
    </Modal>
  );
};
