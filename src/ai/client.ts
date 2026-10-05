import AIWorker from './worker?worker&inline';
import type { Difficulty, PublicPosition } from './engine';
import type { WorkerRequest, WorkerResponse } from './worker';
import type { Color, GameState, Move } from '../core/rules';

function publicPosition(game: GameState): PublicPosition {
  return { board: game.board, captured: game.captured, currentTurn: game.currentTurn, rules: game.rules, shields: game.shields, roster: game.composition() };
}

/** 后台 AI：每次请求可被新的请求作废（悔棋、新局时）。 */
export class AIClient {
  private worker: Worker = new AIWorker();
  private nextId = 1;
  private pending = new Map<number, (r: WorkerResponse) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.pending.get(event.data.id)?.(event.data);
  }

  /** 终止当前思考（重启 worker）。 */
  cancel(): void {
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve({ id: -1, type: 'result', move: null, score: 0 });
    this.pending.clear();
    this.worker = new AIWorker();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.pending.get(event.data.id)?.(event.data);
  }

  choose(game: GameState, difficulty: Difficulty, onProgress?: (candidates: Move[]) => void): Promise<Move | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (response) => {
        if (response.type === 'progress') {
          onProgress?.(response.candidates);
          return;
        }
        this.pending.delete(id);
        resolve(response.type === 'result' ? response.move : null);
      });
      this.post({ id, type: 'choose', position: publicPosition(game), difficulty });
    });
  }

  assess(game: GameState, side: Color): Promise<number> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (response) => {
        this.pending.delete(id);
        resolve(response.type === 'assessment' ? response.score : 0);
      });
      this.post({ id, type: 'assess', position: publicPosition(game), side });
    });
  }

  private post(request: WorkerRequest): void {
    this.worker.postMessage(JSON.parse(JSON.stringify(request)));
  }
}
