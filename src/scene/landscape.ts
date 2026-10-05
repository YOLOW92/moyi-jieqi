// 水墨山水环境：远山、红日、云雾、落梅、飞鹤、地面水纹。

import * as THREE from 'three';
import { seededRandom } from '../core/rules';
import { makeCanvas, mistTexture, mountainPanorama, paintPaper, petalTexture, toTexture } from './textures';

interface Crane {
  group: THREE.Group;
  wings: THREE.Mesh[];
  speed: number;
  phase: number;
  angle: number;
  radius: number;
  height: number;
}

export class Landscape {
  readonly group = new THREE.Group();
  private readonly mists: { sprite: THREE.Sprite; speed: number; base: number; phase: number }[] = [];
  private petals!: THREE.Points;
  private petalData: { velocity: THREE.Vector3; phase: number }[] = [];
  private readonly cranes: Crane[] = [];
  private readonly layers: THREE.Mesh[] = [];
  private readonly bamboo: { mesh: THREE.Mesh; base: THREE.Euler; phase: number }[] = [];
  private time = 0;
  wind = 1;
  private gustTimer = 6;
  petalBurst = 0;

  constructor(quality: number) {
    this.buildGround();
    this.buildPond();
    this.buildBamboo();
    this.buildMountains();
    this.buildSun();
    this.buildMist(quality > 0 ? 26 : 12);
    this.buildPetals(quality > 0 ? 220 : 80);
    this.buildCranes();
  }

  private buildGround(): void {
    const [canvas, ctx] = makeCanvas(1024, 1024);
    paintPaper(ctx, 1024, 1024, 12, '#ebe2cf');
    // 棋盘下的淡墨水面与同心水纹
    const g = ctx.createRadialGradient(512, 512, 60, 512, 512, 512);
    g.addColorStop(0, 'rgba(70,70,62,0.18)');
    g.addColorStop(0.35, 'rgba(70,70,62,0.06)');
    g.addColorStop(1, 'rgba(70,70,62,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(40,38,33,0.07)';
    for (let r = 150; r < 520; r += 28 + r * 0.05) {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(512, 512, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(420, 96),
      new THREE.MeshStandardMaterial({ map: toTexture(canvas), roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.0;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /** 棋盘四周的荷塘：浓淡荷叶、水纹、几点粉荷。 */
  private buildPond(): void {
    const size = 2048;
    const [canvas, ctx] = makeCanvas(size, size);
    const random = seededRandom(31);
    const unit = size / 46;
    const at = (x: number, z: number): [number, number] => [size / 2 + x * unit, size / 2 + z * unit];
    // 水纹
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const [x, y] = at((random() - 0.5) * 44, (random() - 0.5) * 44);
      const w = 40 + random() * 160;
      ctx.strokeStyle = `rgba(40,38,33,${0.05 + random() * 0.08})`;
      ctx.lineWidth = 1 + random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.bezierCurveTo(x - w / 3, y - 6, x + w / 3, y + 6, x + w, y);
      ctx.stroke();
    }
    // 荷叶
    const leaves: [number, number, number][] = [[-11.5, 6.5, 3.2], [-13.5, -2.5, 2.4], [12.5, 7.5, 2.8], [13, -6.5, 3.6], [-9.5, -9.5, 2.2], [9, 11, 2.0], [-15, 10, 1.6], [16, 1.5, 1.8]];
    for (const [x, z, r] of leaves) {
      const [cx, cy] = at(x, z);
      const R = r * unit;
      const notch = random() * Math.PI * 2;
      const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
      const dark = 0.35 + random() * 0.3;
      g.addColorStop(0, `rgba(30,32,26,${dark})`);
      g.addColorStop(0.75, `rgba(30,32,26,${dark * 0.75})`);
      g.addColorStop(1, `rgba(30,32,26,${dark * 0.25})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let i = 0; i <= 64; i++) {
        const a = notch + 0.18 + (i / 64) * (Math.PI * 2 - 0.36);
        const k = 1 + Math.sin(a * 9) * 0.03 + (random() - 0.5) * 0.04;
        ctx.lineTo(cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k);
      }
      ctx.closePath();
      ctx.fill();
      // 叶脉
      ctx.strokeStyle = 'rgba(235,226,207,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 13; i++) {
        const a = notch + 0.3 + (i / 13) * (Math.PI * 2 - 0.6);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.1) * R * 0.5, cy + Math.sin(a + 0.1) * R * 0.5, cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
        ctx.stroke();
      }
    }
    // 粉荷
    for (const [x, z] of [[-10.5, 9.5], [14.5, -3.5], [-14, -6]]) {
      const [cx, cy] = at(x, z);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + random() * 0.3;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, 0, -unit * 0.9);
        g.addColorStop(0, 'rgba(236,190,180,0.9)');
        g.addColorStop(1, 'rgba(196,72,64,0.85)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, -unit * 0.45, unit * 0.22, unit * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(214,170,60,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, unit * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    // 边缘渐隐
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.5);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    const pond = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshStandardMaterial({ map: toTexture(canvas), transparent: true, roughness: 1, depthWrite: false }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.y = -0.985;
    pond.receiveShadow = true;
    this.group.add(pond);
  }

  /** 看不见的竹枝，只把影子投在棋盘与水面上。 */
  private buildBamboo(): void {
    const [canvas, ctx] = makeCanvas(512, 512);
    const random = seededRandom(17);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, 500);
    ctx.quadraticCurveTo(200, 300, 470, 40);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) {
      const t = 0.15 + random() * 0.8;
      const bx = 10 + 460 * t;
      const by = 500 - 460 * t - Math.sin(t * Math.PI) * 60;
      const angle = random() * Math.PI * 2;
      const len = 90 + random() * 80;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.35, -14, len, 0);
      ctx.quadraticCurveTo(len * 0.35, 14, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    const texture = toTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, depthWrite: false, transparent: false });
    const spots: [number, number, number, number][] = [[-8.8, 5.5, 3.6, 0.4], [-7.5, 6.5, -1.6, 2.2], [3.2, 7, 7.4, -0.8], [-10, 5, -6, 1.2]];
    for (const [x, y, z, rot] of spots) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 6.5), material);
      mesh.position.set(x, y, z);
      const base = new THREE.Euler(-Math.PI / 2 + 0.2, 0, rot);
      mesh.rotation.copy(base);
      mesh.castShadow = true;
      this.bamboo.push({ mesh, base, phase: random() * 10 });
      this.group.add(mesh);
    }
  }

  private buildMountains(): void {
    const specs = [
      { radius: 120, height: 0.62, ridge: 1.3, dark: 0.32, peaks: 3, y: 4, h: 70, seed: 21 },
      { radius: 92, height: 0.5, ridge: 1.1, dark: 0.48, peaks: 5, y: 1, h: 50, seed: 22 },
      { radius: 68, height: 0.38, ridge: 0.9, dark: 0.7, peaks: 8, y: -1, h: 32, seed: 23, trees: true },
    ];
    for (const spec of specs) {
      const texture = mountainPanorama(spec.seed, spec);
      texture.repeat.x = 1;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.radius, spec.radius, spec.h, 96, 1, true),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.BackSide, depthWrite: false, fog: true }),
      );
      mesh.position.y = spec.y + spec.h / 2 - 8;
      mesh.rotation.y = spec.seed;
      mesh.renderOrder = -10 + spec.seed - 21;
      this.layers.push(mesh);
      this.group.add(mesh);
    }
  }

  private buildSun(): void {
    const [canvas, ctx] = makeCanvas(256, 256);
    const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(196,58,40,0.92)');
    g.addColorStop(0.75, 'rgba(196,58,40,0.85)');
    g.addColorStop(1, 'rgba(196,58,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.fill();
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(canvas), transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
    sun.scale.setScalar(13);
    sun.position.set(-38, 26, -105);
    sun.renderOrder = -20;
    this.group.add(sun);
  }

  private buildMist(count: number): void {
    const random = seededRandom(5);
    const texture = mistTexture();
    for (let i = 0; i < count; i++) {
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.5, fog: false, color: 0xf6f1e4 });
      const sprite = new THREE.Sprite(material);
      const near = i < count * 0.4;
      const angle = random() * Math.PI * 2;
      const radius = near ? 9 + random() * 8 : 25 + random() * 50;
      sprite.position.set(Math.cos(angle) * radius, near ? -0.6 + random() * 0.8 : -2 + random() * 8, Math.sin(angle) * radius);
      const s = near ? 8 + random() * 6 : 30 + random() * 30;
      sprite.scale.set(s, s * 0.5, 1);
      this.mists.push({ sprite, speed: (random() - 0.5) * 0.04, base: material.opacity * (near ? 0.75 : 1), phase: random() * 10 });
      this.group.add(sprite);
    }
  }

  private buildPetals(count: number): void {
    const random = seededRandom(9);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([(random() - 0.5) * 30, random() * 14, (random() - 0.5) * 30], i * 3);
      const pink = random() < 0.7;
      const c = new THREE.Color(pink ? 0xe7a3a0 : 0xf7efe6).lerp(new THREE.Color(0xc73a32), pink ? random() * 0.35 : 0);
      colors.set([c.r, c.g, c.b], i * 3);
      this.petalData.push({ velocity: new THREE.Vector3(0.3 + random() * 0.4, -(0.35 + random() * 0.4), (random() - 0.5) * 0.2), phase: random() * 10 });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.petals = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.22, map: petalTexture(), vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9, sizeAttenuation: true }),
    );
    this.group.add(this.petals);
  }

  private buildCranes(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0x1c1915, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.quadraticCurveTo(0.8, 0.35, 1.9, 0.1);
    wingShape.quadraticCurveTo(1.0, -0.05, 0, -0.2);
    const wingGeometry = new THREE.ShapeGeometry(wingShape);
    const bodyGeometry = new THREE.CapsuleGeometry(0.1, 1.2, 4, 8);
    for (let i = 0; i < 5; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, material);
      body.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xb02a1f }));
      head.position.z = -0.85;
      const left = new THREE.Mesh(wingGeometry, material);
      const right = new THREE.Mesh(wingGeometry, material);
      right.scale.x = -1;
      left.rotation.order = right.rotation.order = 'ZXY';
      left.rotation.x = right.rotation.x = -Math.PI / 2;
      group.add(body, head, left, right);
      group.scale.setScalar(0.9);
      this.cranes.push({ group, wings: [left, right], speed: 0.05 + i * 0.004, phase: i * 0.9, angle: 2.2 + i * 0.09, radius: 42 + (i % 2) * 3 + i * 1.5, height: 15 + Math.sin(i) * 2 });
      this.group.add(group);
    }
  }

  /** 让落梅一阵骤起（终局等场合）。 */
  gust(strength = 1): void {
    this.petalBurst = Math.max(this.petalBurst, strength);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const t = this.time;
    const burst = this.petalBurst;
    // 偶尔一阵风：竹影摇得更急，落梅更斜
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 9 + Math.random() * 14;
      this.gust(0.5 + Math.random() * 0.5);
    }
    this.wind = 1 + burst * 2.5;
    // 竹影随风摇曳
    for (const b of this.bamboo) {
      const sway = Math.sin(t * 0.9 + b.phase) * 0.05 + Math.sin(t * 2.3 + b.phase * 2) * 0.015 * this.wind * (1 + burst);
      b.mesh.rotation.set(b.base.x + sway * 0.5, b.base.y, b.base.z + sway);
    }
    // 远山极缓慢地漂移，与镜头位移叠加形成视差
    this.layers.forEach((layer, i) => (layer.rotation.y += dt * 0.002 * (i + 1)));
    for (const mist of this.mists) {
      const p = mist.sprite.position;
      const angle = Math.atan2(p.z, p.x) + mist.speed * dt;
      const r = Math.hypot(p.x, p.z);
      p.x = Math.cos(angle) * r;
      p.z = Math.sin(angle) * r;
      mist.sprite.material.opacity = mist.base * (0.7 + Math.sin(t * 0.25 + mist.phase) * 0.3);
    }
    // 落梅

    this.petalBurst = Math.max(0, this.petalBurst - dt * 0.4);
    const positions = this.petals.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.petalData.length; i++) {
      const d = this.petalData[i];
      let x = positions.getX(i) + (d.velocity.x * this.wind * (1 + burst * 4) + Math.sin(t * 1.3 + d.phase) * 0.25) * dt;
      let y = positions.getY(i) + d.velocity.y * dt * (1 + burst);
      let z = positions.getZ(i) + (d.velocity.z + Math.cos(t * 0.9 + d.phase) * 0.2) * dt;
      if (y < -0.9 || x > 16) {
        x = -16 + Math.random() * 8;
        y = 8 + Math.random() * 7;
        z = (Math.random() - 0.5) * 30;
      }
      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;
    // 飞鹤盘旋
    for (const crane of this.cranes) {
      crane.angle += crane.speed * dt;
      const x = Math.cos(crane.angle) * crane.radius;
      const z = Math.sin(crane.angle) * crane.radius;
      const y = crane.height + Math.sin(t * 0.5 + crane.phase) * 1.2;
      crane.group.position.set(x, y, z);
      crane.group.lookAt(x - Math.sin(crane.angle) * 10, y, z + Math.cos(crane.angle) * 10);
      crane.group.rotateY(Math.PI);
      const flap = Math.sin(t * 3.2 + crane.phase) * 0.55;
      crane.wings[0].rotation.z = flap;
      crane.wings[1].rotation.z = -flap;
    }
    void camera;
  }
}
