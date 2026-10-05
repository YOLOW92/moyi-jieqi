// 墨途界面：三选一卡牌、墨肆（商店）、侧栏的行程面板。

import gsap from 'gsap';
import { sound } from '../audio/sound';
import { AFFIXES, KIND_LABEL, MAX_TALISMANS, cardById, type CardDef } from '../rogue/content';
import { openBackdrop, unrollIn, wireButtons } from './dialogs';

function cardElement(card: CardDef, tag = 'button'): HTMLElement {
  const el = document.createElement(tag);
  el.className = `card card-${card.kind}`;
  el.innerHTML = `<span class="card-kind"></span><b class="card-glyph"></b><span class="card-name"></span><span class="card-desc"></span>`;
  el.querySelector('.card-kind')!.textContent = KIND_LABEL[card.kind];
  el.querySelector('.card-glyph')!.textContent = card.glyph;
  el.querySelector('.card-name')!.textContent = card.name;
  el.querySelector('.card-desc')!.textContent = card.desc;
  return el;
}

function dialogShell(title: string, subtitle: string): HTMLDivElement {
  const dialog = document.createElement('div');
  dialog.className = 'dialog rogue-dialog';
  const h = document.createElement('h3');
  h.textContent = title;
  dialog.appendChild(h);
  if (subtitle) {
    const p = document.createElement('p');
    p.textContent = subtitle;
    dialog.appendChild(p);
  }
  return dialog;
}

function dealCards(cards: HTMLElement[]): void {
  gsap.fromTo(
    cards,
    { y: 50, opacity: 0, rotate: (i) => (i - (cards.length - 1) / 2) * 6 },
    { y: 0, opacity: 1, rotate: 0, duration: 0.6, stagger: 0.09, delay: 0.3, ease: 'back.out(1.6)' },
  );
}

/** 三选一。返回所选卡牌，跳过则为 null。 */
export function pickCard(title: string, subtitle: string, cards: CardDef[], skipLabel = '略过'): Promise<CardDef | null> {
  return new Promise((resolve) => {
    const dialog = dialogShell(title, subtitle);
    const row = document.createElement('div');
    row.className = 'card-row';
    dialog.appendChild(row);
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const skip = document.createElement('button');
    skip.className = 'ink-btn';
    skip.textContent = skipLabel;
    actions.appendChild(skip);
    dialog.appendChild(actions);
    const { close } = openBackdrop(dialog);
    let done = false;
    const finish = (card: CardDef | null, el?: HTMLElement) => {
      if (done) return;
      done = true;
      if (el) {
        el.classList.add('chosen');
        gsap.fromTo(el, { scale: 1 }, { scale: 1.08, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out' });
        sound.drum(0.6);
      }
      gsap.delayedCall(el ? 0.55 : 0, () => void close().then(() => resolve(card)));
    };
    const elements = cards.map((card) => {
      const el = cardElement(card);
      el.addEventListener('click', () => finish(card, el));
      row.appendChild(el);
      return el;
    });
    skip.addEventListener('click', () => finish(null));
    wireButtons(dialog);
    unrollIn(dialog);
    dealCards(elements);
  });
}

export interface ShopItem {
  card: CardDef;
  price: number;
  sold?: boolean;
}

/**
 * 墨肆：可买多件。onBuy 返回 null 表示买不了（并给出原因由调用方提示），
 * 返回字符串则为成交提示。
 */
export function openShop(items: ShopItem[], ink: () => number, onBuy: (item: ShopItem) => string | null, canBuy: (item: ShopItem) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const dialog = dialogShell('墨 肆', '以墨锭易符箓、兵法、遗珍。');
    const purse = document.createElement('div');
    purse.className = 'shop-purse';
    dialog.appendChild(purse);
    const row = document.createElement('div');
    row.className = 'card-row shop-row';
    dialog.appendChild(row);
    const note = document.createElement('div');
    note.className = 'shop-note';
    dialog.appendChild(note);
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const leave = document.createElement('button');
    leave.className = 'ink-btn primary';
    leave.textContent = '离 开';
    actions.appendChild(leave);
    dialog.appendChild(actions);
    const { close } = openBackdrop(dialog);

    const buttons: [ShopItem, HTMLElement, HTMLButtonElement][] = [];
    const refresh = () => {
      purse.textContent = `囊中墨锭 ${ink()}`;
      for (const [item, el, buy] of buttons) {
        el.classList.toggle('sold', !!item.sold);
        buy.disabled = !!item.sold || item.price > ink() || !canBuy(item);
        buy.textContent = item.sold ? '已 购' : `${item.price} 墨锭`;
      }
    };
    for (const item of items) {
      const wrap = document.createElement('div');
      wrap.className = 'shop-item';
      const el = cardElement(item.card, 'div');
      const buy = document.createElement('button');
      buy.className = 'ink-btn small';
      buy.addEventListener('click', () => {
        const message = onBuy(item);
        if (message === null) return;
        item.sold = true;
        note.textContent = message;
        gsap.fromTo(note, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4 });
        gsap.fromTo(purse, { scale: 1.25, color: '#b02a1f' }, { scale: 1, color: '#1c1915', duration: 0.6, ease: 'back.out(3)' });
        sound.clack(0.6, 1.3);
        refresh();
      });
      wrap.append(el, buy);
      row.appendChild(wrap);
      buttons.push([item, el, buy]);
    }
    refresh();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish();
      }
    };
    const finish = () => {
      document.removeEventListener('keydown', onKey, true);
      void close().then(resolve);
    };
    document.addEventListener('keydown', onKey, true);
    leave.addEventListener('click', finish);
    wireButtons(dialog);
    unrollIn(dialog);
    dealCards(buttons.map(([, el]) => el.parentElement!));
  });
}

export interface PanelInfo {
  stage: string;
  hint: string;
  ink: number;
  enemyShield: number;
  ownShield: number;
  affixes: string[];
  boss: { name: string; desc: string; active: boolean };
  owned: string[];
  talismans: string[];
  canUse: boolean;
}

/** 侧栏行程面板。 */
export class RoguePanel {
  private readonly root = document.getElementById('rogue') as HTMLElement;
  private handler: (index: number) => void = () => {};
  private lastInk = -1;

  onTalisman(handler: (index: number) => void): void {
    this.handler = handler;
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  update(info: PanelInfo): void {
    const $ = (id: string) => document.getElementById(id)!;
    $('rogue-stage').textContent = info.stage;
    $('rogue-hint').textContent = info.hint;
    const ink = $('rogue-ink');
    ink.textContent = `墨锭 ${info.ink}`;
    if (this.lastInk >= 0 && info.ink !== this.lastInk) {
      gsap.fromTo(ink, { scale: 1.5, color: info.ink > this.lastInk ? '#a8834a' : '#b02a1f' }, { scale: 1, color: '#1c1915', duration: 0.7, ease: 'back.out(3)' });
    }
    this.lastInk = info.ink;

    const enemy = $('rogue-enemy');
    enemy.innerHTML = '';
    const chip = (text: string, title: string, cls = '') => {
      const el = document.createElement('span');
      el.className = `chip ${cls}`;
      el.textContent = text;
      el.title = title;
      return el;
    };
    enemy.appendChild(chip(info.boss.active ? `首领 · ${info.boss.name}` : `终幕 · ${info.boss.name}`, info.boss.desc, info.boss.active ? 'boss' : 'boss dim'));
    for (const id of info.affixes) {
      const affix = AFFIXES.find((a) => a.id === id);
      if (affix) enemy.appendChild(chip(affix.name, affix.desc, 'foe'));
    }
    if (info.enemyShield > 0) enemy.appendChild(chip(`敌护体 ${info.enemyShield}`, '吃将时先抵消一次，来犯之子被震碎', 'foe'));

    const owned = $('rogue-owned');
    owned.innerHTML = '';
    if (info.ownShield > 0) owned.appendChild(chip(`护体 ${info.ownShield}`, '吃帅时先抵消一次', 'mine'));
    for (const id of info.owned) {
      const card = cardById(id);
      owned.appendChild(chip(card.name, card.desc, 'mine'));
    }
    if (owned.childElementCount === 0) owned.appendChild(chip('尚无', '吃掉敌方车马炮可得三选一奖励', 'dim'));

    const slots = $('rogue-talismans');
    slots.innerHTML = '';
    for (let i = 0; i < MAX_TALISMANS; i++) {
      const id = info.talismans[i];
      const button = document.createElement('button');
      button.className = 'talisman';
      if (id) {
        const card = cardById(id);
        button.innerHTML = `<b></b><span></span>`;
        button.querySelector('b')!.textContent = card.glyph;
        button.querySelector('span')!.textContent = card.name;
        button.title = card.desc;
        button.disabled = !info.canUse;
        button.addEventListener('pointerenter', () => !button.disabled && sound.tick(true));
        button.addEventListener('click', () => {
          sound.tick();
          this.handler(i);
        });
      } else {
        button.classList.add('empty');
        button.disabled = true;
        button.innerHTML = '<span>空</span>';
      }
      slots.appendChild(button);
    }
  }
}
