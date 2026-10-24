import { describe, expect, it } from 'vitest';
import {
  CALL_VIBRATION,
  answerUrl,
  callNotification,
  callTag,
  declineRequest,
  missedCallNotification,
  parseCallPush,
  planClick,
  type CallPush,
} from './callPush';

const ring = {
  type: 'call',
  call_id: 'c1',
  conversation_id: 'conv1',
  caller_name: 'Praneeth',
  media: 'video',
  decline_token: 'tok-abcdefghijklmnop',
};

describe('parseCallPush', () => {
  it('reads a ring and a cancel', () => {
    expect(parseCallPush(ring)).toEqual(ring);
    expect(parseCallPush({ ...ring, type: 'call_cancel', decline_token: undefined })).toEqual({
      type: 'call_cancel',
      call_id: 'c1',
      conversation_id: 'conv1',
      caller_name: 'Praneeth',
      media: 'video',
    });
  });

  it('ignores message pushes and bad payloads', () => {
    expect(parseCallPush({ title: 'Bob', conversation_id: 'c', message_id: 'm' })).toBeNull();
    expect(parseCallPush({ ...ring, call_id: '' })).toBeNull();
    expect(parseCallPush({ ...ring, conversation_id: 5 })).toBeNull();
    expect(parseCallPush(null)).toBeNull();
    expect(parseCallPush('call')).toBeNull();
  });

  it('falls back to safe defaults', () => {
    const p = parseCallPush({ ...ring, caller_name: 7, media: 'hologram', decline_token: 1 });
    expect(p).toMatchObject({ caller_name: 'Someone', media: 'audio', decline_token: '' });
  });
});

describe('call notification', () => {
  const push = parseCallPush(ring) as CallPush;

  it('says who is calling and offers Answer and Decline, staying until tapped', () => {
    const n = callNotification(push);
    expect(n.title).toBe('Praneeth is calling…');
    expect(n.options.body).toBe('Video call');
    expect(n.options.requireInteraction).toBe(true);
    expect(n.options.actions.map((a) => a.action)).toEqual(['answer', 'decline']);
    expect(n.options.tag).toBe(callTag('c1'));
    expect(n.options.vibrate).toBe(CALL_VIBRATION);
    expect(n.options.data).toMatchObject({ kind: 'call', url: '/?answer=c1', call_id: 'c1' });
  });

  it('says "Voice call" for audio and drops Decline when there is no token', () => {
    const n = callNotification({ ...push, media: 'audio', decline_token: '' });
    expect(n.options.body).toBe('Voice call');
    expect(n.options.actions.map((a) => a.action)).toEqual(['answer']);
    expect(n.options.data.decline_token).toBeUndefined();
  });

  it('vibrates in a ring-pause pattern', () => {
    expect(CALL_VIBRATION.length).toBeGreaterThan(4);
    expect(CALL_VIBRATION.length % 2).toBe(1); // ends on a buzz, not a pause
  });

  it('turns into "Missed call" under the same tag when the call is cancelled', () => {
    const cancel = parseCallPush({ ...ring, type: 'call_cancel' });
    const n = missedCallNotification(cancel as never);
    expect(n.title).toBe('Missed video call');
    expect(n.options.body).toBe('From Praneeth');
    expect(n.options.tag).toBe(callNotification(push).options.tag); // replaces the ring
    expect(n.options.requireInteraction).toBe(false);
    expect(n.options.actions).toEqual([]);
    expect(n.options.data).toMatchObject({ kind: 'missed', url: '/?c=conv1' });
  });
});

describe('what a tap does', () => {
  const data = callNotification(parseCallPush(ring) as CallPush).options.data;

  it('Answer and a tap on the body open the app on the incoming call', () => {
    expect(planClick('answer', data)).toEqual({ type: 'open', url: answerUrl('c1') });
    expect(planClick('', data)).toEqual({ type: 'open', url: '/?answer=c1' });
  });

  it('Decline sends the token, without opening the app', () => {
    expect(planClick('decline', data)).toEqual({
      type: 'decline',
      callId: 'c1',
      token: 'tok-abcdefghijklmnop',
    });
  });

  it('Decline without a token opens the app instead of doing nothing', () => {
    const { decline_token: _token, ...noToken } = data;
    expect(planClick('decline', noToken)).toEqual({ type: 'open', url: '/?answer=c1' });
  });

  it('a missed-call notification opens its chat; a message notification opens its url', () => {
    expect(planClick('', { kind: 'missed', url: '/?c=conv1', call_id: 'c1' })).toEqual({
      type: 'open',
      url: '/?c=conv1',
    });
    expect(planClick('', { url: '/?c=x' })).toEqual({ type: 'open', url: '/?c=x' });
    expect(planClick('', {})).toEqual({ type: 'open', url: '/' });
  });

  it('builds the decline request for the API (base URL may have a path or a trailing slash)', () => {
    const r = declineRequest('https://api.example.com/api/', 'c1', 'tok');
    expect(r.url).toBe('https://api.example.com/api/calls/decline-from-push');
    expect(r.init.method).toBe('POST');
    expect(JSON.parse(r.init.body)).toEqual({ call_id: 'c1', token: 'tok' });
  });
});
