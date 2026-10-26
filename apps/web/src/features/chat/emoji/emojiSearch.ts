// Emoji search by name or keyword, and the recently used ones (kept on this device).

/** Each emoji with a few space-separated keywords. The order is the order of the picker. */
const DATA: readonly (readonly [string, string])[] = [
  ['😀', 'grin smile happy'],
  ['😁', 'beam grin happy'],
  ['😂', 'laugh lol joy tears funny'],
  ['🤣', 'rofl laugh lol funny'],
  ['😊', 'blush smile happy'],
  ['😍', 'love heart eyes crush'],
  ['😘', 'kiss love'],
  ['😎', 'cool sunglasses'],
  ['🤔', 'think hmm thinking'],
  ['🙄', 'eyeroll annoyed whatever'],
  ['😴', 'sleep tired zzz'],
  ['😭', 'cry sad sob tears'],
  ['😅', 'sweat nervous phew'],
  ['😉', 'wink'],
  ['🥳', 'party celebrate birthday'],
  ['🤩', 'wow star excited'],
  ['👍', 'thumbs up yes ok good like'],
  ['👎', 'thumbs down no bad dislike'],
  ['🙏', 'pray thanks please'],
  ['👏', 'clap applause bravo'],
  ['🙌', 'hooray hands celebrate'],
  ['💪', 'strong muscle flex'],
  ['🔥', 'fire hot lit'],
  ['✨', 'sparkles shine magic'],
  ['🎉', 'party tada celebrate congrats'],
  ['❤️', 'heart love red'],
  ['💯', 'hundred perfect score'],
  ['👀', 'eyes look see'],
  ['😜', 'tongue wink silly'],
  ['🤝', 'handshake deal'],
  ['🫶', 'heart hands love'],
  ['🚀', 'rocket launch fast'],
  ['😢', 'sad cry tear'],
  ['😡', 'angry mad rage'],
  ['😱', 'scream shock scared'],
  ['🤗', 'hug warm'],
  ['🤫', 'shh quiet secret'],
  ['🥰', 'love adore hearts'],
  ['😇', 'angel innocent halo'],
  ['🤯', 'mind blown wow'],
  ['😬', 'grimace awkward'],
  ['🥺', 'pleading puppy please'],
  ['😋', 'yum tasty delicious'],
  ['🤤', 'drool want'],
  ['👋', 'wave hello hi bye'],
  ['✌️', 'peace victory'],
  ['🤞', 'fingers crossed luck'],
  ['👌', 'ok perfect'],
  ['🤌', 'chef pinched italian'],
  ['💔', 'broken heart sad'],
  ['💙', 'blue heart'],
  ['💚', 'green heart'],
  ['🧡', 'orange heart'],
  ['💜', 'purple heart'],
  ['🎂', 'cake birthday'],
  ['🍕', 'pizza food'],
  ['🍔', 'burger food'],
  ['☕', 'coffee tea drink'],
  ['🍺', 'beer drink cheers'],
  ['🍷', 'wine drink'],
  ['🐶', 'dog puppy pet'],
  ['🐱', 'cat kitten pet'],
  ['🌞', 'sun sunny day'],
  ['🌙', 'moon night'],
  ['⭐', 'star favorite'],
  ['🌈', 'rainbow'],
  ['🌧️', 'rain weather'],
  ['⚽', 'soccer football sport'],
  ['🏀', 'basketball sport'],
  ['🎵', 'music note song'],
  ['🎮', 'game controller play'],
  ['📱', 'phone mobile'],
  ['💻', 'laptop computer work'],
  ['📷', 'camera photo'],
  ['🎁', 'gift present'],
  ['✅', 'check done yes'],
  ['❌', 'cross no wrong'],
  ['⚠️', 'warning caution'],
  ['❓', 'question'],
  ['❗', 'exclamation important'],
  ['💡', 'idea bulb'],
  ['⏰', 'alarm clock time'],
  ['🏠', 'home house'],
  ['✈️', 'plane travel flight'],
  ['🚗', 'car drive'],
];

export const ALL_EMOJIS: readonly string[] = DATA.map(([emoji]) => emoji);

/** Emojis whose name or keywords start a word with every typed word ("thumb up" finds 👍). */
export const searchEmojis = (query: string): string[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return DATA.filter(([, keywords]) => {
    const tokens = keywords.split(' ');
    return words.every((w) => tokens.some((t) => t.startsWith(w)));
  }).map(([emoji]) => emoji);
};

const RECENT_KEY = 'flick:recentEmojis';
const RECENT_MAX = 16;

export const readRecentEmojis = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
};

/** Puts the emoji first in the recents (no duplicates, at most 16) and returns the new list. */
export const pushRecentEmoji = (emoji: string): string[] => {
  const next = [emoji, ...readRecentEmojis().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // The list still works for this session.
  }
  return next;
};
