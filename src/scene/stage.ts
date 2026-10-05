// 渲染舞台：渲染器、镜头运镜、灯光、水墨后期。

import * as THREE from 'three';
import gsap from 'gsap';

const INK_POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const INK_POST_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float time;
uniform float edgeStrength;
uniform float grain;
uniform float flash;
uniform float redPulse;
uniform float desaturate;
uniform float inkFade;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

float linearDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
uniform float exposure;
vec3 aces(vec3 x) { x *= exposure; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 display(vec2 uv) { return toSRGB(aces(texture2D(tColor, uv).rgb)); }

void main() {
  vec2 texel = 1.0 / resolution;
  // 手绘般的轻微抖动
  vec2 wobble = (vec2(noise(vUv * 9.0 + time * 0.07), noise(vUv * 9.0 + 7.3 - time * 0.05)) - 0.5) * 0.0016;
  vec2 uv = vUv + wobble;
  vec3 color = display(uv);

  // 墨线：深度 + 亮度边缘
  float d0 = linearDepth(uv);
  float dl = linearDepth(uv - vec2(texel.x, 0.0));
  float dr = linearDepth(uv + vec2(texel.x, 0.0));
  float du = linearDepth(uv + vec2(0.0, texel.y));
  float dd = linearDepth(uv - vec2(0.0, texel.y));
  float depthEdge = (abs(dl - d0) + abs(dr - d0) + abs(du - d0) + abs(dd - d0)) / max(d0, 0.001);
  float l00 = luma(display(uv + texel * vec2(-1.0, -1.0)));
  float l10 = luma(display(uv + texel * vec2(0.0, -1.0)));
  float l20 = luma(display(uv + texel * vec2(1.0, -1.0)));
  float l01 = luma(display(uv + texel * vec2(-1.0, 0.0)));
  float l21 = luma(display(uv + texel * vec2(1.0, 0.0)));
  float l02 = luma(display(uv + texel * vec2(-1.0, 1.0)));
  float l12 = luma(display(uv + texel * vec2(0.0, 1.0)));
  float l22 = luma(display(uv + texel * vec2(1.0, 1.0)));
  float gx = -l00 - 2.0 * l01 - l02 + l20 + 2.0 * l21 + l22;
  float gy = -l00 - 2.0 * l10 - l20 + l02 + 2.0 * l12 + l22;
  float lumEdge = length(vec2(gx, gy));
  float brush = 0.65 + 0.7 * fbm(vUv * vec2(60.0, 60.0));
  float edge = (smoothstep(0.035, 0.12, depthEdge) * 0.9 + smoothstep(0.22, 0.6, lumEdge) * 0.35) * brush * edgeStrength;
  edge *= smoothstep(260.0, 30.0, d0);
  vec3 ink = vec3(0.11, 0.098, 0.082);
  color = mix(color, ink, clamp(edge, 0.0, 0.85));

  // 水墨色调：适度去饱和、偏暖
  float l = luma(color);
  color = mix(vec3(l), color, 0.82 - desaturate * 0.75);
  color *= vec3(1.02, 1.0, 0.95);

  // 宣纸纤维与颗粒
  float paper = fbm(vUv * resolution / 180.0) * 0.06 + (hash(floor(vUv * resolution)) - 0.5) * grain;
  color *= 1.0 - paper * 0.6;

  // 暗角（墨色晕边）
  vec2 c = vUv - 0.5;
  float vig = smoothstep(0.95, 0.25, length(c * vec2(1.1, 1.25)) + fbm(vUv * 3.0 + time * 0.02) * 0.12);
  color = mix(color * vec3(0.72, 0.68, 0.62), color, vig);

  // 将军时的朱砂暗角
  float redEdge = smoothstep(0.35, 0.9, length(c * vec2(1.0, 1.15)) + fbm(vUv * 4.0 + time * 0.3) * 0.2);
  color = mix(color, vec3(0.62, 0.12, 0.08), redEdge * redPulse * 0.55);

  // 翻面闪白
  color = mix(color, vec3(1.0, 0.98, 0.92), flash);

  // 墨染转场
  float inkMask = smoothstep(inkFade - 0.15, inkFade, fbm(vUv * 5.0) * 0.6 + length(c) * 0.9);
  color = mix(ink, color, inkFade >= 1.5 ? 1.0 : inkMask);

  gl_FragColor = vec4(color, 1.0);
}`;

export interface CameraRig {
  yaw: number;
  pitch: number;
  distance: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig = { yaw: 0, pitch: 0.98, distance: 19, targetX: 0, targetY: 0, targetZ: 0.4 };
  readonly sun: THREE.DirectionalLight;
  readonly postUniforms: Record<string, THREE.IUniform>;
  /** 右侧面板占用的像素宽度，用于把棋盘居中到剩余区域。 */
  sideInset = 0;
  quality = 1;
  sway = 1;
  private target!: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly listeners: ((dt: number, time: number) => void)[] = [];
  private readonly timer = new THREE.Timer();
  private time = 0;
  private shakeAmount = 0;
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private distanceScale = 1;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
    this.scene.fog = new THREE.Fog(0xe9e0cc, 45, 135);
    this.scene.add(this.buildSky());

    const hemi = new THREE.HemisphereLight(0xfff6e6, 0x7d7262, 1.45);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
    this.sun.position.set(-7, 16, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -11;
    s.right = 11;
    s.top = 11;
    s.bottom = -11;
    s.near = 1;
    s.far = 50;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 5;
    this.scene.add(this.sun);

    this.postUniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      cameraNear: { value: this.camera.near },
      cameraFar: { value: this.camera.far },
      time: { value: 0 },
      edgeStrength: { value: 1 },
      grain: { value: 0.05 },
      flash: { value: 0 },
      redPulse: { value: 0 },
      desaturate: { value: 0 },
      inkFade: { value: 2 },
      exposure: { value: 0.93 },
    };
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.postUniforms, vertexShader: INK_POST_VERTEX, fragmentShader: INK_POST_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.postScene.add(quad);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private buildSky(): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `varying vec3 vDir;
        float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
        void main(){
          float h = vDir.y;
          vec3 top = vec3(0.93,0.90,0.83);
          vec3 horizon = vec3(0.95,0.91,0.82);
          vec3 low = vec3(0.90,0.86,0.77);
          vec3 c = mix(horizon, top, smoothstep(0.0,0.6,h));
          c = mix(low, c, smoothstep(-0.2,0.05,h));
          float a = atan(vDir.z, vDir.x);
          float cloud = noise(vec2(a*6.0, h*14.0)) * noise(vec2(a*13.0, h*5.0));
          c -= cloud * 0.05 * smoothstep(0.05, 0.35, h);
          gl_FragColor = vec4(c,1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
    sky.renderOrder = -100;
    return sky;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, this.quality > 0 ? 2 : 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 让棋盘居中于右侧面板之外的区域
    if (this.sideInset !== 0) this.camera.setViewOffset(w, h, this.sideInset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    // 根据可用宽度调整距离
    const usable = (w - Math.abs(this.sideInset)) / h;
    this.distanceScale = Math.max(1, 1.62 / usable);
    this.target?.dispose();
    const depthTexture = new THREE.DepthTexture(w * pixelRatio, h * pixelRatio);
    this.target = new THREE.WebGLRenderTarget(w * pixelRatio, h * pixelRatio, {
      samples: this.quality > 0 ? 4 : 0,
      depthTexture,
      type: THREE.HalfFloatType,
    });
    this.postUniforms.resolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  setSideInset(px: number): void {
    this.sideInset = px;
    this.resize();
  }

  setQuality(quality: number): void {
    this.quality = quality;
    this.renderer.shadowMap.enabled = true;
    this.sun.shadow.mapSize.set(quality > 0 ? 2048 : 1024, quality > 0 ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.resize();
  }

  onFrame(listener: (dt: number, time: number) => void): void {
    this.listeners.push(listener);
  }

  shake(amount = 0.25): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  flash(amount = 0.35, duration = 0.5): void {
    gsap.fromTo(this.postUniforms.flash, { value: amount }, { value: 0, duration, ease: 'power2.out' });
  }

  pulseRed(): void {
    gsap.fromTo(this.postUniforms.redPulse, { value: 1 }, { value: 0, duration: 1.6, ease: 'power2.out' });
  }

  /** 墨染转场：1 → 被墨覆盖；返回 Promise。 */
  inkTransition(cover: boolean, duration = 0.9): Promise<void> {
    return new Promise((resolve) => {
      gsap.fromTo(
        this.postUniforms.inkFade,
        { value: cover ? 1.5 : -0.2 },
        { value: cover ? -0.2 : 1.5, duration, ease: cover ? 'power2.in' : 'power2.out', onComplete: () => {
          if (!cover) this.postUniforms.inkFade.value = 2;
          resolve();
        } },
      );
    });
  }

  /** 把屏幕坐标投射到棋盘平面（y = height）。 */
  pick(clientX: number, clientY: number, height = 0): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, point);
  }

  /** 世界坐标 → 屏幕像素。 */
  project(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  private updateCamera(): void {
    const r = this.rig;
    const t = this.time;
    this.pointerSmooth.lerp(this.pointer, 0.04);
    const sway = this.sway;
    const yaw = r.yaw + Math.sin(t * 0.13) * 0.025 * sway + this.pointerSmooth.x * 0.035 * sway;
    const pitch = r.pitch + Math.sin(t * 0.17 + 1) * 0.012 * sway + this.pointerSmooth.y * 0.02 * sway;
    const distance = r.distance * this.distanceScale;
    const target = new THREE.Vector3(r.targetX, r.targetY, r.targetZ);
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    if (this.shakeAmount > 0.001) {
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shakeAmount, (Math.random() - 0.5) * this.shakeAmount, (Math.random() - 0.5) * this.shakeAmount));
      this.shakeAmount *= 0.86;
    }
    this.camera.lookAt(target);
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.time += dt;
    for (const listener of this.listeners) listener(dt, this.time);
    this.updateCamera();
    this.postUniforms.time.value = this.time;

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.postUniforms.tColor.value = this.target.texture;
    this.postUniforms.tDepth.value = this.target.depthTexture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}
