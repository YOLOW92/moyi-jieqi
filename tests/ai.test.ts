import { describe, expect, it } from 'vitest';
import { chooseMove, determinize, publicRemainingPool } from '../src/ai/engine';
import { BLACK, GameState, idx, RED, seededRandom } from '../src/core/rules';

describe('AI', () => {
  it('公开身份池不包含已公开棋子', () => {
    const game = new GameState(3);
    const pool = publicRemainingPool(game);
    expect(pool).toHaveLength(30);
    expect(pool.filter(([, k]) => k === 'general')).toHaveLength(0);
  });

  it('重采样不改变明子，且身份守恒', () => {
    const game = new GameState(5);
    const board = determinize(game, seededRandom(1));
    expect(board[idx(0, 4)]!.kind).toBe('general');
    const counts = new Map<string, number>();
    for (const p of board) if (p) counts.set(`${p.color}:${p.kind}`, (counts.get(`${p.color}:${p.kind}`) ?? 0) + 1);
    expect(counts.get('red:soldier')).toBe(5);
    expect(counts.get('black:rook')).toBe(2);
  });

  it('选择会立即吃将的着法', () => {
    const game = GameState.blank(RED);
    game.place(9, 3, RED, 'general');
    game.place(0, 4, BLACK, 'general');
    game.place(5, 4, RED, 'rook');
    game.place(3, 0, BLACK, 'rook');
    for (const difficulty of ['easy', 'normal', 'expert'] as const) {
      const choice = chooseMove(game, { difficulty, seed: 1, budgetMs: 300 });
      if (difficulty !== 'easy') expect(choice!.move).toEqual([idx(5, 4), idx(0, 4)]);
      expect(game.legalMovesFrom(choice!.move[0])).toContain(choice!.move[1]);
    }
  });

  it('不依赖暗子真实身份：真实身份不同的同一公开局面给出相同着法', () => {
    const a = new GameState(11);
    const b = new GameState(12);
    // 公开信息相同（全部为开局暗子），真实身份不同。
    a.currentTurn = BLACK;
    b.currentTurn = BLACK;
    const scrub = (g: GameState) => ({
      board: g.board.map((p) => (p && !p.revealed ? { ...p, color: p.coverColor!, kind: p.coverKind! } : p)),
      captured: g.captured,
      currentTurn: g.currentTurn,
    });
    const ma = chooseMove(scrub(a), { difficulty: 'normal', seed: 4, budgetMs: 100000 });
    const mb = chooseMove(scrub(b), { difficulty: 'normal', seed: 4, budgetMs: 100000 });
    expect(ma!.move).toEqual(mb!.move);
  });

  it('专家档在时间预算内返回合法着法', () => {
    const game = new GameState(21);
    const start = performance.now();
    const choice = chooseMove(game, { difficulty: 'expert', seed: 2, budgetMs: 1500 });
    expect(performance.now() - start).toBeLessThan(4000);
    expect(game.legalMovesFrom(choice!.move[0])).toContain(choice!.move[1]);
  });
});
