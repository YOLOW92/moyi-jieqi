// 公平的本地 AI：只依据公开信息重新采样暗子身份，绝不读取真实暗子。

import {
  allLegalMovesOn,
  colOf,
  controller,
  isInCheckOn,
  movementKind,
  NON_GENERAL_COUNTS,
  otherColor,
  rowOf,
  seededRandom,
  shieldBlocks,
  shuffle,
  type Board,
  type Color,
  type Kind,
  type Move,
  type Piece,
  type RuleSet,
} from '../core/rules';

export type Difficulty = 'easy' | 'normal' | 'expert';

export interface PublicPosition {
  board: Board;
  captured: Record<Color, Piece[]>;
  currentTurn: Color;
  /** 规则修正（墨途模式），缺省为标准规则。 */
  rules?: RuleSet;
  shields?: Record<Color, number>;
  /** 全部身份构成 `${color}:${kind}` → 数量；缺省为标准配置。 */
  roster?: Record<string, number>;
}

const VALUE: Record<Kind, number> = {
  general: 100_000,
  rook: 900,
  cannon: 450,
  horse: 420,
  elephant: 220,
  advisor: 220,
  soldier: 110,
};
const WIN = 1_000_000;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 尚未公开的身份池。 */
export function publicRemainingPool(position: PublicPosition): [Color, Kind][] {
  const counts = new Map<string, number>();
  if (position.roster) {
    for (const [key, count] of Object.entries(position.roster)) counts.set(key, count);
  } else {
    for (const color of ['red', 'black'] as Color[]) {
      for (const [kind, count] of Object.entries(NON_GENERAL_COUNTS)) counts.set(`${color}:${kind}`, count);
      counts.set(`${color}:general`, 1);
    }
  }
  const everyPiece = [...position.board, ...position.captured.red, ...position.captured.black];
  for (const piece of everyPiece) {
    if (piece === null || !piece.revealed) continue;
    const key = `${piece.color}:${piece.kind}`;
    counts.set(key, (counts.get(key) ?? 0) - 1);
  }
  const pool: [Color, Kind][] = [];
  for (const [key, count] of [...counts.entries()].sort()) {
    const [color, kind] = key.split(':') as [Color, Kind];
    for (let i = 0; i < count; i++) pool.push([color, kind]);
  }
  return pool;
}

/** 生成一个与公开信息一致的“可能世界”。 */
export function determinize(position: PublicPosition, random: () => number): Board {
  const board: Board = position.board.map((p) => (p === null ? null : { ...p }));
  const hidden: number[] = [];
  board.forEach((p, i) => {
    if (p !== null && !p.revealed) hidden.push(i);
  });
  const pool = shuffle(publicRemainingPool(position), random);
  if (pool.length < hidden.length) throw new Error('公开身份池与暗子数量不一致');
  hidden.forEach((square, i) => {
    const piece = board[square]!;
    [piece.color, piece.kind] = pool[i];
  });
  return board;
}

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

interface Undo {
  from: number;
  to: number;
  captured: Piece | null;
  revealed: boolean;
  /** 被护体震碎：走子方离盘。 */
  bounced: boolean;
}

class Searcher {
  nodes = 0;
  aborted = false;

  private readonly shields: Record<Color, number>;
  private readonly bouncedPieces: Piece[] = [];

  constructor(
    private readonly board: Board,
    private readonly deadline: number,
    private readonly quiescence: boolean,
    private readonly rules: RuleSet = {},
    shields: Record<Color, number> = { red: 0, black: 0 },
  ) {
    this.shields = { ...shields };
  }

  make(move: Move): Undo {
    const [from, to] = move;
    const piece = this.board[from]!;
    if (shieldBlocks(this.board, to, this.shields)) {
      // 护体震碎来犯之子
      this.shields[this.board[to]!.color] -= 1;
      this.bouncedPieces.push(piece);
      this.board[from] = null;
      return { from, to, captured: null, revealed: piece.revealed, bounced: true };
    }
    const undo: Undo = { from, to, captured: this.board[to], revealed: piece.revealed, bounced: false };
    this.board[to] = piece;
    this.board[from] = null;
    piece.revealed = true;
    return undo;
  }

  unmake(undo: Undo): void {
    if (undo.bounced) {
      this.board[undo.from] = this.bouncedPieces.pop()!;
      this.shields[this.board[undo.to]!.color] += 1;
      return;
    }
    const piece = this.board[undo.to]!;
    piece.revealed = undo.revealed;
    this.board[undo.from] = piece;
    this.board[undo.to] = undo.captured;
  }

  generalAlive(color: Color): boolean {
    for (const p of this.board) if (p !== null && p.kind === 'general' && p.color === color && p.revealed) return true;
    return false;
  }

  /** 以 side 为视角的静态评估。 */
  evaluate(side: Color, mobility: number): number {
    let score = 0;
    for (let i = 0; i < this.board.length; i++) {
      const p = this.board[i];
      if (p === null) continue;
      const sign = p.color === side ? 1 : -1;
      score += sign * VALUE[p.kind];
      if (!p.revealed) {
        // 暗子对最终主人的即时价值较低。
        score += controller(p) === side ? 12 : -12;
      } else if (p.kind === 'soldier') {
        const progress = p.color === 'red' ? 9 - rowOf(i) : rowOf(i);
        score += sign * progress * 9;
      } else if (p.kind === 'horse' || p.kind === 'cannon') {
        score += sign * (4 - Math.abs(colOf(i) - 4)) * 6;
      }
    }
    score += (this.shields[side] - this.shields[otherColor(side)]) * 600;
    if (isInCheckOn(this.board, side, this.rules)) score -= 320;
    if (isInCheckOn(this.board, otherColor(side), this.rules)) score += 260;
    return score + mobility * 3;
  }

  ordered(moves: Move[]): Move[] {
    const scoreOf = ([from, to]: Move): number => {
      const mover = this.board[from]!;
      const target = this.board[to];
      if (target === null) {
        let s = 0;
        if (movementKind(mover) === 'soldier') s += 5;
        if (!mover.revealed) s += 3;
        return s - Math.abs(colOf(to) - 4);
      }
      const victim = target.revealed ? VALUE[target.kind] : 300;
      if (target.kind === 'general' && target.revealed) return 10_000_000;
      return 100_000 + victim * 10 - (mover.revealed ? VALUE[mover.kind] : 300) / 10;
    };
    return moves
      .map((m) => [m, scoreOf(m)] as const)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
  }

  private checkTime(): boolean {
    if ((++this.nodes & 255) === 0 && now() >= this.deadline) this.aborted = true;
    return this.aborted;
  }

  negamax(side: Color, depth: number, alpha: number, beta: number, ply: number): number {
    if (!this.generalAlive(side)) return -WIN + ply;
    if (!this.generalAlive(otherColor(side))) return WIN - ply;
    const moves = allLegalMovesOn(this.board, side, this.rules);
    if (moves.length === 0) return -WIN + ply;
    if (this.checkTime()) return 0;
    if (depth <= 0) {
      return this.quiescence ? this.quiesce(side, alpha, beta, ply, 4, moves) : this.evaluate(side, moves.length);
    }
    let best = -Infinity;
    for (const move of this.ordered(moves)) {
      const undo = this.make(move);
      const value = -this.negamax(otherColor(side), depth - 1, -beta, -alpha, ply + 1);
      this.unmake(undo);
      if (this.aborted) return 0;
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  quiesce(side: Color, alpha: number, beta: number, ply: number, depth: number, moves: Move[]): number {
    const stand = this.evaluate(side, moves.length);
    if (depth === 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const captures = this.ordered(moves.filter(([, to]) => this.board[to] !== null));
    for (const move of captures) {
      const undo = this.make(move);
      let value: number;
      const other = otherColor(side);
      if (!this.generalAlive(other)) value = WIN - ply;
      else {
        const replies = allLegalMovesOn(this.board, other, this.rules);
        value = replies.length === 0 ? WIN - ply : -this.quiesce(other, -beta, -alpha, ply + 1, depth - 1, replies);
      }
      this.unmake(undo);
      if (this.checkTime()) return alpha;
      if (value >= beta) return value;
      if (value > alpha) alpha = value;
    }
    return alpha;
  }
}

interface Profile {
  samples: number;
  maxDepth: number;
  budgetMs: number;
  noise: number;
  quiescence: boolean;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { samples: 1, maxDepth: 1, budgetMs: 250, noise: 160, quiescence: false },
  normal: { samples: 3, maxDepth: 2, budgetMs: 800, noise: 20, quiescence: true },
  expert: { samples: 10, maxDepth: 5, budgetMs: 2400, noise: 0, quiescence: true },
};

export interface ChooseOptions {
  difficulty: Difficulty;
  seed?: number;
  budgetMs?: number;
  /** 搜索过程中的候选着法（供界面展示“思考”）。 */
  onProgress?: (candidates: Move[]) => void;
}

export interface Choice {
  move: Move;
  score: number;
  ranked: { move: Move; score: number }[];
}

export function chooseMove(position: PublicPosition, options: ChooseOptions): Choice | null {
  const side = position.currentTurn;
  const rootMoves = allLegalMovesOn(position.board, side, position.rules);
  if (rootMoves.length === 0) return null;
  const profile = PROFILES[options.difficulty];
  const random = seededRandom(options.seed ?? Math.floor(Math.random() * 2 ** 31));
  const start = now();
  const deadline = start + (options.budgetMs ?? profile.budgetMs);
  const totals = new Map<string, { move: Move; sum: number; n: number }>();
  for (const move of rootMoves) totals.set(move.join(','), { move, sum: 0, n: 0 });

  for (let sample = 0; sample < profile.samples; sample++) {
    const remaining = deadline - now();
    if (remaining <= 0 && sample > 0) break;
    const sampleDeadline = now() + Math.max(remaining / (profile.samples - sample), 15);
    const board = determinize(position, random);
    const searcher = new Searcher(board, sampleDeadline, profile.quiescence, position.rules, position.shields);
    let completed = new Map<string, number>();
    let ordered = searcher.ordered(rootMoves);

    for (let depth = 1; depth <= profile.maxDepth; depth++) {
      const scores = new Map<string, number>();
      // 根节点用全窗口：每个候选都需要精确分值，才能在多个采样世界间求平均。
      for (const move of ordered) {
        const undo = searcher.make(move);
        const value = -searcher.negamax(otherColor(side), depth - 1, -Infinity, Infinity, 1);
        searcher.unmake(undo);
        if (searcher.aborted) break;
        scores.set(move.join(','), value);
      }
      if (searcher.aborted) {
        // 未完成的深度：只采纳已经搜到的更好结果作补充。
        for (const [key, value] of scores) if (!completed.has(key)) completed.set(key, value);
        break;
      }
      completed = scores;
      ordered = [...ordered].sort((a, b) => (scores.get(b.join(',')) ?? -Infinity) - (scores.get(a.join(',')) ?? -Infinity));
      if (now() >= sampleDeadline) break;
    }

    for (const [key, value] of completed) {
      const entry = totals.get(key)!;
      entry.sum += Math.max(-WIN, Math.min(WIN, value)) + (random() * 2 - 1) * profile.noise;
      entry.n += 1;
    }
    if (options.onProgress) {
      const top = rankTotals(totals).slice(0, 3).map((r) => r.move);
      options.onProgress(top);
    }
  }

  const ranked = rankTotals(totals);
  let pick = ranked[0];
  if (options.difficulty === 'easy' && ranked.length > 1 && random() < 0.3) {
    pick = ranked[Math.floor(random() * Math.min(4, ranked.length))];
  }
  return { move: pick.move, score: pick.score, ranked };
}

function rankTotals(totals: Map<string, { move: Move; sum: number; n: number }>): { move: Move; score: number }[] {
  return [...totals.values()]
    .map(({ move, sum, n }) => ({ move, score: n === 0 ? -Infinity : sum / n }))
    .sort((a, b) => b.score - a.score);
}

/** 对 side 而言的公开局面估值（多次采样平均），用于决定是否接受和棋。 */
export function assessPosition(position: PublicPosition, side: Color, samples = 6): number {
  const random = seededRandom(7);
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const board = determinize(position, random);
    const searcher = new Searcher(board, Infinity, false, position.rules, position.shields);
    total += searcher.evaluate(side, 0);
  }
  return total / samples;
}
