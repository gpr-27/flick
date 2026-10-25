// Composer buttons for the content types that are not plain text: GIFs and stickers, polls and
// voice notes. Each one hands a ready message content to `onSend`. The GIF and poll buttons are
// hidden on phones (the composer's "+" menu opens them through the controlled props); the mic
// stays next to Send.
import { BarChart3, Sticker } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { cn } from '@/components/ui';
import { GifPicker } from './GifPicker';
import { PollComposer } from './polls/PollComposer';
import { VoiceComposer } from './voice/VoiceComposer';

export interface ComposerExtrasProps {
  disabled: boolean;
  /** Extra classes for the microphone button (the composer hides it on phones while Send shows). */
  micClassName?: string | undefined;
  onSend: (content: MessageContent) => void;
  gifs: boolean;
  onGifsChange: (open: boolean) => void;
  poll: boolean;
  onPollChange: (open: boolean) => void;
}

export const ComposerExtras = ({
  disabled,
  micClassName,
  onSend,
  gifs,
  onGifsChange,
  poll,
  onPollChange,
}: ComposerExtrasProps) => {
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onGifsChange(!gifs);
        }}
        disabled={disabled}
        className={cn(
          'btn btn-circle btn-ghost btn-sm max-sm:hidden',
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
        className="btn btn-circle btn-ghost btn-sm text-base-content/60 max-sm:hidden"
        aria-label="Create poll"
        data-guide="composer.poll"
      >
        <BarChart3 className="size-5" aria-hidden="true" />
      </button>
      <VoiceComposer disabled={disabled} onSend={onSend} buttonClassName={micClassName} />
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
