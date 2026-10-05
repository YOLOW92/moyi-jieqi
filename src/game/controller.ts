// 对局控制器：串联规则、AI、3D 动画、界面与存档。

import * as THREE from 'three';
import gsap from 'gsap';
import { AIClient } from '../ai/client';
import type { Difficulty } from '../ai/engine';
import { sound } from '../audio/sound';
import { COLOR_NAME, describeOutcome, END_REASON_TEXT, formatMove } from '../core/notation';
import { colOf, controller, GameState, otherColor, rowOf, type Color, type MoveOutcome, type Piece, type SavedGame } from '../core/rules';
import { BoardView, squareToWorld, worldToSquare } from '../scene/board';
import { Effects } from '../scene/effects';
import { Landscape } from '../scene/landscape';
import { PIECE_HEIGHT, PieceView } from '../scene/pieces';
import { Stage } from '../scene/stage';
import { ask, dialogOpen, resultBlock } from '../ui/dialogs';
import { Hud, type MoveEntry } from '../ui/hud';
import type { InkLayer } from '../ui/inkLayer';

export interface Session {
  mode: 'local' | 'ai' | 'rogue';
  human: Color;
  difficulty: Difficulty;
}

/** 墨途（Roguelike）模式挂在对局控制器上的钩子。 */
export interface RogueHooks {
  difficulty(): Difficulty;
  enemyName(): string;
  stageLabel(): string;
  /** 每步棋动画结束后（对局未终）：结算墨锭、奖励、换幕、Boss 技能。 */
  onMove(o: MoveOutcome): Promise<void>;
  /** 对局终了的演出之后：进入下一盘或结束本次墨途。 */
  onGameEnd(): Promise<void>;
  /** 进入对局画面（新开或读档）时同步地形等场景物件。 */
  onEnter(): void;
  onExit(): void;
  /** 界面刷新（每次 updateHud 之后）。 */
  refresh(): void;
  update(dt: number): void;
  saveData(): unknown;
  restore(data: unknown): boolean;
}

interface SaveData {
  version: 1;
  game: SavedGame;
  session: Session;
  log: MoveEntry[];
  run?: unknown;
}

interface Picker {
  valid: Set<number>;
  resolve: (square: number | null) => void;
}

const SAVE_KEY = 'ink-xiangqi:save';
const BASE_LIFT = PIECE_HEIGHT / 2;
const TRAY_TOP = 0.012;
const INK = new THREE.Color(0x1c1915);
const CINNABAR = new THREE.Color(0xb02a1f);
const DIFFICULTY_NAME: Record<Difficulty, string> = { easy: '初学', normal: '棋手', expert: '宗师' };
const MIN_THINK: Record<Difficulty, number> = { easy: 700, normal: 950, expert: 600 };

const colorOf = (c: Color) => (c === 'red' ? CINNABAR : INK);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tween = (target: object, vars: gsap.TweenVars) => new Promise<void>((resolve) => gsap.to(target, { ...vars, onComplete: () => resolve() }));

interface ViewState {
  liftTarget: number;
  hop: { v: number };
  animating: number;
}

type Location = { kind: 'board'; square: number } | { kind: 'tray'; color: Color; index: number };

export class Controller {
  game: GameState = new GameState();
  session: Session = { mode: 'local', human: 'red', difficulty: 'normal' };
  log: MoveEntry[] = [];
  readonly views = new Map<number, PieceView>();
  private readonly states = new Map<number, ViewState>();
  private readonly piecesGroup = new THREE.Group();
  private readonly ai = new AIClient();
  private busy = 0;
  private selected: number | null = null;
  private legal: number[] = [];
  private hoverSquare: number | null = null;
  private aiToken = 0;
  private viewYaw = 0;
  private time = 0;
  private trailClock = 0;
  private readonly flying = new Set<PieceView>();
  private drag: { square: number; x: number; y: number; dragging: boolean } | null = null;
  private orbit: gsap.core.Tween | null = null;
  private picker: Picker | null = null;
  mode: 'menu' | 'game' = 'menu';
  onExitToMenu: () => void = () => {};
  rogue: RogueHooks | null = null;

  /** 对手是电脑（人机或墨途）。 */
  get vsAI(): boolean {
    return this.session.mode !== 'local';
  }

  /** 墨途模式进行中。 */
  private get roguing(): RogueHooks | null {
    return this.session.mode === 'rogue' ? this.rogue : null;
  }

  constructor(
    readonly stage: Stage,
    readonly board: BoardView,
    readonly effects: Effects,
    readonly landscape: Landscape,
    readonly hud: Hud,
    readonly ink: InkLayer,
  ) {
    stage.scene.add(this.piecesGroup);
    this.buildTrays();
    for (let id = 0; id < 32; id++) {
      const view = new PieceView(id);
      this.views.set(id, view);
      this.states.set(id, { liftTarget: 0, hop: { v: 0 }, animating: 0 });
      this.piecesGroup.add(view.root);
    }
    this.syncInstant();
    stage.onFrame((dt) => this.update(dt));
    const canvas = stage.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.picker) this.finishPick(null);
      this.deselect();
    });
  }

  // ======================================================================
  // 场景布置
  // ======================================================================

  private buildTrays(): void {
    const lacquer = new THREE.MeshStandardMaterial({ color: 0x221b16, roughness: 0.5, metalness: 0.05 });
    const felt = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.95 });
    for (const side of [-1, 1]) {
      const tray = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.36, 8.4), lacquer);
      base.position.y = -0.18;
      base.castShadow = base.receiveShadow = true;
      const inner = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.02, 8.1), felt);
      inner.position.y = 0.002;
      inner.receiveShadow = true;
      tray.add(base, inner);
      tray.position.set(side * 6.35, 0, side * -1.0);
      this.board.group.add(tray);
    }
  }

  private trayPosition(color: Color, index: number): THREE.Vector3 {
    const col = index % 2;
    const row = Math.floor(index / 2);
    // 红方阵亡子放在红方右手侧（+x），黑方阵亡子放在 -x
    if (color === 'red') return new THREE.Vector3(5.88 + col * 0.94, TRAY_TOP, 2.6 - row * 0.98);
    return new THREE.Vector3(-5.88 - col * 0.94, TRAY_TOP, -2.6 + row * 0.98);
  }

  private locate(id: number): Location | null {
    const square = this.game.board.findIndex((p) => p !== null && p.id === id);
    if (square >= 0) return { kind: 'board', square };
    for (const color of ['red', 'black'] as Color[]) {
      const index = this.game.captured[color].findIndex((p) => p.id === id);
      if (index >= 0) return { kind: 'tray', color, index };
    }
    return null;
  }

  private worldOf(location: Location): THREE.Vector3 {
    return location.kind === 'board' ? squareToWorld(location.square) : this.trayPosition(location.color, location.index);
  }

  private pieceById(id: number): Piece | null {
    return this.game.allPieces().find((p) => p.id === id) ?? null;
  }

  /** 无动画地把所有棋子摆到规则状态。 */
  syncInstant(): void {
    for (const [id, view] of this.views) {
      const piece = this.pieceById(id);
      const location = this.locate(id);
      view.root.visible = piece !== null && location !== null;
      if (!piece || !location) continue;
      view.root.position.copy(this.worldOf(location));
      view.root.rotation.y = this.viewYaw;
      view.lift.position.y = BASE_LIFT;
      view.tilt.rotation.set(0, 0, 0);
      view.tilt.scale.set(1, 1, 1);
      view.applyState(piece);
      view.setGlow(0);
      const state = this.states.get(id)!;
      state.liftTarget = 0;
      state.animating = 0;
    }
  }

  // ======================================================================
  // 每帧
  // ======================================================================

  private update(dt: number): void {
    this.time += dt;
    this.board.update(dt);
    this.effects.update(dt);
    this.landscape.update(dt, this.stage.camera);
    const k = 1 - Math.exp(-dt * 12);
    for (const [id, view] of this.views) {
      const state = this.states.get(id)!;
      if (state.animating > 0) continue;
      const selected = this.selected !== null && this.game.board[this.selected]?.id === id;
      const bob = selected ? Math.sin(this.time * 3.2) * 0.06 : 0;
      const target = BASE_LIFT + state.liftTarget + state.hop.v + bob;
      view.lift.position.y += (target - view.lift.position.y) * k;
      const wobbleTarget = selected ? Math.sin(this.time * 2.3) * 0.07 : 0;
      view.tilt.rotation.z += (wobbleTarget - view.tilt.rotation.z) * k;
      view.tilt.rotation.x += ((selected ? Math.cos(this.time * 1.9) * 0.05 : 0) - view.tilt.rotation.x) * k;
      if (selected) view.setGlow(0.45 + Math.sin(this.time * 4) * 0.25);
    }
    // 飞行中的棋子拖出墨痕
    this.trailClock += dt;
    if (this.trailClock > 0.028) {
      this.trailClock = 0;
      for (const view of this.flying) {
        const p = new THREE.Vector3();
        view.body.getWorldPosition(p);
        this.effects.trail(p, colorOf(view.controllerColor));
      }
    }
    if (this.mode === 'menu') this.stage.rig.yaw += dt * 0.045;
    else this.roguing?.update(dt);
  }

  // ======================================================================
  // 开局 / 读档
  // ======================================================================

  hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  save(): void {
    try {
      if (this.game.isFinished) {
        localStorage.removeItem(SAVE_KEY);
        return;
      }
      const data: SaveData = { version: 1, game: this.game.toJSON(), session: this.session, log: this.log, run: this.roguing?.saveData() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // 存档失败不影响对局
    }
  }

  private readSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      GameState.fromJSON(data.game);
      return data;
    } catch {
      return null;
    }
  }

  /** 卷首背景：一局新洗好的暗子棋盘，镜头缓缓环绕。 */
  showMenuScene(): void {
    this.mode = 'menu';
    this.cancelAI();
    this.effects.clearAll();
    this.orbit?.kill();
    this.finishPick(null);
    this.rogue?.onExit();
    if (!this.hasSave() || this.game.isFinished || this.session.mode === 'rogue') this.game = new GameState();
    this.syncInstant();
    this.board.finishPainting();
    this.stage.setSideInset(-Math.round(window.innerWidth * 0.36));
    gsap.to(this.stage.rig, { pitch: 0.3, distance: 24, targetY: 1.2, targetZ: 0, duration: 2.4, ease: 'power2.inOut' });
  }

  async startNew(session: Session, game = new GameState()): Promise<void> {
    this.session = session;
    this.cancelAI();
    this.game = game;
    this.log = [];
    this.save();
    await this.enterGame(true);
  }

  async continueSaved(): Promise<boolean> {
    const data = this.readSave();
    if (!data) return false;
    if (data.session.mode === 'rogue' && !this.rogue?.restore(data.run)) return false;
    this.session = data.session;
    this.game = GameState.fromJSON(data.game);
    this.log = data.log ?? [];
    await this.enterGame(false);
    return true;
  }

  private async enterGame(fresh: boolean): Promise<void> {
    this.mode = 'game';
    this.orbit?.kill();
    this.effects.clearAll();
    this.deselect();
    // 人机：站在玩家一侧；双人：站在当前行棋方一侧
    const facing = this.vsAI ? this.session.human : this.game.currentTurn;
    this.viewYaw = facing === 'black' ? Math.PI : 0;
    this.hud.show();
    this.roguing?.onEnter();
    this.stage.setSideInset(this.hud.panelWidth());
    this.updateHud(false);
    this.busy++;
    await this.intro(fresh);
    this.busy--;
    if (this.game.lastMove) this.effects.showLastMove(this.game.lastMove.from, this.game.lastMove.to);
    this.afterTurn(true);
  }

  /** 开场：笔墨写出棋盘，镜头穿云而下，棋子自天而降。 */
  private async intro(paintBoard: boolean): Promise<void> {
    const rig = this.stage.rig;
    gsap.killTweensOf(rig);
    // 镜头从当前角度连续地旋到己方视角（不绕远路）
    const twoPi = Math.PI * 2;
    const delta = ((((this.viewYaw - rig.yaw) % twoPi) + twoPi * 1.5) % twoPi) - Math.PI;
    rig.pitch = 1.32;
    rig.distance = 34;
    rig.yaw = this.viewYaw + delta - 0.9;
    gsap.to(rig, { yaw: this.viewYaw, pitch: 0.98, distance: 18, targetY: 0, targetZ: 0.4, duration: 3.4, ease: 'power3.inOut' });
    if (paintBoard) this.board.startPainting();
    else this.board.finishPainting();

    this.syncInstant();
    const order = [...this.views.values()].filter((v) => v.root.visible);
    order.forEach((v) => {
      v.root.visible = false;
      this.states.get(v.id)!.animating++;
    });
    const generals = order.filter((v) => this.pieceById(v.id)?.kind === 'general' && this.pieceById(v.id)?.revealed);
    const others = order.filter((v) => !generals.includes(v)).sort((a, b) => {
      const pa = a.root.position;
      const pb = b.root.position;
      return Math.abs(pb.z) + Math.abs(pb.x) * 0.3 - (Math.abs(pa.z) + Math.abs(pa.x) * 0.3) + (Math.random() - 0.5) * 2;
    });
    const start = paintBoard ? 1.5 : 0.5;
    const drops: Promise<void>[] = [];
    others.forEach((view, i) => drops.push(this.dropIn(view, start + i * 0.045, i % 3 === 0)));
    const generalStart = start + others.length * 0.045 + 0.35;
    generals.forEach((view, i) => drops.push(this.dropIn(view, generalStart + i * 0.4, true, true)));
    await Promise.all(drops);
    // 首次轮到的一方欢迎一跳
    this.wave(this.game.currentTurn);
  }

  private dropIn(view: PieceView, delay: number, loud: boolean, grand = false): Promise<void> {
    return new Promise((resolve) => {
      const height = grand ? 11 : 6 + Math.random() * 3;
      const spin = (Math.random() - 0.5) * Math.PI * 4;
      gsap.delayedCall(delay, () => {
        view.root.visible = true;
        view.lift.position.y = BASE_LIFT + height;
        view.tilt.rotation.y = spin;
        gsap.to(view.tilt.rotation, { y: 0, duration: grand ? 0.75 : 0.55, ease: 'power2.out' });
        gsap.to(view.lift.position, {
          y: BASE_LIFT,
          duration: grand ? 0.75 : 0.5,
          ease: grand ? 'expo.in' : 'power3.in',
          onComplete: () => {
            const p = view.root.position.clone();
            if (loud || grand) sound.clack(grand ? 1.4 : 0.6, 0.9 + Math.random() * 0.25);
            this.effects.ripple(p, { size: grand ? 4.5 : 1.6, opacity: grand ? 0.6 : 0.28, duration: grand ? 1.4 : 0.8 });
            gsap.fromTo(view.tilt.scale, { y: 0.6, x: 1.2, z: 1.2 }, { y: 1, x: 1, z: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.35)' });
            if (grand) {
              this.effects.inkBurst(p, { count: 40, color: colorOf(view.controllerColor), power: 1.3 });
              this.effects.splat(p, { size: 2.4, opacity: 0.55, color: colorOf(view.controllerColor), life: 3 });
              this.effects.smoke(p, INK, 8);
              this.stage.shake(0.3);
              sound.drum(0.9);
            }
            this.states.get(view.id)!.animating--;
            resolve();
          },
        });
      });
    });
  }

  /** 当前一方的棋子依次轻跳，像水波掠过。 */
  private wave(color: Color): void {
    const general = this.game.board.findIndex((p) => p?.kind === 'general' && p.revealed && p.color === color);
    const origin = general >= 0 ? squareToWorld(general) : new THREE.Vector3(0, 0, color === 'red' ? 4.5 : -4.5);
    this.game.board.forEach((piece, square) => {
      if (!piece || controller(piece) !== color) return;
      const state = this.states.get(piece.id)!;
      const distance = squareToWorld(square).distanceTo(origin);
      gsap.killTweensOf(state.hop);
      gsap.fromTo(state.hop, { v: 0 }, { v: 0.22, duration: 0.18, delay: distance * 0.045, ease: 'power2.out', yoyo: true, repeat: 1 });
    });
  }

  // ======================================================================
  // 输入
  // ======================================================================

  private humanCanMove(): boolean {
    if (this.mode !== 'game' || this.busy > 0 || this.game.isFinished || dialogOpen()) return false;
    return !this.vsAI || this.game.currentTurn === this.session.human;
  }

  /** 墨途符箓：让玩家在盘上点选一格。右键或 Esc 取消，返回 null。 */
  pickSquare(hint: string, valid: number[]): Promise<number | null> {
    this.finishPick(null);
    this.deselect();
    if (valid.length === 0) {
      this.hud.toast('无处可施');
      return Promise.resolve(null);
    }
    this.hud.toast(hint, 2.6);
    this.effects.showMoves(valid.map((square) => ({ square, capture: this.game.board[square] !== null })));
    return new Promise((resolve) => {
      this.picker = { valid: new Set(valid), resolve };
    });
  }

  private finishPick(square: number | null): void {
    const picker = this.picker;
    if (!picker) return;
    this.picker = null;
    this.effects.clearMoves();
    picker.resolve(square);
  }

  get picking(): boolean {
    return this.picker !== null;
  }

  private squareAt(e: PointerEvent): number | null {
    const point = this.stage.pick(e.clientX, e.clientY, PIECE_HEIGHT);
    return point ? worldToSquare(point) : null;
  }

  private onPointerDown(e: PointerEvent): void {
    sound.unlock();
    if (e.button !== 0) return;
    this.ink.splash(e.clientX, e.clientY, { radius: 18, life: 0.7 });
    if (this.picker) {
      const square = this.squareAt(e);
      if (square !== null && this.picker.valid.has(square)) {
        sound.select();
        this.finishPick(square);
      } else if (square !== null) {
        this.effects.ripple(squareToWorld(square), { size: 0.9, opacity: 0.25, duration: 0.5 });
      }
      return;
    }
    if (!this.humanCanMove()) return;
    const square = this.squareAt(e);
    if (square === null) {
      this.deselect();
      return;
    }
    const piece = this.game.board[square];
    if (this.selected !== null && this.legal.includes(square)) {
      void this.play(this.selected, square);
      return;
    }
    if (piece && controller(piece) === this.game.currentTurn) {
      if (this.selected !== square) this.select(square);
      this.drag = { square, x: e.clientX, y: e.clientY, dragging: false };
      return;
    }
    // 点击空处或不可走处：落一滴墨表示无效
    this.effects.ripple(squareToWorld(square), { size: 0.9, opacity: 0.25, duration: 0.5 });
    this.deselect();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.mode !== 'game') return;
    if (this.drag) {
      const view = this.viewAt(this.drag.square);
      if (!view) return;
      if (!this.drag.dragging && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) {
        this.drag.dragging = true;
        this.states.get(view.id)!.liftTarget = 0.75;
      }
      if (this.drag.dragging) {
        const point = this.stage.pick(e.clientX, e.clientY, PIECE_HEIGHT + 0.6);
        if (point) {
          gsap.to(view.root.position, { x: point.x, z: point.z, duration: 0.12, ease: 'power2.out', overwrite: true });
          this.effects.moveSelection(view.root.position);
          const target = worldToSquare(point);
          this.effects.setHover(target !== null && this.legal.includes(target) ? target : null, 'red');
        }
      }
      return;
    }
    if (!this.humanCanMove() || this.picker) {
      this.setHover(null);
      return;
    }
    this.setHover(this.squareAt(e));
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.dragging) return;
    const view = this.viewAt(drag.square);
    const point = this.stage.pick(e.clientX, e.clientY, PIECE_HEIGHT + 0.6);
    const target = point ? worldToSquare(point) : null;
    this.effects.setHover(null);
    if (target !== null && this.legal.includes(target) && this.humanCanMove()) {
      void this.play(drag.square, target);
      return;
    }
    // 放回原处
    if (view) {
      const home = squareToWorld(drag.square);
      gsap.to(view.root.position, { x: home.x, z: home.z, duration: 0.45, ease: 'back.out(1.6)', overwrite: true });
      this.effects.moveSelection(home);
      this.states.get(view.id)!.liftTarget = 0.55;
      sound.clack(0.25, 1.4);
    }
  }

  private viewAt(square: number): PieceView | null {
    const piece = this.game.board[square];
    return piece ? this.views.get(piece.id)! : null;
  }

  private setHover(square: number | null): void {
    if (square === this.hoverSquare) return;
    // 撤销之前悬停的抬起
    if (this.hoverSquare !== null && this.hoverSquare !== this.selected) {
      const v = this.viewAt(this.hoverSquare);
      if (v) this.states.get(v.id)!.liftTarget = 0;
    }
    this.hoverSquare = square;
    if (square === null) {
      this.effects.setHover(null);
      return;
    }
    const piece = this.game.board[square];
    const ownPiece = piece && controller(piece) === this.game.currentTurn;
    const legalTarget = this.selected !== null && this.legal.includes(square);
    if (ownPiece && square !== this.selected) {
      this.states.get(piece.id)!.liftTarget = 0.14;
      sound.tick(true);
    }
    this.effects.setHover(ownPiece || legalTarget ? square : null, legalTarget && piece ? 'red' : 'ink');
  }

  private select(square: number): void {
    this.deselect(false);
    const piece = this.game.board[square]!;
    this.selected = square;
    this.legal = this.game.legalMovesFrom(square);
    this.states.get(piece.id)!.liftTarget = 0.55;
    this.effects.showSelection(square, controller(piece));
    this.effects.showMoves(this.legal.map((s) => ({ square: s, capture: this.game.board[s] !== null })));
    sound.select();
    if (this.legal.length === 0) this.hud.toast(piece.frozen ? '此子被定住，本回合不能走' : '此子无路可走');
  }

  deselect(resetLift = true): void {
    if (this.selected !== null) {
      const view = this.viewAt(this.selected);
      if (view) {
        if (resetLift) this.states.get(view.id)!.liftTarget = 0;
        view.setGlow(0);
        const home = squareToWorld(this.selected);
        if (view.root.position.distanceTo(home) > 0.01) gsap.to(view.root.position, { x: home.x, z: home.z, duration: 0.3, overwrite: true });
      }
    }
    this.selected = null;
    this.legal = [];
    this.effects.clearMoves();
    this.effects.showSelection(null);
  }

  // ======================================================================
  // 走子
  // ======================================================================

  async play(from: number, to: number): Promise<void> {
    if (this.busy > 0) return;
    this.busy++;
    const moverView = this.viewAt(from)!;
    moverView.setGlow(0);
    this.selected = null;
    this.legal = [];
    this.effects.clearMoves();
    this.effects.showSelection(null);
    this.effects.clearArrows();
    this.effects.showCheck(null);
    this.setHover(null);
    const outcome = this.game.move(from, to);
    this.log.push({ color: outcome.actor, text: formatMove(outcome), note: describeOutcome(outcome) });
    this.save();
    await this.animateMove(outcome);
    this.effects.showLastMove(from, to);
    this.updateHud(true);
    this.busy--;
    await this.afterMove(outcome);
  }

  private async animateMove(o: MoveOutcome): Promise<void> {
    const mover = this.views.get(o.piece.id)!;
    const moverState = this.states.get(mover.id)!;
    const victim = o.captured ? this.views.get(o.captured.id)! : null;
    if (o.bounced) {
      await this.animateBounce(mover, o);
      return;
    }
    moverState.animating++;
    const from = mover.root.position.clone();
    const to = squareToWorld(o.to);
    const startLift = mover.lift.position.y;
    const distance = from.distanceTo(to);
    const duration = 0.42 + Math.min(distance, 9) * 0.045;
    const peak = 0.75 + Math.min(distance, 9) * 0.13 + (victim ? 0.6 : 0);
    const dir = to.clone().sub(from).setY(0).normalize();
    sound.whoosh(duration + 0.1);
    this.flying.add(mover);
    let knocked = false;
    const proxy = { t: 0 };
    gsap.killTweensOf(mover.root.position);
    await tween(proxy, {
      t: 1,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = proxy.t;
        mover.root.position.lerpVectors(from, to, t);
        mover.lift.position.y = BASE_LIFT + (startLift - BASE_LIFT) * (1 - t) + Math.sin(Math.PI * t) * peak;
        const lean = Math.sin(Math.PI * t) * 0.45;
        // 前倾：绕与运动方向垂直的水平轴
        mover.tilt.rotation.x = dir.z * lean * (Math.cos(this.viewYaw) || 1);
        mover.tilt.rotation.z = -dir.x * lean * (Math.cos(this.viewYaw) || 1);
        if (victim && !knocked && t > 0.8) {
          knocked = true;
          void this.knockAway(victim, o.captured!, o.capturedWasHidden);
        }
      },
    });
    this.flying.delete(mover);
    mover.tilt.rotation.x = 0;
    mover.tilt.rotation.z = 0;
    mover.lift.position.y = BASE_LIFT;
    moverState.liftTarget = 0;

    // 落定
    sound.clack(victim ? 1.3 : 0.95, 1);
    this.effects.ripple(to, { size: victim ? 3.2 : 1.9, opacity: 0.45 });
    this.effects.splat(to, { size: victim ? 2.2 : 1.0, opacity: victim ? 0.6 : 0.28, life: victim ? 6 : 2.5, color: victim ? colorOf(o.actor) : INK });
    gsap.fromTo(mover.tilt.scale, { y: 0.62, x: 1.18, z: 1.18 }, { y: 1, x: 1, z: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.35)' });
    if (victim) {
      this.effects.inkBurst(to, { count: 34, color: colorOf(o.actor), power: 1.2 });
      this.effects.smoke(to, INK, 6);
      this.stage.shake(0.26);
      sound.drum(0.8);
    }
    if (o.wasHidden) await this.revealFlip(mover, o);
    moverState.animating--;
  }

  /** 吃将被护体挡下：来犯之子撞上金光，被震碎弹入阵亡托盘。 */
  private async animateBounce(mover: PieceView, o: MoveOutcome): Promise<void> {
    const state = this.states.get(mover.id)!;
    state.animating++;
    const from = mover.root.position.clone();
    const target = squareToWorld(o.to);
    // 停在将帅跟前
    const stop = from.clone().lerp(target, Math.max(0, 1 - 0.75 / Math.max(from.distanceTo(target), 0.01)));
    sound.whoosh(0.5);
    this.flying.add(mover);
    const proxy = { t: 0 };
    await tween(proxy, {
      t: 1,
      duration: 0.45,
      ease: 'power2.in',
      onUpdate: () => {
        mover.root.position.lerpVectors(from, stop, proxy.t);
        mover.lift.position.y = BASE_LIFT + Math.sin(Math.PI * proxy.t * 0.5) * 0.9;
      },
    });
    this.flying.delete(mover);
    const gold = new THREE.Color(0xd9a441);
    this.effects.ripple(target, { color: gold, size: 3.6, duration: 1.2, opacity: 0.8 });
    this.effects.revealBurst(target, gold);
    this.stage.flash(0.35, 0.5);
    this.stage.shake(0.32);
    sound.gong(0.6);
    const general = this.viewAt(o.to);
    if (general) gsap.fromTo(general.tilt.scale, { x: 1.25, y: 1.25, z: 1.25 }, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'elastic.out(1.4, 0.3)' });
    void this.hud.bigText('护体', { red: o.actor !== 'red', caption: `${COLOR_NAME[otherColor(o.actor)]}方将帅护体抵消一击`, hold: 0.3 });
    state.animating--;
    await this.knockAway(mover, o.piece, o.wasHidden);
  }

  /** 被吃的棋子被撞飞，翻转着落入阵亡托盘。 */
  private async knockAway(victim: PieceView, captured: Piece, wasHidden: boolean): Promise<void> {
    const state = this.states.get(victim.id)!;
    state.animating++;
    const index = this.game.captured[captured.color].findIndex((p) => p.id === captured.id);
    const from = victim.root.position.clone();
    const to = this.trayPosition(captured.color, Math.max(0, index));
    if (wasHidden) {
      victim.showFace(captured);
      victim.revealed = true;
      gsap.fromTo(victim.body.rotation, { x: Math.PI }, { x: -Math.PI * 2, duration: 0.95, ease: 'power2.out', onComplete: () => void victim.body.rotation.set(0, 0, 0) });
      gsap.delayedCall(0.35, () => {
        const p = new THREE.Vector3();
        victim.body.getWorldPosition(p);
        this.effects.revealBurst(p.setY(0), colorOf(captured.color));
        sound.reveal(false);
      });
    }
    victim.setController(captured.color);
    this.flying.add(victim);
    const spinZ = (Math.random() < 0.5 ? -1 : 1) * Math.PI * 2;
    const proxy = { t: 0 };
    await tween(proxy, {
      t: 1,
      duration: 1.0,
      ease: 'power1.inOut',
      onUpdate: () => {
        const t = proxy.t;
        victim.root.position.lerpVectors(from, to, t);
        victim.lift.position.y = BASE_LIFT + Math.sin(Math.PI * t) * 2.6 + (to.y - from.y) * t;
        victim.tilt.rotation.z = spinZ * t;
      },
    });
    this.flying.delete(victim);
    victim.tilt.rotation.z = 0;
    victim.lift.position.y = BASE_LIFT;
    victim.root.position.copy(to);
    victim.applyState({ ...captured, revealed: true });
    sound.clack(0.45, 1.35);
    this.effects.ripple(new THREE.Vector3(to.x, 0, to.z), { size: 1.2, opacity: 0.3, y: TRAY_TOP + 0.01 });
    gsap.fromTo(victim.tilt.scale, { y: 0.7 }, { y: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    state.animating--;
  }

  /** 暗子翻面：腾空翻转一周半，见真身。 */
  private async revealFlip(view: PieceView, o: MoveOutcome): Promise<void> {
    const identity = o.piece;
    view.showFace(identity);
    const position = squareToWorld(o.to);
    const tl = gsap.timeline();
    tl.to(view.lift.position, { y: BASE_LIFT + 1.25, duration: 0.3, ease: 'power2.out' }, 0);
    tl.fromTo(view.body.rotation, { x: Math.PI }, { x: -Math.PI * 2, duration: 0.62, ease: 'power2.inOut' }, 0.02);
    tl.call(() => {
      view.revealed = true;
      view.setController(identity.color);
      this.effects.revealBurst(position, colorOf(identity.color));
      this.stage.flash(o.switchedOwner ? 0.45 : 0.25, 0.6);
      sound.reveal(o.switchedOwner);
      if (o.switchedOwner) {
        this.effects.inkBurst(position, { count: 40, color: colorOf(identity.color), power: 1.4 });
        this.effects.ripple(position, { color: colorOf(identity.color), size: 5, duration: 1.6, opacity: 0.6 });
        this.stage.shake(0.3);
        void this.hud.bigText('倒戈', { red: identity.color === 'red', caption: `暗子翻出${COLOR_NAME[identity.color]}方`, hold: 0.35 });
      }
    }, [], 0.32);
    tl.to(view.lift.position, { y: BASE_LIFT, duration: 0.3, ease: 'power2.in' }, 0.34);
    await tl.then();
    view.body.rotation.set(0, 0, 0);
    sound.clack(0.8, 1.1);
    this.effects.ripple(position, { size: 1.6, opacity: 0.35 });
    gsap.fromTo(view.tilt.scale, { y: 0.7, x: 1.12, z: 1.12 }, { y: 1, x: 1, z: 1, duration: 0.5, ease: 'elastic.out(1.2, 0.4)' });
  }

  private async afterMove(o: MoveOutcome): Promise<void> {
    if (this.game.isFinished) {
      await this.endSequence();
      return;
    }
    if (o.nextPlayerInCheck) await this.checkSequence(o.actor);
    const rogue = this.roguing;
    if (rogue) {
      this.busy++;
      await rogue.onMove(o);
      this.busy--;
      this.save();
      if (this.mode !== 'game') return;
    }
    this.afterTurn(false);
  }

  private async checkSequence(attacker: Color): Promise<void> {
    const defender = otherColor(attacker);
    const square = this.game.board.findIndex((p) => p?.kind === 'general' && p.revealed && p.color === defender);
    if (square < 0) return;
    this.effects.showCheck(square);
    this.stage.pulseRed();
    this.stage.shake(0.18);
    sound.gong(0.55);
    sound.drum(0.7);
    const view = this.viewAt(square);
    if (view) gsap.fromTo(view.tilt.rotation, { z: 0.25 }, { z: 0, duration: 0.9, ease: 'elastic.out(1.5, 0.2)' });
    void this.hud.bigText('将', { red: attacker === 'red', caption: `${COLOR_NAME[attacker]}方将军`, hold: 0.25 });
    await wait(650);
  }

  private afterTurn(silent: boolean): void {
    this.updateHud(false);
    if (this.game.isFinished) return;
    // 双人对弈：镜头自动转到行棋方（翻转自带棋子轻跳，代替回合波浪）
    const turned = this.session.mode === 'local' && this.faceSide(this.game.currentTurn);
    if (!silent && !turned) this.wave(this.game.currentTurn);
    if (this.game.isInCheck(this.game.currentTurn)) {
      const square = this.game.board.findIndex((p) => p?.kind === 'general' && p.revealed && p.color === this.game.currentTurn);
      if (square >= 0) this.effects.showCheck(square);
    }
    if (this.vsAI && this.game.currentTurn !== this.session.human) void this.aiMove();
  }

  // ======================================================================
  // AI
  // ======================================================================

  private cancelAI(): void {
    this.aiToken++;
    this.ai.cancel();
    this.hud.setThinking(null);
    this.effects.clearArrows();
    for (const state of this.states.values()) if (state.liftTarget > 0 && state.liftTarget < 0.3) state.liftTarget = 0;
  }

  private async aiMove(): Promise<void> {
    const token = ++this.aiToken;
    const color = this.game.currentTurn;
    this.hud.setThinking(color);
    this.busy++;
    const lifted = new Set<number>();
    const started = performance.now();
    const difficulty = this.roguing?.difficulty() ?? this.session.difficulty;
    const move = await this.ai.choose(this.game, difficulty, (candidates) => {
      if (token !== this.aiToken) return;
      // “犹豫”：候选棋子微微浮起，淡墨箭头一闪而过
      this.effects.clearArrows();
      for (const id of lifted) this.states.get(id)!.liftTarget = 0;
      lifted.clear();
      candidates.forEach(([f, t], i) => {
        const view = this.viewAt(f);
        if (view) {
          this.states.get(view.id)!.liftTarget = 0.2 - i * 0.05;
          lifted.add(view.id);
        }
        this.effects.showArrow(f, t, { color: INK, opacity: 0.32 - i * 0.08 });
      });
    });
    const elapsed = performance.now() - started;
    const minimum = MIN_THINK[difficulty];
    if (elapsed < minimum) await wait(minimum - elapsed);
    this.busy--;
    if (token !== this.aiToken || this.mode !== 'game') return;
    this.hud.setThinking(null);
    this.effects.clearArrows();
    for (const id of lifted) this.states.get(id)!.liftTarget = 0;
    if (!move) return;
    // 先拈起，再落子
    const view = this.viewAt(move[0]);
    if (view) {
      this.states.get(view.id)!.liftTarget = 0.55;
      this.effects.showSelection(move[0], this.game.currentTurn);
      sound.select();
      await wait(380);
    }
    if (token !== this.aiToken) return;
    await this.play(move[0], move[1]);
  }

  // ======================================================================
  // 操作按钮
  // ======================================================================

  /** 悔棋。墨途模式下只能借“回首符”（force）。 */
  async undo(force = false): Promise<boolean> {
    if (this.mode !== 'game' || this.busy > 0 || this.game.history.length === 0) return false;
    if (this.roguing && !force) return false;
    this.cancelAI();
    this.deselect();
    const wasEnded = this.game.endReason === 'resignation' || this.game.endReason === 'agreement';
    this.game.undo();
    if (!wasEnded) this.log.pop();
    if (this.vsAI) {
      // 撤回到玩家行棋
      while (this.game.currentTurn !== this.session.human && this.game.history.length > 0) {
        this.game.undo();
        this.log.pop();
      }
    }
    this.desaturate(false);
    this.save();
    sound.whoosh(0.6);
    this.busy++;
    await this.syncAnimated();
    this.busy--;
    this.effects.showCheck(null);
    this.effects.showLastMove(this.game.lastMove?.from ?? null, this.game.lastMove?.to ?? null);
    this.hud.toast('悔棋 · 时光倒流');
    this.afterTurn(true);
    return true;
  }

  /** 把所有棋子以动画方式归位（悔棋、符箓换位、Boss 召魂）。 */
  async syncAnimated(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [id, view] of this.views) {
      const piece = this.pieceById(id);
      const location = this.locate(id);
      if (!piece || !location) continue;
      const target = this.worldOf(location);
      const moved = view.root.position.distanceTo(target) > 0.01;
      const unflip = view.revealed && !piece.revealed;
      if (!moved && !unflip) {
        view.applyState(piece);
        continue;
      }
      const state = this.states.get(id)!;
      state.animating++;
      const from = view.root.position.clone();
      const proxy = { t: 0 };
      this.flying.add(view);
      if (unflip) gsap.to(view.body.rotation, { x: -Math.PI, duration: 0.6, ease: 'power2.inOut' });
      jobs.push(
        tween(proxy, {
          t: 1,
          duration: 0.75,
          ease: 'power2.inOut',
          onUpdate: () => {
            view.root.position.lerpVectors(from, target, proxy.t);
            view.lift.position.y = BASE_LIFT + Math.sin(Math.PI * proxy.t) * (moved ? 1.4 : 0.9);
          },
        }).then(() => {
          this.flying.delete(view);
          view.root.position.copy(target);
          view.lift.position.y = BASE_LIFT;
          view.applyState(piece);
          view.root.rotation.y = this.viewYaw;
          state.animating--;
          this.effects.ripple(target, { size: 1.2, opacity: 0.25 });
        }),
      );
    }
    await Promise.all(jobs);
    sound.clack(0.6);
  }

  async hint(): Promise<void> {
    if (this.roguing) return;
    await this.showHint('normal');
  }

  /** 推演一步好棋并以朱砂箭头标出（提示、墨途“推演符”）。 */
  async showHint(difficulty: Difficulty): Promise<boolean> {
    if (!this.humanCanMove()) return false;
    this.busy++;
    this.hud.toast('凝神推演……', 1.2);
    const move = await this.ai.choose(this.game, difficulty);
    this.busy--;
    if (!move || this.mode !== 'game') return false;
    this.effects.clearArrows();
    this.effects.showArrow(move[0], move[1], { color: CINNABAR, opacity: 0.85 });
    const probe = GameState.fromJSON(this.game.toJSON());
    this.hud.toast(`可走 ${formatMove(probe.move(move[0], move[1]))}`, 2.6);
    sound.pluck(7, { gain: 0.25 });
    gsap.delayedCall(3.2, () => this.effects.clearArrows());
    return true;
  }

  async offerDraw(): Promise<void> {
    if (!this.humanCanMove() || this.roguing) return;
    const proposer = this.game.currentTurn;
    let accepted: boolean;
    if (this.session.mode === 'local') {
      const answer = await ask('议 和', `${COLOR_NAME[proposer]}方提议和棋。\n${COLOR_NAME[otherColor(proposer)]}方是否同意？`, [
        { label: '婉拒', value: 'no' },
        { label: '同意', value: 'yes', primary: true },
      ]);
      accepted = answer === 'yes';
    } else {
      this.busy++;
      this.hud.setThinking(otherColor(proposer));
      const [score] = await Promise.all([this.ai.assess(this.game, otherColor(proposer)), wait(900)]);
      this.hud.setThinking(null);
      this.busy--;
      accepted = score < 150;
    }
    if (!accepted) {
      this.hud.toast('对方婉拒议和');
      return;
    }
    this.game.agreeDraw();
    this.save();
    await this.endSequence();
  }

  async resign(): Promise<void> {
    if (this.mode !== 'game' || this.busy > 0 || this.game.isFinished) return;
    const color = this.vsAI ? this.session.human : this.game.currentTurn;
    const question = this.roguing ? '认输即结束本次墨途，确定吗？' : `${COLOR_NAME[color]}方确定认输吗？`;
    const answer = await ask('认 输', question, [
      { label: '再想想', value: 'no' },
      { label: '认输', value: 'yes', primary: true },
    ]);
    if (answer !== 'yes') return;
    this.cancelAI();
    this.deselect();
    this.game.resign(color);
    this.save();
    // 认输方的将帅倒下
    const square = this.game.board.findIndex((p) => p?.kind === 'general' && p.color === color);
    const view = square >= 0 ? this.viewAt(square) : null;
    if (view) gsap.to(view.tilt.rotation, { x: 1.2, duration: 0.8, ease: 'bounce.out' });
    await this.endSequence();
  }

  flipView(): void {
    if (this.mode !== 'game') return;
    this.turnView(this.viewYaw === 0 ? Math.PI : 0);
  }

  /** 转到指定一方的视角；已经朝向该方时返回 false。 */
  private faceSide(color: Color): boolean {
    const yaw = color === 'black' ? Math.PI : 0;
    if (this.viewYaw === yaw) return false;
    this.turnView(yaw);
    return true;
  }

  private turnView(yaw: number): void {
    this.viewYaw = yaw;
    const rig = this.stage.rig;
    gsap.killTweensOf(rig, 'yaw');
    // 沿最短方向转到目标角度，转动途中再次翻转也不会绕远路
    const twoPi = Math.PI * 2;
    const delta = ((((yaw - rig.yaw) % twoPi) + twoPi * 1.5) % twoPi) - Math.PI;
    gsap.to(rig, { yaw: rig.yaw + delta, duration: 1.6, ease: 'power3.inOut', onComplete: () => void (rig.yaw = this.viewYaw) });
    sound.whoosh(1.2);
    let i = 0;
    for (const view of this.views.values()) {
      if (!view.root.visible) continue;
      const state = this.states.get(view.id)!;
      const delay = 0.3 + (i++ % 16) * 0.03;
      gsap.to(view.root.rotation, { y: this.viewYaw, duration: 0.7, delay, ease: 'back.inOut(1.6)' });
      gsap.fromTo(state.hop, { v: 0 }, { v: 0.35, duration: 0.25, delay, yoyo: true, repeat: 1, ease: 'power2.out' });
    }
  }

  private desaturate(on: boolean): void {
    gsap.to(this.stage.postUniforms.desaturate, { value: on ? 0.55 : 0, duration: 1.5 });
  }

  // ======================================================================
  // 终局
  // ======================================================================

  private async endSequence(): Promise<void> {
    this.hud.setThinking(null);
    this.updateHud(false);
    this.effects.showCheck(null);
    const { winner, endReason } = this.game;
    const reason = endReason ? END_REASON_TEXT[endReason] : '';
    let text: string;
    let red = false;
    let humanLost = false;
    if (winner === null) {
      text = '和';
    } else if (this.vsAI) {
      humanLost = winner !== this.session.human;
      text = humanLost ? '负' : '胜';
      red = !humanLost;
    } else {
      text = `${COLOR_NAME[winner]}胜`;
      red = winner === 'red';
    }

    // 胜方将帅迸发墨花，落梅骤起，镜头缓慢环绕
    if (winner) {
      const square = this.game.board.findIndex((p) => p?.kind === 'general' && p.color === winner);
      if (square >= 0) {
        const p = squareToWorld(square);
        this.effects.inkBurst(p, { count: 60, color: colorOf(winner), power: 1.6 });
        this.effects.revealBurst(p, colorOf(winner));
        this.effects.ripple(p, { size: 8, duration: 2.2, color: colorOf(winner), opacity: 0.6 });
      }
      this.wave(winner);
      gsap.delayedCall(0.8, () => this.wave(winner));
    }
    this.landscape.gust(1.4);
    this.stage.flash(0.3, 1.2);
    if (humanLost) {
      sound.defeat();
      this.desaturate(true);
    } else sound.victory();
    const rig = this.stage.rig;
    this.orbit = gsap.to(rig, { yaw: rig.yaw + 0.55, pitch: 0.82, distance: 17.5, duration: 4, ease: 'sine.inOut', yoyo: true, repeat: 1 });
    await this.hud.bigText(text, { red, caption: reason, hold: 1.4 });

    const rogue = this.roguing;
    if (rogue) {
      await rogue.onGameEnd();
      this.orbit?.kill();
      this.desaturate(false);
      return;
    }

    const answer = await ask(
      '终 局',
      `${reason}${winner ? ` · ${COLOR_NAME[winner]}方胜` : ''}\n共 ${this.game.moveCount} 手`,
      [
        { label: '回卷首', value: 'menu' },
        { label: '观棋', value: 'stay' },
        { label: '再来一局', value: 'again', primary: true },
      ],
      resultBlock(text, red),
    );
    this.orbit?.kill();
    this.desaturate(false);
    if (answer === 'again') {
      await this.ink.ink(true, 0.7);
      const session = { ...this.session };
      if (session.mode === 'ai') session.human = this.session.human;
      void this.ink.ink(false, 1.0);
      await this.startNew(session);
    } else if (answer === 'menu') {
      this.onExitToMenu();
    } else {
      gsap.to(rig, { yaw: this.viewYaw, pitch: 0.98, distance: 19, duration: 1.4, ease: 'power2.inOut' });
    }
  }

  // ======================================================================
  // 界面
  // ======================================================================

  updateHud(animateLog: boolean): void {
    const g = this.game;
    const s = this.session;
    const ai = this.vsAI;
    const rogue = this.roguing;
    const enemyName = rogue ? rogue.enemyName() : DIFFICULTY_NAME[s.difficulty];
    const nameOf = (c: Color) => (ai ? (c === s.human ? `${COLOR_NAME[c]}方 · 你` : `${COLOR_NAME[c]}方 · ${enemyName}`) : `${COLOR_NAME[c]}方`);
    this.hud.setPlayers(nameOf('red'), nameOf('black'));
    let label: string;
    if (g.isFinished) label = g.winner ? `${COLOR_NAME[g.winner]}方胜` : '和局';
    else if (ai) label = g.currentTurn === s.human ? '请君落子' : '对手思量';
    else label = `${COLOR_NAME[g.currentTurn]}方行棋`;
    const check = !g.isFinished && g.isInCheck(g.currentTurn);
    this.hud.setTurn(g.winner ?? g.currentTurn, check ? `${label} · 被将` : label, check);
    this.hud.setSub(
      rogue
        ? `${rogue.stageLabel()} · 第 ${g.moveCount + 1} 手`
        : ai
          ? `人机 · ${DIFFICULTY_NAME[s.difficulty]} · 第 ${g.moveCount + 1} 手`
          : `双人对弈 · 第 ${g.moveCount + 1} 手`,
    );
    this.hud.setLost(g.captured.red.length, g.captured.black.length);
    this.hud.setMoves(this.log, animateLog);
    this.hud.setStats(`未揭 ${g.hiddenCount()} · 闲着 ${Math.floor(g.noProgressPlies / 2)}/60 回合`);
    const humanTurn = !g.isFinished && (!ai || g.currentTurn === s.human);
    this.hud.setEnabled('undo', !rogue && g.history.length > 0);
    this.hud.setEnabled('hint', !rogue && humanTurn);
    this.hud.setEnabled('draw', !rogue && humanTurn);
    this.hud.setEnabled('resign', !g.isFinished);
    rogue?.refresh();
  }

  /** 玩家此刻能否操作（走子或施符）。 */
  canAct(): boolean {
    return this.humanCanMove() && !this.picker;
  }

  async exitToMenu(): Promise<void> {
    this.finishPick(null);
    this.cancelAI();
    this.deselect();
    this.orbit?.kill();
    this.desaturate(false);
    this.save();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (this.mode !== 'game' || dialogOpen()) return false;
    const key = e.key.toLowerCase();
    if (key === 'escape' && this.picker) {
      this.finishPick(null);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      void this.undo();
      return true;
    }
    if (key === 'h') {
      void this.hint();
      return true;
    }
    if (key === 'f' && !e.ctrlKey) {
      this.flipView();
      return true;
    }
    if (key === 'escape' && this.selected !== null) {
      this.deselect();
      return true;
    }
    return false;
  }

  /** 调试/截图辅助。 */
  debugState(): { turn: Color; moves: number; row: (s: number) => number; col: (s: number) => number } {
    return { turn: this.game.currentTurn, moves: this.game.moveCount, row: rowOf, col: colOf };
  }
}
