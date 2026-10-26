import { describe, expect, it } from 'vitest';
import {
  MAX_VERSIONS,
  NO_VERSIONS,
  addVersion,
  currentVersion,
  placeResult,
  replaceRange,
  stepVersion,
  versionLabel,
} from './composeVersions';
import {
  DEFAULT_PREFS,
  addRecentPrompt,
  prefsFields,
  readPrefs,
  readRecentPrompts,
  saveRecentPrompt,
  savePrefs,
} from './composePrefs';

describe('versions', () => {
  it('starts empty and has no label', () => {
    expect(currentVersion(NO_VERSIONS)).toBeNull();
    expect(versionLabel(NO_VERSIONS)).toBeNull();
    expect(stepVersion(NO_VERSIONS, 1)).toBe(NO_VERSIONS);
  });

  it('a new draft becomes the current one; the label shows from two drafts', () => {
    const one = addVersion(NO_VERSIONS, 'a');
    expect(versionLabel(one)).toBeNull();
    const three = addVersion(addVersion(one, 'b'), 'c');
    expect(currentVersion(three)).toBe('c');
    expect(versionLabel(three)).toBe('3 of 3');
  });

  it('steps back and forth and stops at both ends', () => {
    let v = addVersion(addVersion(addVersion(NO_VERSIONS, 'a'), 'b'), 'c');
    v = stepVersion(v, -1);
    expect(currentVersion(v)).toBe('b');
    expect(versionLabel(v)).toBe('2 of 3');
    v = stepVersion(stepVersion(v, -1), -1);
    expect(currentVersion(v)).toBe('a');
    v = stepVersion(stepVersion(stepVersion(v, 1), 1), 1);
    expect(currentVersion(v)).toBe('c');
  });

  it('keeps only the newest drafts', () => {
    let v = NO_VERSIONS;
    for (let i = 0; i < MAX_VERSIONS + 3; i++) v = addVersion(v, `v${i}`);
    expect(v.items).toHaveLength(MAX_VERSIONS);
    expect(currentVersion(v)).toBe(`v${MAX_VERSIONS + 2}`);
    expect(v.items[0]).toBe('v3');
  });
});

describe('placeResult and replaceRange', () => {
  it('insert adds after the text, replace (or an empty box) uses the draft alone', () => {
    expect(placeResult('Hi Ravi  ', 'Late', 'insert')).toBe('Hi Ravi\nLate');
    expect(placeResult('Hi Ravi', 'Late', 'replace')).toBe('Late');
    expect(placeResult('  ', 'Late', 'insert')).toBe('Late');
  });

  it('replaces only the selected range', () => {
    expect(replaceRange('say helo wrld now', 4, 13, 'hello world')).toBe('say hello world now');
  });
});

describe('preferences', () => {
  it('keeps the last five prompts, newest first, without repeats', () => {
    let list: string[] = [];
    for (const p of ['a', 'b', 'c', 'd', 'e', 'f', 'C']) list = addRecentPrompt(list, p);
    expect(list).toEqual(['C', 'f', 'e', 'd', 'b']);
    expect(addRecentPrompt(list, '  ')).toEqual(list);
  });

  it('remembers prompts and settings in localStorage and survives bad data', () => {
    localStorage.clear();
    saveRecentPrompt('first');
    saveRecentPrompt('second');
    expect(readRecentPrompts()).toEqual(['second', 'first']);
    savePrefs({ tone: 'formal', length: 'longer' });
    expect(readPrefs()).toEqual({ tone: 'formal', length: 'longer' });
    localStorage.setItem('flick.compose.prefs', '{"tone":"angry","length":5}');
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem('flick.compose.prompts', 'not json');
    expect(readRecentPrompts()).toEqual([]);
  });

  it('sends only the settings that differ from the default', () => {
    expect(prefsFields(DEFAULT_PREFS)).toEqual({});
    expect(prefsFields({ tone: 'casual', length: 'shorter' })).toEqual({
      tone: 'casual',
      length: 'shorter',
    });
  });
});
