import { ImageOff } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { useAttachmentUrl } from '@/features/chat/content/attachments';
import { TapToDownload } from '@/features/settings/MediaGate';
import { useMediaGate } from '@/features/settings/useMediaGate';

const Caption = ({ text }: { text?: string | undefined }) =>
  text ? (
    <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{text}</p>
  ) : null;

export const VideoView = ({
  attachmentId,
  width,
  height,
  caption,
}: {
  attachmentId: string;
  width: number;
  height: number;
  caption?: string | undefined;
}) => {
  const gate = useMediaGate();
  const { url, failed } = useAttachmentUrl(attachmentId, gate.go);
  return (
    <div>
      {!gate.go ? (
        <TapToDownload noun="video" onClick={gate.load} />
      ) : url ? (
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          aria-label={caption ?? 'Video'}
          style={{ aspectRatio: `${width} / ${height}` }}
          className="block max-h-80 w-auto max-w-[18rem] rounded-xl bg-black"
        />
      ) : (
        <div
          style={{ aspectRatio: `${width} / ${height}` }}
          className="grid max-h-80 w-56 place-items-center rounded-xl bg-base-content/10 text-base-content/50"
        >
          {failed ? (
            <ImageOff className="size-6" aria-label="Video unavailable" />
          ) : (
            <Spinner size="sm" label="Loading video" />
          )}
        </div>
      )}
      <Caption text={caption} />
    </div>
  );
};

/** GIFs and stickers are hosted by GIPHY; the server only checked that the url is http(s). */
export const RemoteImage = ({
  url,
  label,
  width,
  height,
  caption,
  sticker = false,
}: {
  url: string;
  label: string;
  width?: number;
  height?: number;
  caption?: string | undefined;
  sticker?: boolean;
}) => (
  <div>
    <img
      src={url}
      alt={label}
      loading="lazy"
      referrerPolicy="no-referrer"
      {...(width && height
        ? { width, height, style: { aspectRatio: `${width} / ${height}` } }
        : {})}
      className={
        sticker
          ? 'block size-32 object-contain'
          : 'block h-auto max-h-72 w-auto max-w-[16rem] rounded-xl object-contain'
      }
    />
    <Caption text={caption} />
  </div>
);
