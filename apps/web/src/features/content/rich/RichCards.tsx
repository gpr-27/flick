import { ExternalLink, MapPin, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import { isSharing, stopLiveLocation, subscribeLive } from './liveLocation';
import { parseContact, parseLocation, osmLink } from './richMessages';

/** A location or contact-card message drawn as a card; null for any other text. */
export const RichTextCard = ({
  text,
  isMine,
  conversationId,
}: {
  text: string;
  isMine: boolean;
  conversationId?: string | undefined;
}) => {
  const navigate = useNavigate();
  const sharing = useSyncExternalStore(subscribeLive, () =>
    conversationId ? isSharing(conversationId) : false,
  );
  const loc = parseLocation(text);
  if (loc) {
    return (
      <div className="min-w-48">
        <p className="flex items-center gap-2 font-semibold">
          <MapPin className="size-5" aria-hidden="true" />
          {loc.live
            ? loc.ended
              ? 'Live location ended'
              : `Live location, until ${loc.until ?? ''}`
            : 'Location'}
        </p>
        <a
          href={osmLink(loc.lat, loc.lon)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-sm underline"
        >
          Open in OpenStreetMap <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
        {isMine && loc.live && !loc.ended && sharing && conversationId && (
          <button
            type="button"
            onClick={() => {
              stopLiveLocation(conversationId);
            }}
            className="mt-2 block text-sm font-semibold underline"
          >
            Stop sharing
          </button>
        )}
      </div>
    );
  }
  const contact = parseContact(text);
  if (contact) {
    return (
      <div className="flex min-w-48 items-center gap-3">
        <User className="size-8 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{contact.name}</p>
          <p className="truncate text-xs opacity-70">@{contact.username}</p>
          <button
            type="button"
            onClick={() => {
              navigate(`/u/${contact.username}`);
            }}
            className="mt-1 text-sm font-semibold underline"
          >
            Message
          </button>
        </div>
      </div>
    );
  }
  return null;
};
