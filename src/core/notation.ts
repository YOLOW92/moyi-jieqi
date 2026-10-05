import { colOf, rowOf, type Color, type EndReason, type Kind, type MoveOutcome } from './rules';

export const PIECE_CHAR: Record<Color, Record<Kind, string>> = {
  red: { general: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', soldier: '兵' },
  black: { general: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '砲', soldier: '卒' },
};

export const KIND_NAME: Record<Kind, string> = {
  general: '将帅',
  advisor: '士',
  elephant: '象',
  horse: '马',
  rook: '车',
  cannon: '炮',
  soldier: '兵',
};

export const COLOR_NAME: Record<Color, string> = { red: '红', black: '黑' };

const CN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const FW_DIGITS = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];

/** 中国象棋记谱（四字记法；暗子以其走法棋种记，并附翻面结果）。 */
export function formatMove(outcome: MoveOutcome): string {
  const { actor, movedAs } = outcome;
  const fromRow = rowOf(outcome.from);
  const toRow = rowOf(outcome.to);
  const fromCol = colOf(outcome.from);
  const toCol = colOf(outcome.to);
  const digits = actor === 'red' ? CN_DIGITS : FW_DIGITS;
  const file = (col: number) => digits[actor === 'red' ? 9 - col : col + 1];
  const forward = actor === 'red' ? fromRow - toRow : toRow - fromRow;
  const name = (outcome.wasHidden ? '暗' : '') + PIECE_CHAR[actor][movedAs];

  let action: string;
  let target: string;
  if (forward === 0) {
    action = '平';
    target = file(toCol);
  } else {
    action = forward > 0 ? '进' : '退';
    const straight = ['rook', 'cannon', 'soldier', 'general'].includes(movedAs);
    target = straight && fromCol === toCol ? digits[Math.abs(forward)] : file(toCol);
  }
  return `${name}${file(fromCol)}${action}${target}`;
}

export function describeOutcome(outcome: MoveOutcome): string {
  const parts: string[] = [];
  if (outcome.wasHidden) {
    const char = PIECE_CHAR[outcome.piece.color][outcome.piece.kind];
    parts.push(outcome.switchedOwner ? `翻出${COLOR_NAME[outcome.piece.color]}${char}·倒戈` : `翻出${char}`);
  }
  if (outcome.captured) {
    parts.push(`吃${COLOR_NAME[outcome.captured.color]}${PIECE_CHAR[outcome.captured.color][outcome.captured.kind]}`);
  }
  return parts.join(' · ');
}

export const END_REASON_TEXT: Record<EndReason, string> = {
  general_captured: '将帅被擒',
  no_legal_moves: '无子可动',
  threefold_repetition: '三次重复局面',
  no_progress: '六十回合未吃未翻',
  resignation: '认输',
  agreement: '双方议和',
};
