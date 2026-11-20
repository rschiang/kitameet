/**
 * three.js 場景容器：負責相機、控制、量體的建立與視圖模式切換。
 * 資料如何產生不在此處；本模組只認得 {@link Feature}。
 */
import {
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Plane,
  Scene,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  Group,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Feature } from "../data/schema.ts";
import { AERIAL_PLATE_Y, AERIAL_SQUASH, LEVEL_ORDER, type ViewMode } from "../app/viewMode.ts";
import { buildFeatureMesh, disposeMesh, type FeatureUserData } from "./builders.ts";
import { BACKGROUND_COLOR, setupLighting } from "./materials.ts";
import { GROUND } from "./palette.ts";

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

export class Viewer {
  readonly scene = new Scene();
  readonly meshes = new Map<string, Mesh>();

  private readonly renderer: WebGLRenderer;
  private readonly perspective: PerspectiveCamera;
  private readonly orthographic: OrthographicCamera;
  private readonly perspectiveControls: OrbitControls;
  private readonly orthographicControls: OrbitControls;
  private readonly featureGroup = new Group();
  private readonly ground: Mesh;
  private readonly clipPlane = new Plane(new Vector3(0, 0, 1), 0);

  private mode: ViewMode = "3d";
  private clipping = false;
  private needsRender = true;
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

    this.perspective = new PerspectiveCamera(50, 1, 1, 6000);
    this.orthographic = new OrthographicCamera(-500, 500, 500, -500, -2000, 4000);

    // 地面以半透明紙面呈現，讓地下結構在 3D 視圖中可見
    this.ground = new Mesh(
      new PlaneGeometry(4000, 4000),
      new MeshStandardMaterial({
        color: GROUND,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.2;
    this.ground.renderOrder = 1;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.perspectiveControls = new OrbitControls(this.perspective, canvas);
    this.perspectiveControls.enableDamping = true;
    this.perspectiveControls.dampingFactor = 0.08;
    this.perspectiveControls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.perspectiveControls.minDistance = 40;
    this.perspectiveControls.maxDistance = 2500;

    this.orthographicControls = new OrbitControls(this.orthographic, canvas);
    this.orthographicControls.enableDamping = false;
    this.orthographicControls.enabled = false;

    for (const controls of [this.perspectiveControls, this.orthographicControls]) {
      controls.addEventListener("change", () => {
        this.needsRender = true;
        this.onCameraChange?.();
      });
    }
    this.orthographicControls.addEventListener("change", () => {
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

  /** 重建所有量體；提案切換時整批替換。 */
  setFeatures(features: Feature[]): void {
    for (const mesh of this.meshes.values()) {
      this.featureGroup.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes.clear();

    for (const feature of features) {
      const mesh = buildFeatureMesh(feature);
      if (!mesh) continue;
      this.meshes.set(feature.id, mesh);
      this.featureGroup.add(mesh);
    }
    this.applyViewMode();
    this.applyClipping();
    this.needsRender = true;
  }

  setViewMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    const state = this.cameraState();
    this.mode = mode;
    this.perspectiveControls.enabled = mode === "3d";
    this.orthographicControls.enabled = mode === "aerial";
    if (mode === "aerial") {
      const distance = Math.hypot(
        state.position[0] - state.target[0],
        state.position[1] - state.target[1],
        state.position[2] - state.target[2],
      );
      this.applyCameraState({
        position: [state.target[0], state.target[1] + distance, state.target[2]],
        target: state.target,
        zoom: state.zoom,
      });
    } else {
      // 回到 3D 時給一個與目前目標一致的斜角視點
      const distance = 900 / Math.max(this.orthographic.zoom, 0.05);
      this.applyCameraState({
        position: [
          state.target[0] + distance * 0.55,
          state.target[1] + distance * 0.5,
          state.target[2] + distance * 0.67,
        ],
        target: state.target,
        zoom: 1,
      });
    }
    this.applyViewMode();
    this.resize();
    this.needsRender = true;
  }

  /**
   * 空拍模式把量體壓成薄板、依樓層分層排列，並轉為半透明，
   * 使深層結構不被淺層完全遮蔽；3D 模式還原實際高程與不透明度。
   */
  private applyViewMode(): void {
    const aerial = this.mode === "aerial";
    this.ground.visible = !aerial;
    for (const mesh of this.meshes.values()) {
      const data = mesh.userData as FeatureUserData;
      const material = mesh.material as MeshStandardMaterial;
      const baseOpacity = (material.userData.baseOpacity as number) ?? 1;
      if (aerial) {
        mesh.scale.y = AERIAL_SQUASH;
        mesh.position.y = AERIAL_PLATE_Y[data.level] - data.base * AERIAL_SQUASH;
        mesh.renderOrder = LEVEL_ORDER[data.level];
        mesh.castShadow = false;
        material.transparent = true;
        material.opacity = Math.min(baseOpacity, data.status === "removed" ? 0.3 : 0.72);
        material.depthWrite = false;
      } else {
        mesh.scale.y = 1;
        mesh.position.y = 0;
        mesh.renderOrder = 0;
        mesh.castShadow = data.layer === "building" || data.layer === "landmark";
        material.transparent = baseOpacity < 1;
        material.opacity = baseOpacity;
        material.depthWrite = baseOpacity >= 1;
      }
      material.needsUpdate = true;
    }
  }

  /** 剖面：單一平面切除，`bearing` 為自正東起算的度數。 */
  setSection(enabled: boolean, bearing: number, offset: number): void {
    this.clipping = enabled;
    const rad = (bearing * Math.PI) / 180;
    // 局部座標法線 (cos, sin) 轉場景座標 (x, −z)
    this.clipPlane.normal.set(Math.cos(rad), 0, -Math.sin(rad)).normalize();
    this.clipPlane.constant = -offset;
    this.applyClipping();
    this.needsRender = true;
  }

  private applyClipping(): void {
    const planes = this.clipping ? [this.clipPlane] : [];
    for (const mesh of this.meshes.values()) {
      const material = mesh.material as MeshStandardMaterial;
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

  applyCameraState(state: CameraState): void {
    const camera = this.camera;
    camera.position.set(...state.position);
    camera.zoom = state.zoom > 0 ? state.zoom : 1;
    camera.updateProjectionMatrix();
    this.controls.target.set(...state.target);
    this.controls.update();
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

    const half = 620;
    const aspect = width / height;
    this.orthographic.left = -half * aspect;
    this.orthographic.right = half * aspect;
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.updateProjectionMatrix();
    this.needsRender = true;
  }

  private tick(): void {
    if (this.perspectiveControls.enabled) this.perspectiveControls.update();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
