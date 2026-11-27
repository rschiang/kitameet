/**
 * 量體建模：多邊形以 ExtrudeGeometry 長出高度，折線以中心線兩側平移成扁帶後長出厚度。
 * 所有幾何在建模時就把底面高程烘焙進頂點，之後僅以 position／scale 做視圖壓縮。
 */
import {
  BackSide,
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeUtils,
  Vector2,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { corridorPolygon, offsetPolyline, polylineLength, slicePolyline } from "../geo/offset.ts";
import { sceneY } from "./depth.ts";
import type { Local } from "../geo/project.ts";
import { vertexElevations } from "../data/elevation.ts";
import { GROUND_EL, type Feature } from "../data/schema.ts";
import { featureColor } from "./palette.ts";
import { createPaperMaterial } from "./materials.ts";

export interface FeatureUserData {
  featureId: string;
  layer: Feature["layer"];
  level: Feature["level"];
  kind: Feature["kind"];
  name?: string;
  confidence: Feature["confidence"];
  sourceNote?: string;
  status: NonNullable<Feature["status"]>;
  /** 量體底面高程（放大後），視圖壓縮時用來換算位移。 */
  base: number;
  /** 量體底面的真實高程（公尺）。 */
  trueBase: number;
}

function shapeFrom(points: [number, number][]): Shape {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

/**
 * 以局部座標的多邊形長出量體。
 * 擠出方向原為 +Z，旋轉後對應場景的 +Y（高程），同時把局部 y 轉為場景 −Z。
 */
function extrude(points: [number, number][], height: number, base: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapeFrom(points), {
    depth: Math.max(height, 0.05),
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 上下輪廓不同的量體：屋頂斜面、塔冠收分與外傾的翹角。
 * 兩環頂點一一對應，側面以四邊形相連，上下面各自封口。
 * 各面不共用頂點，法線才會逐面平直，屋面與塔冠不致被平滑成圓弧。
 */
function loft(
  bottom: [number, number][],
  top: [number, number][],
  height: number,
  base: number,
): BufferGeometry {
  // 逆時針環的側面才朝外；順時針時兩環一起反轉，維持頂點對應
  const clockwise = ShapeUtils.isClockWise(bottom.map(([x, y]) => new Vector2(x, y)));
  const lower = clockwise ? [...bottom].reverse() : bottom;
  const upper = clockwise ? [...top].reverse() : top;
  const n = lower.length;
  const topY = base + Math.max(height, 0.05);

  const positions: number[] = [];
  const index: number[] = [];
  const push = (p: [number, number], y: number): number => {
    positions.push(p[0], y, -p[1]);
    return positions.length / 3 - 1;
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const bi = push(lower[i], base);
    const bj = push(lower[j], base);
    const tj = push(upper[j], topY);
    const ti = push(upper[i], topY);
    index.push(bi, bj, tj, bi, tj, ti);
  }
  const capFaces = (ring: [number, number][], y: number, upward: boolean): void => {
    const offset = positions.length / 3;
    for (const p of ring) push(p, y);
    const faces = ShapeUtils.triangulateShape(
      ring.map(([x, z]) => new Vector2(x, z)),
      [],
    );
    for (const [a, b, c] of faces) {
      if (upward) index.push(offset + a, offset + b, offset + c);
      else index.push(offset + a, offset + c, offset + b);
    }
  };
  capFaces(lower, base, false);
  capFaces(upper, topY, true);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** 圓周的分段數：每一整圈的線段數。 */
const CIRCLE_SEGMENTS = 16;
/** 未註明環片厚度的圓管所取的厚度（公尺）。 */
const DEFAULT_LINING = 0.25;
/** 雙圓潛盾中央柱（D 型環片）的厚度（公尺）。 */
const TWIN_COLUMN = 0.3;

/** 圓心 (cu, cv)、半徑 r 的圓弧，θ 自 `from` 遞增至 `to`（含兩端）。 */
function arc(cu: number, cv: number, r: number, from: number, to: number): Vector2[] {
  const n = Math.max(2, Math.ceil((CIRCLE_SEGMENTS * (to - from)) / (2 * Math.PI)));
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = from + ((to - from) * k) / n;
    return new Vector2(cu + r * Math.cos(t), cv + r * Math.sin(t));
  });
}

/**
 * 圓管的斷面（u 為軸線左側的水平距離、v 為高於軸心的距離）：外緣逆時針、內孔順時針。
 * 單圓為外半徑 `radius`、內半徑扣除環片厚度的圓環；雙圓為兩個相交的圓，
 * 內孔各自扣除環片厚度，中間留下 {@link TWIN_COLUMN} 厚的中央柱。
 */
export function tubeSection(
  radius: number,
  lining: number,
  twinSpacing?: number,
): { outer: Vector2[]; holes: Vector2[][] } {
  const inner = radius - lining;
  if (twinSpacing === undefined) {
    const outer = arc(0, 0, radius, 0, 2 * Math.PI).slice(0, -1);
    const hole = arc(0, 0, inner, 0, 2 * Math.PI).slice(0, -1).reverse();
    return { outer, holes: [hole] };
  }
  const s = twinSpacing / 2;
  const phi = Math.acos(s / radius);
  // 右圓弧止於上方交點，左圓弧自該點起繞回下方交點；兩處交點各只保留一次
  const right = arc(s, 0, radius, -(Math.PI - phi), Math.PI - phi);
  const left = arc(-s, 0, radius, phi, 2 * Math.PI - phi);
  const outer = [...right, ...left.slice(1, -1)];
  const psi = Math.acos((s - TWIN_COLUMN / 2) / inner);
  // 弧的兩端落在 u = ±c/2 的中央柱面上，首尾以弦封閉
  const leftHole = arc(-s, 0, inner, psi, 2 * Math.PI - psi).reverse();
  const rightHole = arc(s, 0, inner, -(Math.PI - psi), Math.PI - psi).reverse();
  return { outer, holes: [leftHole, rightHole] };
}

/**
 * 沿軸線掃出斷面：平面切向取前後頂點的連線（兩端取單側），側向為其左法線，垂直方向一律朝上，
 * 斷面因此保持直立。深度放大只作用於軸心高程，斷面維持真實尺寸，隧道不會被壓扁。
 * 兩端以斷面三角化封口。
 */
function sweep(points: Local[], elevations: number[], section: { outer: Vector2[]; holes: Vector2[][] }): BufferGeometry {
  const n = points.length;
  const frames = points.map(([x, y], i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x, y, z: sceneY(elevations[i]), nx: -(b[1] - a[1]) / length, ny: (b[0] - a[0]) / length };
  });
  const positions: number[] = [];
  const index: number[] = [];
  const place = (i: number, p: Vector2): number => {
    const f = frames[i];
    positions.push(f.x + f.nx * p.x, f.z + p.y, -(f.y + f.ny * p.x));
    return positions.length / 3 - 1;
  };

  // 側面：每一環在相鄰兩站之間以四邊形相連
  for (const ring of [section.outer, ...section.holes]) {
    const m = ring.length;
    const start = positions.length / 3;
    for (let i = 0; i < n; i++) for (const p of ring) place(i, p);
    const at = (i: number, k: number): number => start + i * m + (k % m);
    for (let i = 0; i + 1 < n; i++) {
      for (let k = 0; k < m; k++) {
        index.push(at(i, k), at(i, k + 1), at(i + 1, k + 1), at(i, k), at(i + 1, k + 1), at(i + 1, k));
      }
    }
  }

  // 端面：斷面上逆時針的三角形法線朝向行進方向，起端反轉
  const flat = [section.outer, ...section.holes].flat();
  const triangles = ShapeUtils.triangulateShape(section.outer, section.holes);
  for (const [station, forward] of [
    [0, false],
    [n - 1, true],
  ] as const) {
    const offset = positions.length / 3;
    for (const p of flat) place(station, p);
    for (const [a, b, c] of triangles) {
      const ccw = ShapeUtils.area([flat[a], flat[b], flat[c]]) > 0;
      if (ccw === forward) index.push(offset + a, offset + b, offset + c);
      else index.push(offset + a, offset + c, offset + b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 沿線漸變高程的帶狀量體：引道、匝道與依縱斷面起伏的捷運軌道。
 * 各頂點的高程先求得再各自放大，避免坡度被深度放大扭曲成折線。
 */
function slopedBand(points: Local[], width: number, thickness: number, elevations: number[]): BufferGeometry {
  const left = offsetPolyline(points, width / 2);
  const right = offsetPolyline(points, -width / 2);
  const n = points.length;

  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = sceneY(elevations[i]);
    const hi = sceneY(elevations[i] + thickness);
    positions.push(left[i][0], lo, -left[i][1]);
    positions.push(right[i][0], lo, -right[i][1]);
    positions.push(left[i][0], hi, -left[i][1]);
    positions.push(right[i][0], hi, -right[i][1]);
  }

  // 每個頂點四個角：左下、右下、左上、右上
  const lb = (i: number) => 4 * i;
  const rb = (i: number) => 4 * i + 1;
  const lt = (i: number) => 4 * i + 2;
  const rt = (i: number) => 4 * i + 3;
  const index: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const j = i + 1;
    index.push(lt(i), rt(i), rt(j), lt(i), rt(j), lt(j)); // 頂面
    index.push(lb(i), rb(j), rb(i), lb(i), lb(j), rb(j)); // 底面
    index.push(lb(i), lt(i), lt(j), lb(i), lt(j), lb(j)); // 左側
    index.push(rb(i), rt(j), rt(i), rb(i), rb(j), rt(j)); // 右側
  }
  const e = n - 1;
  index.push(lb(0), rb(0), rt(0), lb(0), rt(0), lt(0)); // 起端面
  index.push(lb(e), lt(e), rt(e), lb(e), rt(e), rb(e)); // 末端面

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** 階梯每一級的高差（公尺）與最少級數：低面數的示意階，不是實際踏階。 */
const TREAD_RISE = 0.6;
const MIN_TREADS = 3;

/**
 * 階梯：沿線等分為數級，每級是一塊頂面水平的量體，自較低一端的板底長到較高一端的踏面。
 * 各級高程先求得再放大，與 {@link slopedBand} 的兩端對齊。
 */
function steppedBand(
  points: Local[],
  width: number,
  thickness: number,
  baseStart: number,
  baseEnd: number,
): BufferGeometry {
  const treads = Math.max(MIN_TREADS, Math.round(Math.abs(baseEnd - baseStart) / TREAD_RISE));
  const total = polylineLength(points);
  const elevation = (k: number): number => baseStart + ((baseEnd - baseStart) * k) / treads;
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < treads; i++) {
    const run = slicePolyline(points, (total * i) / treads, (total * (i + 1)) / treads);
    if (run.length < 2) continue;
    const top = sceneY(Math.max(elevation(i), elevation(i + 1)));
    const bottom = sceneY(Math.min(elevation(i), elevation(i + 1)) - thickness);
    parts.push(extrude(corridorPolygon(run, width), top - bottom, bottom));
  }
  return mergeGeometries(parts, false);
}

/**
 * 極淡填色的量體：路面、公園水域與地塊皆為半透明色塊，其下的量體仍看得見；
 * 未列出者為實心。地塊幾乎全透明，只負責界定涵蓋範圍與承接陰影。
 * 停車場只是一層樓面；電梯井道半透明，表示其為中空井道。
 */
const FILL_OPACITY: Partial<Record<Feature["kind"], number>> = {
  road: 0.35,
  terrain: 0.08,
  water: 0.35,
  green: 0.3,
  sand: 0.35,
  plaza: 0.25,
  parking: 0.45,
  elevator: 0.55,
};

/** 由 {@link Feature} 建立可直接加入場景的 mesh；幾何不足時回傳 null。 */
export function buildFeatureMesh(feature: Feature, occluderUnit?: number): Mesh | null {
  // 深度放大作用於上下兩端高程，高度由差值求得，避免分別放大造成錯位
  const trueBase = feature.base ?? GROUND_EL;
  const base = sceneY(trueBase);
  const height = sceneY(trueBase + (feature.height ?? 1)) - base;

  let geometry: BufferGeometry;
  // 傾斜量體的底面高程沿線不同，位移基準取最低處
  let meshBase = base;
  if (feature.geometry.tube && feature.geometry.tube.length >= 2) {
    const elevations = vertexElevations(feature);
    const section = tubeSection(feature.radius ?? 3, feature.lining ?? DEFAULT_LINING, feature.twinSpacing);
    geometry = sweep(feature.geometry.tube, elevations, section);
    meshBase = sceneY(Math.min(...elevations));
  } else if (feature.geometry.polygon && feature.geometry.polygon.length >= 3) {
    const polygon = feature.geometry.polygon;
    const top = feature.geometry.polygonTop;
    geometry =
      top && top.length === polygon.length
        ? loft(polygon, top, height, base)
        : extrude(polygon, height, base);
  } else if (feature.geometry.polyline && feature.geometry.polyline.length >= 2) {
    const polyline = feature.geometry.polyline;
    const elevations = vertexElevations(feature);
    if (feature.kind === "stairs" && feature.baseEnd !== undefined && feature.baseEnd !== trueBase) {
      geometry = steppedBand(polyline, feature.width ?? 3, feature.height ?? 1, trueBase, feature.baseEnd);
      meshBase = Math.min(base, sceneY(feature.baseEnd));
    } else if (elevations.some((e) => e !== elevations[0])) {
      geometry = slopedBand(polyline, feature.width ?? 3, feature.height ?? 1, elevations);
      meshBase = sceneY(Math.min(...elevations));
    } else {
      geometry = extrude(corridorPolygon(polyline, feature.width ?? 3), height, base);
    }
  } else {
    return null;
  }
  if (occluderUnit !== undefined) {
    const units = new Float32Array(geometry.getAttribute("position").count).fill(occluderUnit);
    geometry.setAttribute("occluder", new Float32BufferAttribute(units, 1));
  }

  const status = feature.status ?? "existing";
  // 站體外殼與圓管只畫背面，做出掀蓋紙盒的效果，使內部月台、股道不被遮住；
  // 樓板則以半透明呈現，仍能看出層層相疊的關係。
  const shell =
    feature.kind === "station-box" ||
    (feature.layer === "station-box" && feature.kind !== "slab") ||
    feature.geometry.tube !== undefined;
  const slab = feature.kind === "slab";
  // 分層大廳同樣半透明，否則會遮住同一構造物下層的月台與股道。
  const room = feature.kind === "station" && !shell;
  const terrain = feature.kind === "terrain";
  const fill = FILL_OPACITY[feature.kind];
  const opacity = shell ? 0.4 : slab ? 0.15 : room ? 0.3 : (fill ?? 1);
  const material = createPaperMaterial({
    color: featureColor(feature.kind, feature.layer, feature.line),
    opacity,
    side: shell ? BackSide : DoubleSide,
    // 樓板、外殼與地塊一律退讓給貼在它上面的量體
    offset: slab || shell || terrain,
    occluder: occluderUnit !== undefined ? "solid" : undefined,
  });
  material.userData.baseOpacity = opacity;

  const mesh = new Mesh(geometry, material);
  mesh.castShadow = feature.layer === "building" || feature.layer === "landmark";
  mesh.receiveShadow = terrain || feature.level === "G";
  const userData: FeatureUserData = {
    featureId: feature.id,
    layer: feature.layer,
    level: feature.level,
    kind: feature.kind,
    confidence: feature.confidence,
    status,
    base: meshBase,
    trueBase,
  };
  if (feature.name !== undefined) userData.name = feature.name;
  if (feature.sourceNote !== undefined) userData.sourceNote = feature.sourceNote;
  mesh.userData = userData;
  mesh.name = feature.id;
  return mesh;
}

/**
 * 外觀與擺放方式的分組鍵：同鍵的量體併為單一 mesh 不改變任何呈現。
 * 鍵涵蓋材質參數與 `applyMorph()` 會用到的每一項欄位。
 */
export function meshGroupKey(mesh: Mesh): string {
  const data = mesh.userData as FeatureUserData;
  const material = mesh.material as MeshStandardMaterial;
  return [
    data.layer,
    data.level,
    data.kind,
    data.status,
    material.color.getHexString(),
    material.opacity.toFixed(3),
    material.side,
    material.polygonOffset ? 1 : 0,
    data.base.toFixed(3),
    data.trueBase.toFixed(3),
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.geometry.hasAttribute("occluder") ? 1 : 0,
  ].join("|");
}

/**
 * 同組量體併為單一 mesh。
 *
 * 幾何先統一為無索引、且只留位置與法線：`ExtrudeGeometry` 帶 uv 而不帶索引、
 * 放樣與斜帶量體帶索引而不帶 uv，屬性組合不一致時無法合併。
 * 只有一項的組直接沿用原 mesh，保留其量體名稱與來源說明。
 */
export function mergeMeshes(key: string, group: Mesh[]): Mesh {
  if (group.length === 1) return group[0];

  const geometries = group.map((mesh) => {
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const plain = new BufferGeometry();
    plain.setAttribute("position", source.getAttribute("position"));
    plain.setAttribute("normal", source.getAttribute("normal"));
    if (source.hasAttribute("occluder")) plain.setAttribute("occluder", source.getAttribute("occluder"));
    return plain;
  });
  const merged = mergeGeometries(geometries, false);
  for (const mesh of group) mesh.geometry.dispose();
  for (let i = 1; i < group.length; i++) (group[i].material as MeshStandardMaterial).dispose();

  const source = group[0].userData as FeatureUserData;
  const mesh = new Mesh(merged, group[0].material);
  mesh.castShadow = group[0].castShadow;
  mesh.receiveShadow = group[0].receiveShadow;
  // 合併後的 mesh 不再對應單一量體，逐項的名稱與來源說明一併略去
  mesh.userData = {
    featureId: key,
    layer: source.layer,
    level: source.level,
    kind: source.kind,
    confidence: source.confidence,
    status: source.status,
    base: source.base,
    trueBase: source.trueBase,
  } satisfies FeatureUserData;
  mesh.name = key;
  return mesh;
}

/** 淡化繪製排在所有半透明量體之後；數值需大於 `LEVEL_ORDER` 的最大值 5。 */
const GHOST_PREPASS_ORDER = 10;
const GHOST_VEIL_ORDER = 11;

export interface GhostPasses {
  /** 此 mesh 內含的淡化單元編號，不重複。 */
  units: number[];
  prepass: Mesh;
  veil: Mesh;
}

/**
 * 為帶有 `occluder` 屬性的 mesh 掛上淡化用的兩道繪製，共用其幾何與變換；
 * 沒有淡化中的單元時兩者皆隱藏，不產生繪製呼叫。不帶該屬性時回傳 null。
 */
export function addGhostPasses(mesh: Mesh): GhostPasses | null {
  if (!mesh.geometry.hasAttribute("occluder")) return null;
  const color = `#${(mesh.material as MeshStandardMaterial).color.getHexString()}`;
  const prepass = new Mesh(mesh.geometry, createPaperMaterial({ color, occluder: "prepass" }));
  const veil = new Mesh(mesh.geometry, createPaperMaterial({ color, occluder: "veil" }));
  prepass.renderOrder = GHOST_PREPASS_ORDER;
  veil.renderOrder = GHOST_VEIL_ORDER;
  veil.receiveShadow = mesh.receiveShadow;
  prepass.visible = false;
  veil.visible = false;
  mesh.add(prepass, veil);
  const units = [...new Set(mesh.geometry.getAttribute("occluder").array as Float32Array)];
  return { units, prepass, veil };
}

/** 釋放 mesh 佔用的 GPU 資源。 */
export function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  mesh.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}
