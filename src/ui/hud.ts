import gsap from 'gsap';
import type { Color } from '../core/rules';
import type { InkLayer } from './inkLayer';

export interface MoveEntry {
  color: Color;
  text: string;
  note: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  readonly root = $<HTMLDivElement>('hud');
  private readonly seal = $<HTMLDivElement>('turn-seal');
  private readonly sealChar = $<HTMLSpanElement>('turn-seal-char');
  private readonly title = $<HTMLDivElement>('turn-title');
  private readonly sub = $<HTMLDivElement>('turn-sub');
  private readonly moves = $<HTMLOListElement>('moves');
  private readonly stats = $<HTMLDivElement>('stats');
  private readonly banner = $<HTMLDivElement>('banner');
  private readonly toasts = $<HTMLDivElement>('toasts');
  private lastTurn: Color | null = null;

  constructor(private readonly ink: InkLayer) {}

  onAction(handler: (action: string, event: MouseEvent) => void): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((button) => {
      button.addEventListener('click', (event) => handler(button.dataset.act!, event));
    });
  }

  show(): void {
    this.root.hidden = false;
    gsap.fromTo('#panel', { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, ease: 'power3.out' });
    gsap.fromTo('.turn', { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, delay: 0.2, ease: 'power3.out' });
    gsap.fromTo('.actions .ink-btn', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.05, delay: 0.4, ease: 'power2.out' });
  }

  hide(): void {
    this.root.hidden = true;
    this.lastTurn = null;
  }

  panelWidth(): number {
    return this.root.hidden ? 0 : $<HTMLElement>('panel').offsetWidth;
  }

  setTurn(color: Color, label: string, check: boolean): void {
    const changed = this.lastTurn !== color;
    this.lastTurn = color;
    this.seal.classList.toggle('black', color === 'black');
    this.sealChar.textContent = color === 'red' ? '红' : '黑';
    this.title.textContent = label;
    $<HTMLElement>('hud').querySelector('.turn')!.classList.toggle('check', check);
    document.querySelectorAll<HTMLElement>('.player').forEach((el) => el.classList.toggle('active', el.dataset.color === color));
    if (changed) {
      // 盖章
      gsap.fromTo(this.seal, { scale: 1.9, rotate: -22, opacity: 0 }, { scale: 1, rotate: -5, opacity: 1, duration: 0.55, ease: 'back.out(2.4)' });
      gsap.fromTo(this.title, { x: -16, opacity: 0, filter: 'blur(6px)' }, { x: 0, opacity: 1, filter: 'blur(0px)', duration: 0.6, delay: 0.1, ease: 'power3.out' });
      const rect = this.seal.getBoundingClientRect();
      gsap.delayedCall(0.28, () => this.ink.splash(rect.left + rect.width / 2, rect.top + rect.height / 2, { radius: 46, color: color === 'red' ? '176,42,31' : '28,25,21', life: 0.9 }));
    }
  }

  setSub(text: string): void {
    this.sub.textContent = text;
  }

  setPlayers(red: string, black: string): void {
    $('name-red').textContent = red;
    $('name-black').textContent = black;
  }

  setThinking(color: Color | null): void {
    document.querySelectorAll<HTMLElement>('.player').forEach((el) => el.classList.toggle('thinking-on', el.dataset.color === color));
  }

  setLost(red: number, black: number): void {
    const update = (id: string, n: number) => {
      const el = $(id);
      const text = `失 ${n}`;
      if (el.textContent !== text) {
        el.textContent = text;
        gsap.fromTo(el, { scale: 1.6, color: '#b02a1f' }, { scale: 1, color: '#4a433b', duration: 0.6, ease: 'back.out(3)' });
      }
    };
    update('lost-red', red);
    update('lost-black', black);
  }

  setMoves(entries: MoveEntry[], animateLast = false): void {
    this.moves.innerHTML = '';
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '尚 未 落 子';
      this.moves.appendChild(li);
      return;
    }
    entries.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = entry.color;
      if (i === entries.length - 1) {
        li.classList.add('latest');
        if (animateLast) li.classList.add('enter');
      }
      li.innerHTML = `<span class="no">${i + 1}</span><span class="mv"></span>${entry.note ? '<span class="note"></span>' : ''}`;
      li.querySelector('.mv')!.textContent = `${entry.color === 'red' ? '红' : '黑'} ${entry.text}`;
      if (entry.note) li.querySelector('.note')!.textContent = entry.note;
      this.moves.appendChild(li);
    });
    this.moves.scrollTo({ top: this.moves.scrollHeight, behavior: animateLast ? 'smooth' : 'auto' });
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  setEnabled(action: string, enabled: boolean): void {
    const button = this.root.querySelector<HTMLButtonElement>(`[data-act="${action}"]`);
    if (button) button.disabled = !enabled;
  }

  /** 屏幕中央的大字（将、倒戈、胜……）。 */
  bigText(text: string, options: { red?: boolean; caption?: string; hold?: number } = {}): Promise<void> {
    return new Promise((resolve) => {
      this.banner.innerHTML = '';
      const wrap = document.createElement('div');
      const big = document.createElement('div');
      big.className = `big${options.red ? ' red' : ''}`;
      for (const ch of text) {
        const span = document.createElement('span');
        span.textContent = ch;
        span.style.display = 'inline-block';
        big.appendChild(span);
      }
      wrap.appendChild(big);
      if (options.caption) {
        const caption = document.createElement('div');
        caption.className = 'caption';
        caption.textContent = options.caption;
        wrap.appendChild(caption);
      }
      this.banner.style.paddingRight = `${this.panelWidth()}px`;
      this.banner.appendChild(wrap);
      const chars = big.querySelectorAll('span');
      const tl = gsap.timeline({ onComplete: () => {
        this.banner.innerHTML = '';
        resolve();
      } });
      tl.fromTo(chars, { scale: 2.4, opacity: 0, rotate: -12, filter: 'blur(26px)' }, { scale: 1, opacity: 1, rotate: 0, filter: 'blur(0px)', duration: 0.55, stagger: 0.12, ease: 'expo.out' });
      tl.call(() => {
        const rect = big.getBoundingClientRect();
        this.ink.splash(rect.left + rect.width / 2, rect.top + rect.height / 2, { radius: rect.height * 0.55, color: options.red ? '176,42,31' : '28,25,21', life: 1.4 });
      }, [], 0.15);
      if (options.caption) tl.fromTo(wrap.querySelector('.caption'), { opacity: 0, y: 14, letterSpacing: '1.2em' }, { opacity: 1, y: 0, letterSpacing: '0.4em', duration: 0.7, ease: 'power3.out' }, 0.3);
      tl.to({}, { duration: options.hold ?? 0.6 });
      tl.to(wrap, { opacity: 0, scale: 1.08, filter: 'blur(12px)', duration: 0.5, ease: 'power2.in' });
    });
  }

  toast(text: string, duration = 2.2): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.style.setProperty('--toast-shift', `${this.panelWidth() / 2}px`);
    this.toasts.appendChild(el);
    gsap.fromTo(el, { y: -30, opacity: 0, rotate: -3 }, { y: 0, opacity: 1, rotate: 0, duration: 0.5, ease: 'back.out(2)' });
    gsap.to(el, { y: -20, opacity: 0, duration: 0.4, delay: duration, ease: 'power2.in', onComplete: () => el.remove() });
  }
}
