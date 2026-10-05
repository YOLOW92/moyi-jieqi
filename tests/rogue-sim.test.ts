import { describe, expect, it } from 'vitest';
import { chooseMove, type PublicPosition } from '../src/ai/engine';
import { GameState, seededRandom, type Piece } from '../src/core/rules';
import { AFFIXES, BOSSES, DECK_OPS } from '../src/rogue/content';
import { ambush, applyDeckOp, freeSquares, newRun, rosterPool, rulesOf, sampleDistinct } from '../src/rogue/run';

/** 与 worker 一致：抹掉暗子真身。 */
function publicOf(game: GameState): PublicPosition {
  const mask = (p: Piece | null): Piece | null => (p === null || p.revealed ? p : { ...p, color: p.coverColor!, kind: p.coverKind! });
  return { board: game.board.map(mask), captured: game.captured, currentTurn: game.currentTurn, rules: game.rules, shields: game.shields, roster: game.composition() };
}

describe('墨途整盘模拟', () => {
  it('各种修正下整盘对弈不出错', () => {
    let bounces = 0;
    let mired = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const random = seededRandom(seed * 97);
      const run = newRun();
      run.round = 1 + (seed % 3);
      run.upgrades = ['tianma', 'lianhuan', 'youshi'].slice(0, seed % 4);
      // 点将改写暗子池（颜色数量不再对称）
      for (const op of DECK_OPS) applyDeckOp(run, null, op.id, random);
      const game = new GameState(seed, true, rosterPool(run.roster));
      expect(game.hiddenCount()).toBe(30);
      run.rocks = sampleDistinct(freeSquares(game, run, [3, 6]), 3, random);
      run.pools = sampleDistinct(freeSquares(game, run, [3, 6]), 3, random);
      run.affixes = sampleDistinct(AFFIXES, 2, random).map((a) => a.id);
      if (run.affixes.includes('fubing')) ambush(game, random);
      run.act = 3;
      game.shields = { red: 1, black: BOSSES[run.round - 1].shield };
      game.rules = rulesOf(run);

      for (let ply = 0; ply < 160 && !game.isFinished; ply++) {
        const choice = chooseMove(publicOf(game), { difficulty: 'easy', seed: seed * 1000 + ply, budgetMs: 40 });
        expect(choice).not.toBeNull();
        const [from, to] = choice!.move;
        expect(game.legalMovesFrom(from)).toContain(to);
        const outcome = game.move(from, to);
        if (outcome.bounced) bounces++;
        if (outcome.mired) mired++;
        // Boss 召魂
        if (ply % 12 === 11) {
          const empty = game.board.findIndex((p, s) => p === null && s < 27 && !game.rules.rocks!.includes(s));
          if (empty >= 0) game.revive('black', empty);
        }
        // 身份总数守恒
        expect(game.allPieces()).toHaveLength(32);
      }
    }
    // 至少触发过护体或墨池，说明模拟覆盖到这些分支
    expect(bounces + mired).toBeGreaterThan(0);
  }, 60_000);
});
