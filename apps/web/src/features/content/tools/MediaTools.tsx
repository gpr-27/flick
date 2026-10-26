import { useState } from 'react';
import { MapPin, Sparkles } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { notify } from '@/components/ui';
import { cn } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { ContactDialog } from './ContactDialog';
import { GifMakerDialog } from './GifMakerDialog';
import { RoundVideoDialog } from './RoundVideoDialog';
import { StickerDialog } from './StickerDialog';
import { sendOneOffLocation, startLiveLocation } from '../rich/liveLocation';

type Tool = 'contact' | 'video' | 'sticker' | 'gif' | null;

/** One composer button that opens the extra send tools: location, contact, video note, sticker, GIF. */
export const MediaTools = ({
  conversationId,
  disabled,
  onSend,
}: {
  conversationId: string;
  disabled: boolean;
  onSend: (c: MessageContent) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>(null);

  const guard = (p: Promise<void>): void => {
    p.catch((error: unknown) => {
      notify.error(getErrorMessage(error, "Couldn't share your location."));
    });
  };
  const items: { label: string; run: () => void }[] = [
    {
      label: 'Send my location',
      run: () => {
        guard(sendOneOffLocation(conversationId));
      },
    },
    {
      label: 'Share live location, 15 min',
      run: () => {
        guard(startLiveLocation(conversationId, 15));
      },
    },
    {
      label: 'Share live location, 1 hour',
      run: () => {
        guard(startLiveLocation(conversationId, 60));
      },
    },
    {
      label: 'Share live location, 8 hours',
      run: () => {
        guard(startLiveLocation(conversationId, 480));
      },
    },
    {
      label: 'Share a contact',
      run: () => {
        setTool('contact');
      },
    },
    {
      label: 'Record a video note',
      run: () => {
        setTool('video');
      },
    },
    {
      label: 'Make a sticker',
      run: () => {
        setTool('sticker');
      },
    },
    {
      label: 'Make a GIF from a video',
      run: () => {
        setTool('gif');
      },
    },
  ];
  const close = (): void => {
    setTool(null);
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-label="More tools"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => {
            setOpen((v) => !v);
          }}
          className={cn(
            'btn btn-circle btn-ghost btn-sm',
            open ? 'text-primary' : 'text-base-content/60',
          )}
        >
          <MapPin className="size-5" aria-hidden="true" />
        </button>
        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              aria-hidden="true"
              onClick={() => {
                setOpen(false);
              }}
            />
            <ul
              role="menu"
              className="glass-card absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-base-content/10 p-1 shadow-xl"
            >
              {items.map((i) => (
                <li key={i.label} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-base-content/5"
                    onClick={() => {
                      setOpen(false);
                      i.run();
                    }}
                  >
                    <Sparkles className="size-3.5 opacity-50" aria-hidden="true" />
                    {i.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {tool === 'contact' && <ContactDialog onSend={onSend} onClose={close} />}
      {tool === 'video' && <RoundVideoDialog onSend={onSend} onClose={close} />}
      {tool === 'sticker' && <StickerDialog onSend={onSend} onClose={close} />}
      {tool === 'gif' && <GifMakerDialog onSend={onSend} onClose={close} />}
    </>
  );
};
