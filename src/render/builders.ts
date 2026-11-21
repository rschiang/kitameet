/**
 * 量體建模：多邊形以 ExtrudeGeometry 長出高度，折線以中心線兩側平移成扁帶後長出厚度。
 * 所有幾何在建模時就把底面高程烘焙進頂點，之後僅以 position／scale 做視圖壓縮。
 */
import {
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeUtils,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { corridorPolygon, offsetPolyline } from "../geo/offset.ts";
import { exaggerate } from "./depth.ts";
import type { Local } from "../geo/project.ts";
import type { Feature } from "../data/schema.ts";
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

/**
 * 圓形隧道：以軸心折線掃出管狀量體。
 * 深度放大只作用於軸心高程，半徑維持真實值，否則隧道會被壓成扁管。
 */
function tube(points: [number, number][], axis: number, radius: number): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map(([x, y]) => new Vector3(x, axis, -y)));
  const segments = Math.max(8, points.length - 1);
  const geometry = new TubeGeometry(curve, segments, radius, 12, false);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 沿線漸變高程的帶狀量體：引道、匝道與疊式隧道的收斂段。
 * 兩端高程依累積弧長線性內插後才各自放大，避免坡度被深度放大扭曲成折線。
 */
function slopedBand(
  points: Local[],
  width: number,
  thickness: number,
  baseStart: number,
  baseEnd: number,
): BufferGeometry {
  const left = offsetPolyline(points, width / 2);
  const right = offsetPolyline(points, -width / 2);
  const n = points.length;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) {
    along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = along[n - 1];

  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = total === 0 ? 0 : along[i] / total;
    const elevation = baseStart + (baseEnd - baseStart) * t;
    const lo = exaggerate(elevation);
    const hi = exaggerate(elevation + thickness);
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

/**
 * 極淡填色的量體：路面、公園水域與地塊皆為半透明色塊，其下的量體仍看得見；
 * 未列出者為實心。地塊幾乎全透明，只負責界定涵蓋範圍與承接陰影。
 */
const FILL_OPACITY: Partial<Record<Feature["kind"], number>> = {
  road: 0.35,
  terrain: 0.08,
  water: 0.35,
  green: 0.3,
  sand: 0.35,
  plaza: 0.25,
};

/** 由 {@link Feature} 建立可直接加入場景的 mesh；幾何不足時回傳 null。 */
export function buildFeatureMesh(feature: Feature): Mesh | null {
  // 深度放大作用於上下兩端高程，高度由差值求得，避免分別放大造成錯位
  const trueBase = feature.base ?? 0;
  const base = exaggerate(trueBase);
  const height = exaggerate(trueBase + (feature.height ?? 1)) - base;

  let geometry: BufferGeometry;
  // 傾斜量體的底面高程兩端不同，位移基準取較低的一端
  let meshBase = base;
  if (feature.geometry.tube && feature.geometry.tube.length >= 2) {
    geometry = tube(feature.geometry.tube, base, feature.radius ?? 3);
  } else if (feature.geometry.polygon && feature.geometry.polygon.length >= 3) {
    const polygon = feature.geometry.polygon;
    const top = feature.geometry.polygonTop;
    geometry =
      top && top.length === polygon.length
        ? loft(polygon, top, height, base)
        : extrude(polygon, height, base);
  } else if (feature.geometry.polyline && feature.geometry.polyline.length >= 2) {
    if (feature.baseEnd !== undefined && feature.baseEnd !== trueBase) {
      geometry = slopedBand(
        feature.geometry.polyline,
        feature.width ?? 3,
        feature.height ?? 1,
        trueBase,
        feature.baseEnd,
      );
      meshBase = Math.min(base, exaggerate(feature.baseEnd));
    } else {
      const band = corridorPolygon(feature.geometry.polyline, feature.width ?? 3);
      geometry = extrude(band, height, base);
    }
  } else {
    return null;
  }

  const status = feature.status ?? "existing";
  // 站體外殼只畫背面，做出掀蓋紙盒的效果，使內部月台、股道不被遮住；
  // 樓板則以半透明呈現，仍能看出層層相疊的關係。
  const shell =
    feature.kind === "station-box" || (feature.layer === "station-box" && feature.kind !== "slab");
  const slab = feature.kind === "slab";
  // 分層大廳同樣半透明，否則會遮住同一構造物下層的月台與股道。
  const room = feature.kind === "station" && !shell;
  const terrain = feature.kind === "terrain";
  const fill = FILL_OPACITY[feature.kind];
  const opacity =
    status === "removed" ? 0.25 : shell ? 0.4 : slab ? 0.15 : room ? 0.3 : (fill ?? 1);
  const material = createPaperMaterial({
    color: featureColor(
      feature.kind,
      feature.layer,
      status === "existing" ? undefined : status,
      feature.line,
    ),
    opacity,
    side: shell ? BackSide : DoubleSide,
    // 樓板、外殼與地塊一律退讓給貼在它上面的量體
    offset: slab || shell || terrain,
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

/** 釋放 mesh 佔用的 GPU 資源。 */
export function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}
