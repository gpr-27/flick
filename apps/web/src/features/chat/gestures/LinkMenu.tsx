import { Copy, ExternalLink } from 'lucide-react';
import { Modal, cn, notify } from '@/components/ui';
import { haptic } from './haptics';
import { useSheetSwipeDown } from './useSheetSwipeDown';

const row =
  'flex min-h-[48px] w-full items-center gap-4 rounded-xl px-4 text-left text-base active:bg-base-200 hover:bg-base-200';

/** Holding a link in a message offers these two, instead of the whole message menu. */
export const LinkMenu = ({ href, onClose }: { href: string; onClose: () => void }) => {
  const sheet = useSheetSwipeDown(onClose);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(href);
      notify.success('Link copied');
    } catch {
      notify.error("Couldn't copy");
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      label="Link actions"
      overlayClassName="max-sm:items-end sm:p-4"
      className="w-full sm:w-80"
    >
      <div
        {...sheet.props}
        style={sheet.style}
        className={cn(
          'glass-card flex touch-pan-x flex-col gap-1 rounded-t-3xl border border-base-content/10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl',
        )}
      >
        <div
          className="mx-auto mb-1 h-1 w-10 rounded-full bg-base-content/20 sm:hidden"
          aria-hidden="true"
        />
        <p className="truncate px-4 py-1 text-xs text-base-content/60">{href}</p>
        <div role="menu" aria-label="Link actions" className="flex flex-col">
          <button
            type="button"
            role="menuitem"
            className={row}
            onClick={() => {
              haptic();
              onClose();
              void copy();
            }}
          >
            <Copy className="size-5" aria-hidden="true" />
            Copy link
          </button>
          <a
            role="menuitem"
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={row}
            onClick={onClose}
          >
            <ExternalLink className="size-5" aria-hidden="true" />
            Open
          </a>
        </div>
      </div>
    </Modal>
  );
};
