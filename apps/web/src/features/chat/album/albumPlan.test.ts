import { LIMITS } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import {
  assignBatch,
  buildContent,
  canSend,
  nextToSend,
  nextToUpload,
  type ItemStatus,
  type PlanItem,
} from './albumPlan';

const item = (id: string, status: ItemStatus, kind: PlanItem['kind'] = 'image'): PlanItem => ({
  id,
  kind,
  status,
  fileName: `${id}.x`,
  fileSize: 1000,
  ...(status === 'ready' || status === 'sent'
    ? { result: { attachmentId: `att-${id}`, width: 10, height: 20, durationMs: 3000 } }
    : {}),
});
const opts = { batchId: 'b1', albumId: 'a1', caption: 'hi', replyTo: null };

describe('uploads', () => {
  it('starts at most 3 at a time, oldest first', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id, 'waiting'));
    expect(nextToUpload(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    const running = [item('a', 'uploading'), item('b', 'uploading'), ...items.slice(2)];
    expect(nextToUpload(running).map((i) => i.id)).toEqual(['c']);
    expect(LIMITS.MAX_ALBUM_CONCURRENT_UPLOADS).toBe(3);
    const full = [
      item('a', 'uploading'),
      item('b', 'uploading'),
      item('c', 'uploading'),
      item('d', 'waiting'),
    ];
    expect(nextToUpload(full)).toEqual([]);
  });
});

describe('assignBatch', () => {
  it('numbers photos and videos as one album, with the caption on the first', () => {
    const out = assignBatch(
      [item('a', 'ready'), item('b', 'waiting', 'video'), item('c', 'ready', 'file')],
      opts,
    );
    expect(out.map((i) => i.batch?.order)).toEqual([0, 1, 2]);
    expect(out[0]?.batch?.album).toEqual({ id: 'a1', index: 0, count: 2, videos: 1 });
    expect(out[1]?.batch?.album).toEqual({ id: 'a1', index: 1, count: 2, videos: 1 });
    expect(out[2]?.batch?.album).toBeNull(); // a file is its own message
    expect(out.map((i) => i.batch?.caption)).toEqual(['hi', '', '']);
  });

  it('one photo is not an album; failed items stay out', () => {
    const out = assignBatch([item('a', 'ready'), item('b', 'failed')], opts);
    expect(out[0]?.batch?.album).toBeNull();
    expect(out[1]?.batch).toBeUndefined();
  });
});

describe('sending in order', () => {
  const batched = (statuses: ItemStatus[]) =>
    assignBatch(
      statuses.map((s, i) => item(String(i), s)),
      opts,
    );

  it('waits for earlier items', () => {
    const items = batched(['ready', 'uploading', 'ready']);
    expect(nextToSend(items).map((i) => i.id)).toEqual(['0']);
  });

  it('sends all that are ready in order once the first ones are', () => {
    expect(nextToSend(batched(['ready', 'ready', 'ready'])).map((i) => i.id)).toEqual([
      '0',
      '1',
      '2',
    ]);
  });

  it('a failed item does not hold the others back', () => {
    const items = batched(['ready', 'ready', 'ready']).map((i) =>
      i.id === '1' ? { ...i, status: 'failed' as const } : i,
    );
    expect(nextToSend(items).map((i) => i.id)).toEqual(['0', '2']);
  });

  it('never sends a draft that has no batch yet', () => {
    expect(nextToSend([item('a', 'ready')])).toEqual([]);
  });

  it('is disabled when nothing can still go out', () => {
    expect(canSend([])).toBe(false);
    expect(canSend([item('a', 'failed')])).toBe(false);
    expect(canSend([item('a', 'uploading')])).toBe(true);
    expect(canSend([item('a', 'failed'), item('b', 'ready')])).toBe(true);
  });
});

describe('buildContent', () => {
  it('writes album metadata on photos and videos', () => {
    const [a, b] = assignBatch([item('a', 'ready'), item('b', 'ready', 'video')], opts);
    expect(buildContent(a as PlanItem)).toEqual({
      type: 'image',
      attachment_id: 'att-a',
      width: 10,
      height: 20,
      album: { id: 'a1', index: 0, count: 2, videos: 1 },
      caption: 'hi',
    });
    expect(buildContent(b as PlanItem)).toMatchObject({
      type: 'video',
      duration_ms: 3000,
      album: { id: 'a1', index: 1, count: 2, videos: 1 },
    });
  });

  it('files carry no album', () => {
    const [f] = assignBatch([item('f', 'ready', 'file')], opts);
    expect(buildContent(f as PlanItem)).toEqual({
      type: 'file',
      attachment_id: 'att-f',
      file_name: 'f.x',
      size: 1000,
      caption: 'hi',
    });
  });
});
