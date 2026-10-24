import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRingtone, stopRingtone } from './ringtone';
import { useCallSounds } from './useCallSounds';
import { useCallStore } from './useCallStore';

// A stand-in for the Web Audio API that records which tones were started.
const started: number[] = [];
class FakeParam {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  connect() {}
  start() {
    started.push(this.frequency.value);
  }
  stop() {}
}
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
}

const vibrate = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  started.length = 0;
  vibrate.mockClear();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  useCallStore.setState({ callStatus: 'idle' });
});

afterEach(() => {
  stopRingtone();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('ringtone', () => {
  it('rings with the two classic phone tones, twice per cycle, and vibrates a phone', () => {
    startRingtone('ring');
    expect(started).toEqual([440, 480, 440, 480]);
    expect(vibrate).toHaveBeenCalledWith([400, 200, 400, 2000]);
  });

  it('repeats until stopped, then goes quiet and stops the vibration', () => {
    startRingtone('ring');
    const first = started.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(started.length).toBeGreaterThan(first);

    stopRingtone();
    const at = started.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(started.length).toBe(at);
    expect(vibrate).toHaveBeenLastCalledWith(0);
  });

  it('starting the same sound again does not stack a second one', () => {
    startRingtone('ring');
    startRingtone('ring');
    expect(started).toEqual([440, 480, 440, 480]);
  });

  it('plays a single soft tone for the caller and does not vibrate their phone', () => {
    startRingtone('ringback');
    expect(started).toEqual([425]);
    expect(vibrate).not.toHaveBeenCalledWith([400, 200, 400, 2000]);
  });

  it('does not crash on a browser without Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => {
      startRingtone('ring');
    }).not.toThrow();
  });
});

describe('call sounds follow the call', () => {
  const Probe = () => {
    useCallSounds();
    return null;
  };

  it('rings while a call comes in, plays the waiting tone while calling, silent once connected', () => {
    render(<Probe />);
    expect(started).toEqual([]);

    act(() => {
      useCallStore.setState({ callStatus: 'ringing' });
    });
    expect(started.slice(0, 2)).toEqual([440, 480]);

    act(() => {
      useCallStore.setState({ callStatus: 'connected' });
    });
    const quiet = started.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(started.length).toBe(quiet);

    started.length = 0;
    act(() => {
      useCallStore.setState({ callStatus: 'calling' });
    });
    expect(started).toEqual([425]);
  });
});
