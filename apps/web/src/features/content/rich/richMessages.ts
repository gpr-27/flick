// Location and contact-card messages are ordinary text messages with a fixed shape, so older
// clients just show a readable text with a link. These helpers build and read that text.

export const osmLink = (lat: number, lon: number): string =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}`;

const clock = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export interface LocationInfo {
  lat: number;
  lon: number;
  live: boolean;
  /** Live sharing has stopped. */
  ended: boolean;
  /** "14:30" while live. */
  until: string | null;
}

export const locationText = (
  lat: number,
  lon: number,
  mode: { live: false } | { live: true; until: Date } | { live: true; ended: true },
): string => {
  const title = !mode.live
    ? '📍 Location'
    : 'ended' in mode
      ? '📍 Live location ended'
      : `📍 Live location until ${clock(mode.until)}`;
  return `${title}\n${osmLink(lat, lon)}`;
};

export const parseLocation = (text: string): LocationInfo | null => {
  const m =
    /^📍 (Location|Live location(?: until (\d{2}:\d{2})| ended)?)\nhttps:\/\/www\.openstreetmap\.org\/\?mlat=(-?[\d.]+)&mlon=(-?[\d.]+)/.exec(
      text,
    );
  if (!m) return null;
  const lat = Number(m[3]);
  const lon = Number(m[4]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const live = (m[1] ?? '').startsWith('Live');
  return { lat, lon, live, ended: live && (m[1] ?? '').endsWith('ended'), until: m[2] ?? null };
};

export const contactText = (name: string, username: string, origin: string): string =>
  `👤 ${name.replace(/[\n()]/g, ' ').trim()} (@${username})\n${origin}/u/${username}`;

export const parseContact = (text: string): { name: string; username: string } | null => {
  const m = /^👤 (.+) \(@([A-Za-z0-9_.-]+)\)\nhttps?:\/\/\S+\/u\/\2$/.exec(text);
  return m ? { name: m[1] ?? '', username: m[2] ?? '' } : null;
};

export const isRichText = (text: string): boolean =>
  parseLocation(text) !== null || parseContact(text) !== null;
