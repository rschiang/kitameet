/**
 * three.js 場景容器：負責相機、控制、量體的建立與視圖模式切換。
 * 資料如何產生不在此處；本模組只認得 {@link Feature}。
 */
import {
  Mesh,
  type Material,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Plane,
  Scene,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  Group,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Feature, LayerId } from "../data/schema.ts";
import {
  AERIAL_HIDDEN_LAYERS,
  AERIAL_PLATE_Y,
  AERIAL_SQUASH,
  LEVEL_ORDER,
  VIEW_TRANSITION_MS,
  type ViewMode,
} from "../app/viewMode.ts";
import {
  addGhostPasses,
  buildFeatureMesh,
  disposeMesh,
  meshGroupKey,
  mergeMeshes,
  type FeatureUserData,
  type GhostPasses,
} from "./builders.ts";
import {
  BACKGROUND_COLOR,
  FADE_BYTES,
  FADE_MAP,
  FADE_MAP_CAPACITY,
  setupLighting,
} from "./materials.ts";
import {
  buildOcclusionIndex,
  findObstructing,
  type OcclusionIndex,
} from "./occlusion.ts";

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export const DEFAULT_CAMERA: CameraState = {
  position: [330, 250, 430],
  target: [0, -10, 30],
  zoom: 1,
};

/** 空拍模式切回 3D 的極角門檻（度）。 */
const POLAR_EXIT_THRESHOLD = 2;

/** 遮蔽建物淡入淡出的長度（毫秒）。 */
const GHOST_FADE_MS = 200;
/** 建物不再遮蔽後維持半透明的時間（毫秒），避免在判定邊界來回閃爍。 */
const GHOST_HOLD_MS = 250;

/** 正投影視錐的半高（公尺），同時用於與透視距離互換。 */
const ORTHO_HALF_HEIGHT = 620;

/** 正投影縮放上下限：下限的視野半高 4,133 公尺可一次看全涵蓋範圍，上限約當半高 15 公尺。 */
const ORTHO_MIN_ZOOM = 0.15;
const ORTHO_MAX_ZOOM = 40;
const PERSPECTIVE_FOV = 50;
const TAN_HALF_FOV = Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);

/** 空拍模式正投影相機與目標的固定距離；正投影下只影響裁切，不影響比例。 */
const AERIAL_CAMERA_DISTANCE = 1200;

/** 回到 3D 時的最小極角，避免正俯視造成 OrbitControls 的方位角失效。 */
const MIN_PERSPECTIVE_POLAR = 0.05;

/** 預設視點的方向，供從未進過 3D 模式的狀態回退使用。 */
const DEFAULT_DIRECTION = (() => {
  const [px, py, pz] = DEFAULT_CAMERA.position;
  const [tx, ty, tz] = DEFAULT_CAMERA.target;
  const dx = px - tx;
  const dy = py - ty;
  const dz = pz - tz;
  const length = Math.hypot(dx, dy, dz);
  return { azimuth: Math.atan2(dx, dz), polar: Math.acos(dy / length) };
})();

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** easeInOutQuad：轉場兩端慢、中段快。 */
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export class Viewer {
  readonly scene = new Scene();
  readonly meshes = new Map<string, Mesh>();

  private readonly renderer: WebGLRenderer;
  private readonly perspective: PerspectiveCamera;
  private readonly orthographic: OrthographicCamera;
  private readonly perspectiveControls: OrbitControls;
  private readonly orthographicControls: OrbitControls;
  private readonly featureGroup = new Group();
  private readonly clipPlane = new Plane(new Vector3(0, 0, 1), 0);

  private mode: ViewMode = "3d";
  private clipping = false;
  private needsRender = true;
  private layerFilter: (data: FeatureUserData) => boolean = () => true;

  /** 視圖轉場進度：0 為 3D 真實高程，1 為空拍分層薄板。 */
  private morph = 0;
  private morphFrom = 0;
  private morphTo = 0;
  private morphStart = 0;
  /** 切往空拍時，將正投影相機由使用者當下的方向轉為正俯視。 */
  private cameraTween?: { azimuth: number; polar: number; start: number };
  /** 切往空拍前的視線方向，供切回 3D 時還原。 */
  private restoreDirection?: { azimuth: number; polar: number };
  private readonly ghosts = new Map<Mesh, GhostPasses>();
  private occlusion?: OcclusionIndex;
  private obstructing = new Uint8Array(0);
  private wasObstructing = new Uint8Array(0);
  private ghostFade = new Float32Array(0);
  private releaseAt = new Float64Array(0);
  private occlusionDirty = true;
  private ghostActive = false;
  private ghostClock = performance.now();

  /** 空拍模式被拖曳旋轉時呼叫，由 app 層決定如何切回 3D。 */
  onAerialRotate?: () => void;
  onCameraChange?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.scene.background = BACKGROUND_COLOR;
    this.scene.add(this.featureGroup);
    setupLighting(this.scene);

    // 地面由涵蓋範圍的地塊量體承擔，場景不另設平面
    this.perspective = new PerspectiveCamera(PERSPECTIVE_FOV, 1, 1, 12000);
    this.orthographic = new OrthographicCamera(-500, 500, 500, -500, -2000, 4000);

    this.perspectiveControls = new OrbitControls(this.perspective, canvas);
    this.perspectiveControls.enableDamping = true;
    this.perspectiveControls.dampingFactor = 0.08;
    this.perspectiveControls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.perspectiveControls.minDistance = 40;
    // 涵蓋範圍東西向約 4.3 公里，拉遠到此距離才看得全
    this.perspectiveControls.maxDistance = 5000;

    this.orthographicControls = new OrbitControls(this.orthographic, canvas);
    this.orthographicControls.enableDamping = false;
    this.orthographicControls.enabled = false;
    // OrbitControls 的 minZoom 預設為 0，不設上下限時滾輪可把畫面縮到空白
    this.orthographicControls.minZoom = ORTHO_MIN_ZOOM;
    this.orthographicControls.maxZoom = ORTHO_MAX_ZOOM;

    for (const controls of [this.perspectiveControls, this.orthographicControls]) {
      controls.addEventListener("change", () => {
        this.needsRender = true;
        this.occlusionDirty = true;
        this.onCameraChange?.();
      });
    }
    this.orthographicControls.addEventListener("change", () => {
      // 轉場自己會把相機由傾角轉正，別把它當成使用者拖曳
      if (this.cameraTween) return;
      if (this.mode !== "aerial") return;
      const offset = this.orthographic.position.clone().sub(this.orthographicControls.target);
      const polar = (Math.atan2(Math.hypot(offset.x, offset.z), offset.y) * 180) / Math.PI;
      if (polar > POLAR_EXIT_THRESHOLD) this.onAerialRotate?.();
    });

    this.applyCameraState(DEFAULT_CAMERA);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.mode === "aerial" ? this.orthographic : this.perspective;
  }

  private get controls(): OrbitControls {
    return this.mode === "aerial" ? this.orthographicControls : this.perspectiveControls;
  }

  /**
   * 重建所有量體；提案切換時整批替換。
   *
   * 外觀與擺放方式相同的量體併為單一 mesh：涵蓋範圍內有上萬項量體，
   * 逐項一個 mesh 時繪製呼叫的數量本身就使畫面低於 30 fps。
   * 分組鍵涵蓋 {@link applyMorph} 與材質會用到的每一項（圖層、樓層、類型、方案狀態、
   * 顏色、不透明度、底面高程與繪製旗標），因此分組不改變任何呈現行為。
   */
  setFeatures(features: Feature[]): void {
    for (const mesh of this.meshes.values()) {
      this.featureGroup.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes.clear();
    this.ghosts.clear();

    const occlusion = buildOcclusionIndex(features);
    if (occlusion.unitCount > FADE_MAP_CAPACITY) {
      throw new Error(
        `淡化單元共 ${occlusion.unitCount} 個，超出淡化貼圖的容量 ${FADE_MAP_CAPACITY}`,
      );
    }
    this.occlusion = occlusion;
    this.obstructing = new Uint8Array(occlusion.unitCount);
    this.wasObstructing = new Uint8Array(occlusion.unitCount);
    this.ghostFade = new Float32Array(occlusion.unitCount);
    this.releaseAt = new Float64Array(occlusion.unitCount);

    const groups = new Map<string, Mesh[]>();
    for (const feature of features) {
      const mesh = buildFeatureMesh(feature, occlusion.units.get(feature));
      if (!mesh) continue;
      const key = meshGroupKey(mesh);
      const list = groups.get(key);
      if (list) list.push(mesh);
      else groups.set(key, [mesh]);
    }

    for (const [key, group] of groups) {
      const merged = mergeMeshes(key, group);
      this.meshes.set(key, merged);
      this.featureGroup.add(merged);
      const ghost = addGhostPasses(merged);
      if (ghost) this.ghosts.set(merged, ghost);
    }
    this.applyMorph();
    this.applyClipping();
    this.settleOcclusion();
    this.needsRender = true;
  }

  /** 設定圖層可見性判斷；與視圖模式無關，空拍隱藏的圖層由轉場淡出處理。 */
  setLayerFilter(predicate: (data: FeatureUserData) => boolean): void {
    this.layerFilter = predicate;
    this.occlusionDirty = true;
    this.applyMorph();
    this.needsRender = true;
  }

  setViewMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    const camera = this.camera;
    const target = this.controls.target.clone();
    const offset = camera.position.clone().sub(target);
    const distance = Math.max(offset.length(), 1);
    const dir = offset.divideScalar(distance);
    const azimuth = Math.atan2(dir.x, dir.z);
    const polar = Math.acos(clamp(dir.y, -1, 1));

    this.mode = mode;
    this.perspectiveControls.enabled = mode === "3d";
    this.orthographicControls.enabled = mode === "aerial";

    if (mode === "aerial") {
      // 記下使用者當下的視線方向，切回 3D 時還原
      this.restoreDirection = { azimuth, polar };
      this.orthographic.zoom = clamp(
        ORTHO_HALF_HEIGHT / (distance * TAN_HALF_FOV),
        ORTHO_MIN_ZOOM,
        ORTHO_MAX_ZOOM,
      );
      this.orthographic.position.copy(target).addScaledVector(dir, AERIAL_CAMERA_DISTANCE);
      this.cameraTween = { azimuth, polar, start: performance.now() };
    } else {
      this.cameraTween = undefined;
      // 使用者在空拍模式拖出傾角時沿用該角度，否則還原切換前的方向
      const dragged = polar > MIN_PERSPECTIVE_POLAR;
      const restore = this.restoreDirection ?? DEFAULT_DIRECTION;
      const nextAzimuth = dragged ? azimuth : restore.azimuth;
      const nextPolar = Math.max(dragged ? polar : restore.polar, MIN_PERSPECTIVE_POLAR);
      const d = clamp(
        ORTHO_HALF_HEIGHT / (Math.max(this.orthographic.zoom, ORTHO_MIN_ZOOM) * TAN_HALF_FOV),
        this.perspectiveControls.minDistance,
        this.perspectiveControls.maxDistance,
      );
      const sin = Math.sin(nextPolar);
      this.perspective.position.set(
        target.x + sin * Math.sin(nextAzimuth) * d,
        target.y + Math.cos(nextPolar) * d,
        target.z + sin * Math.cos(nextAzimuth) * d,
      );
      this.perspective.zoom = 1;
    }

    const controls = this.controls;
    controls.target.copy(target);
    this.camera.updateProjectionMatrix();
    controls.update();
    this.startMorph(mode === "aerial" ? 1 : 0);
    this.resize();
    this.occlusionDirty = true;
  }

  private startMorph(to: number): void {
    this.morphFrom = this.morph;
    this.morphTo = to;
    this.morphStart = performance.now();
    this.needsRender = true;
  }

  /** 立即收斂目前的轉場；由網址還原狀態時不該殘留動畫。 */
  settle(): void {
    this.morph = this.morphTo;
    this.cameraTween = undefined;
    this.applyMorph();
    this.settleOcclusion();
    this.needsRender = true;
  }

  /**
   * 依轉場進度 `morph` 擺放量體：0 為真實高程與不透明度，
   * 1 為壓成薄板、依樓層分層排列的半透明空拍樣貌。
   */
  private applyMorph(): void {
    const t = this.morph;
    const squash = 1 + (AERIAL_SQUASH - 1) * t;
    for (const mesh of this.meshes.values()) {
      const data = mesh.userData as FeatureUserData;
      const fade = AERIAL_HIDDEN_LAYERS[data.layer] ? 1 - t : 1;
      mesh.visible = this.layerFilter(data) && fade > 0.001;
      if (!mesh.visible) continue;
      mesh.scale.y = squash;
      mesh.position.y = data.base + (AERIAL_PLATE_Y[data.level] - data.base) * t - data.base * squash;
      mesh.renderOrder = t > 0 ? LEVEL_ORDER[data.level] : 0;
      mesh.castShadow = t < 0.5 && (data.layer === "building" || data.layer === "landmark");
      const material = mesh.material as MeshStandardMaterial;
      const baseOpacity = (material.userData.baseOpacity as number) ?? 1;
      const aerialOpacity = Math.min(baseOpacity, data.status === "removed" ? 0.3 : 0.72);
      const opacity = (baseOpacity + (aerialOpacity - baseOpacity) * t) * fade;
      material.opacity = opacity;
      const ghost = this.ghosts.get(mesh);
      if (ghost) (ghost.veil.material as MeshStandardMaterial).opacity = opacity;
      const transparent = opacity < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.depthWrite = !transparent;
        // 僅在旗標改變時重編譯，避免每幀全場重建材質
        material.needsUpdate = true;
      }
    }
  }

  /** 剖面：單一平面切除，`bearing` 為自正東起算的度數。 */
  setSection(enabled: boolean, bearing: number, offset: number): void {
    this.clipping = enabled;
    const rad = (bearing * Math.PI) / 180;
    // 局部座標法線 (cos, sin) 轉場景座標 (x, −z)
    this.clipPlane.normal.set(Math.cos(rad), 0, -Math.sin(rad)).normalize();
    this.clipPlane.constant = -offset;
    this.occlusionDirty = true;
    this.applyClipping();
    this.needsRender = true;
  }

  private applyClipping(): void {
    const planes = this.clipping ? [this.clipPlane] : [];
    const materials: Material[] = [];
    for (const mesh of this.meshes.values()) {
      materials.push(mesh.material as Material);
      const ghost = this.ghosts.get(mesh);
      if (ghost) materials.push(ghost.prepass.material as Material, ghost.veil.material as Material);
    }
    for (const material of materials) {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
  }

  cameraState(): CameraState {
    const camera = this.camera;
    const target = this.controls.target;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.x, target.y, target.z],
      zoom: camera.zoom,
    };
  }

  /**
   * 套用相機狀態。空拍模式一律將視點拉回目標正上方，
   * 避免網址帶入非俯視的視點後立刻觸發切回 3D 的判斷。
   */
  applyCameraState(state: CameraState): void {
    const camera = this.camera;
    const [tx, ty, tz] = state.target;
    if (this.mode === "aerial") {
      const distance = Math.hypot(
        state.position[0] - tx,
        state.position[1] - ty,
        state.position[2] - tz,
      );
      camera.position.set(tx, ty + (distance || 600), tz);
    } else {
      camera.position.set(...state.position);
    }
    camera.zoom = state.zoom > 0 ? state.zoom : 1;
    camera.updateProjectionMatrix();
    this.controls.target.set(tx, ty, tz);
    this.controls.update();
    this.occlusionDirty = true;
    this.needsRender = true;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();

    const aspect = width / height;
    this.orthographic.left = -ORTHO_HALF_HEIGHT * aspect;
    this.orthographic.right = ORTHO_HALF_HEIGHT * aspect;
    this.orthographic.top = ORTHO_HALF_HEIGHT;
    this.orthographic.bottom = -ORTHO_HALF_HEIGHT;
    this.orthographic.updateProjectionMatrix();
    this.occlusionDirty = true;
    this.needsRender = true;
  }

  /** 推進量體漸變與相機轉向；兩者共用 {@link VIEW_TRANSITION_MS}。 */
  private updateTransitions(): void {
    const now = performance.now();
    if (this.morph !== this.morphTo) {
      const u = Math.min(1, (now - this.morphStart) / VIEW_TRANSITION_MS);
      this.morph = u >= 1 ? this.morphTo : this.morphFrom + (this.morphTo - this.morphFrom) * ease(u);
      this.applyMorph();
      this.needsRender = true;
    }
    const tween = this.cameraTween;
    if (tween) {
      const u = Math.min(1, (now - tween.start) / VIEW_TRANSITION_MS);
      const polar = tween.polar * (1 - ease(u));
      const sin = Math.sin(polar);
      const target = this.orthographicControls.target;
      this.orthographic.position.set(
        target.x + sin * Math.sin(tween.azimuth) * AERIAL_CAMERA_DISTANCE,
        target.y + Math.cos(polar) * AERIAL_CAMERA_DISTANCE,
        target.z + sin * Math.cos(tween.azimuth) * AERIAL_CAMERA_DISTANCE,
      );
      this.orthographicControls.update();
      if (u >= 1) this.cameraTween = undefined;
      this.needsRender = true;
    }
  }

  /** 依目前的相機、圖層開關與剖面重新判定遮蔽；空拍模式不淡化。 */
  private computeObstructing(): void {
    const index = this.occlusion;
    if (!index) return;
    if (this.mode !== "3d") {
      this.obstructing.fill(0);
      return;
    }
    const visible = new Set<LayerId>();
    for (const mesh of this.meshes.values()) {
      if (mesh.visible) visible.add((mesh.userData as FeatureUserData).layer);
    }
    findObstructing(
      index,
      this.perspective,
      {
        layerVisible: (layer) => visible.has(layer),
        clipPlane: this.clipping ? this.clipPlane : null,
      },
      this.obstructing,
    );
  }

  private syncGhostVisibility(): void {
    for (const ghost of this.ghosts.values()) {
      const active = ghost.units.some((unit) => FADE_BYTES[unit] > 0);
      ghost.prepass.visible = active;
      ghost.veil.visible = active;
    }
  }

  /** 立即套用遮蔽判定的結果，不留淡入淡出；用於重建場景與由網址還原狀態。 */
  private settleOcclusion(): void {
    this.computeObstructing();
    for (let unit = 0; unit < this.obstructing.length; unit++) {
      const on = this.obstructing[unit] === 1;
      this.ghostFade[unit] = on ? 1 : 0;
      FADE_BYTES[unit] = on ? 255 : 0;
    }
    this.releaseAt.fill(0);
    FADE_MAP.value.needsUpdate = true;
    this.syncGhostVisibility();
    this.occlusionDirty = false;
    this.ghostActive = false;
    this.needsRender = true;
  }

  /** 視角改變時重新判定遮蔽，並逐幀推進各單元的淡化程度。 */
  private updateOcclusion(): void {
    const now = performance.now();
    const elapsed = Math.min(now - this.ghostClock, 100);
    this.ghostClock = now;
    if (!this.occlusion) return;

    const count = this.obstructing.length;
    if (this.occlusionDirty) {
      this.occlusionDirty = false;
      this.wasObstructing.set(this.obstructing);
      this.computeObstructing();
      for (let unit = 0; unit < count; unit++) {
        if (this.wasObstructing[unit] && !this.obstructing[unit]) {
          this.releaseAt[unit] = now + GHOST_HOLD_MS;
        }
      }
      this.ghostActive = true;
    }
    if (!this.ghostActive) return;

    const step = elapsed / GHOST_FADE_MS;
    let active = false;
    let changed = false;
    for (let unit = 0; unit < count; unit++) {
      const held = !this.obstructing[unit] && now < this.releaseAt[unit];
      const target = this.obstructing[unit] || held ? 1 : 0;
      let fade = this.ghostFade[unit];
      if (fade !== target) {
        fade = target > fade ? Math.min(1, fade + step) : Math.max(0, fade - step);
        this.ghostFade[unit] = fade;
        // 淡化中的單元至少寫入 1：著色器以 0 與非 0 區分實心與淡化兩道繪製
        const byte = fade <= 0 ? 0 : Math.max(1, Math.round(ease(fade) * 255));
        if (FADE_BYTES[unit] !== byte) {
          FADE_BYTES[unit] = byte;
          changed = true;
        }
      }
      if (fade !== target || held) active = true;
    }
    this.ghostActive = active;
    if (changed) {
      FADE_MAP.value.needsUpdate = true;
      this.syncGhostVisibility();
      this.needsRender = true;
    }
  }

  private tick(): void {
    this.updateTransitions();
    if (this.perspectiveControls.enabled) this.perspectiveControls.update();
    this.updateOcclusion();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
