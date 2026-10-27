import { describe, expect, it } from 'vitest';
import { canMove, emptyBoard, ticTacToeResult, wyrTally, type TicTacToeState } from './games';

describe('tic-tac-toe', () => {
  it('detects wins and draws', () => {
    const b = emptyBoard();
    expect(ticTacToeResult(b)).toBeNull();
    b[0] = 'x';
    b[4] = 'x';
    b[8] = 'x';
    expect(ticTacToeResult(b)).toBe('x');
    expect(ticTacToeResult(['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', 'x'])).toBe('draw');
  });
  it('lets two different people take turns', () => {
    expect(canMove({}, 'ann')).toBe(true);
    expect(canMove({ x: 'ann', turn: 'o' }, 'ann')).toBe(false);
    expect(canMove({ x: 'ann', turn: 'o' }, 'bob')).toBe(true);
    expect(canMove({ x: 'ann', o: 'bob', turn: 'x' }, 'bob')).toBe(false);
    expect(canMove({ x: 'ann', o: 'bob', turn: 'x' }, 'ann')).toBe(true);
  });
});

describe('would you rather', () => {
  it('counts votes', () => {
    expect(wyrTally({ votes: { a: 'a', b: 'b', c: 'a' } })).toEqual({ a: 2, b: 1 });
    expect(wyrTally({})).toEqual({ a: 0, b: 0 });
  });
});

describe('tic-tac-toe in a chat with only yourself', () => {
  it('lets the same person play X and then O until the game ends', () => {
    expect(
      canMove(
        { x: 'me', turn: 'o', solo: true, board: ['x', '', '', '', '', '', '', '', ''] },
        'me',
      ),
    ).toBe(true);
    const won: TicTacToeState = {
      solo: true,
      x: 'me',
      o: 'me',
      turn: 'o',
      board: ['x', 'x', 'x', 'o', 'o', '', '', '', ''],
    };
    expect(canMove(won, 'me')).toBe(false);
  });

  it('without the flag the second mark still needs a different person', () => {
    expect(
      canMove({ x: 'me', turn: 'o', board: ['x', '', '', '', '', '', '', '', ''] }, 'me'),
    ).toBe(false);
  });
});
