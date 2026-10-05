// 墨途（Roguelike）模式的全部内容定义：兵种升级、遗珍、符箓、暗子池操作、敌方词缀、Boss。

import type { Difficulty } from '../ai/engine';
import type { SideRules } from '../core/rules';

export type CardKind = 'upgrade' | 'relic' | 'talisman' | 'deck';

export interface CardDef {
  id: string;
  kind: CardKind;
  name: string;
  /** 印章上的单字 */
  glyph: string;
  desc: string;
  price: number;
}

export const KIND_LABEL: Record<CardKind, string> = { upgrade: '兵法', relic: '遗珍', talisman: '符箓', deck: '点将' };

// ---------------------------------------------------------------------------
// 兵种升级：直接改写己方走法
// ---------------------------------------------------------------------------

export const UPGRADES: (CardDef & { rule: keyof SideRules })[] = [
  { id: 'tianma', kind: 'upgrade', name: '天马行空', glyph: '马', desc: '己方马不再蹩腿。', price: 11, rule: 'horseNoLeg' },
  { id: 'feixiang', kind: 'upgrade', name: '飞象过河', glyph: '象', desc: '己方象不再塞象眼。', price: 9, rule: 'elephantNoEye' },
  { id: 'lianhuan', kind: 'upgrade', name: '连环炮', glyph: '炮', desc: '己方炮可隔一子或两子吃子。', price: 12, rule: 'cannonMulti' },
  { id: 'youbing', kind: 'upgrade', name: '游兵散勇', glyph: '兵', desc: '己方兵未过河也可左右平移。', price: 8, rule: 'soldierSideways' },
  { id: 'youshi', kind: 'upgrade', name: '谋士出帐', glyph: '仕', desc: '己方士除斜走外，也可直走一格。', price: 8, rule: 'advisorStraight' },
];

// ---------------------------------------------------------------------------
// 遗珍：被动效果
// ---------------------------------------------------------------------------

export const RELICS: CardDef[] = [
  { id: 'jubao', kind: 'relic', name: '聚宝盆', glyph: '宝', desc: '每吃一子，墨锭额外 +1。', price: 10 },
  { id: 'huiyan', kind: 'relic', name: '慧眼', glyph: '眼', desc: '每盘开局窥见三枚暗子的真身。', price: 11 },
  { id: 'tiebi', kind: 'relic', name: '铁壁', glyph: '壁', desc: '每盘开局，己方帅护体 +1（挡下一次吃帅）。', price: 14 },
  { id: 'huichun', kind: 'relic', name: '回春', glyph: '春', desc: '每盘开局获得一张随机符箓。', price: 10 },
  { id: 'huofu', kind: 'relic', name: '祸福相倚', glyph: '福', desc: '己方翻子倒戈时，获得 3 墨锭。', price: 7 },
  { id: 'jiangxing', kind: 'relic', name: '将星', glyph: '星', desc: '每次将军，获得 2 墨锭。', price: 8 },
  { id: 'yuyin', kind: 'relic', name: '余荫', glyph: '荫', desc: '每入新一幕，获得 4 墨锭。', price: 8 },
  { id: 'yanchi', kind: 'relic', name: '以池为砚', glyph: '砚', desc: '己方棋子不受墨池影响。', price: 7 },
];

// ---------------------------------------------------------------------------
// 符箓：主动、一次性
// ---------------------------------------------------------------------------

export const TALISMANS: CardDef[] = [
  { id: 'kuitian', kind: 'talisman', name: '窥天符', glyph: '窥', desc: '窥见一枚暗子的真身。不耗回合。', price: 4 },
  { id: 'dingshen', kind: 'talisman', name: '定身符', glyph: '定', desc: '定住一枚敌子，两回合内不能走。不耗回合。', price: 5 },
  { id: 'yixing', kind: 'talisman', name: '移形符', glyph: '移', desc: '互换两枚己方棋子的位置。不耗回合。', price: 6 },
  { id: 'tuiyan', kind: 'talisman', name: '推演符', glyph: '算', desc: '以宗师之力推演一步好棋。', price: 3 },
  { id: 'huishou', kind: 'talisman', name: '回首符', glyph: '回', desc: '悔一步棋（连同对手的应着）。', price: 5 },
  { id: 'zhenmo', kind: 'talisman', name: '泼墨符', glyph: '墨', desc: '在一处空格泼下墨池。不耗回合。', price: 3 },
  { id: 'kaishan', kind: 'talisman', name: '开山符', glyph: '山', desc: '击碎一块山石。不耗回合。', price: 3 },
];

export const MAX_TALISMANS = 4;

// ---------------------------------------------------------------------------
// 点将：改写暗子池（本盘暗子若符合，亦即时生效）
// ---------------------------------------------------------------------------

export const DECK_OPS: CardDef[] = [
  { id: 'dianhua', kind: 'deck', name: '点石成金', glyph: '金', desc: '己方暗子池中一枚兵化为车。', price: 7 },
  { id: 'cefan', kind: 'deck', name: '策反', glyph: '反', desc: '敌方暗子池中一枚马、炮或兵改投己方。', price: 8 },
  { id: 'xuefan', kind: 'deck', name: '削藩', glyph: '削', desc: '敌方暗子池中一枚车降为卒。', price: 7 },
];

export const ALL_CARDS: CardDef[] = [...UPGRADES, ...RELICS, ...TALISMANS, ...DECK_OPS];
export const cardById = (id: string): CardDef => {
  const card = ALL_CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`未知卡牌 ${id}`);
  return card;
};

// ---------------------------------------------------------------------------
// 敌方：词缀与 Boss
// ---------------------------------------------------------------------------

export interface AffixDef {
  id: string;
  name: string;
  desc: string;
  rule?: keyof SideRules;
  /** 敌帅护体 */
  shield?: number;
}

export const AFFIXES: AffixDef[] = [
  { id: 'tieqi', name: '铁骑', desc: '敌马不再蹩腿。', rule: 'horseNoLeg' },
  { id: 'lianzhu', name: '连珠', desc: '敌炮可隔一子或两子吃子。', rule: 'cannonMulti' },
  { id: 'duxiang', name: '象渡', desc: '敌象不再塞象眼。', rule: 'elephantNoEye' },
  { id: 'jixing', name: '疾行', desc: '敌卒未过河也可平移。', rule: 'soldierSideways' },
  { id: 'jianbi', name: '坚壁', desc: '敌将护体 +1。', shield: 1 },
  { id: 'fubing', name: '伏兵', desc: '盘上两枚己方暗子暗中改投敌方。' },
  { id: 'moxiang', name: '墨乡', desc: '盘上再泼两处墨池、立一块山石。' },
];

export interface BossDef {
  id: string;
  name: string;
  title: string;
  desc: string;
  shield: number;
  rules: (keyof SideRules)[];
  /** 每隔若干手（敌方行棋步数）唤回一枚阵亡敌子；0 为无 */
  summonEvery: number;
}

export const BOSSES: BossDef[] = [
  { id: 'tiejia', name: '铁甲将军', title: '铁甲', desc: '敌将护体 +2：须连破两次方能擒获。', shield: 2, rules: [], summonEvery: 0 },
  { id: 'yujia', name: '御驾亲征', title: '御驾', desc: '敌将护体 +1，可出九宫在本方半场驰骋；敌士可直走。', shield: 1, rules: ['generalFree', 'advisorStraight'], summonEvery: 0 },
  { id: 'moyan', name: '墨魇', title: '墨魇', desc: '敌将护体 +1；敌马不蹩腿、敌炮可隔两子；每六手唤回一枚阵亡敌子。', shield: 1, rules: ['horseNoLeg', 'cannonMulti'], summonEvery: 6 },
];

/** 每盘对手的名号 */
export const OPPONENTS = ['山野棋客', '江湖国手', '墨魇'];

export const ROUNDS = 3;

/** 难度：第 round 盘第 act 幕 */
export const DIFFICULTY_TABLE: Difficulty[][] = [
  ['easy', 'easy', 'normal'],
  ['normal', 'normal', 'expert'],
  ['normal', 'expert', 'expert'],
];

/** 换幕门槛：本盘己方吃子数或总手数，先到为准 */
export const ACT_GATES = [
  { captures: 3, plies: 40 },
  { captures: 7, plies: 80 },
];

export const ACT_NAME = ['', '第一幕', '第二幕', '第三幕'];
export const ROUND_NAME = ['', '第一盘', '第二盘', '第三盘'];
export const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
