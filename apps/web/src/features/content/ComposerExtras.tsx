// Composer buttons for the content types that are not plain text: GIFs and stickers, polls and
// voice notes. Each one hands a ready message content to `onSend`.
import { useState } from 'react';
import { BarChart3, Sticker } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { cn } from '@/components/ui';
import { GifPicker } from './GifPicker';
import { PollComposer } from './polls/PollComposer';
import { VoiceComposer } from './voice/VoiceComposer';

export const ComposerExtras = ({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (content: MessageContent) => void;
}) => {
  const [gifs, setGifs] = useState(false);
  const [poll, setPoll] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setGifs((v) => !v);
        }}
        disabled={disabled}
        className={cn(
          'btn btn-circle btn-ghost btn-sm',
          gifs ? 'text-primary' : 'text-base-content/60',
        )}
        aria-label="GIFs and stickers"
        aria-expanded={gifs}
        aria-haspopup="dialog"
      >
        <Sticker className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => {
          setPoll(true);
        }}
        disabled={disabled}
        className="btn btn-circle btn-ghost btn-sm text-base-content/60"
        aria-label="Create poll"
      >
        <BarChart3 className="size-5" aria-hidden="true" />
      </button>
      <VoiceComposer disabled={disabled} onSend={onSend} />
      {gifs && (
        <GifPicker
          onPick={(content) => {
            setGifs(false);
            onSend(content);
          }}
          onClose={() => {
            setGifs(false);
          }}
        />
      )}
      <PollComposer
        open={poll}
        onClose={() => {
          setPoll(false);
        }}
        onCreate={(content) => {
          setPoll(false);
          onSend(content);
        }}
      />
    </>
  );
};
