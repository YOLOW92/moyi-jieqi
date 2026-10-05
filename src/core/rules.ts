// 全混揭棋规则引擎：与界面无关，可在主线程与 Worker 中共用。

export type Color = 'red' | 'black';
export type Kind = 'general' | 'advisor' | 'elephant' | 'horse' | 'rook' | 'cannon' | 'soldier';
export type EndReason =
  | 'general_captured'
  | 'no_legal_moves'
  | 'threefold_repetition'
  | 'no_progress'
  | 'resignation'
  | 'agreement';

export const RED: Color = 'red';
export const BLACK: Color = 'black';
export const COLORS: readonly Color[] = [RED, BLACK];
export const KINDS: readonly Kind[] = ['general', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'soldier'];

export const ROWS = 10;
export const COLS = 9;
export const NO_PROGRESS_LIMIT = 120;

export interface Piece {
  /** 稳定编号，供界面追踪同一枚棋子。 */
  id: number;
  color: Color;
  kind: Kind;
  revealed: boolean;
  coverColor: Color | null;
  coverKind: Kind | null;
  /** 被定住的剩余半回合数（墨池、定身符）；大于 0 时不能走。 */
  frozen?: number;
}

/** 某一方的兵种强化（墨途模式的升级、敌方词缀）。 */
export interface SideRules {
  /** 马不蹩腿 */
  horseNoLeg?: boolean;
  /** 象不塞眼 */
  elephantNoEye?: boolean;
  /** 炮可隔一或两子吃子 */
  cannonMulti?: boolean;
  /** 兵卒未过河也可平移 */
  soldierSideways?: boolean;
  /** 士也可直走一格 */
  advisorStraight?: boolean;
  /** 将帅可出九宫，在己方半场内行走 */
  generalFree?: boolean;
  /** 不受墨池影响 */
  poolImmune?: boolean;
}

/** 规则修正：双方的兵种强化与盘上地形。为空时即标准全混揭棋。 */
export interface RuleSet {
  sides?: Partial<Record<Color, SideRules>>;
  /** 山石：不可进入，挡路，可作炮架 */
  rocks?: number[];
  /** 墨池：落入的棋子下一回合不能走 */
  pools?: number[];
}

export type Board = (Piece | null)[];
export type Move = [from: number, to: number];

export const idx = (row: number, col: number): number => row * COLS + col;
export const rowOf = (square: number): number => Math.floor(square / COLS);
export const colOf = (square: number): number => square % COLS;
export const otherColor = (color: Color): Color => (color === RED ? BLACK : RED);

export function controller(piece: Piece): Color {
  if (piece.revealed) return piece.color;
  if (piece.coverColor === null) throw new Error('暗子缺少暂时控制方');
  return piece.coverColor;
}

export function movementKind(piece: Piece): Kind {
  if (piece.revealed) return piece.kind;
  if (piece.coverKind === null) throw new Error('暗子缺少首次走法');
  return piece.coverKind;
}

export function makePiece(
  id: number,
  color: Color,
  kind: Kind,
  revealed = true,
  coverColor: Color | null = null,
  coverKind: Kind | null = null,
): Piece {
  return { id, color, kind, revealed, coverColor, coverKind };
}

const inside = (row: number, col: number): boolean => row >= 0 && row < ROWS && col >= 0 && col < COLS;

function insidePalace(row: number, col: number, color: Color | null): boolean {
  if (col < 3 || col > 5) return false;
  if (color === RED) return row >= 7 && row <= 9;
  if (color === BLACK) return row >= 0 && row <= 2;
  return false;
}

export const NON_GENERAL_COUNTS: Readonly<Record<Exclude<Kind, 'general'>, number>> = {
  advisor: 2,
  elephant: 2,
  horse: 2,
  rook: 2,
  cannon: 2,
  soldier: 5,
};

export function nonGeneralPool(): [Color, Kind][] {
  const pool: [Color, Kind][] = [];
  for (const color of COLORS) {
    for (const [kind, count] of Object.entries(NON_GENERAL_COUNTS) as [Kind, number][]) {
      for (let i = 0; i < count; i++) pool.push([color, kind]);
    }
  }
  return pool;
}

export function startingSlots(): [square: number, coverColor: Color, coverKind: Kind][] {
  const backRank: [number, Kind][] = [
    [0, 'rook'], [1, 'horse'], [2, 'elephant'], [3, 'advisor'],
    [5, 'advisor'], [6, 'elephant'], [7, 'horse'], [8, 'rook'],
  ];
  const slots: [number, Color, Kind][] = [];
  for (const [col, kind] of backRank) slots.push([idx(0, col), BLACK, kind]);
  for (const col of [1, 7]) slots.push([idx(2, col), BLACK, 'cannon']);
  for (const col of [0, 2, 4, 6, 8]) slots.push([idx(3, col), BLACK, 'soldier']);
  for (const col of [0, 2, 4, 6, 8]) slots.push([idx(6, col), RED, 'soldier']);
  for (const col of [1, 7]) slots.push([idx(7, col), RED, 'cannon']);
  for (const [col, kind] of backRank) slots.push([idx(9, col), RED, kind]);
  return slots;
}

/** 可复现的伪随机数（mulberry32）。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---------------------------------------------------------------------------
// 走法生成（纯函数，供引擎与 AI 共用）
// ---------------------------------------------------------------------------

const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const HORSE_PATTERNS = [
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
  [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
] as const;
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

const NO_RULES: RuleSet = {};
const NO_SIDE: SideRules = {};

export const sideRulesOf = (rules: RuleSet, color: Color): SideRules => rules.sides?.[color] ?? NO_SIDE;
export const isRock = (rules: RuleSet, square: number): boolean => rules.rocks !== undefined && rules.rocks.includes(square);
export const isPool = (rules: RuleSet, square: number): boolean => rules.pools !== undefined && rules.pools.includes(square);

/** 该格是否有东西挡路（棋子或山石）。 */
const blocked = (board: Board, rules: RuleSet, square: number): boolean => board[square] !== null || isRock(rules, square);

function rayMoves(board: Board, rules: RuleSet, source: number, piece: Piece, cannon: boolean, out: number[]): void {
  const own = controller(piece);
  const maxScreens = cannon && sideRulesOf(rules, own).cannonMulti ? 2 : 1;
  const r0 = rowOf(source);
  const c0 = colOf(source);
  for (const [dr, dc] of ORTHOGONAL) {
    let row = r0 + dr;
    let col = c0 + dc;
    let screens = 0;
    while (inside(row, col)) {
      const square = idx(row, col);
      const occupant = board[square];
      const rock = isRock(rules, square);
      if (!cannon) {
        if (rock) break;
        if (occupant === null) {
          out.push(square);
        } else {
          if (controller(occupant) !== own) out.push(square);
          break;
        }
      } else if (occupant === null && !rock) {
        if (screens === 0) out.push(square);
      } else {
        if (screens > 0 && occupant !== null && controller(occupant) !== own) out.push(square);
        if (++screens > maxScreens) break;
      }
      row += dr;
      col += dc;
    }
  }
}

function findGeneral(board: Board, color: Color): number {
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p !== null && p.revealed && p.kind === 'general' && p.color === color) return i;
  }
  return -1;
}

const ownHalf = (row: number, color: Color): boolean => (color === RED ? row >= 5 : row <= 4);

export function pseudoMoves(board: Board, source: number, piece: Piece, out: number[] = [], rules: RuleSet = NO_RULES): number[] {
  const row = rowOf(source);
  const col = colOf(source);
  const side = sideRulesOf(rules, controller(piece));
  const start = out.length;
  switch (movementKind(piece)) {
    case 'rook':
      rayMoves(board, rules, source, piece, false, out);
      break;
    case 'cannon':
      rayMoves(board, rules, source, piece, true, out);
      break;
    case 'horse':
      for (const [dr, dc, lr, lc] of HORSE_PATTERNS) {
        if (!inside(row + lr, col + lc)) continue;
        if (!side.horseNoLeg && blocked(board, rules, idx(row + lr, col + lc))) continue;
        if (inside(row + dr, col + dc)) out.push(idx(row + dr, col + dc));
      }
      break;
    case 'elephant':
      for (const [dr, dc] of DIAGONAL) {
        const tr = row + dr * 2;
        const tc = col + dc * 2;
        if (!inside(tr, tc)) continue;
        if (!side.elephantNoEye && blocked(board, rules, idx(row + dr, col + dc))) continue;
        if (!piece.revealed) {
          if (piece.coverColor === RED && tr < 5) continue;
          if (piece.coverColor === BLACK && tr > 4) continue;
        }
        out.push(idx(tr, tc));
      }
      break;
    case 'advisor':
      for (const [dr, dc] of side.advisorStraight ? [...DIAGONAL, ...ORTHOGONAL] : DIAGONAL) {
        const tr = row + dr;
        const tc = col + dc;
        if (!inside(tr, tc)) continue;
        if (!piece.revealed && !insidePalace(tr, tc, piece.coverColor)) continue;
        out.push(idx(tr, tc));
      }
      break;
    case 'general': {
      const free = sideRulesOf(rules, piece.color).generalFree;
      for (const [dr, dc] of ORTHOGONAL) {
        const tr = row + dr;
        const tc = col + dc;
        if (free ? inside(tr, tc) && ownHalf(tr, piece.color) : insidePalace(tr, tc, piece.color)) out.push(idx(tr, tc));
      }
      const enemy = findGeneral(board, otherColor(piece.color));
      if (enemy >= 0 && colOf(enemy) === col) {
        const start = Math.min(row, rowOf(enemy));
        const end = Math.max(row, rowOf(enemy));
        let clear = true;
        for (let r = start + 1; r < end; r++) {
          if (blocked(board, rules, idx(r, col))) {
            clear = false;
            break;
          }
        }
        if (clear) out.push(enemy);
      }
      break;
    }
    case 'soldier': {
      const color = piece.revealed ? piece.color : piece.coverColor;
      const direction = color === RED ? -1 : 1;
      if (inside(row + direction, col)) out.push(idx(row + direction, col));
      const crossed = color === RED ? row <= 4 : row >= 5;
      if (crossed || side.soldierSideways) {
        if (inside(row, col - 1)) out.push(idx(row, col - 1));
        if (inside(row, col + 1)) out.push(idx(row, col + 1));
      }
      break;
    }
  }
  // 山石不可落脚
  if (rules.rocks !== undefined && rules.rocks.length > 0) {
    let write = start;
    for (let i = start; i < out.length; i++) if (!isRock(rules, out[i])) out[write++] = out[i];
    out.length = write;
  }
  return out;
}

export function generalsFace(board: Board, rules: RuleSet = NO_RULES): boolean {
  const red = findGeneral(board, RED);
  const black = findGeneral(board, BLACK);
  if (red < 0 || black < 0 || colOf(red) !== colOf(black)) return false;
  const col = colOf(red);
  const start = Math.min(rowOf(red), rowOf(black));
  const end = Math.max(rowOf(red), rowOf(black));
  for (let r = start + 1; r < end; r++) if (blocked(board, rules, idx(r, col))) return false;
  return true;
}

function wouldFaceGenerals(board: Board, source: number, destination: number, rules: RuleSet): boolean {
  const mover = board[source];
  const captured = board[destination];
  board[destination] = mover;
  board[source] = null;
  const result = generalsFace(board, rules);
  board[source] = mover;
  board[destination] = captured;
  return result;
}

export function legalMovesOn(board: Board, source: number, turn: Color, rules: RuleSet = NO_RULES): number[] {
  const piece = board[source];
  if (piece === null || controller(piece) !== turn || (piece.frozen ?? 0) > 0) return [];
  const own = controller(piece);
  const seen = new Set<number>();
  for (const destination of pseudoMoves(board, source, piece, [], rules)) {
    const occupant = board[destination];
    if (occupant !== null && controller(occupant) === own) continue;
    if (wouldFaceGenerals(board, source, destination, rules)) continue;
    seen.add(destination);
  }
  return [...seen].sort((a, b) => a - b);
}

export function allLegalMovesOn(board: Board, turn: Color, rules: RuleSet = NO_RULES): Move[] {
  const moves: Move[] = [];
  for (let source = 0; source < board.length; source++) {
    const piece = board[source];
    if (piece === null || controller(piece) !== turn) continue;
    for (const destination of legalMovesOn(board, source, turn, rules)) moves.push([source, destination]);
  }
  return moves;
}

export function isInCheckOn(board: Board, color: Color, rules: RuleSet = NO_RULES): boolean {
  const general = findGeneral(board, color);
  if (general < 0) return false;
  const enemy = otherColor(color);
  const buffer: number[] = [];
  for (let source = 0; source < board.length; source++) {
    const piece = board[source];
    if (piece === null || controller(piece) !== enemy) continue;
    buffer.length = 0;
    if (pseudoMoves(board, source, piece, buffer, rules).includes(general)) return true;
  }
  return false;
}

/** 吃将时是否会被护体挡下。 */
export function shieldBlocks(board: Board, destination: number, shields: Record<Color, number> | undefined): boolean {
  const target = board[destination];
  return target !== null && target.revealed && target.kind === 'general' && (shields?.[target.color] ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// 对局状态
// ---------------------------------------------------------------------------

export interface LastMove {
  from: number;
  to: number;
  actor: Color;
  pieceId: number;
  pieceColor: Color;
  pieceKind: Kind;
  movedAs: Kind;
  wasHidden: boolean;
  switchedOwner: boolean;
  capturedId: number | null;
  capturedColor: Color | null;
  capturedKind: Kind | null;
  nextPlayerInCheck: boolean;
}

export interface MoveOutcome {
  from: number;
  to: number;
  actor: Color;
  piece: Piece;
  movedAs: Kind;
  wasHidden: boolean;
  captured: Piece | null;
  capturedWasHidden: boolean;
  switchedOwner: boolean;
  /** 吃将被护体挡下：走子方反被震碎（进入阵亡托盘）。 */
  bounced: boolean;
  /** 落入墨池被定住。 */
  mired: boolean;
  nextPlayerInCheck: boolean;
  winner: Color | null;
  isDraw: boolean;
  endReason: EndReason | null;
}

export interface CoreState {
  board: Board;
  currentTurn: Color;
  captured: Record<Color, Piece[]>;
  winner: Color | null;
  isDraw: boolean;
  endReason: EndReason | null;
  noProgressPlies: number;
  positionCounts: Record<string, number>;
  moveCount: number;
  lastMove: LastMove | null;
  rules?: RuleSet;
  shields?: Record<Color, number>;
}

export interface SavedGame {
  version: 2;
  state: CoreState;
  history: CoreState[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class GameState {
  board: Board = new Array<Piece | null>(ROWS * COLS).fill(null);
  currentTurn: Color = RED;
  captured: Record<Color, Piece[]> = { red: [], black: [] };
  winner: Color | null = null;
  isDraw = false;
  endReason: EndReason | null = null;
  noProgressPlies = 0;
  positionCounts: Record<string, number> = {};
  moveCount = 0;
  lastMove: LastMove | null = null;
  history: CoreState[] = [];
  /** 规则修正（墨途模式）。 */
  rules: RuleSet = {};
  /** 将帅护体：吃将时先抵消一次。 */
  shields: Record<Color, number> = { red: 0, black: 0 };

  /** pool：可选的三十枚暗子身份（墨途模式可增删改），缺省为标准配置。 */
  constructor(seed?: number, setup = true, pool?: [Color, Kind][]) {
    if (setup) this.setup(seed ?? Math.floor(Math.random() * 2 ** 31), pool);
    this.positionCounts[this.positionKey()] = 1;
  }

  static blank(turn: Color = RED): GameState {
    const game = new GameState(undefined, false);
    game.currentTurn = turn;
    game.positionCounts = { [game.positionKey()]: 1 };
    return game;
  }

  /** 测试/分析用：直接摆子（id 自动分配）。 */
  place(row: number, col: number, color: Color, kind: Kind, revealed = true, coverColor: Color | null = null, coverKind: Kind | null = null): Piece {
    const used = new Set(this.board.filter((p): p is Piece => p !== null).map((p) => p.id));
    let id = 0;
    while (used.has(id)) id++;
    const piece = makePiece(id, color, kind, revealed, coverColor, coverKind);
    this.board[idx(row, col)] = piece;
    return piece;
  }

  private setup(seed: number, identities?: [Color, Kind][]): void {
    const slots = startingSlots();
    const source = identities ?? nonGeneralPool();
    if (source.length !== slots.length) throw new Error('暗子身份数量必须为三十');
    const pool = shuffle(source.map(([c, k]) => [c, k] as [Color, Kind]), seededRandom(seed));
    this.board[idx(0, 4)] = makePiece(0, BLACK, 'general');
    this.board[idx(9, 4)] = makePiece(1, RED, 'general');
    slots.forEach(([square, coverColor, coverKind], i) => {
      const [color, kind] = pool[i];
      this.board[square] = makePiece(i + 2, color, kind, false, coverColor, coverKind);
    });
  }

  get isFinished(): boolean {
    return this.winner !== null || this.isDraw;
  }

  pieceAt(row: number, col: number): Piece | null {
    return this.board[idx(row, col)];
  }

  legalMovesFrom(source: number): number[] {
    if (this.isFinished) return [];
    return legalMovesOn(this.board, source, this.currentTurn, this.rules);
  }

  allLegalMoves(): Move[] {
    if (this.isFinished) return [];
    return allLegalMovesOn(this.board, this.currentTurn, this.rules);
  }

  isInCheck(color: Color): boolean {
    return isInCheckOn(this.board, color, this.rules);
  }

  move(source: number, destination: number): MoveOutcome {
    if (this.isFinished) throw new Error('对局已经结束');
    if (!this.legalMovesFrom(source).includes(destination)) throw new Error('这一步不符合规则');

    this.history.push(this.coreState());
    const actor = this.currentTurn;
    const piece = this.board[source]!;
    const bounced = shieldBlocks(this.board, destination, this.shields);
    const captured = bounced ? null : this.board[destination];
    const movedAs = movementKind(piece);
    this.board[source] = null;
    const wasHidden = !piece.revealed;
    const capturedWasHidden = captured !== null && !captured.revealed;

    if (bounced) {
      // 护体震碎来犯之子
      this.shields[this.board[destination]!.color] -= 1;
      piece.revealed = true;
      delete piece.frozen;
      this.captured[piece.color].push(piece);
    } else {
      if (captured !== null) {
        captured.revealed = true;
        delete captured.frozen;
        this.captured[captured.color].push(captured);
      }
      this.board[destination] = piece;
      if (wasHidden) piece.revealed = true;
      if (captured !== null && captured.kind === 'general') this.winner = actor;
    }

    // 定身逐半回合消退；新落入墨池者被定住（对方走完后仍不能动）
    for (const p of this.board) if (p !== null && p.frozen) p.frozen > 1 ? (p.frozen -= 1) : delete p.frozen;
    const mired = !bounced && isPool(this.rules, destination) && !sideRulesOf(this.rules, controller(piece)).poolImmune;
    if (mired) piece.frozen = 2;

    const switchedOwner = wasHidden && piece.color !== actor;
    this.moveCount += 1;
    this.currentTurn = otherColor(actor);
    this.noProgressPlies = captured !== null || wasHidden || bounced ? 0 : this.noProgressPlies + 1;

    this.recordPositionAndCheckEnd();
    const nextPlayerInCheck = !this.isFinished && this.isInCheck(this.currentTurn);
    this.lastMove = {
      from: source,
      to: destination,
      actor,
      pieceId: piece.id,
      pieceColor: piece.color,
      pieceKind: piece.kind,
      movedAs,
      wasHidden,
      switchedOwner,
      capturedId: captured?.id ?? null,
      capturedColor: captured?.color ?? null,
      capturedKind: captured?.kind ?? null,
      nextPlayerInCheck,
    };
    return {
      from: source,
      to: destination,
      actor,
      piece: clone(piece),
      movedAs,
      wasHidden,
      captured: captured ? clone(captured) : null,
      capturedWasHidden,
      switchedOwner,
      bounced,
      mired,
      nextPlayerInCheck,
      winner: this.winner,
      isDraw: this.isDraw,
      endReason: this.endReason,
    };
  }

  resign(color: Color): void {
    if (this.isFinished) throw new Error('对局已经结束');
    this.history.push(this.coreState());
    this.winner = otherColor(color);
    this.endReason = 'resignation';
  }

  agreeDraw(): void {
    if (this.isFinished) throw new Error('对局已经结束');
    this.history.push(this.coreState());
    this.isDraw = true;
    this.endReason = 'agreement';
  }

  /** 把一枚阵亡子（非将帅）以明子身份放回盘上空格。 */
  revive(color: Color, square: number): Piece | null {
    if (this.board[square] !== null || isRock(this.rules, square)) return null;
    const list = this.captured[color];
    let index = list.length - 1;
    while (index >= 0 && list[index].kind === 'general') index--;
    if (index < 0) return null;
    const [piece] = list.splice(index, 1);
    piece.revealed = true;
    this.board[square] = piece;
    return piece;
  }

  undo(): boolean {
    const snapshot = this.history.pop();
    if (snapshot === undefined) return false;
    this.loadCore(snapshot);
    return true;
  }

  positionKey(): string {
    const parts: string[] = [];
    for (let i = 0; i < this.board.length; i++) {
      const p = this.board[i];
      if (p === null) continue;
      const frozen = p.frozen ? `~${p.frozen}` : '';
      parts.push(
        p.revealed
          ? `${i}:${p.color[0]}${p.kind}${frozen}`
          : `${i}:${p.color[0]}${p.kind}?${p.coverColor![0]}${p.coverKind}${frozen}`,
      );
    }
    return `${this.currentTurn[0]}|${parts.join(',')}`;
  }

  private recordPositionAndCheckEnd(): void {
    const key = this.positionKey();
    this.positionCounts[key] = (this.positionCounts[key] ?? 0) + 1;
    if (this.winner !== null) {
      this.endReason = 'general_captured';
      return;
    }
    if (allLegalMovesOn(this.board, this.currentTurn, this.rules).length === 0) {
      this.winner = otherColor(this.currentTurn);
      this.endReason = 'no_legal_moves';
      return;
    }
    if (this.positionCounts[key] >= 3) {
      this.isDraw = true;
      this.endReason = 'threefold_repetition';
      return;
    }
    if (this.noProgressPlies >= NO_PROGRESS_LIMIT) {
      this.isDraw = true;
      this.endReason = 'no_progress';
    }
  }

  coreState(): CoreState {
    return clone({
      board: this.board,
      currentTurn: this.currentTurn,
      captured: this.captured,
      winner: this.winner,
      isDraw: this.isDraw,
      endReason: this.endReason,
      noProgressPlies: this.noProgressPlies,
      positionCounts: this.positionCounts,
      moveCount: this.moveCount,
      lastMove: this.lastMove,
      rules: this.rules,
      shields: this.shields,
    });
  }

  private loadCore(data: CoreState): void {
    const state = clone(data);
    this.board = state.board;
    this.currentTurn = state.currentTurn;
    this.captured = state.captured;
    this.winner = state.winner ?? null;
    this.isDraw = Boolean(state.isDraw);
    this.endReason = state.endReason ?? null;
    this.noProgressPlies = state.noProgressPlies ?? 0;
    this.positionCounts = state.positionCounts ?? {};
    if (Object.keys(this.positionCounts).length === 0) this.positionCounts[this.positionKey()] = 1;
    this.moveCount = state.moveCount ?? 0;
    this.lastMove = state.lastMove ?? null;
    this.rules = state.rules ?? {};
    this.shields = state.shields ?? { red: 0, black: 0 };
  }

  toJSON(): SavedGame {
    return { version: 2, state: this.coreState(), history: clone(this.history) };
  }

  static fromJSON(data: SavedGame): GameState {
    if (data?.version !== 2) throw new Error('存档版本不受支持');
    const game = new GameState(undefined, false);
    game.loadCore(data.state);
    game.history = clone(data.history ?? []);
    return game;
  }

  /** 所有棋子（盘上 + 阵亡），用于校验与界面同步。 */
  allPieces(): Piece[] {
    return [...this.board.filter((p): p is Piece => p !== null), ...this.captured.red, ...this.captured.black];
  }

  /** 全部身份构成（含暗子真身）。构成本身是公开信息：每次增删都会公告。 */
  composition(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const p of this.allPieces()) counts[`${p.color}:${p.kind}`] = (counts[`${p.color}:${p.kind}`] ?? 0) + 1;
    return counts;
  }

  hiddenCount(): number {
    return this.board.reduce((n, p) => n + (p !== null && !p.revealed ? 1 : 0), 0);
  }
}
