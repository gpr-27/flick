// Tic-tac-toe move rules for the game card. Pure, so it can be tested without a database.
// The web card has the same rules for what a player may do (features/grouptools/games.ts).

export interface TicTacToeState {
  board?: string[];
  turn?: 'x' | 'o';
  x?: string;
  o?: string;
  /** Set when the chat has one person (Saved messages): that person plays both X and O. */
  solo?: boolean;
}

export class MoveError extends Error {
  constructor(
    readonly code: 'NOT_YOUR_TURN' | 'TAKEN' | 'OUT_OF_RANGE',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Applies one move and returns the new state.
 * With two or more people the first to move is X and the next different person is O, and they take
 * turns. In a chat with only one member there is nobody else, so that person plays both sides.
 */
export function applyTicTacToeMove(
  state: TicTacToeState,
  me: string,
  cell: number,
  soloChat: boolean,
): TicTacToeState {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
    throw new MoveError('OUT_OF_RANGE', 'That square does not exist.');
  }
  const board = state.board ? [...state.board] : Array.from({ length: 9 }, () => '');
  const turn = state.turn ?? 'x';
  const players = { x: state.x, o: state.o };

  if (soloChat) {
    players.x = me;
    players.o = me;
  } else {
    if (!players[turn] && players.x !== me && players.o !== me) players[turn] = me;
    if (players[turn] !== me) throw new MoveError('NOT_YOUR_TURN', "It's not your turn.");
  }
  if (board[cell]) throw new MoveError('TAKEN', 'That square is taken.');

  board[cell] = turn;
  return {
    ...state,
    ...players,
    board,
    turn: turn === 'x' ? 'o' : 'x',
    ...(soloChat ? { solo: true } : {}),
  };
}
