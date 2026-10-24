// A compact card for the first link in a text message. Everything from the page (title,
// description, site) is shown as plain text: React escapes it, and there is no innerHTML.
import { useEffect, useState } from 'react';
import { ENDPOINTS, type LinkPreview } from '@chat/contracts';
import type { z } from 'zod';
import { getApi } from '@/lib/services';

type Preview = z.infer<typeof LinkPreview>;

// One request per link per tab. A failed lookup (422 unreadable page, 429 rate limit) is
// remembered too, so scrolling does not retry it.
const cache = new Map<string, Promise<Preview | null>>();

const loadPreview = (url: string): Promise<Preview | null> => {
  let request = cache.get(url);
  if (!request) {
    request = getApi()
      .call(ENDPOINTS.media.linkPreview, { query: { url } })
      .catch(() => null);
    cache.set(url, request);
  }
  return request;
};

export const LinkPreviewCard = ({ url }: { url: string }) => {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPreview(url).then((result) => {
      if (alive) setPreview(result);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!preview || (!preview.title && !preview.description)) return null;
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-xl bg-black/10 no-underline"
      aria-label={`Link preview: ${preview.title ?? preview.url}`}
    >
      {preview.image_url && (
        <img
          src={preview.image_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-40 w-full object-cover"
        />
      )}
      <span className="block px-3 py-2">
        {preview.site_name && (
          <span className="block truncate text-xs uppercase opacity-70">{preview.site_name}</span>
        )}
        {preview.title && (
          <span className="line-clamp-2 block text-sm font-semibold">{preview.title}</span>
        )}
        {preview.description && (
          <span className="line-clamp-2 block text-xs opacity-80">{preview.description}</span>
        )}
      </span>
    </a>
  );
};
