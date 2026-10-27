// How many photos and videos one send may hold, and what to say when a pick is too big.
// Pure: no browser APIs, so it is tested with plain objects.
import { formatBytes, LIMITS } from '@chat/contracts';
import { FileTooLargeError } from '../upload';

interface Sized {
  name: string;
  size: number;
}

export interface TrimResult<F extends Sized> {
  /** The files that fit, in the order they were picked. */
  accepted: F[];
  /** Files over the per-file limit; only these are rejected, with the message to show. */
  tooLarge: { file: F; message: string }[];
  /** Plain-language explanations of everything that was dropped (empty when all fit). */
  notices: string[];
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Applies the album limits to a pick. `current` is what the tray already holds. The first files
 * that fit are kept, in order, and every drop is explained with the numbers and the reason:
 *  - a file over MAX_UPLOAD_BYTES is rejected on its own (FileTooLargeError's message);
 *  - more than MAX_ALBUM_ITEMS items in total: the first ones that fit are kept;
 *  - more than MAX_ALBUM_BYTES in total: the first files that fit are kept.
 */
export const trimPicked = <F extends Sized>(
  current: { count: number; bytes: number },
  picked: readonly F[],
): TrimResult<F> => {
  const notices: string[] = [];
  const tooLarge: TrimResult<F>['tooLarge'] = [];
  const candidates: F[] = [];
  for (const file of picked) {
    if (file.size > LIMITS.MAX_UPLOAD_BYTES) {
      const error = new FileTooLargeError(file.size, LIMITS.MAX_UPLOAD_BYTES);
      tooLarge.push({
        file,
        message: picked.length > 1 ? `${file.name}: ${error.message}` : error.message,
      });
    } else {
      candidates.push(file);
    }
  }
  for (const { message } of tooLarge) notices.push(message);

  // Count.
  const room = Math.max(0, LIMITS.MAX_ALBUM_ITEMS - current.count);
  let kept = candidates;
  if (candidates.length > room) {
    const picks = current.count + candidates.length;
    const max = String(LIMITS.MAX_ALBUM_ITEMS);
    const why = `You can send up to ${max} photos and videos at once (you picked ${String(picks)}) so uploads stay reliable.`;
    if (room === 0) notices.push(`${why} This send is full, so nothing new was added.`);
    else if (current.count === 0) notices.push(`${why} The first ${String(room)} were kept.`);
    else
      notices.push(
        `${why} Only ${String(room)} more fit, so the first ${String(room)} of the new ${plural(candidates.length, 'file', 'files')} ${plural(room, 'was', 'were')} kept.`,
      );
    kept = candidates.slice(0, room);
  }

  // Total size.
  const total = current.bytes + kept.reduce((sum, f) => sum + f.size, 0);
  if (total > LIMITS.MAX_ALBUM_BYTES) {
    const accepted: F[] = [];
    let bytes = current.bytes;
    for (const file of kept) {
      if (bytes + file.size > LIMITS.MAX_ALBUM_BYTES) break;
      bytes += file.size;
      accepted.push(file);
    }
    const limit = formatBytes(LIMITS.MAX_ALBUM_BYTES);
    const why = `These files add up to ${formatBytes(total)}; the limit for one send is ${limit} so uploads stay reliable.`;
    notices.push(
      accepted.length === 0
        ? `${why} None of the new files fit.`
        : `${why} The first ${String(accepted.length)} that fit ${plural(accepted.length, 'was', 'were')} kept.`,
    );
    kept = accepted;
  }

  return { accepted: kept, tooLarge, notices };
};
