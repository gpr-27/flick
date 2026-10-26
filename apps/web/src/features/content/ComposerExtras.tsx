// Composer buttons for the content types that are not plain text: GIFs and stickers and polls
// (the voice note button is separate, see VoiceComposer). Each one hands a ready message content
// to `onSend`. On phones the whole tool group is hidden: the composer's "+" panel opens the
// pickers through the controlled props. `children` are more tool buttons for the same group.
import type { ReactNode } from 'react';
import { BarChart3, Sticker } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { cn } from '@/components/ui';
import { GifPicker } from './GifPicker';
import { PollComposer } from './polls/PollComposer';

export interface ComposerExtrasProps {
  disabled: boolean;
  /** More buttons for the start of the tool group (emoji, photo, camera, file). */
  children?: ReactNode;
  onSend: (content: MessageContent) => void;
  gifs: boolean;
  onGifsChange: (open: boolean) => void;
  poll: boolean;
  onPollChange: (open: boolean) => void;
}

export const ComposerExtras = ({
  disabled,
  children,
  onSend,
  gifs,
  onGifsChange,
  poll,
  onPollChange,
}: ComposerExtrasProps) => {
  return (
    <>
      {/* One group, centred on the first line of the text box (44px tall). */}
      <div
        role="group"
        aria-label="Attach and insert"
        className="flex h-11 shrink-0 items-center gap-0.5 self-end max-sm:hidden"
      >
        {children}
        <button
          type="button"
          onClick={() => {
            onGifsChange(!gifs);
          }}
          disabled={disabled}
          className={cn(
            'btn btn-circle btn-ghost btn-sm',
            gifs ? 'text-primary' : 'text-base-content/60',
          )}
          aria-label="GIFs and stickers"
          data-guide="composer.gif"
          aria-expanded={gifs}
          aria-haspopup="dialog"
        >
          <Sticker className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            onPollChange(true);
          }}
          disabled={disabled}
          className="btn btn-circle btn-ghost btn-sm text-base-content/60"
          aria-label="Create poll"
          data-guide="composer.poll"
        >
          <BarChart3 className="size-5" aria-hidden="true" />
        </button>
      </div>
      {gifs && (
        <GifPicker
          onPick={(content) => {
            onGifsChange(false);
            onSend(content);
          }}
          onClose={() => {
            onGifsChange(false);
          }}
        />
      )}
      <PollComposer
        open={poll}
        onClose={() => {
          onPollChange(false);
        }}
        onCreate={(content) => {
          onPollChange(false);
          onSend(content);
        }}
      />
    </>
  );
};
