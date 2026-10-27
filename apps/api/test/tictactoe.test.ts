import { describe, expect, it } from 'vitest';
import { applyTicTacToeMove, MoveError } from '../src/modules/grouptools/tictactoe.js';

describe('tic-tac-toe moves', () => {
  it('two people: the first mover is X, the next different person is O, and they take turns', () => {
    let state = applyTicTacToeMove({}, 'ann', 0, false);
    expect(state).toMatchObject({ x: 'ann', turn: 'o' });
    expect(() => applyTicTacToeMove(state, 'ann', 1, false)).toThrow(MoveError);
    state = applyTicTacToeMove(state, 'bob', 1, false);
    expect(state).toMatchObject({
      x: 'ann',
      o: 'bob',
      turn: 'x',
      board: ['x', 'o'].concat(Array(7).fill('')),
    });
  });

  it('refuses a taken square and a square that does not exist', () => {
    const state = applyTicTacToeMove({}, 'ann', 4, false);
    expect(() => applyTicTacToeMove(state, 'bob', 4, false)).toThrow('taken');
    expect(() => applyTicTacToeMove({}, 'ann', 9, false)).toThrow('does not exist');
    expect(() => applyTicTacToeMove({}, 'ann', -1, false)).toThrow('does not exist');
  });

  it('one person alone (Saved messages): plays X and O in turn', () => {
    let state = applyTicTacToeMove({}, 'me', 0, true);
    expect(state).toMatchObject({ x: 'me', o: 'me', turn: 'o', solo: true });
    state = applyTicTacToeMove(state, 'me', 4, true);
    expect(state.board?.[0]).toBe('x');
    expect(state.board?.[4]).toBe('o');
    expect(state.turn).toBe('x');
    state = applyTicTacToeMove(state, 'me', 1, true);
    expect(state.board?.[1]).toBe('x');
  });
});
