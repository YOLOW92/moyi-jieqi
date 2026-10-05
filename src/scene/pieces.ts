import * as THREE from 'three';
import type { Color, Piece } from '../core/rules';
import { controller } from '../core/rules';
import { pieceBackTexture, pieceBlankTexture, pieceFaceTexture } from './textures';

export const PIECE_RADIUS = 0.43;
export const PIECE_HEIGHT = 0.24;

let sharedBody: THREE.LatheGeometry | null = null;
let sharedFace: THREE.CircleGeometry | null = null;
let sharedBand: THREE.TorusGeometry | null = null;

function bodyGeometry(): THREE.LatheGeometry {
  if (sharedBody) return sharedBody;
  const r = PIECE_RADIUS;
  const h = PIECE_HEIGHT / 2;
  const bevel = 0.06;
  const points: THREE.Vector2[] = [];
  points.push(new THREE.Vector2(0, -h));
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    points.push(new THREE.Vector2(r - bevel + Math.cos(a) * bevel, -h + bevel + Math.sin(a) * bevel));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    points.push(new THREE.Vector2(r - bevel + Math.cos(a) * bevel, h - bevel + Math.sin(a) * bevel));
  }
  points.push(new THREE.Vector2(0, h));
  sharedBody = new THREE.LatheGeometry(points, 64);
  return sharedBody;
}

const faceGeometry = () => (sharedFace ??= new THREE.CircleGeometry(PIECE_RADIUS - 0.045, 64));
const bandGeometry = () => (sharedBand ??= new THREE.TorusGeometry(PIECE_RADIUS + 0.002, 0.018, 8, 64));

const BAND_COLOR: Record<Color, number> = { red: 0xb02a1f, black: 0x1c1915 };

/**
 * 一枚 3D 棋子：
 * root（棋盘坐标） → lift（抬起/弹跳） → tilt（倾斜/摇摆） → body（翻面旋转）
 */
export class PieceView {
  readonly root = new THREE.Group();
  readonly lift = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly body = new THREE.Group();
  readonly faceMaterial: THREE.MeshStandardMaterial;
  readonly backMaterial: THREE.MeshStandardMaterial;
  readonly bandMaterial: THREE.MeshStandardMaterial;
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  /** 0..1 外发光（选中、AI 思考） */
  glow = 0;
  revealed = false;
  faceShown: string | null = null;
  controllerColor: Color = 'red';

  constructor(readonly id: number) {
    this.bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf1e7d2, roughness: 0.42, metalness: 0.02, emissive: 0x000000 });
    const mesh = new THREE.Mesh(bodyGeometry(), this.bodyMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.faceMaterial = new THREE.MeshStandardMaterial({ map: pieceBlankTexture(), roughness: 0.55, emissive: 0x000000 });
    const face = new THREE.Mesh(faceGeometry(), this.faceMaterial);
    face.rotation.x = -Math.PI / 2;
    face.position.y = PIECE_HEIGHT / 2 + 0.001;

    this.backMaterial = new THREE.MeshStandardMaterial({ map: pieceBackTexture('red'), roughness: 0.6, emissive: 0x000000 });
    const back = new THREE.Mesh(faceGeometry(), this.backMaterial);
    back.rotation.x = Math.PI / 2;
    back.position.y = -PIECE_HEIGHT / 2 - 0.001;

    this.bandMaterial = new THREE.MeshStandardMaterial({ color: BAND_COLOR.red, roughness: 0.5 });
    const band = new THREE.Mesh(bandGeometry(), this.bandMaterial);
    band.rotation.x = Math.PI / 2;

    this.body.add(mesh, face, back, band);
    this.tilt.add(this.body);
    this.lift.add(this.tilt);
    this.root.add(this.lift);
    this.lift.position.y = PIECE_HEIGHT / 2;
    this.root.userData.pieceId = id;
  }

  /** 直接同步外观（无动画）。 */
  applyState(piece: Piece): void {
    this.revealed = piece.revealed;
    this.setController(controller(piece));
    if (piece.revealed) {
      this.showFace(piece);
      this.body.rotation.set(0, 0, 0);
    } else {
      this.hideFace();
      this.body.rotation.set(Math.PI, 0, 0);
    }
  }

  setController(color: Color): void {
    this.controllerColor = color;
    this.bandMaterial.color.setHex(BAND_COLOR[color]);
    if (!this.revealed) this.backMaterial.map = pieceBackTexture(color);
  }

  showFace(piece: Pick<Piece, 'color' | 'kind'>): void {
    const key = `${piece.color}:${piece.kind}`;
    if (this.faceShown === key) return;
    this.faceShown = key;
    this.faceMaterial.map = pieceFaceTexture(piece.color, piece.kind);
    this.faceMaterial.needsUpdate = true;
  }

  hideFace(): void {
    this.faceShown = null;
    this.faceMaterial.map = pieceBlankTexture();
    this.faceMaterial.needsUpdate = true;
  }

  setGlow(value: number, color = 0xd9a441): void {
    this.glow = value;
    const c = new THREE.Color(color).multiplyScalar(value * 0.45);
    this.bodyMaterial.emissive.copy(c);
    this.faceMaterial.emissive.copy(c);
    this.backMaterial.emissive.copy(c);
  }
}
