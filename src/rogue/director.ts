// 墨途导演：一局墨途 = 三盘棋，每盘三幕。负责开盘、结算、换幕、Boss、符箓与界面。

import * as THREE from 'three';
import { sound } from '../audio/sound';
import { COLOR_NAME, PIECE_CHAR } from '../core/notation';
import { controller as controllerOf, GameState, generalsFace, idx, type Kind, type MoveOutcome, type Piece } from '../core/rules';
import type { Controller, RogueHooks } from '../game/controller';
import { squareToWorld } from '../scene/board';
import { TerrainView } from '../scene/terrain';
import { ask, resultBlock } from '../ui/dialogs';
import { openShop, pickCard, RoguePanel, type ShopItem } from '../ui/rogueUi';
import { ACT_NAME, AFFIXES, cardById, CN_NUM, OPPONENTS, ROUND_NAME, ROUNDS, TALISMANS, type CardDef } from './content';
import {
  actFor,
  ambush,
  applyDeckOp,
  bossActive,
  bossOf,
  canTake,
  difficultyOf,
  ENEMY,
  freeSquares,
  gainInk,
  HUMAN,
  inkForCapture,
  isRunState,
  newRun,
  nextActHint,
  pickRandom,
  rollReward,
  rollShop,
  rosterPool,
  rulesOf,
  sampleDistinct,
  takeCard,
  type RunState,
} from './run';

const MAJOR: Kind[] = ['rook', 'horse', 'cannon'];
const GOLD = new THREE.Color(0xd9a441);
const INK = new THREE.Color(0x1c1915);

export class RogueDirector implements RogueHooks {
  run: RunState | null = null;
  private readonly terrain = new TerrainView();
  private readonly panel = new RoguePanel();
  private casting = false;

  constructor(private readonly c: Controller) {
    c.stage.scene.add(this.terrain.group);
    this.panel.onTalisman((i) => void this.useTalisman(i));
  }

  private get game(): GameState {
    return this.c.game;
  }

  // ======================================================================
  // 开局
  // ======================================================================

  async startRun(): Promise<void> {
    this.run = newRun();
    await this.startRound();
  }

  private async startRound(): Promise<void> {
    const run = this.run!;
    Object.assign(run, { act: 1, captures: 0, rocks: [], pools: [], treasures: [], peeked: [], summonClock: 0, affixes: [] });
    const game = new GameState(undefined, true, rosterPool(run.roster));
    game.shields = { red: run.relics.includes('tiebi') ? 1 : 0, black: 0 };

    // 开局地形随盘数加重
    this.scatter(game, 'rocks', [1, 2, 2][run.round - 1], [3, 6]);
    this.scatter(game, 'pools', [1, 2, 3][run.round - 1], [3, 6]);
    this.scatter(game, 'treasures', [1, 1, 2][run.round - 1], [4, 5]);
    // 后几盘的对手一上来就带着词缀
    const carried = sampleDistinct(AFFIXES, run.round - 1);
    for (const affix of carried) this.applyAffix(affix.id, game);

    if (run.relics.includes('huichun')) {
      const card = pickRandom(TALISMANS);
      if (canTake(run, card)) takeCard(run, card);
    }
    if (run.relics.includes('huiyan')) {
      const hidden = game.board.filter((p): p is Piece => p !== null && !p.revealed);
      run.peeked.push(...sampleDistinct(hidden, 3).map((p) => p.id));
    }
    game.rules = rulesOf(run);
    await this.c.startNew({ mode: 'rogue', human: HUMAN, difficulty: difficultyOf(run) }, game);
    const lines = [`对手 · ${OPPONENTS[run.round - 1]}`];
    if (carried.length > 0) lines.push(`敌势：${carried.map((a) => a.name).join('、')}`);
    await this.c.hud.bigText(ROUND_NAME[run.round], { red: true, caption: lines.join('　'), hold: 1.0 });
  }

  private scatter(game: GameState, kind: 'rocks' | 'pools' | 'treasures', count: number, rows: [number, number]): number[] {
    const run = this.run!;
    const chosen = sampleDistinct(freeSquares(game, run, rows), count);
    run[kind].push(...chosen);
    return chosen;
  }

  private applyAffix(id: string, game: GameState): void {
    const run = this.run!;
    run.affixes.push(id);
    const affix = AFFIXES.find((a) => a.id === id)!;
    if (affix.shield) game.shields.black += affix.shield;
    if (id === 'fubing') ambush(game);
    if (id === 'moxiang') {
      this.scatter(game, 'pools', 2, [2, 7]);
      this.scatter(game, 'rocks', 1, [3, 6]);
    }
  }

  // ======================================================================
  // 控制器钩子
  // ======================================================================

  difficulty() {
    return difficultyOf(this.run!);
  }

  enemyName(): string {
    const run = this.run!;
    return bossActive(run) ? bossOf(run).name : OPPONENTS[run.round - 1];
  }

  stageLabel(): string {
    const run = this.run!;
    return `墨途 · ${ROUND_NAME[run.round]} · ${ACT_NAME[run.act]}`;
  }

  saveData(): unknown {
    return this.run;
  }

  restore(data: unknown): boolean {
    if (!isRunState(data)) return false;
    this.run = structuredClone(data);
    return true;
  }

  onEnter(): void {
    const run = this.run!;
    this.terrain.clear();
    this.terrain.sync(run.rocks, run.pools, run.treasures);
    this.panel.show(true);
  }

  onExit(): void {
    this.terrain.clear();
    this.panel.show(false);
  }

  refresh(): void {
    const run = this.run;
    if (!run) return;
    const boss = bossOf(run);
    this.panel.update({
      stage: `${ROUND_NAME[run.round]} · ${ACT_NAME[run.act]}`,
      hint: nextActHint(run, this.game.moveCount),
      ink: run.ink,
      enemyShield: this.game.shields.black,
      ownShield: this.game.shields.red,
      affixes: run.affixes,
      boss: { name: boss.name, desc: boss.desc, active: bossActive(run) },
      owned: [...run.upgrades, ...run.relics],
      talismans: run.talismans,
      canUse: !this.casting && this.c.canAct(),
    });
  }

  update(dt: number): void {
    this.terrain.update(dt);
    const run = this.run;
    if (!run) return;
    // 盘上小字：窥见的真身、定身、护体
    const live = new Set<string>();
    const lift = new THREE.Vector3();
    this.game.board.forEach((piece) => {
      if (!piece) return;
      const view = this.c.views.get(piece.id);
      if (!view?.root.visible) return;
      let text = '';
      let color = piece.color === 'red' ? '#b02a1f' : '#1c1915';
      if (!piece.revealed && run.peeked.includes(piece.id)) text = PIECE_CHAR[piece.color][piece.kind];
      if (piece.frozen) text += text ? '·定' : '定';
      if (piece.kind === 'general' && piece.revealed && this.game.shields[piece.color] > 0) {
        text = `护${CN_NUM[this.game.shields[piece.color]] ?? this.game.shields[piece.color]}`;
        color = '#a8834a';
      }
      if (!text) return;
      if (piece.frozen && run.peeked.includes(piece.id) === false) color = '#3b352f';
      const key = `p${piece.id}`;
      live.add(key);
      lift.copy(view.root.position);
      lift.y += view.lift.position.y;
      this.terrain.setLabel(key, text, color, lift);
    });
    for (const key of this.terrain.labelKeys()) if (!live.has(key)) this.terrain.setLabel(key, null);
  }

  // ======================================================================
  // 每步结算
  // ======================================================================

  async onMove(o: MoveOutcome): Promise<void> {
    const run = this.run!;
    const game = this.game;
    const hud = this.c.hud;
    let reward = false;
    const gains: string[] = [];
    const earn = (amount: number, why: string) => {
      if (amount <= 0) return;
      gainInk(run, amount);
      gains.push(`${why} +${amount}`);
    };

    if (o.actor === HUMAN) {
      if (o.captured) {
        run.captures++;
        run.stats.captures++;
        if (o.captured.color === ENEMY) {
          earn(inkForCapture(run, o.captured.kind), `吃${PIECE_CHAR[ENEMY][o.captured.kind]}`);
          if (MAJOR.includes(o.captured.kind)) reward = true;
        }
      }
      if (o.wasHidden) {
        if (!o.switchedOwner) earn(1, '翻子');
        else if (run.relics.includes('huofu')) earn(3, '祸福相倚');
      }
      if (o.nextPlayerInCheck && run.relics.includes('jiangxing')) earn(2, '将星');
      if (!o.bounced && run.treasures.includes(o.to)) {
        run.treasures = run.treasures.filter((s) => s !== o.to);
        this.terrain.sync(run.rocks, run.pools, run.treasures);
        this.c.effects.revealBurst(squareToWorld(o.to), GOLD);
        sound.reveal(false);
        earn(4, '宝匣');
        const card = pickRandom(TALISMANS);
        if (Math.random() < 0.6 && canTake(run, card)) {
          takeCard(run, card);
          gains.push(`得${card.name}`);
        }
      }
    } else {
      if (!o.bounced && run.treasures.includes(o.to)) {
        run.treasures = run.treasures.filter((s) => s !== o.to);
        this.terrain.sync(run.rocks, run.pools, run.treasures);
        hud.toast('宝匣被敌方毁去');
      }
      // 召魂
      const boss = bossOf(run);
      if (bossActive(run) && boss.summonEvery > 0 && ++run.summonClock >= boss.summonEvery) {
        run.summonClock = 0;
        await this.summon();
      }
    }
    if (o.mired) {
      this.c.effects.splat(squareToWorld(o.to), { size: 1.6, opacity: 0.6, color: INK, life: 3 });
      hud.toast(`${COLOR_NAME[controllerOf(o.piece)]}子陷入墨池，下回合不能动`);
    }
    if (gains.length > 0) hud.toast(`墨锭 · ${gains.join(' · ')}`);
    this.refresh();

    if (reward) await this.offerReward('斩将夺旗', '擒得敌方大将，择一而取。');
    const target = actFor(run, game.moveCount);
    while (run.act < target) await this.advanceAct();
    this.c.updateHud(false);
  }

  private async offerReward(title: string, subtitle: string): Promise<void> {
    const run = this.run!;
    const cards = rollReward(run);
    if (cards.length === 0) return;
    const card = await pickCard(title, subtitle, cards, '换 3 墨锭');
    if (card) this.take(card);
    else gainInk(run, 3);
    this.syncRules();
  }

  private take(card: CardDef): void {
    takeCard(this.run!, card);
    if (card.kind === 'relic' && card.id === 'tiebi') this.game.shields.red += 1;
  }

  private syncRules(): void {
    this.game.rules = rulesOf(this.run!);
    this.refresh();
  }

  private async advanceAct(): Promise<void> {
    const run = this.run!;
    const game = this.game;
    if (run.act >= 3) return;
    run.act++;
    if (run.relics.includes('yuyin')) gainInk(run, 4);
    let caption: string;
    if (run.act === 2) {
      const affix = pickRandom(AFFIXES.filter((a) => !run.affixes.includes(a.id)));
      this.applyAffix(affix.id, game);
      this.scatter(game, 'pools', 1, [3, 6]);
      this.scatter(game, 'treasures', 1, [3, 6]);
      caption = `敌势 · ${affix.name}：${affix.desc}`;
    } else {
      const boss = bossOf(run);
      game.shields.black += boss.shield;
      this.scatter(game, 'rocks', 1, [3, 6]);
      this.scatter(game, 'pools', 1, [2, 7]);
      this.scatter(game, 'treasures', 1, [3, 6]);
      caption = `首领 · ${boss.name}：${boss.desc}`;
    }
    this.syncRules();
    this.terrain.sync(run.rocks, run.pools, run.treasures);
    this.c.stage.shake(0.25);
    sound.gong(0.7);
    sound.drum(0.8);
    this.c.updateHud(false);
    await this.c.hud.bigText(ACT_NAME[run.act], { red: run.act === 3, caption, hold: 1.6 });
    await this.shop();
  }

  private async summon(): Promise<void> {
    const game = this.game;
    if (!game.captured[ENEMY].some((p) => p.kind !== 'general')) return;
    const homes = [];
    for (let row = 0; row <= 2; row++) for (let col = 0; col < 9; col++) if (game.board[idx(row, col)] === null && !this.run!.rocks.includes(idx(row, col))) homes.push(idx(row, col));
    if (homes.length === 0) return;
    const square = pickRandom(homes);
    const piece = game.revive(ENEMY, square);
    if (!piece) return;
    void this.c.hud.bigText('召魂', { caption: `${bossOf(this.run!).name}唤回${PIECE_CHAR[ENEMY][piece.kind]}`, hold: 0.4 });
    this.c.effects.smoke(squareToWorld(square), INK, 14);
    sound.gong(0.5);
    await this.c.syncAnimated();
  }

  // ======================================================================
  // 墨肆
  // ======================================================================

  private async shop(): Promise<void> {
    const run = this.run!;
    const items: ShopItem[] = rollShop(run).map((card) => ({ card, price: card.price }));
    await openShop(
      items,
      () => run.ink,
      (item) => {
        if (item.price > run.ink) return null;
        let message: string;
        if (item.card.kind === 'deck') {
          const result = applyDeckOp(run, this.c.mode === 'game' && !this.game.isFinished ? this.game : null, item.card.id);
          if (result === null) return null;
          message = `${item.card.name} · ${result}`;
        } else {
          if (!canTake(run, item.card)) return null;
          this.take(item.card);
          message = `购得${item.card.name}`;
        }
        run.ink -= item.price;
        return message;
      },
      (item) => canTake(run, item.card),
    );
    this.syncRules();
    this.c.save();
  }

  // ======================================================================
  // 终局
  // ======================================================================

  async onGameEnd(): Promise<void> {
    const run = this.run!;
    const game = this.game;
    const won = game.winner === HUMAN;
    const draw = game.winner === null;
    const last = run.round >= ROUNDS;

    if (won) {
      run.stats.roundsWon++;
      gainInk(run, 6 + run.round * 2);
    }
    if ((won || draw) && !last) {
      if (won) await this.offerReward(`${ROUND_NAME[run.round]}告捷`, `得墨锭 ${6 + run.round * 2}。择一件带往下一盘。`);
      else this.c.hud.toast('和局 · 无赏，继续前行', 2.6);
      await this.shop();
      run.round++;
      await this.c.ink.ink(true, 0.8);
      void this.c.ink.ink(false, 1.1);
      await this.startRound();
      return;
    }
    await this.finishRun(won);
  }

  private async finishRun(victory: boolean): Promise<void> {
    const run = this.run!;
    const s = run.stats;
    const body = [
      victory ? '三盘皆捷，墨途走到尽头。' : `止步于${ROUND_NAME[run.round]}${ACT_NAME[run.act]}。`,
      `胜 ${s.roundsWon} 盘 · 吃子 ${s.captures} · 累计墨锭 ${s.inkEarned}`,
      run.upgrades.length + run.relics.length > 0 ? `所得：${[...run.upgrades, ...run.relics].map((id) => cardById(id).name).join('、')}` : '',
    ].join('\n');
    const answer = await ask(
      victory ? '墨途 · 功成' : '墨途 · 折戟',
      body,
      [
        { label: '回卷首', value: 'menu' },
        { label: '再踏墨途', value: 'again', primary: true },
      ],
      resultBlock(victory ? '功成' : '折戟', victory),
    );
    if (answer === 'again') {
      await this.c.ink.ink(true, 0.7);
      void this.c.ink.ink(false, 1.0);
      await this.startRun();
    } else {
      this.c.onExitToMenu();
    }
  }

  // ======================================================================
  // 符箓
  // ======================================================================

  private async useTalisman(index: number): Promise<void> {
    const run = this.run;
    if (!run || this.casting || !this.c.canAct()) return;
    const id = run.talismans[index];
    if (!id) return;
    const game = this.game;
    const card = cardById(id);
    this.casting = true;
    this.refresh();
    let used = false;
    try {
      const squares = (test: (p: Piece | null, square: number) => boolean) => game.board.map((p, s) => (test(p, s) ? s : -1)).filter((s) => s >= 0);
      switch (id) {
        case 'kuitian': {
          const square = await this.c.pickSquare('窥天符：点选一枚暗子', squares((p) => p !== null && !p.revealed && !run.peeked.includes(p.id)));
          if (square === null) break;
          const piece = game.board[square]!;
          run.peeked.push(piece.id);
          this.c.effects.revealBurst(squareToWorld(square), GOLD);
          sound.reveal(false);
          this.c.hud.toast(`窥见：${COLOR_NAME[piece.color]}${PIECE_CHAR[piece.color][piece.kind]}`, 2.6);
          used = true;
          break;
        }
        case 'dingshen': {
          const square = await this.c.pickSquare('定身符：点选一枚敌子', squares((p) => p !== null && controllerOf(p) === ENEMY && p.kind !== 'general'));
          if (square === null) break;
          game.board[square]!.frozen = 4;
          this.c.effects.ripple(squareToWorld(square), { color: GOLD, size: 2.4, opacity: 0.7 });
          sound.gong(0.4);
          used = true;
          break;
        }
        case 'yixing': {
          const own = (p: Piece | null) => p !== null && controllerOf(p) === HUMAN && p.kind !== 'general';
          const a = await this.c.pickSquare('移形符：点选第一枚己方棋子', squares(own));
          if (a === null) break;
          const b = await this.c.pickSquare('再点选与之互换的一枚', squares((p, s) => own(p) && s !== a));
          if (b === null) break;
          [game.board[a], game.board[b]] = [game.board[b], game.board[a]];
          if (generalsFace(game.board, game.rules)) {
            [game.board[a], game.board[b]] = [game.board[b], game.board[a]];
            this.c.hud.toast('换位会使将帅照面，不可');
            break;
          }
          sound.whoosh(0.8);
          await this.c.syncAnimated();
          used = true;
          break;
        }
        case 'tuiyan':
          this.casting = false;
          used = await this.c.showHint('expert');
          break;
        case 'huishou':
          if (game.history.length < 2) {
            this.c.hud.toast('尚无可悔之着');
            break;
          }
          this.casting = false;
          used = await this.c.undo(true);
          if (used) this.syncRules();
          break;
        case 'zhenmo': {
          const taken = new Set([...run.rocks, ...run.pools, ...run.treasures]);
          const square = await this.c.pickSquare('泼墨符：点选一处空格', squares((p, s) => p === null && !taken.has(s)));
          if (square === null) break;
          run.pools.push(square);
          this.syncRules();
          this.terrain.sync(run.rocks, run.pools, run.treasures);
          this.c.effects.inkBurst(squareToWorld(square), { count: 30, color: INK });
          sound.drum(0.5);
          used = true;
          break;
        }
        case 'kaishan': {
          const square = await this.c.pickSquare('开山符：点选一块山石', [...run.rocks]);
          if (square === null) break;
          run.rocks = run.rocks.filter((s) => s !== square);
          this.syncRules();
          this.terrain.sync(run.rocks, run.pools, run.treasures);
          this.c.effects.smoke(squareToWorld(square), INK, 12);
          this.c.stage.shake(0.2);
          sound.drum(0.8);
          used = true;
          break;
        }
      }
    } finally {
      this.casting = false;
    }
    if (used) {
      const at = run.talismans.indexOf(id);
      if (at >= 0) run.talismans.splice(at, 1);
      this.c.hud.toast(`${card.name}已用`, 1.4);
      this.c.save();
    }
    this.c.updateHud(false);
  }
}
