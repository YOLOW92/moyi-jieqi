// 场景特效：墨点落点、涟漪、墨迹、飞溅、拖尾、箭头、将军光晕……

import * as THREE from 'three';
import gsap from 'gsap';
import { squareToWorld } from './board';
import { arrowTexture, blotTexture, cornerTexture, ensoTexture, inkDotTexture, ringTexture, softDotTexture, splatTexture } from './textures';

const INK = new THREE.Color(0x1c1915);
const CINNABAR = new THREE.Color(0xb02a1f);
const GOLD = new THREE.Color(0xb8893a);

function flatMesh(texture: THREE.Texture, size: number, color: THREE.Color, opacity = 1, blending: THREE.Blending = THREE.NormalBlending): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, opacity, depthWrite: false, blending, fog: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  spin: number;
  grow: number;
  fade: number;
  onLand?: (position: THREE.Vector3) => void;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly markers = new THREE.Group();
  private readonly decals = new THREE.Group();
  private readonly particles: Particle[] = [];
  private markerTime = 0;
  private hover: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private lastMove: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private checkAura: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private selection: THREE.Group | null = null;
  private arrows = new THREE.Group();
  quality = 1;

  constructor() {
    this.group.add(this.decals, this.markers, this.arrows);
    this.hover = flatMesh(ringTexture(), 1.02, INK, 0);
    this.hover.position.y = 0.012;
    this.group.add(this.hover);
  }

  // ------------------------------------------------------------------ 落点
  showMoves(targets: { square: number; capture: boolean }[]): void {
    this.clearMoves();
    targets.forEach(({ square, capture }, i) => {
      const position = squareToWorld(square);
      if (capture) {
        const enso = flatMesh(ensoTexture(11, 0.2), 1.15, CINNABAR, 0.95);
        enso.position.set(position.x, 0.015, position.z);
        enso.userData.spin = 0.6;
        enso.scale.setScalar(0.01);
        gsap.to(enso.scale, { x: 1, y: 1, z: 1, duration: 0.5, delay: i * 0.025, ease: 'back.out(2.2)' });
        this.markers.add(enso);
      } else {
        const dot = flatMesh(inkDotTexture(), 0.62, INK, 0.9);
        dot.position.set(position.x, 0.014, position.z);
        dot.rotation.z = Math.random() * Math.PI * 2;
        dot.userData.breathe = Math.random() * Math.PI * 2;
        dot.scale.setScalar(0.01);
        gsap.to(dot.scale, { x: 1, y: 1, z: 1, duration: 0.55, delay: i * 0.03, ease: 'elastic.out(1, 0.55)' });
        this.markers.add(dot);
        // 落点出现时的小涟漪
        if (this.quality > 0) this.ripple(position, { color: INK, size: 0.9, duration: 0.7, delay: i * 0.03, opacity: 0.25 });
      }
    });
  }

  clearMoves(): void {
    for (const child of [...this.markers.children]) {
      gsap.killTweensOf((child as THREE.Mesh).scale);
      const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      gsap.to(mesh.scale, {
        x: 0.01,
        y: 0.01,
        z: 0.01,
        duration: 0.18,
        ease: 'power2.in',
        onComplete: () => {
          this.markers.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        },
      });
    }
  }

  setHover(square: number | null, color: 'ink' | 'red' = 'ink'): void {
    if (square === null) {
      gsap.to(this.hover.material, { opacity: 0, duration: 0.2 });
      return;
    }
    const p = squareToWorld(square);
    this.hover.material.color.copy(color === 'red' ? CINNABAR : INK);
    if (this.hover.material.opacity < 0.05) this.hover.position.set(p.x, 0.012, p.z);
    gsap.to(this.hover.position, { x: p.x, z: p.z, duration: 0.18, ease: 'power3.out' });
    gsap.to(this.hover.material, { opacity: 0.4, duration: 0.2 });
  }

  // ------------------------------------------------------------------ 上一步标记
  showLastMove(from: number | null, to: number | null): void {
    for (const mesh of this.lastMove) {
      gsap.to(mesh.material, { opacity: 0, duration: 0.3, onComplete: () => this.group.remove(mesh) });
    }
    this.lastMove = [];
    if (from === null || to === null) return;
    [from, to].forEach((square, i) => {
      const mesh = flatMesh(cornerTexture(), 1.02, i === 0 ? INK : CINNABAR, 0);
      const p = squareToWorld(square);
      mesh.position.set(p.x, 0.011, p.z);
      mesh.scale.setScalar(1.5);
      gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'power3.out' });
      gsap.to(mesh.material, { opacity: i === 0 ? 0.35 : 0.75, duration: 0.5 });
      this.group.add(mesh);
      this.lastMove.push(mesh);
    });
  }

  // ------------------------------------------------------------------ 选中光环
  showSelection(square: number | null, color: 'red' | 'black' = 'black'): void {
    if (this.selection) {
      const old = this.selection;
      old.children.forEach((c) => gsap.to((c as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material, { opacity: 0, duration: 0.2 }));
      gsap.delayedCall(0.25, () => this.group.remove(old));
      this.selection = null;
    }
    if (square === null) return;
    const group = new THREE.Group();
    const p = squareToWorld(square);
    group.position.set(p.x, 0.013, p.z);
    const tint = color === 'red' ? CINNABAR : INK;
    for (let i = 0; i < 3; i++) {
      const ring = flatMesh(ringTexture(), 1, tint, 0);
      ring.userData.phase = i / 3;
      group.add(ring);
    }
    const halo = flatMesh(softDotTexture(), 1.5, GOLD, 0);
    halo.userData.halo = true;
    gsap.to(halo.material, { opacity: 0.35, duration: 0.3 });
    group.add(halo);
    this.selection = group;
    this.group.add(group);
  }

  moveSelection(position: THREE.Vector3): void {
    if (this.selection) this.selection.position.set(position.x, 0.013, position.z);
  }

  // ------------------------------------------------------------------ 将军
  showCheck(square: number | null): void {
    if (this.checkAura) {
      const old = this.checkAura;
      gsap.to(old.material, { opacity: 0, duration: 0.4, onComplete: () => this.group.remove(old) });
      this.checkAura = null;
    }
    if (square === null) return;
    const aura = flatMesh(splatTexture(5), 2.2, CINNABAR, 0);
    const p = squareToWorld(square);
    aura.position.set(p.x, 0.008, p.z);
    aura.userData.pulse = true;
    gsap.to(aura.material, { opacity: 0.55, duration: 0.4 });
    gsap.fromTo(aura.scale, { x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
    this.checkAura = aura;
    this.group.add(aura);
  }

  // ------------------------------------------------------------------ 箭头（提示 / AI 候选）
  showArrow(from: number, to: number, options: { color?: THREE.Color; opacity?: number; draw?: boolean } = {}): void {
    const a = squareToWorld(from);
    const b = squareToWorld(to);
    const length = a.distanceTo(b);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, Math.max(0.6, length)),
      new THREE.MeshBasicMaterial({ map: arrowTexture(), color: options.color ?? CINNABAR, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    // 平面局部 +Y 指向世界 -Z；绕局部 Z 旋转使箭头指向 a→b。
    mesh.rotation.z = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    mesh.position.set((a.x + b.x) / 2, 0.35, (a.z + b.z) / 2);
    mesh.renderOrder = 5;
    gsap.to(mesh.material, { opacity: options.opacity ?? 0.85, duration: 0.35 });
    if (options.draw !== false) gsap.fromTo(mesh.scale, { y: 0.05 }, { y: 1, duration: 0.5, ease: 'power3.out' });
    this.arrows.add(mesh);
  }

  clearArrows(): void {
    for (const child of [...this.arrows.children]) {
      const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      gsap.to(mesh.material, {
        opacity: 0,
        duration: 0.25,
        onComplete: () => {
          this.arrows.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        },
      });
    }
  }

  // ------------------------------------------------------------------ 涟漪 / 墨迹 / 飞溅
  ripple(position: THREE.Vector3, options: { color?: THREE.Color; size?: number; duration?: number; delay?: number; opacity?: number; y?: number } = {}): void {
    const ring = flatMesh(ringTexture(), 1, options.color ?? INK, 0);
    ring.position.set(position.x, options.y ?? 0.016, position.z);
    ring.scale.setScalar(0.2);
    const size = options.size ?? 2;
    const duration = options.duration ?? 1;
    const delay = options.delay ?? 0;
    gsap.to(ring.scale, { x: size, y: size, z: size, duration, delay, ease: 'power2.out' });
    gsap.fromTo(ring.material, { opacity: options.opacity ?? 0.5 }, {
      opacity: 0,
      duration,
      delay,
      ease: 'power1.in',
      onComplete: () => {
        this.group.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
      },
    });
    this.group.add(ring);
  }

  /** 在宣纸上留下一摊会慢慢淡去的墨迹。 */
  splat(position: THREE.Vector3, options: { color?: THREE.Color; size?: number; life?: number; opacity?: number } = {}): void {
    const variant = Math.floor(Math.random() * 6);
    const decal = flatMesh(splatTexture(variant), options.size ?? 1.6, options.color ?? INK, 0);
    decal.position.set(position.x, 0.006 + this.decals.children.length * 0.0004, position.z);
    decal.rotation.z = Math.random() * Math.PI * 2;
    decal.scale.setScalar(0.2);
    gsap.to(decal.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'expo.out' });
    gsap.to(decal.material, { opacity: options.opacity ?? 0.7, duration: 0.15 });
    gsap.to(decal.material, {
      opacity: 0,
      delay: options.life ?? 5,
      duration: 3,
      ease: 'power1.in',
      onComplete: () => {
        this.decals.remove(decal);
        decal.geometry.dispose();
        decal.material.dispose();
      },
    });
    this.decals.add(decal);
    while (this.decals.children.length > 30) this.decals.remove(this.decals.children[0]);
  }

  private spawn(position: THREE.Vector3, velocity: THREE.Vector3, options: Partial<Particle> & { color?: THREE.Color; size?: number; texture?: THREE.Texture; opacity?: number }): void {
    if (this.particles.length > 600) return;
    const material = new THREE.SpriteMaterial({
      map: options.texture ?? blotTexture(),
      color: options.color ?? INK,
      transparent: true,
      opacity: options.opacity ?? 0.9,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(options.size ?? 0.1);
    material.rotation = Math.random() * Math.PI * 2;
    this.group.add(sprite);
    this.particles.push({
      sprite,
      velocity,
      life: 0,
      maxLife: options.maxLife ?? 1,
      gravity: options.gravity ?? 9,
      drag: options.drag ?? 0.4,
      spin: options.spin ?? (Math.random() - 0.5) * 6,
      grow: options.grow ?? 0,
      fade: options.fade ?? 0.6,
      onLand: options.onLand,
    });
  }

  /** 墨滴四溅（落地后在纸上留下小墨点）。 */
  inkBurst(position: THREE.Vector3, options: { count?: number; color?: THREE.Color; power?: number; stain?: boolean } = {}): void {
    const count = Math.round((options.count ?? 26) * (this.quality > 0 ? 1 : 0.4));
    const color = options.color ?? INK;
    const power = options.power ?? 1;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (1.2 + Math.random() * 2.8) * power;
      const velocity = new THREE.Vector3(Math.cos(a) * speed, 1.5 + Math.random() * 3.5 * power, Math.sin(a) * speed);
      const start = position.clone().add(new THREE.Vector3(0, 0.15, 0));
      const stain = options.stain !== false && Math.random() < 0.35;
      this.spawn(start, velocity, {
        color,
        size: 0.04 + Math.random() * 0.1,
        maxLife: 1.6,
        gravity: 12,
        drag: 0.2,
        onLand: stain ? (p) => this.splat(p, { color, size: 0.18 + Math.random() * 0.25, life: 3 + Math.random() * 3, opacity: 0.65 }) : undefined,
      });
    }
  }

  /** 移动时的墨痕拖尾。 */
  trail(position: THREE.Vector3, color: THREE.Color = INK): void {
    if (this.quality === 0 && Math.random() < 0.6) return;
    this.spawn(position.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.15, (Math.random() - 0.5) * 0.2), {
      texture: splatTexture(Math.floor(Math.random() * 6)),
      color,
      size: 0.32 + Math.random() * 0.22,
      maxLife: 0.75,
      gravity: 0,
      drag: 1.5,
      grow: 0.6,
      fade: 0,
      opacity: 0.32,
    });
  }

  /** 翻面时的金色碎光与墨环。 */
  revealBurst(position: THREE.Vector3, color: THREE.Color): void {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const velocity = new THREE.Vector3(Math.cos(a) * 2.6, 0.6 + Math.random(), Math.sin(a) * 2.6);
      this.spawn(position.clone().add(new THREE.Vector3(0, 0.5, 0)), velocity, {
        texture: softDotTexture(),
        color: i % 2 ? GOLD : color,
        size: 0.12 + Math.random() * 0.1,
        maxLife: 0.9,
        gravity: 1.5,
        drag: 2.6,
        blendingAdditive: true,
      } as Partial<Particle>);
    }
    this.ripple(position, { color, size: 3.2, duration: 1.2, opacity: 0.7 });
    this.ripple(position, { color: GOLD, size: 2.2, duration: 0.9, delay: 0.1, opacity: 0.5 });
  }

  /** 墨烟（吃子、终局） */
  smoke(position: THREE.Vector3, color: THREE.Color = INK, count = 10): void {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
      this.spawn(position.clone().add(new THREE.Vector3(0, 0.2, 0)), v, {
        texture: softDotTexture(),
        color,
        size: 0.5 + Math.random() * 0.4,
        maxLife: 1.4 + Math.random() * 0.6,
        gravity: -0.3,
        drag: 1.2,
        grow: 1.4,
        fade: 0,
        opacity: 0.22,
      });
    }
  }

  // ------------------------------------------------------------------ 每帧
  update(dt: number): void {
    this.markerTime += dt;
    for (const child of this.markers.children) {
      const mesh = child as THREE.Mesh;
      if (mesh.userData.spin) mesh.rotation.z += dt * mesh.userData.spin;
      if (mesh.userData.breathe !== undefined) {
        const s = 1 + Math.sin(this.markerTime * 3 + mesh.userData.breathe) * 0.08;
        if (!gsap.isTweening(mesh.scale)) mesh.scale.setScalar(s);
      }
    }
    if (this.selection) {
      for (const child of this.selection.children) {
        const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
        if (mesh.userData.halo) {
          mesh.scale.setScalar(1 + Math.sin(this.markerTime * 4) * 0.08);
          continue;
        }
        const phase = (this.markerTime * 0.7 + mesh.userData.phase) % 1;
        mesh.scale.setScalar(0.7 + phase * 1.1);
        mesh.material.opacity = 0.45 * (1 - phase);
      }
    }
    if (this.checkAura && !gsap.isTweening(this.checkAura.material)) {
      this.checkAura.material.opacity = 0.42 + Math.sin(this.markerTime * 5) * 0.16;
      this.checkAura.rotation.z += dt * 0.3;
    }
    for (const arrow of this.arrows.children) {
      const m = (arrow as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material;
      if (!gsap.isTweening(m)) m.opacity = 0.55 + Math.sin(this.markerTime * 4) * 0.2;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.velocity.y -= p.gravity * dt;
      p.velocity.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.material.rotation += p.spin * dt;
      if (p.grow) p.sprite.scale.multiplyScalar(1 + p.grow * dt);
      const t = p.life / p.maxLife;
      const baseOpacity = p.sprite.userData.baseOpacity ?? (p.sprite.userData.baseOpacity = p.sprite.material.opacity);
      p.sprite.material.opacity = baseOpacity * (t < p.fade ? 1 : 1 - (t - p.fade) / (1 - p.fade || 1));
      let dead = t >= 1;
      if (p.gravity > 0 && p.sprite.position.y < 0.02 && p.velocity.y < 0) {
        const inside = Math.abs(p.sprite.position.x) < 4.8 && Math.abs(p.sprite.position.z) < 5.3;
        if (inside) {
          p.onLand?.(p.sprite.position);
          dead = true;
        } else if (p.sprite.position.y < -3) dead = true;
      }
      if (dead) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  clearAll(): void {
    this.clearMoves();
    this.clearArrows();
    this.showSelection(null);
    this.showCheck(null);
    this.showLastMove(null, null);
    this.setHover(null);
  }
}
