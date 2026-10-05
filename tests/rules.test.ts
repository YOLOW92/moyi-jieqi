import { describe, expect, it } from 'vitest';
import { BLACK, GameState, idx, RED, type Color } from '../src/core/rules';
import { formatMove } from '../src/core/notation';

const sq = idx;

function safeGame(turn: Color = RED): GameState {
  const game = GameState.blank(turn);
  game.place(9, 3, RED, 'general');
  game.place(0, 5, BLACK, 'general');
  game.positionCounts = { [game.positionKey()]: 1 };
  return game;
}

describe('开局', () => {
  it('全混开局拥有完整棋子', () => {
    const game = new GameState(1234);
    const pieces = game.board.filter((p) => p !== null);
    expect(pieces).toHaveLength(32);
    expect(pieces.filter((p) => !p!.revealed)).toHaveLength(30);
    expect(game.pieceAt(0, 4)!.revealed).toBe(true);
    expect(game.pieceAt(9, 4)!.revealed).toBe(true);
    const counts = new Map<string, number>();
    for (const p of game.allPieces()) counts.set(`${p.color}:${p.kind}`, (counts.get(`${p.color}:${p.kind}`) ?? 0) + 1);
    for (const color of [RED, BLACK]) {
      expect(counts.get(`${color}:general`)).toBe(1);
      expect(counts.get(`${color}:soldier`)).toBe(5);
      for (const kind of ['advisor', 'elephant', 'horse', 'rook', 'cannon']) expect(counts.get(`${color}:${kind}`)).toBe(2);
    }
    expect(new Set(pieces.map((p) => p!.id)).size).toBe(32);
  });

  it('种子可复现', () => {
    expect(new GameState(8).toJSON().state.board).toEqual(new GameState(8).toJSON().state.board);
  });
});

describe('暗子', () => {
  it('首次按槽位走法，翻面后转换控制方', () => {
    const game = safeGame();
    game.place(9, 0, BLACK, 'horse', false, RED, 'rook');
    expect(game.legalMovesFrom(sq(9, 0))).toContain(sq(8, 0));
    const outcome = game.move(sq(9, 0), sq(8, 0));
    expect(outcome.wasHidden).toBe(true);
    expect(outcome.switchedOwner).toBe(true);
    expect(game.currentTurn).toBe(BLACK);
    expect(game.legalMovesFrom(sq(8, 0)).length).toBeGreaterThan(0);
  });

  it('吃暗子有效并公开被吃子', () => {
    const game = safeGame();
    game.place(5, 0, RED, 'rook');
    game.place(3, 0, RED, 'cannon', false, BLACK, 'soldier');
    const outcome = game.move(sq(5, 0), sq(3, 0));
    expect(outcome.captured?.revealed).toBe(true);
    expect(outcome.captured?.kind).toBe('cannon');
    expect(game.captured.red).toHaveLength(1);
  });

  it('暗子吃将，即使翻出敌子也算行动方胜', () => {
    const game = GameState.blank(RED);
    game.place(9, 3, RED, 'general');
    game.place(0, 4, BLACK, 'general');
    game.place(1, 4, BLACK, 'horse', false, RED, 'rook');
    const outcome = game.move(sq(1, 4), sq(0, 4));
    expect(outcome.winner).toBe(RED);
  });
});

describe('走法', () => {
  it('明士可出宫过河', () => {
    const game = safeGame();
    game.place(5, 4, RED, 'advisor');
    expect(game.legalMovesFrom(sq(5, 4))).toContain(sq(4, 3));
  });

  it('暗士限于槽位九宫', () => {
    const game = safeGame();
    game.board[sq(9, 3)] = null;
    game.place(9, 3, RED, 'advisor', false, RED, 'advisor');
    game.place(9, 4, RED, 'general');
    expect(game.legalMovesFrom(sq(9, 3))).toContain(sq(8, 4));
    expect(game.legalMovesFrom(sq(9, 3))).not.toContain(sq(8, 2));
  });

  it('明象可过河但有象眼', () => {
    const game = safeGame();
    game.place(6, 2, RED, 'elephant');
    expect(game.legalMovesFrom(sq(6, 2))).toContain(sq(4, 4));
    game.place(5, 3, RED, 'soldier');
    expect(game.legalMovesFrom(sq(6, 2))).not.toContain(sq(4, 4));
  });

  it('暗象不能过槽位一方的河', () => {
    const game = safeGame();
    game.place(5, 2, BLACK, 'rook', false, RED, 'elephant');
    expect(game.legalMovesFrom(sq(5, 2))).not.toContain(sq(3, 4));
  });

  it('蹩马腿只挡对应方向', () => {
    const game = safeGame();
    game.place(5, 4, RED, 'horse');
    game.place(4, 4, RED, 'soldier');
    const moves = game.legalMovesFrom(sq(5, 4));
    expect(moves).not.toContain(sq(3, 3));
    expect(moves).not.toContain(sq(3, 5));
    expect(moves).toContain(sq(4, 2));
  });

  it('炮需恰好一个炮架', () => {
    const game = safeGame();
    game.place(5, 0, RED, 'cannon');
    game.place(4, 0, RED, 'soldier');
    game.place(2, 0, BLACK, 'rook');
    game.place(1, 0, BLACK, 'horse');
    const moves = game.legalMovesFrom(sq(5, 0));
    expect(moves).toContain(sq(2, 0));
    expect(moves).not.toContain(sq(3, 0));
    expect(moves).not.toContain(sq(1, 0));
  });

  it('兵的方向与过河横走', () => {
    const game = safeGame();
    game.place(4, 4, RED, 'soldier');
    const moves = game.legalMovesFrom(sq(4, 4));
    expect(moves).toEqual(expect.arrayContaining([sq(3, 4), sq(4, 3), sq(4, 5)]));
    expect(moves).not.toContain(sq(5, 4));
  });

  it('黑卒向红方走', () => {
    const game = safeGame(BLACK);
    game.place(5, 2, BLACK, 'soldier');
    const moves = game.legalMovesFrom(sq(5, 2));
    expect(moves).toContain(sq(6, 2));
    expect(moves).toContain(sq(5, 1));
    expect(moves).not.toContain(sq(4, 2));
  });

  it('暗兵按槽位方向走', () => {
    const game = safeGame();
    game.place(6, 2, BLACK, 'rook', false, RED, 'soldier');
    expect(game.legalMovesFrom(sq(6, 2))).toEqual([sq(5, 2)]);
  });

  it('主动造成将帅照面非法', () => {
    const game = GameState.blank(RED);
    game.place(9, 4, RED, 'general');
    game.place(0, 4, BLACK, 'general');
    game.place(5, 4, RED, 'rook');
    expect(game.legalMovesFrom(sq(5, 4))).not.toContain(sq(5, 3));
  });

  it('车遇子即停并可吃敌子', () => {
    const game = safeGame();
    game.place(5, 0, RED, 'rook');
    game.place(3, 0, BLACK, 'horse');
    game.place(2, 0, BLACK, 'cannon');
    const moves = game.legalMovesFrom(sq(5, 0));
    expect(moves).toContain(sq(4, 0));
    expect(moves).toContain(sq(3, 0));
    expect(moves).not.toContain(sq(2, 0));
  });

  it('将帅限九宫且可飞将吃', () => {
    const game = GameState.blank(RED);
    game.place(9, 4, RED, 'general');
    game.place(0, 4, BLACK, 'general');
    expect(game.legalMovesFrom(sq(9, 4))).toContain(sq(0, 4));
    expect(game.legalMovesFrom(sq(9, 4))).not.toContain(sq(9, 6));
    game.place(5, 4, RED, 'soldier');
    expect(game.legalMovesFrom(sq(9, 4))).toContain(sq(8, 4));
  });

  it('非照面的送将走法允许', () => {
    const game = GameState.blank(RED);
    game.place(9, 4, RED, 'general');
    game.place(0, 3, BLACK, 'general');
    game.place(9, 0, BLACK, 'rook');
    game.place(9, 2, RED, 'rook');
    expect(game.legalMovesFrom(sq(9, 2))).toContain(sq(8, 2));
  });
});

describe('状态', () => {
  it('悔棋恢复暗子身份、吃子与行棋方', () => {
    const game = safeGame();
    game.place(9, 0, BLACK, 'horse', false, RED, 'rook');
    const before = game.toJSON().state;
    game.move(sq(9, 0), sq(8, 0));
    expect(game.undo()).toBe(true);
    expect(game.toJSON().state).toEqual(before);
    expect(game.pieceAt(9, 0)!.revealed).toBe(false);
  });

  it('JSON 往返保留历史', () => {
    const game = safeGame();
    game.place(9, 0, RED, 'rook', false, RED, 'rook');
    game.move(sq(9, 0), sq(8, 0));
    const restored = GameState.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
    expect(restored.toJSON()).toEqual(game.toJSON());
    expect(restored.undo()).toBe(true);
  });
});

describe('终局', () => {
  it('对方无子可动即负', () => {
    const game = GameState.blank(BLACK);
    game.place(0, 0, BLACK, 'rook');
    const outcome = game.move(sq(0, 0), sq(1, 0));
    expect(outcome.winner).toBe(BLACK);
    expect(outcome.endReason).toBe('no_legal_moves');
    expect(game.allLegalMoves()).toEqual([]);
  });

  it('三次重复局面和棋，且可悔棋恢复', () => {
    const game = safeGame();
    game.place(9, 0, RED, 'rook');
    game.place(0, 0, BLACK, 'rook');
    game.positionCounts = { [game.positionKey()]: 1 };
    let outcome;
    for (let i = 0; i < 2; i++) {
      game.move(sq(9, 0), sq(8, 0));
      game.move(sq(0, 0), sq(1, 0));
      game.move(sq(8, 0), sq(9, 0));
      outcome = game.move(sq(1, 0), sq(0, 0));
    }
    expect(outcome!.isDraw).toBe(true);
    expect(game.endReason).toBe('threefold_repetition');
    const restored = GameState.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
    expect(restored.undo()).toBe(true);
    expect(restored.isDraw).toBe(false);
  });

  it('第 120 个无进展半回合自然和棋', () => {
    const game = safeGame();
    game.place(9, 0, RED, 'rook');
    game.place(0, 0, BLACK, 'rook');
    game.noProgressPlies = 118;
    game.positionCounts = {};
    game.move(sq(9, 0), sq(8, 0));
    expect(game.isDraw).toBe(false);
    const outcome = game.move(sq(0, 0), sq(1, 0));
    expect(outcome.isDraw).toBe(true);
    expect(game.endReason).toBe('no_progress');
  });

  it('吃子与翻面重置无进展计数', () => {
    const capture = safeGame();
    capture.place(5, 0, RED, 'rook');
    capture.place(4, 0, BLACK, 'horse');
    capture.noProgressPlies = 119;
    capture.move(sq(5, 0), sq(4, 0));
    expect(capture.noProgressPlies).toBe(0);
    const reveal = safeGame();
    reveal.place(9, 0, RED, 'rook', false, RED, 'rook');
    reveal.noProgressPlies = 119;
    reveal.move(sq(9, 0), sq(8, 0));
    expect(reveal.noProgressPlies).toBe(0);
  });

  it('认输与议和可悔棋', () => {
    const resigned = safeGame();
    resigned.resign(RED);
    expect(resigned.winner).toBe(BLACK);
    expect(resigned.undo()).toBe(true);
    expect(resigned.winner).toBeNull();
    const drawn = safeGame();
    drawn.agreeDraw();
    expect(drawn.endReason).toBe('agreement');
    expect(drawn.undo()).toBe(true);
    expect(drawn.isDraw).toBe(false);
  });
});

describe('记谱', () => {
  it('红车进与黑卒平', () => {
    const game = safeGame();
    game.place(9, 0, RED, 'rook');
    game.place(5, 2, BLACK, 'soldier');
    expect(formatMove(game.move(sq(9, 0), sq(7, 0)))).toBe('车九进二');
    expect(formatMove(game.move(sq(5, 2), sq(5, 1)))).toBe('卒３平２');
  });
});
