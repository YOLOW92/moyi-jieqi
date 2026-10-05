import { describe, expect, it } from 'vitest';
import { chooseMove, publicRemainingPool } from '../src/ai/engine';
import { BLACK, GameState, idx, RED, seededRandom, type Color } from '../src/core/rules';
import { actFor, applyDeckOp, canTake, newRun, rollReward, rollShop, rosterPool, rulesOf } from '../src/rogue/run';
import { cardById } from '../src/rogue/content';

const sq = idx;

function safeGame(turn: Color = RED): GameState {
  const game = GameState.blank(turn);
  game.place(9, 3, RED, 'general');
  game.place(0, 5, BLACK, 'general');
  game.positionCounts = { [game.positionKey()]: 1 };
  return game;
}

describe('规则修正', () => {
  it('山石挡车、不可落脚，可作炮架', () => {
    const game = safeGame();
    game.place(5, 0, RED, 'rook');
    game.place(5, 6, RED, 'cannon');
    game.place(5, 8, BLACK, 'soldier');
    game.rules = { rocks: [sq(5, 3), sq(5, 7)] };
    const rook = game.legalMovesFrom(sq(5, 0));
    expect(rook).toContain(sq(5, 2));
    expect(rook).not.toContain(sq(5, 3));
    expect(rook).not.toContain(sq(5, 4));
    // 炮隔山石吃卒
    expect(game.legalMovesFrom(sq(5, 6))).toContain(sq(5, 8));
  });

  it('天马：马不蹩腿', () => {
    const game = safeGame();
    game.place(5, 4, RED, 'horse');
    game.place(4, 4, RED, 'soldier');
    expect(game.legalMovesFrom(sq(5, 4))).not.toContain(sq(3, 3));
    game.rules = { sides: { red: { horseNoLeg: true } } };
    expect(game.legalMovesFrom(sq(5, 4))).toContain(sq(3, 3));
  });

  it('连环炮：可隔两子吃子', () => {
    const game = safeGame();
    game.place(6, 1, RED, 'cannon');
    game.place(5, 1, RED, 'soldier');
    game.place(4, 1, BLACK, 'soldier');
    game.place(2, 1, BLACK, 'rook');
    expect(game.legalMovesFrom(sq(6, 1))).not.toContain(sq(2, 1));
    game.rules = { sides: { red: { cannonMulti: true } } };
    const moves = game.legalMovesFrom(sq(6, 1));
    expect(moves).toContain(sq(4, 1));
    expect(moves).toContain(sq(2, 1));
  });

  it('护体：吃将被挡，来犯之子被震碎', () => {
    const game = safeGame();
    game.place(5, 5, RED, 'rook');
    game.shields.black = 1;
    const outcome = game.move(sq(5, 5), sq(0, 5));
    expect(outcome.bounced).toBe(true);
    expect(game.winner).toBeNull();
    expect(game.shields.black).toBe(0);
    expect(game.pieceAt(0, 5)!.kind).toBe('general');
    expect(game.pieceAt(5, 5)).toBeNull();
    expect(game.captured.red.map((p) => p.kind)).toEqual(['rook']);
    game.undo();
    expect(game.shields.black).toBe(1);
    expect(game.pieceAt(5, 5)!.kind).toBe('rook');
  });

  it('墨池：落入者下回合不能走，之后恢复', () => {
    const game = safeGame();
    game.place(6, 0, RED, 'rook');
    game.place(3, 8, BLACK, 'soldier');
    game.rules = { pools: [sq(5, 0)] };
    const outcome = game.move(sq(6, 0), sq(5, 0));
    expect(outcome.mired).toBe(true);
    game.move(sq(3, 8), sq(4, 8));
    expect(game.legalMovesFrom(sq(5, 0))).toEqual([]);
    game.move(sq(9, 3), sq(8, 3));
    game.move(sq(4, 8), sq(5, 8));
    expect(game.legalMovesFrom(sq(5, 0)).length).toBeGreaterThan(0);
  });

  it('不受墨池影响的一方照常行走', () => {
    const game = safeGame();
    game.place(6, 0, RED, 'rook');
    game.rules = { pools: [sq(5, 0)], sides: { red: { poolImmune: true } } };
    expect(game.move(sq(6, 0), sq(5, 0)).mired).toBe(false);
  });

  it('自定义暗子池', () => {
    const run = newRun();
    run.roster.red.soldier -= 1;
    run.roster.red.rook += 1;
    const game = new GameState(7, true, rosterPool(run.roster));
    expect(game.composition()['red:rook']).toBe(3);
    expect(game.composition()['red:soldier']).toBe(4);
    expect(publicRemainingPool({ ...game, roster: game.composition() }).filter(([c, k]) => c === RED && k === 'rook')).toHaveLength(3);
  });
});

describe('AI 遵守修正规则', () => {
  it('知道护体存在时不会白送车去吃将', () => {
    const game = safeGame(RED);
    game.place(5, 5, RED, 'rook');
    game.shields.black = 1;
    const shielded = chooseMove({ ...game, rules: game.rules, shields: game.shields }, { difficulty: 'normal', seed: 1, budgetMs: 400 });
    // 车吃将会被震碎，不该去送
    expect(shielded!.move).not.toEqual([sq(5, 5), sq(0, 5)]);
    game.shields.black = 0;
    const bare = chooseMove({ ...game, rules: game.rules, shields: game.shields }, { difficulty: 'normal', seed: 1, budgetMs: 400 });
    expect(bare!.move).toEqual([sq(5, 5), sq(0, 5)]);
  });

  it('走法在山石存在时合法', () => {
    const game = new GameState(3);
    game.rules = { rocks: [sq(4, 1), sq(5, 7)], pools: [sq(4, 4)], sides: { black: { horseNoLeg: true, cannonMulti: true } } };
    game.move(sq(6, 0), sq(5, 0));
    const choice = chooseMove({ ...game, rules: game.rules, shields: game.shields, roster: game.composition() }, { difficulty: 'easy', seed: 2, budgetMs: 200 });
    expect(choice).not.toBeNull();
    expect(game.legalMovesFrom(choice!.move[0])).toContain(choice!.move[1]);
  });
});

describe('墨途逻辑', () => {
  it('换幕门槛', () => {
    const run = newRun();
    expect(actFor(run, 0)).toBe(1);
    run.captures = 3;
    expect(actFor(run, 10)).toBe(2);
    expect(actFor(run, 80)).toBe(3);
  });

  it('升级反映到规则', () => {
    const run = newRun();
    run.upgrades.push('tianma');
    run.affixes.push('lianzhu');
    const rules = rulesOf(run);
    expect(rules.sides!.red!.horseNoLeg).toBe(true);
    expect(rules.sides!.black!.cannonMulti).toBe(true);
    expect(rules.sides!.black!.horseNoLeg).toBeUndefined();
  });

  it('奖励与货架不重复已拥有的升级和遗珍', () => {
    const run = newRun();
    run.upgrades.push('tianma', 'feixiang', 'lianhuan', 'youbing');
    for (let i = 0; i < 20; i++) {
      const random = seededRandom(i);
      for (const card of [...rollReward(run, random), ...rollShop(run, random)]) {
        if (card.kind === 'upgrade') expect(run.upgrades).not.toContain(card.id);
      }
    }
    expect(canTake(run, cardById('youshi'))).toBe(true);
  });

  it('点将改写暗子池与本盘暗子', () => {
    const run = newRun();
    const game = new GameState(5, true, rosterPool(run.roster));
    const before = game.composition()['red:rook'];
    const text = applyDeckOp(run, game, 'dianhua', seededRandom(1));
    expect(text).toContain('生效');
    expect(run.roster.red.rook).toBe(3);
    expect(game.composition()['red:rook']).toBe(before + 1);
    expect(game.hiddenCount()).toBe(30);
  });
});
