// 墨途的局外状态与纯逻辑（不涉及界面，便于测试）。

import type { Difficulty } from '../ai/engine';
import { BLACK, NON_GENERAL_COUNTS, RED, type Color, type GameState, type Kind, type RuleSet, type SideRules } from '../core/rules';
import {
  ACT_GATES,
  AFFIXES,
  BOSSES,
  DECK_OPS,
  DIFFICULTY_TABLE,
  MAX_TALISMANS,
  RELICS,
  TALISMANS,
  UPGRADES,
  type CardDef,
} from './content';

export type Roster = Record<Color, Record<Exclude<Kind, 'general'>, number>>;

export interface RunState {
  version: 1;
  /** 第几盘（1..3） */
  round: number;
  /** 本盘第几幕（1..3） */
  act: number;
  ink: number;
  upgrades: string[];
  relics: string[];
  talismans: string[];
  /** 暗子池构成；玩家恒执红 */
  roster: Roster;
  /** 本盘已出现的敌方词缀 */
  affixes: string[];
  /** 本盘己方吃子数 */
  captures: number;
  rocks: number[];
  pools: number[];
  treasures: number[];
  /** 已窥见的暗子编号 */
  peeked: number[];
  /** Boss 召魂计时（敌方行棋步数） */
  summonClock: number;
  stats: { captures: number; inkEarned: number; roundsWon: number };
}

export const HUMAN: Color = RED;
export const ENEMY: Color = BLACK;

export function newRun(): RunState {
  const counts = { ...NON_GENERAL_COUNTS };
  return {
    version: 1,
    round: 1,
    act: 1,
    ink: 5,
    upgrades: [],
    relics: [],
    talismans: ['kuitian'],
    roster: { red: { ...counts }, black: { ...counts } },
    affixes: [],
    captures: 0,
    rocks: [],
    pools: [],
    treasures: [],
    peeked: [],
    summonClock: 0,
    stats: { captures: 0, inkEarned: 0, roundsWon: 0 },
  };
}

export function isRunState(data: unknown): data is RunState {
  const r = data as RunState | null;
  return !!r && r.version === 1 && typeof r.round === 'number' && Array.isArray(r.talismans) && !!r.roster?.red;
}

/** 暗子池展开成三十枚身份。 */
export function rosterPool(roster: Roster): [Color, Kind][] {
  const pool: [Color, Kind][] = [];
  for (const color of [RED, BLACK] as Color[]) {
    for (const [kind, n] of Object.entries(roster[color]) as [Kind, number][]) for (let i = 0; i < n; i++) pool.push([color, kind]);
  }
  return pool;
}

export const pickRandom = <T>(items: readonly T[], random = Math.random): T => items[Math.floor(random() * items.length)];

export function sampleDistinct<T>(items: readonly T[], n: number, random = Math.random): T[] {
  const copy = [...items];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  return out;
}

export const bossOf = (run: RunState) => BOSSES[Math.min(run.round, BOSSES.length) - 1];
export const bossActive = (run: RunState): boolean => run.act >= 3;

export function difficultyOf(run: RunState): Difficulty {
  const row = DIFFICULTY_TABLE[Math.min(run.round, DIFFICULTY_TABLE.length) - 1];
  return row[Math.min(run.act, row.length) - 1];
}

/** 双方兵种强化 + 地形 → 规则修正。 */
export function rulesOf(run: RunState): RuleSet {
  const red: SideRules = {};
  for (const id of run.upgrades) {
    const upgrade = UPGRADES.find((u) => u.id === id);
    if (upgrade) red[upgrade.rule] = true;
  }
  if (run.relics.includes('yanchi')) red.poolImmune = true;
  const black: SideRules = {};
  for (const id of run.affixes) {
    const affix = AFFIXES.find((a) => a.id === id);
    if (affix?.rule) black[affix.rule] = true;
  }
  if (bossActive(run)) for (const rule of bossOf(run).rules) black[rule] = true;
  return { sides: { red, black }, rocks: [...run.rocks], pools: [...run.pools] };
}

/** 换幕门槛：返回应进入的幕。 */
export function actFor(run: RunState, plies: number): number {
  let act = 1;
  for (const gate of ACT_GATES) if (run.captures >= gate.captures || plies >= gate.plies) act++;
  return Math.min(3, act);
}

/** 距下一幕的提示文字。 */
export function nextActHint(run: RunState, plies: number): string {
  if (run.act >= 3) return '终幕 · 擒将即胜';
  const gate = ACT_GATES[run.act - 1];
  return `再吃 ${Math.max(0, gate.captures - run.captures)} 子或 ${Math.max(0, Math.ceil((gate.plies - plies) / 2))} 回合后入下一幕`;
}

const CAPTURE_INK: Record<Kind, number> = { general: 0, soldier: 1, advisor: 2, elephant: 2, horse: 3, cannon: 3, rook: 4 };

export function inkForCapture(run: RunState, kind: Kind): number {
  return CAPTURE_INK[kind] + (run.relics.includes('jubao') ? 1 : 0);
}

export function gainInk(run: RunState, amount: number): void {
  run.ink += amount;
  run.stats.inkEarned += amount;
}

/** 能否再收一张卡（符箓有格数上限，升级与遗珍不可重复）。 */
export function canTake(run: RunState, card: CardDef): boolean {
  switch (card.kind) {
    case 'talisman':
      return run.talismans.length < MAX_TALISMANS;
    case 'upgrade':
      return !run.upgrades.includes(card.id);
    case 'relic':
      return !run.relics.includes(card.id);
    case 'deck':
      return deckOpPossible(run, card.id);
  }
}

/** 三选一奖励：尽量各类各一。 */
export function rollReward(run: RunState, random = Math.random): CardDef[] {
  const pools: CardDef[][] = [UPGRADES, RELICS, TALISMANS].map((list) => list.filter((c) => canTake(run, c)));
  const offer: CardDef[] = [];
  for (const list of pools) if (list.length > 0) offer.push(pickRandom(list, random));
  const rest = [...UPGRADES, ...RELICS, ...TALISMANS].filter((c) => canTake(run, c) && !offer.includes(c));
  offer.push(...sampleDistinct(rest, 3 - offer.length, random));
  return sampleDistinct(offer, offer.length, random);
}

/** 墨肆货架。 */
export function rollShop(run: RunState, random = Math.random): CardDef[] {
  const take = (list: CardDef[], n: number) => sampleDistinct(list.filter((c) => canTake(run, c) || c.kind === 'talisman'), n, random);
  return [...take(TALISMANS, 3), ...take(UPGRADES, 1), ...take(RELICS, 1), ...take(DECK_OPS, 2)];
}

/** 收下一张卡（不处理点将，点将见 applyDeckOp）。 */
export function takeCard(run: RunState, card: CardDef): void {
  if (card.kind === 'talisman') run.talismans.push(card.id);
  else if (card.kind === 'upgrade') run.upgrades.push(card.id);
  else if (card.kind === 'relic') run.relics.push(card.id);
}

interface DeckChange {
  fromColor: Color;
  fromKind: Exclude<Kind, 'general'>;
  toColor: Color;
  toKind: Exclude<Kind, 'general'>;
}

function deckChanges(id: string): DeckChange[] {
  switch (id) {
    case 'dianhua':
      return [{ fromColor: HUMAN, fromKind: 'soldier', toColor: HUMAN, toKind: 'rook' }];
    case 'cefan':
      return (['horse', 'cannon', 'soldier'] as const).map((k) => ({ fromColor: ENEMY, fromKind: k, toColor: HUMAN, toKind: k }));
    case 'xuefan':
      return [{ fromColor: ENEMY, fromKind: 'rook', toColor: ENEMY, toKind: 'soldier' }];
    default:
      return [];
  }
}

export function deckOpPossible(run: RunState, id: string): boolean {
  return deckChanges(id).some((c) => run.roster[c.fromColor][c.fromKind] > 0);
}

/**
 * 点将：改写暗子池；若本盘还有符合条件的暗子，同时改写其真身。
 * 返回描述文字；不可行时返回 null。
 */
export function applyDeckOp(run: RunState, game: GameState | null, id: string, random = Math.random): string | null {
  const options = deckChanges(id).filter((c) => run.roster[c.fromColor][c.fromKind] > 0);
  if (options.length === 0) return null;
  const change = pickRandom(options, random);
  run.roster[change.fromColor][change.fromKind] -= 1;
  run.roster[change.toColor][change.toKind] += 1;
  let live = false;
  if (game) {
    const hidden = game.board.filter((p) => p !== null && !p.revealed && p.color === change.fromColor && p.kind === change.fromKind);
    if (hidden.length > 0) {
      const piece = pickRandom(hidden, random)!;
      piece.color = change.toColor;
      piece.kind = change.toKind;
      live = true;
    }
  }
  const NAME: Record<string, string> = { soldier: '兵', rook: '车', horse: '马', cannon: '炮' };
  const text =
    change.fromColor === change.toColor
      ? `${change.fromColor === HUMAN ? '己方' : '敌方'}一${NAME[change.fromKind]}化为${NAME[change.toKind]}`
      : `敌方一${NAME[change.fromKind]}改投己方`;
  return live ? `${text}（本盘暗子已生效）` : `${text}（自下一盘起生效）`;
}

/** 伏兵：本盘两枚己方暗子改投敌方（只改本盘，不改暗子池）。 */
export function ambush(game: GameState, random = Math.random): number {
  const hidden = game.board.filter((p) => p !== null && !p.revealed && p.color === HUMAN && p.kind !== 'general');
  const chosen = sampleDistinct(hidden, 2, random);
  for (const piece of chosen) piece!.color = ENEMY;
  return chosen.length;
}

/** 选空格放置地形：避开棋子、已有地形与九宫。 */
export function freeSquares(game: GameState, run: RunState, rows: [number, number]): number[] {
  const taken = new Set([...run.rocks, ...run.pools, ...run.treasures]);
  const out: number[] = [];
  for (let row = rows[0]; row <= rows[1]; row++) {
    for (let col = 0; col < 9; col++) {
      const square = row * 9 + col;
      if (game.board[square] !== null || taken.has(square)) continue;
      if (col >= 3 && col <= 5 && (row <= 2 || row >= 7)) continue;
      out.push(square);
    }
  }
  return out;
}
