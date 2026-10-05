// 墨途地形：山石、墨池、宝匣，以及悬在棋子上方的小字标记（窥见的真身、定身、护体）。

import * as THREE from 'three';
import gsap from 'gsap';
import { squareToWorld } from './board';
import { BRUSH_FONT, makeCanvas, splatTexture, toTexture } from './textures';

type TerrainType = 'rock' | 'pool' | 'treasure';

const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x45443d, roughness: 0.92, flatShading: true });
const mossMaterial = new THREE.MeshStandardMaterial({ color: 0x5d6650, roughness: 0.95, flatShading: true });
const lacquerMaterial = new THREE.MeshStandardMaterial({ color: 0x9e2419, roughness: 0.35, metalness: 0.05 });
const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 0.6 });

function makeRock(seed: number): THREE.Group {
  const group = new THREE.Group();
  const main = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), rockMaterial);
  main.scale.set(1.05, 0.95, 0.9);
  main.rotation.set(seed * 0.7, seed * 1.3, seed * 0.4);
  main.position.y = 0.24;
  const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), mossMaterial);
  small.position.set(0.26, 0.1, 0.16);
  small.rotation.set(seed, seed * 2, 0);
  for (const m of [main, small]) m.castShadow = m.receiveShadow = true;
  group.add(main, small);
  return group;
}

function makePool(seed: number): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: splatTexture(seed % 6), color: 0x0d0b09, transparent: true, opacity: 1, depthWrite: false, fog: false }),
  );
  // 叠一层浓墨芯，远看也认得出
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 32),
    new THREE.MeshBasicMaterial({ color: 0x14120f, transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.006;
  core.renderOrder = 1;
  group.add(core);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = seed;
  mesh.position.y = 0.005;
  mesh.renderOrder = 1;
  group.add(mesh);
  group.userData.spin = mesh;
  return group;
}

function makeTreasure(): THREE.Group {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.34), lacquerMaterial);
  box.position.y = 0.13;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.38), lacquerMaterial);
  lid.position.y = 0.3;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.4), goldMaterial);
  band.position.y = 0.18;
  for (const m of [box, lid, band]) m.castShadow = true;
  const bob = new THREE.Group();
  bob.add(box, lid, band);
  group.add(bob);
  group.userData.bob = bob;
  return group;
}

/** 书法小字贴图（标签用）。 */
const glyphCache = new Map<string, THREE.Texture>();
function glyphTexture(text: string, color: string): THREE.Texture {
  const key = `${text}:${color}`;
  let texture = glyphCache.get(key);
  if (texture) return texture;
  const [canvas, ctx] = makeCanvas(256, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${text.length > 1 ? 84 : 104}px ${BRUSH_FONT}`;
  ctx.shadowColor = 'rgba(239,231,214,0.95)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) ctx.fillText(text, 128, 68);
  texture = toTexture(canvas);
  glyphCache.set(key, texture);
  return texture;
}

export class TerrainView {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, THREE.Group>();
  private readonly labels = new Map<string, THREE.Sprite>();
  private time = 0;

  /** 与给定地形同步：新增的从地里长出，消失的缩回。 */
  sync(rocks: number[], pools: number[], treasures: number[], animate = true): void {
    const wanted = new Map<string, [TerrainType, number]>();
    for (const s of rocks) wanted.set(`rock:${s}`, ['rock', s]);
    for (const s of pools) wanted.set(`pool:${s}`, ['pool', s]);
    for (const s of treasures) wanted.set(`treasure:${s}`, ['treasure', s]);
    for (const [key, item] of this.items) {
      if (wanted.has(key)) continue;
      this.items.delete(key);
      if (!animate) {
        this.group.remove(item);
        continue;
      }
      gsap.to(item.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.45, ease: 'back.in(2)', onComplete: () => void this.group.remove(item) });
    }
    for (const [key, [type, square]] of wanted) {
      if (this.items.has(key)) continue;
      const item = type === 'rock' ? makeRock(square) : type === 'pool' ? makePool(square) : makeTreasure();
      item.position.copy(squareToWorld(square));
      this.group.add(item);
      this.items.set(key, item);
      if (animate) gsap.fromTo(item.scale, { x: 0.01, y: 0.01, z: 0.01 }, { x: 1, y: 1, z: 1, duration: 0.9, delay: Math.random() * 0.3, ease: 'elastic.out(1.1, 0.45)' });
    }
  }

  clear(): void {
    this.sync([], [], [], false);
    for (const key of [...this.labels.keys()]) this.setLabel(key, null);
  }

  /** 悬浮小字：key 唯一标识，text 为 null 时移除。 */
  setLabel(key: string, text: string | null, color = '#1c1915', position?: THREE.Vector3): void {
    let sprite = this.labels.get(key);
    if (text === null) {
      if (sprite) {
        this.labels.delete(key);
        const s = sprite;
        gsap.to(s.material, { opacity: 0, duration: 0.3, onComplete: () => void this.group.remove(s) });
      }
      return;
    }
    const map = glyphTexture(text, color);
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
      sprite.scale.set(1.0, 0.5, 1);
      sprite.renderOrder = 10;
      sprite.userData.phase = Math.random() * 6;
      this.labels.set(key, sprite);
      this.group.add(sprite);
      gsap.to(sprite.material, { opacity: 0.95, duration: 0.4 });
    } else if (sprite.material.map !== map) {
      sprite.material.map = map;
      sprite.material.needsUpdate = true;
    }
    if (position) sprite.position.set(position.x, position.y + 0.72, position.z);
  }

  labelKeys(): string[] {
    return [...this.labels.keys()];
  }

  update(dt: number): void {
    this.time += dt;
    for (const item of this.items.values()) {
      const bob = item.userData.bob as THREE.Group | undefined;
      if (bob) {
        bob.position.y = 0.06 + Math.sin(this.time * 2.2 + item.position.x) * 0.05;
        bob.rotation.y += dt * 0.6;
      }
      const spin = item.userData.spin as THREE.Mesh | undefined;
      if (spin) spin.rotation.z += dt * 0.08;
    }
    for (const sprite of this.labels.values()) sprite.position.y += Math.sin(this.time * 2 + sprite.userData.phase) * 0.0015;
  }
}
