import '@fontsource/ma-shan-zheng';
import '@fontsource/liu-jian-mao-cao';
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/700.css';
import './styles.css';

import gsap from 'gsap';
import { sound } from './audio/sound';
import { Controller, type Session } from './game/controller';
import { RogueDirector } from './rogue/director';
import { GameState, idx } from './core/rules';
import { BoardView, squareToWorld } from './scene/board';
import { Effects } from './scene/effects';
import { Landscape } from './scene/landscape';
import { Stage } from './scene/stage';
import { installBrushAssets } from './ui/brushAssets';
import { dialogOpen, showRules, showSettings, type Settings } from './ui/dialogs';
import { Hud } from './ui/hud';
import { InkLayer } from './ui/inkLayer';
import { Menu } from './ui/menu';

const SETTINGS_KEY = 'ink-xiangqi:settings';

function loadSettings(): Settings {
  const defaults: Settings = { sfx: true, music: true, quality: true, cursor: true, sway: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

async function loadFonts(): Promise<void> {
  // 画布纹理需要的字形必须先加载完成
  const glyphs = '帅仕相马车炮兵将士象砲卒楚河漢界墨弈全混揭棋';
  const load = Promise.all([
    document.fonts.load('64px "Ma Shan Zheng"', glyphs),
    document.fonts.load('64px "Liu Jian Mao Cao"', '将倒戈胜负和红黑'),
    document.fonts.load('16px "Noto Serif SC"', '棋谱'),
  ]);
  await Promise.race([load, new Promise((r) => setTimeout(r, 5000))]);
}

async function boot(): Promise<void> {
  await loadFonts();
  installBrushAssets();
  const settings = loadSettings();
  sound.sfxOn = settings.sfx;
  sound.musicOn = settings.music;

  const stage = new Stage(document.getElementById('stage')!);
  stage.setQuality(settings.quality ? 1 : 0);
  stage.sway = settings.sway ? 1 : 0;
  const landscape = new Landscape(settings.quality ? 1 : 0);
  const board = new BoardView();
  const effects = new Effects();
  effects.quality = settings.quality ? 1 : 0;
  stage.scene.add(landscape.group, board.group, effects.group);

  const ink = new InkLayer(document.getElementById('ink-overlay') as HTMLCanvasElement);
  ink.cursorTrail = settings.cursor;
  const hud = new Hud(ink);
  const menu = new Menu(ink);
  const controller = new Controller(stage, board, effects, landscape, hud, ink);
  const rogue = new RogueDirector(controller);
  controller.rogue = rogue;

  const applySettings = (s: Settings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    sound.setSfx(s.sfx);
    sound.setMusic(s.music);
    ink.cursorTrail = s.cursor;
    stage.sway = s.sway ? 1 : 0;
    effects.quality = s.quality ? 1 : 0;
    stage.setQuality(s.quality ? 1 : 0);
    if (controller.mode === 'game') stage.setSideInset(hud.panelWidth());
    else stage.setSideInset(-Math.round(window.innerWidth * 0.36));
  };

  const toMenu = async () => {
    await controller.exitToMenu();
    await ink.ink(true, 0.7);
    hud.hide();
    controller.showMenuScene();
    menu.show(controller.hasSave());
    await ink.ink(false, 1.0);
  };
  controller.onExitToMenu = () => void toMenu();

  const startGame = async (run: () => Promise<unknown>) => {
    sound.unlock();
    await ink.ink(true, 0.75);
    menu.hide();
    void ink.ink(false, 1.1);
    await run();
  };

  menu.onAction(async (action) => {
    switch (action.type) {
      case 'local':
        await startGame(() => controller.startNew({ mode: 'local', human: 'red', difficulty: 'normal' }));
        break;
      case 'rogue':
        await startGame(() => rogue.startRun());
        break;
      case 'ai': {
        const human = action.side === 'random' ? (Math.random() < 0.5 ? 'red' : 'black') : action.side;
        const session: Session = { mode: 'ai', human, difficulty: action.difficulty };
        await startGame(() => controller.startNew(session));
        break;
      }
      case 'continue':
        await startGame(() => controller.continueSaved());
        break;
      case 'rules':
        await showRules();
        break;
      case 'settings':
        await showSettings(settings, applySettings);
        break;
      case 'quit':
        await ink.ink(true, 0.6);
        window.close();
        break;
    }
  });

  hud.onAction(async (action, event) => {
    sound.unlock();
    ink.splash(event.clientX, event.clientY, { radius: 24 });
    sound.tick();
    switch (action) {
      case 'undo':
        await controller.undo();
        break;
      case 'hint':
        await controller.hint();
        break;
      case 'draw':
        await controller.offerDraw();
        break;
      case 'resign':
        await controller.resign();
        break;
      case 'flip':
        controller.flipView();
        break;
      case 'rules':
        await showRules();
        break;
      case 'settings':
        await showSettings(settings, applySettings);
        break;
      case 'menu':
        await toMenu();
        break;
    }
  });
  document.querySelectorAll<HTMLButtonElement>('#hud button').forEach((b) => b.addEventListener('pointerenter', () => !b.disabled && sound.tick(true)));

  window.addEventListener('keydown', async (e) => {
    sound.unlock();
    if (e.key === 'F11') {
      e.preventDefault();
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      return;
    }
    if (dialogOpen()) return;
    if (e.key === 'F1') {
      e.preventDefault();
      await showRules();
      return;
    }
    if (controller.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && controller.mode === 'game') await toMenu();
  });
  window.addEventListener('resize', () => {
    stage.setSideInset(controller.mode === 'game' ? hud.panelWidth() : -Math.round(window.innerWidth * 0.36));
  });

  // 首次进入：卷首，棋盘一笔一笔写出
  controller.showMenuScene();
  board.startPainting();
  const loading = document.getElementById('loading')!;
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
  menu.show(controller.hasSave());
  gsap.fromTo(stage.rig, { distance: 40, pitch: 0.9 }, { distance: 24, pitch: 0.3, duration: 3.6, ease: 'power3.out' });

  // 调试与自动截图钩子
  (window as unknown as Record<string, unknown>).__ink = { controller, rogue, stage, hud, menu, ink, startGame, toMenu, GameState, idx, screenOf: (square: number) => stage.project(squareToWorld(square).setY(0.24)) };
}

void boot();
