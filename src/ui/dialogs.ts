import gsap from 'gsap';
import { sound } from '../audio/sound';

const root = () => document.getElementById('dialogs')!;

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
}

let openCount = 0;
export const dialogOpen = () => openCount > 0;

export function openBackdrop(content: HTMLElement, onBackdrop?: () => void): { backdrop: HTMLDivElement; close: () => Promise<void> } {
  openCount++;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.appendChild(content);
  root().appendChild(backdrop);
  gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.3 });
  if (onBackdrop) {
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) onBackdrop();
    });
  }
  let closed = false;
  const close = () =>
    new Promise<void>((resolve) => {
      if (closed) return resolve();
      closed = true;
      openCount--;
      gsap.to(content, { scaleY: 0.02, opacity: 0, duration: 0.32, ease: 'power3.in' });
      gsap.to(backdrop, { opacity: 0, duration: 0.35, delay: 0.1, onComplete: () => {
        backdrop.remove();
        resolve();
      } });
    });
  return { backdrop, close };
}

export function unrollIn(dialog: HTMLElement): void {
  gsap.fromTo(dialog, { scaleY: 0.02, opacity: 0.6 }, { scaleY: 1, opacity: 1, duration: 0.65, ease: 'power4.out' });
  gsap.fromTo(dialog.querySelectorAll('h3, p, .big-result, .dialog-actions > *, .setting'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, delay: 0.25, ease: 'power2.out' });
}

export function wireButtons(container: HTMLElement): void {
  container.querySelectorAll('button').forEach((b) => b.addEventListener('pointerenter', () => sound.tick(true)));
}

export function ask(title: string, body: string, buttons: DialogButton[], extra?: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    const h = document.createElement('h3');
    h.textContent = title;
    dialog.appendChild(h);
    if (extra) dialog.appendChild(extra);
    for (const line of body.split('\n').filter(Boolean)) {
      const p = document.createElement('p');
      p.textContent = line;
      dialog.appendChild(p);
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    dialog.appendChild(actions);
    const cancel = buttons.find((b) => !b.primary)?.value ?? buttons[0].value;
    const { close } = openBackdrop(dialog, () => finish(cancel));
    const finish = (value: string) => {
      document.removeEventListener('keydown', onKey, true);
      void close();
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(cancel);
      } else if (event.key === 'Enter') {
        event.stopPropagation();
        finish(buttons.find((b) => b.primary)?.value ?? buttons[0].value);
      }
    };
    document.addEventListener('keydown', onKey, true);
    for (const button of buttons) {
      const el = document.createElement('button');
      el.className = `ink-btn${button.primary ? ' primary' : ''}`;
      el.textContent = button.label;
      el.addEventListener('click', () => {
        sound.tick();
        finish(button.value);
      });
      actions.appendChild(el);
    }
    wireButtons(dialog);
    unrollIn(dialog);
  });
}

export function resultBlock(text: string, red: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `big-result${red ? ' red' : ''}`;
  el.textContent = text;
  return el;
}

const RULES_HTML = `
  <h3>全混揭棋 · 棋规</h3>
  <h4>开局</h4>
  <p>将、帅明置于九宫正中，其余三十子不分红黑，完全混洗后背面朝上，摆在常规象棋的开局位置。</p>
  <p>暗子侧边的色带与背面圆相的颜色，表示它暂时由哪一方指挥。</p>
  <h4>暗子</h4>
  <p>暗子第一次移动，按它所在开局位置的棋种走法行走（车位走车、马位走马……），落定后立即翻面。</p>
  <p>若翻出的是敌方棋子，这一步依然有效，此后改由敌方控制——谓之“倒戈”。</p>
  <p>暗士只能在原九宫内斜走，暗象不能过河；兵卒按所在一方的方向前进。</p>
  <h4>明子</h4>
  <p>翻开的士可以出宫、过河；翻开的象可以过河，但仍受象眼阻挡。其余棋子与象棋相同：马有蹩腿，炮须隔一子吃子。</p>
  <p>被吃掉的暗子会立即公开身份。</p>
  <h4>胜负</h4>
  <p>吃掉对方的将帅，或使轮到的一方无子可动，即为胜。</p>
  <p>主动走成将帅照面属违规；但因翻面而意外形成的攻击有效。</p>
  <p>同一完整局面第三次出现判和；连续六十回合无吃子、无翻面亦判和。可认输、可议和。</p>
  <h4>操作</h4>
  <p>点击或拖拽己方棋子，墨点为可落之处，朱圈为可吃之子。</p>
  <p>Ctrl+Z 悔棋　H 提示　F 翻转视角　F11 全屏　F1 棋规　Esc 取消或回卷首</p>
`;

/** 卷轴展开的规则页。 */
export function showRules(): Promise<void> {
  return new Promise((resolve) => {
    const scroll = document.createElement('div');
    scroll.className = 'scroll';
    scroll.innerHTML = `<div class="roller"></div><div class="scroll-paper"><div class="scroll-body">${RULES_HTML}</div></div><div class="roller"></div>`;
    const closeButton = document.createElement('button');
    closeButton.className = 'ink-btn scroll-close';
    closeButton.textContent = '卷起';
    scroll.appendChild(closeButton);
    const { close } = openBackdrop(scroll, () => finish());
    const paper = scroll.querySelector<HTMLElement>('.scroll-paper')!;
    const body = scroll.querySelector<HTMLElement>('.scroll-body')!;
    const full = paper.getBoundingClientRect().width;
    const finish = () => {
      document.removeEventListener('keydown', onKey, true);
      gsap.to(paper, { width: 0, duration: 0.6, ease: 'power3.inOut' });
      gsap.delayedCall(0.35, () => void close().then(resolve));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'F1') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    };
    document.addEventListener('keydown', onKey, true);
    closeButton.addEventListener('click', finish);
    // 竖排从右往左读：滚动到最右
    body.scrollLeft = body.scrollWidth;
    body.addEventListener('wheel', (event) => {
      body.scrollLeft -= event.deltaY;
      event.preventDefault();
    }, { passive: false });
    gsap.fromTo(paper, { width: 0 }, { width: full, duration: 1.1, ease: 'power3.inOut' });
    gsap.fromTo(body.children, { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.04, delay: 0.6 });
    sound.whoosh(0.9);
  });
}

export interface Settings {
  sfx: boolean;
  music: boolean;
  quality: boolean;
  cursor: boolean;
  sway: boolean;
}

export function showSettings(settings: Settings, onChange: (s: Settings) => void): Promise<void> {
  const list = document.createElement('div');
  list.className = 'settings-list';
  const rows: [keyof Settings, string][] = [
    ['sfx', '音效'],
    ['music', '松风琴韵'],
    ['quality', '高画质（阴影、抗锯齿）'],
    ['cursor', '笔锋光标墨迹'],
    ['sway', '镜头呼吸微动'],
  ];
  for (const [key, label] of rows) {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<span>${label}</span><button class="toggle${settings[key] ? ' on' : ''}" aria-label="${label}"></button>`;
    const toggle = row.querySelector('button')!;
    toggle.addEventListener('click', () => {
      settings[key] = !settings[key];
      toggle.classList.toggle('on', settings[key]);
      sound.tick(settings[key]);
      onChange(settings);
    });
    list.appendChild(row);
  }
  return ask('设 置', '', [{ label: '好', value: 'ok', primary: true }], list).then(() => undefined);
}
