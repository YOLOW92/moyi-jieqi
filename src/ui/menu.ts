import gsap from 'gsap';
import { sound } from '../audio/sound';
import type { Difficulty } from '../ai/engine';
import type { InkLayer } from './inkLayer';

export type MenuAction =
  | { type: 'continue' }
  | { type: 'local' }
  | { type: 'rogue' }
  | { type: 'ai';difficulty: Difficulty; side: 'red' | 'black' | 'random' }
  | { type: 'rules' }
  | { type: 'settings' }
  | { type: 'quit' };

const VERSES = ['落子无悔 · 翻面见真', '一子翻覆 · 满盘风云', '墨分五色 · 棋藏万象', '闲敲棋子 · 落尽灯花'];

export class Menu {
  readonly root = document.getElementById('menu') as HTMLDivElement;
  private readonly main = document.getElementById('menu-main') as HTMLElement;
  private readonly aiPanel = document.getElementById('menu-ai') as HTMLElement;
  private difficulty: Difficulty = 'normal';
  private side: 'red' | 'black' | 'random' = 'red';
  private handler: (action: MenuAction) => void = () => {};

  constructor(private readonly ink: InkLayer) {
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('pointerenter', () => sound.tick(true));
      button.addEventListener('click', (event) => {
        sound.unlock();
        sound.tick();
        this.ink.splash(event.clientX, event.clientY, { radius: 30 });
        this.onButton(button);
      });
    });
  }

  onAction(handler: (action: MenuAction) => void): void {
    this.handler = handler;
  }

  private choose(rowId: string, button: HTMLButtonElement): void {
    document.querySelectorAll(`#${rowId} .choice`).forEach((el) => el.classList.toggle('selected', el === button));
  }

  private onButton(button: HTMLButtonElement): void {
    if (button.classList.contains('choice')) {
      const row = button.parentElement!.id;
      this.choose(row, button);
      if (row === 'difficulty') this.difficulty = button.dataset.value as Difficulty;
      else this.side = button.dataset.value as 'red' | 'black' | 'random';
      return;
    }
    const act = button.dataset.act;
    switch (act) {
      case 'ai':
        this.swap(this.main, this.aiPanel);
        return;
      case 'back':
        this.swap(this.aiPanel, this.main);
        return;
      case 'start-ai':
        this.handler({ type: 'ai', difficulty: this.difficulty, side: this.side });
        return;
      case 'continue':
      case 'local':
      case 'rogue':
      case 'rules':
      case 'settings':
      case 'quit':
        this.handler({ type: act });
        return;
    }
  }

  private swap(from: HTMLElement, to: HTMLElement): void {
    gsap.to(from, {
      opacity: 0,
      x: -30,
      duration: 0.25,
      ease: 'power2.in',
      onComplete: () => {
        from.hidden = true;
        gsap.set(from, { opacity: 1, x: 0 });
        to.hidden = false;
        gsap.fromTo(to.children, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.06, ease: 'power3.out' });
      },
    });
  }

  show(hasSave: boolean): void {
    this.root.hidden = false;
    this.aiPanel.hidden = true;
    this.main.hidden = false;
    (this.root.querySelector('[data-act="continue"]') as HTMLElement).hidden = !hasSave;
    document.getElementById('verse')!.textContent = VERSES[Math.floor(Math.random() * VERSES.length)];

    // 标题：浓墨落纸
    const chars = this.root.querySelectorAll<HTMLElement>('.title span');
    const tl = gsap.timeline();
    tl.fromTo('.menu-wash', { opacity: 0 }, { opacity: 1, duration: 1.2 }, 0);
    chars.forEach((char, i) => {
      tl.fromTo(char, { opacity: 0, scale: 1.9, filter: 'blur(30px)', rotate: i ? 8 : -8 }, { opacity: 1, scale: 1, filter: 'blur(0px)', rotate: 0, duration: 0.9, ease: 'expo.out' }, 0.25 + i * 0.35);
      tl.call(() => {
        const rect = char.getBoundingClientRect();
        this.ink.splash(rect.left + rect.width / 2, rect.top + rect.height / 2, { radius: rect.width * 0.75, life: 1.6 });
        sound.drum(0.5);
      }, [], 0.38 + i * 0.35);
    });
    tl.fromTo('.subtitle', { opacity: 0, letterSpacing: '1.4em' }, { opacity: 1, letterSpacing: '0.35em', duration: 1.1, ease: 'power3.out' }, 0.9);
    tl.fromTo('.title-seal', { opacity: 0, scale: 2.2, rotate: -20 }, { opacity: 1, scale: 1, rotate: 3, duration: 0.5, ease: 'back.out(2.5)' }, 1.3);
    tl.fromTo('.verse', { opacity: 0 }, { opacity: 1, duration: 1 }, 1.5);
    tl.fromTo(this.main.querySelectorAll('.menu-btn:not([hidden])'), { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out' }, 1.0);
    tl.fromTo(this.main.querySelectorAll('.menu-btn:not([hidden]) b'), { rotate: -180, scale: 0.3 }, { rotate: 0, scale: 1, duration: 0.8, stagger: 0.08, ease: 'back.out(1.8)' }, 1.0);
  }

  hide(): void {
    this.root.hidden = true;
  }
}
