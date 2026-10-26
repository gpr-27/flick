import { describe, expect, it } from 'vitest';
import { matchSlash, parseSlash } from './slashCommands';

describe('slash commands', () => {
  it('lists every command for a bare slash and filters by prefix', () => {
    expect(matchSlash('/')).toHaveLength(4);
    expect(matchSlash('/re').map((c) => c.name)).toEqual(['remind']);
    expect(matchSlash('/zzz')).toEqual([]);
    expect(matchSlash('hello /poll')).toEqual([]);
    expect(matchSlash('/poll now')).toEqual([]);
  });

  it('parses a command with the text after it', () => {
    expect(parseSlash('/remind call mom')).toEqual({ name: 'remind', arg: 'call mom' });
    expect(parseSlash('/POLL')).toEqual({ name: 'poll', arg: '' });
    expect(parseSlash('/flick write a poem\nabout cats')).toEqual({
      name: 'flick',
      arg: 'write a poem\nabout cats',
    });
    expect(parseSlash('/pollution')).toBeNull();
    expect(parseSlash('hi /poll')).toBeNull();
  });
});
