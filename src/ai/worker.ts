import { assessPosition, chooseMove, type Difficulty, type PublicPosition } from './engine';
import type { Color, Move, Piece } from '../core/rules';

export type WorkerRequest =
  | { id: number; type: 'choose'; position: PublicPosition; difficulty: Difficulty }
  | { id: number; type: 'assess'; position: PublicPosition; side: Color };

export type WorkerResponse =
  | { id: number; type: 'progress'; candidates: Move[] }
  | { id: number; type: 'result'; move: Move | null; score: number }
  | { id: number; type: 'assessment'; score: number };

/** 把暗子的真实身份抹掉，确保 AI 物理上拿不到。 */
function scrub(position: PublicPosition): PublicPosition {
  const mask = (p: Piece | null): Piece | null =>
    p === null || p.revealed ? p : { ...p, color: p.coverColor!, kind: p.coverKind! };
  return { ...position, board: position.board.map(mask) };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const position = scrub(request.position);
  if (request.type === 'choose') {
    const choice = chooseMove(position, {
      difficulty: request.difficulty,
      onProgress: (candidates) => postMessage({ id: request.id, type: 'progress', candidates } satisfies WorkerResponse),
    });
    postMessage({ id: request.id, type: 'result', move: choice?.move ?? null, score: choice?.score ?? 0 } satisfies WorkerResponse);
  } else {
    postMessage({ id: request.id, type: 'assessment', score: assessPosition(position, request.side) } satisfies WorkerResponse);
  }
};
