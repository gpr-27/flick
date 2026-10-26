// Rules for the two quick games. Pure; the server applies moves the same way (see grouptools/routes.ts).

export type Mark = 'x' | 'o' | '';
export interface TicTacToeState {
  board?: Mark[];
  turn?: 'x' | 'o';
  x?: string;
  o?: string;
}

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const emptyBoard = (): Mark[] => Array.from({ length: 9 }, () => '');

/** 'x' or 'o' when someone has three in a row, 'draw' when the board is full, else null. */
export function ticTacToeResult(board: readonly Mark[]): 'x' | 'o' | 'draw' | null {
  for (const [a, b, c] of LINES) {
    const m = board[a];
    if (m && m === board[b] && m === board[c]) return m;
  }
  return board.length === 9 && board.every(Boolean) ? 'draw' : null;
}

/** Whether this user may play the next move. The first two different people to move become X and O. */
export function canMove(state: TicTacToeState, userId: string): boolean {
  const board = state.board ?? emptyBoard();
  if (ticTacToeResult(board)) return false;
  const turn = state.turn ?? 'x';
  const owner = state[turn];
  if (owner) return owner === userId;
  return state.x !== userId && state.o !== userId;
}

export interface WyrState {
  votes?: Record<string, 'a' | 'b'>;
}
export function wyrTally(state: WyrState): { a: number; b: number } {
  const tally = { a: 0, b: 0 };
  for (const v of Object.values(state.votes ?? {})) tally[v]++;
  return tally;
}

export const WYR_PROMPTS: [string, string][] = [
  ['Always be 10 minutes late', 'Always be 20 minutes early'],
  ['Only eat pizza forever', 'Never eat pizza again'],
  ['Travel to the past', 'Travel to the future'],
  ['Have a pet dragon', 'Have a pet unicorn'],
  ['Live by the beach', 'Live in the mountains'],
  ['Be able to fly', 'Be able to read minds'],
  ['Never use social media again', 'Never watch a movie again'],
  ['Have unlimited coffee', 'Have unlimited snacks'],
];
