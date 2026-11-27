/**
 * 遮蔽判定：找出在目前視角下擋住月台與股道的建物。
 * 月台與股道的取樣點投影到低解析度的畫面遮罩，再逐一比對建物稜柱的投影輪廓；
 * 本模組不依賴 WebGL，可直接以 vitest 驗證。
 */
import { Box3, Frustum, Matrix4, Vector3, type PerspectiveCamera, type Plane } from "three";
import { elevationAt } from "../data/elevation.ts";
import { GROUND_EL, type Feature, type LayerId } from "../data/schema.ts";
import { convexHull, pointInPolygon, polygonCentroid } from "../geo/measure.ts";
import type { Local } from "../geo/project.ts";
import { sceneY } from "./depth.ts";

/** 會轉為半透明的圖層。 */
export const OCCLUDER_LAYERS: readonly LayerId[] = ["building", "landmark"];
/** 必須保持可見的圖層：月台、股道，以及捷運圖層中的捷運軌道（{@link isTarget}）。 */
export const TARGET_LAYERS: readonly LayerId[] = ["platform", "track", "metro"];

/** 須保持可見的量體：捷運圖層只取軌道，隧道與箱涵本就包住軌道。 */
function isTarget(feature: Feature): boolean {
  return feature.layer === "metro" ? feature.kind === "track-metro" : TARGET_LAYERS.includes(feature.layer);
}

/** 取樣點是否屬於臺鐵或高鐵；其餘（捷運股道與捷運月台）淡化程度較淺。 */
function isMainlineTarget(feature: Feature): boolean {
  return feature.line === "tra" || feature.line === "hsr" || feature.structure === "tra-hsr-station";
}

/**
 * 臺北車站特定區：南臨忠孝西路一段、東臨中山北路一段、北臨市民大道一段
 * （承德路以西為市民大道高架正下方的鄭州路）、西臨延平北路一段。
 * 頂點取 OSM 路面中心線（雙向分幅者取兩幅中點），單位為局部公尺；
 * 街廓內的建物不會跨越中心線，因此以輪廓形心判定內外即可。
 */
const STATION_AREA: Local[] = [
  [-590, 35], // 忠孝西路 × 延平北路（北門西北側路口）
  [-463, -44],
  [-396, -62],
  [-220, -109],
  [32, -177], // 忠孝西路，站前廣場南側
  [238, -232], // 忠孝西路 × 中山北路
  [322, -68],
  [360, 25], // 中山北路 × 市民大道
  [255, 53],
  [145, 70],
  [89, 79],
  [-70, 106], // 市民大道 × 承德路，以西沿鄭州路
  [-232, 138],
  [-398, 181],
  [-528, 229], // 鄭州路 × 延平北路
  [-536, 206],
  [-580, 71],
];

/** 月台與股道的取樣間距（公尺）；股道寬 3 公尺，取樣點的投影範圍同時涵蓋其寬度。 */
const TARGET_STEP = 4;
/** 畫面遮罩的列數；欄數依相機長寬比換算。 */
const MASK_HEIGHT = 180;
const MASK_MAX_WIDTH = 640;
/** 視深低於此值的點視為位於相機後方，與透視相機的近平面一致。 */
const NEAR_W = 1;
/** 遮罩格心與投影輪廓的容許距離（格）。 */
const HULL_MARGIN = 0.5;
/** 建物最近的頂點視深超過視線目標視深的此倍數時視為背景，不淡化。 */
const FOREGROUND_REACH = 1.2;
/** 淡化單元至少需遮住的遮罩格數；16 格在 768 像素高的畫面約為 17×17 像素。 */
const MIN_HIDDEN_CELLS = 16;

interface Prism {
  unit: number;
  /** 輪廓形心是否落在 {@link STATION_AREA} 內；深淡化的必要條件。 */
  inStation: boolean;
  /** 底面與頂面輪廓的凸包，場景座標 (x, z) 交錯排列。 */
  bottom: Float32Array;
  top: Float32Array;
  lo: number;
  hi: number;
  box: Box3;
}

export interface OcclusionIndex {
  /** 淡化單元數量；地標的各部量體共用一個單元。 */
  unitCount: number;
  /** 量體對應的淡化單元；不在表內者不參與淡化。 */
  units: Map<Feature, number>;
  prisms: Prism[];
  /** 月台與股道頂面的取樣點，場景座標 (x, y, z) 交錯排列。 */
  samples: Float32Array;
  /** 各取樣點所屬圖層於 {@link TARGET_LAYERS} 的索引。 */
  sampleLayers: Uint8Array;
  /** 各取樣點是否屬於臺鐵或高鐵（1 為是），見 {@link isMainlineTarget}。 */
  sampleRail: Uint8Array;
  depth: Float32Array;
  /** 只由臺鐵、高鐵取樣點寫入的視深遮罩，大小同 {@link OcclusionIndex.depth}。 */
  depthRail: Float32Array;
  sat: Int32Array;
  pointX: Float32Array;
  pointY: Float32Array;
  hullX: Float32Array;
  hullY: Float32Array;
  /** 各淡化單元已遮住的遮罩格數，每次判定時歸零。 */
  hidden: Uint16Array;
  /** 各淡化單元已遮住的臺鐵、高鐵遮罩格數，每次判定時歸零。 */
  hiddenRail: Uint16Array;
}

export interface OcclusionOptions {
  /** 圖層目前是否顯示；隱藏的月台與股道不列入判定。 */
  layerVisible: (layer: LayerId) => boolean;
  /** 啟用中的剖切面；已切除一側的取樣點不列入判定。 */
  clipPlane: Plane | null;
  /** 視線目標（軌道控制的環繞中心），場景座標；用於劃分前景與背景。 */
  focus: Vector3;
}

/**
 * 淡化單元的識別字串；不屬於遮蔽圖層、已拆除或非多邊形量體時回傳 null。
 * 地標取 `landmark/<slug>`，各部量體一併淡化；裁切產生的 `#n` 後綴一律略去。
 */
export function occluderKey(feature: Feature): string | null {
  if (!OCCLUDER_LAYERS.includes(feature.layer) || feature.status === "removed") return null;
  const polygon = feature.geometry.polygon;
  if (feature.geometry.tube || !polygon || polygon.length < 3) return null;
  const landmark = /^landmark\/[^/]+/.exec(feature.id);
  return landmark ? landmark[0] : feature.id.replace(/#\d+$/, "");
}

function hullRing(ring: Local[]): Float32Array {
  const hull = convexHull(ring);
  const flat = new Float32Array(hull.length * 2);
  hull.forEach(([x, y], i) => {
    flat[2 * i] = x;
    flat[2 * i + 1] = -y;
  });
  return flat;
}

/** 沿折線每隔不超過 `TARGET_STEP` 取一點；`elevation(s)` 以沿線弧長（公尺）給出頂面高程。 */
function sampleLine(line: Local[], closed: boolean, elevation: (s: number) => number, out: number[]): void {
  const count = closed ? line.length : line.length - 1;
  let travelled = 0;
  for (let i = 0; i < count; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[(i + 1) % line.length];
    const length = Math.hypot(bx - ax, by - ay);
    const pieces = Math.max(1, Math.ceil(length / TARGET_STEP));
    const last = !closed && i === count - 1 ? pieces : pieces - 1;
    for (let k = 0; k <= last; k++) {
      const u = k / pieces;
      const s = travelled + u * length;
      out.push(ax + (bx - ax) * u, sceneY(elevation(s)), -(ay + (by - ay) * u));
    }
    travelled += length;
  }
}

function sampleTarget(feature: Feature, out: number[]): void {
  const base = feature.base ?? GROUND_EL;
  const height = feature.height ?? 1;
  const { tube, polygon, polyline } = feature.geometry;
  if (tube && tube.length >= 2) {
    sampleLine(tube, false, elevationAt(feature), out);
  } else if (polygon && polygon.length >= 3) {
    sampleLine(polygon, true, () => base + height, out);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of polygon) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const top = sceneY(base + height);
    for (let x = minX + TARGET_STEP / 2; x < maxX; x += TARGET_STEP) {
      for (let y = minY + TARGET_STEP / 2; y < maxY; y += TARGET_STEP) {
        if (pointInPolygon([x, y], polygon)) out.push(x, top, -y);
      }
    }
  } else if (polyline && polyline.length >= 2) {
    const at = elevationAt(feature);
    sampleLine(polyline, false, (s) => at(s) + height, out);
  }
}

export function buildOcclusionIndex(features: Feature[]): OcclusionIndex {
  const keys = new Map<string, number>();
  const units = new Map<Feature, number>();
  const prisms: Prism[] = [];
  const samples: number[] = [];
  const sampleLayers: number[] = [];
  const sampleRail: number[] = [];
  let maxRing = 0;

  for (const feature of features) {
    if (isTarget(feature)) {
      const target = TARGET_LAYERS.indexOf(feature.layer);
      const before = samples.length;
      sampleTarget(feature, samples);
      const mainline = isMainlineTarget(feature);
      for (let i = before; i < samples.length; i += 3) {
        sampleLayers.push(target);
        sampleRail.push(mainline ? 1 : 0);
      }
      continue;
    }
    const key = occluderKey(feature);
    if (key === null) continue;
    let unit = keys.get(key);
    if (unit === undefined) {
      unit = keys.size;
      keys.set(key, unit);
    }
    units.set(feature, unit);

    const polygon = feature.geometry.polygon!;
    const polygonTop = feature.geometry.polygonTop;
    const bottom = hullRing(polygon);
    if (bottom.length < 6) continue;
    const top = polygonTop && polygonTop.length === polygon.length ? hullRing(polygonTop) : bottom;
    const base = feature.base ?? GROUND_EL;
    const lo = sceneY(base);
    const hi = sceneY(base + (feature.height ?? 1));
    const box = new Box3();
    const corner = new Vector3();
    for (const ring of [bottom, top]) {
      for (let i = 0; i < ring.length; i += 2) {
        box.expandByPoint(corner.set(ring[i], lo, ring[i + 1]));
        box.expandByPoint(corner.set(ring[i], hi, ring[i + 1]));
      }
    }
    maxRing = Math.max(maxRing, bottom.length / 2, top.length / 2);
    const inStation = pointInPolygon(polygonCentroid(polygon), STATION_AREA);
    prisms.push({ unit, inStation, bottom, top, lo, hi, box });
  }

  const scratch = 2 * maxRing + 2;
  return {
    unitCount: keys.size,
    units,
    prisms,
    samples: new Float32Array(samples),
    sampleLayers: new Uint8Array(sampleLayers),
    sampleRail: new Uint8Array(sampleRail),
    depth: new Float32Array(MASK_MAX_WIDTH * MASK_HEIGHT),
    depthRail: new Float32Array(MASK_MAX_WIDTH * MASK_HEIGHT),
    sat: new Int32Array((MASK_MAX_WIDTH + 1) * (MASK_HEIGHT + 1)),
    hidden: new Uint16Array(keys.size),
    hiddenRail: new Uint16Array(keys.size),
    pointX: new Float32Array(scratch),
    pointY: new Float32Array(scratch),
    hullX: new Float32Array(scratch),
    hullY: new Float32Array(scratch),
  };
}

const viewProjection = new Matrix4();
const frustum = new Frustum();

/** Andrew monotone chain；輸入為 `pointX`、`pointY` 的前 `n` 點，輸出逆時針凸包至 `hullX`、`hullY`，回傳頂點數。 */
function screenHull(index: OcclusionIndex, n: number): number {
  const { pointX, pointY, hullX, hullY } = index;
  for (let i = 1; i < n; i++) {
    const x = pointX[i];
    const y = pointY[i];
    let j = i - 1;
    while (j >= 0 && (pointX[j] > x || (pointX[j] === x && pointY[j] > y))) {
      pointX[j + 1] = pointX[j];
      pointY[j + 1] = pointY[j];
      j--;
    }
    pointX[j + 1] = x;
    pointY[j + 1] = y;
  }
  const turnsRight = (k: number, i: number): boolean =>
    (hullX[k - 1] - hullX[k - 2]) * (pointY[i] - hullY[k - 2]) -
      (hullY[k - 1] - hullY[k - 2]) * (pointX[i] - hullX[k - 2]) <=
    0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k >= 2 && turnsRight(k, i)) k--;
    hullX[k] = pointX[i];
    hullY[k] = pointY[i];
    k++;
  }
  const lower = k + 1;
  for (let i = n - 2; i >= 0; i--) {
    while (k >= lower && turnsRight(k, i)) k--;
    hullX[k] = pointX[i];
    hullY[k] = pointY[i];
    k++;
  }
  return k - 1;
}

/**
 * 判定各淡化單元是否擋住月台或股道，結果寫入 `out`（長度為 `unitCount`）：
 * 0 為不淡化、1 為位於車站特定區內且擋住臺鐵或高鐵（深淡化）、2 為其餘遮蔽（淺淡化）。
 * 只淡化前景中遮蔽範圍夠大的建物：最近的頂點需在視線目標視深的 `FOREGROUND_REACH` 倍以內，
 * 且同一單元合計遮住至少 `MIN_HIDDEN_CELLS` 格。輪廓取凸包，遮罩有一格以內的誤差。
 */
export function findObstructing(
  index: OcclusionIndex,
  camera: PerspectiveCamera,
  options: OcclusionOptions,
  out: Uint8Array,
): void {
  out.fill(0);
  camera.updateMatrixWorld();
  const e = viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const height = MASK_HEIGHT;
  const width = Math.max(1, Math.min(MASK_MAX_WIDTH, Math.round(height * camera.aspect)));
  const { depth, depthRail, sat, hidden, hiddenRail, samples, sampleLayers, sampleRail } = index;
  const { pointX, pointY, hullX, hullY } = index;
  depth.fill(0, 0, width * height);
  depthRail.fill(0, 0, width * height);
  hidden.fill(0);
  hiddenRail.fill(0);
  const { focus } = options;
  const foreground = FOREGROUND_REACH * (e[3] * focus.x + e[7] * focus.y + e[11] * focus.z + e[15]);

  // 一、月台與股道的取樣點寫入遮罩，每格記錄最遠的視深；臺鐵、高鐵另寫入第二道遮罩
  const visible = TARGET_LAYERS.map((layer) => options.layerVisible(layer));
  const clip = options.clipPlane;
  const spread = 0.25 * TARGET_STEP * camera.projectionMatrix.elements[5] * height;
  for (let s = 0, n = 0; s < samples.length; s += 3, n++) {
    if (!visible[sampleLayers[n]]) continue;
    const x = samples[s];
    const y = samples[s + 1];
    const z = samples[s + 2];
    if (clip && clip.normal.x * x + clip.normal.y * y + clip.normal.z * z + clip.constant < 0) continue;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= NEAR_W) continue;
    const u = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * width;
    const v = (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 + 0.5) * height;
    // 取樣間距的投影不足一格時只寫入所在的一格
    const reach = spread / w < 0.5 ? 0 : spread / w;
    const i0 = Math.max(0, Math.floor(u - reach));
    const i1 = Math.min(width - 1, Math.floor(u + reach));
    const j0 = Math.max(0, Math.floor(v - reach));
    const j1 = Math.min(height - 1, Math.floor(v + reach));
    const rail = sampleRail[n] === 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (w > depth[j * width + i]) depth[j * width + i] = w;
        if (rail && w > depthRail[j * width + i]) depthRail[j * width + i] = w;
      }
    }
  }

  // 二、積分圖：以常數時間排除投影範圍內沒有月台與股道的建物
  const stride = width + 1;
  sat.fill(0, 0, stride);
  let marked = 0;
  for (let j = 0; j < height; j++) {
    let row = 0;
    sat[(j + 1) * stride] = 0;
    for (let i = 0; i < width; i++) {
      if (depth[j * width + i] > 0) row++;
      sat[(j + 1) * stride + i + 1] = sat[j * stride + i + 1] + row;
    }
    marked += row;
  }
  if (marked === 0) return;

  frustum.setFromProjectionMatrix(viewProjection);
  for (const prism of index.prisms) {
    if (out[prism.unit] === 1) continue;
    if (!prism.inStation && out[prism.unit] === 2) continue;

    // 三、外接方盒的八個角點：全在相機後方即略過，跨越近平面者只要落在視錐內就視為遮蔽
    const { min, max } = prism.box;
    let behind = 0;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? max.x : min.x;
      const y = c & 2 ? max.y : min.y;
      const z = c & 4 ? max.z : min.z;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= NEAR_W) {
        behind++;
        continue;
      }
      const u = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * width;
      const v = (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 + 0.5) * height;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    if (behind === 8) continue;
    if (behind > 0) {
      if (frustum.intersectsBox(prism.box)) out[prism.unit] = prism.inStation ? 1 : 2;
      continue;
    }
    let i0 = Math.max(0, Math.floor(u0));
    let i1 = Math.min(width - 1, Math.floor(u1));
    let j0 = Math.max(0, Math.floor(v0));
    let j1 = Math.min(height - 1, Math.floor(v1));
    if (i0 > i1 || j0 > j1) continue;
    const covered =
      sat[(j1 + 1) * stride + i1 + 1] - sat[j0 * stride + i1 + 1] - sat[(j1 + 1) * stride + i0] + sat[j0 * stride + i0];
    if (covered === 0) continue;

    // 四、底面與頂面輪廓投影後取凸包，逐格累計較建物更遠的月台與股道
    let count = 0;
    let nearest = Infinity;
    for (let side = 0; side < 2; side++) {
      const ring = side === 0 ? prism.bottom : prism.top;
      const y = side === 0 ? prism.lo : prism.hi;
      for (let k = 0; k < ring.length; k += 2) {
        const x = ring[k];
        const z = ring[k + 1];
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        pointX[count] = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * width;
        pointY[count] = (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 + 0.5) * height;
        nearest = Math.min(nearest, w);
        count++;
      }
    }
    // 背景建物即使擋住遠處的股道也不淡化
    if (nearest > foreground) continue;
    const corners = screenHull(index, count);
    u0 = v0 = Infinity;
    u1 = v1 = -Infinity;
    for (let k = 0; k < count; k++) {
      u0 = Math.min(u0, pointX[k]);
      u1 = Math.max(u1, pointX[k]);
      v0 = Math.min(v0, pointY[k]);
      v1 = Math.max(v1, pointY[k]);
    }
    i0 = Math.max(0, Math.floor(u0));
    i1 = Math.min(width - 1, Math.floor(u1));
    j0 = Math.max(0, Math.floor(v0));
    j1 = Math.min(height - 1, Math.floor(v1));
    search: for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!(depth[j * width + i] > nearest)) continue;
        let inside = true;
        for (let k = 0; inside && corners >= 3 && k < corners; k++) {
          const next = (k + 1) % corners;
          const ex = hullX[next] - hullX[k];
          const ey = hullY[next] - hullY[k];
          // 逆時針凸包的內側在各邊左方；格心在右方超過容許距離即在輪廓外
          const left = ((j + 0.5 - hullY[k]) * ex - (i + 0.5 - hullX[k]) * ey) / (Math.hypot(ex, ey) || 1);
          if (left < -HULL_MARGIN) inside = false;
        }
        if (!inside) continue;
        hidden[prism.unit]++;
        if (prism.inStation && depthRail[j * width + i] > nearest) {
          hiddenRail[prism.unit]++;
          if (hiddenRail[prism.unit] >= MIN_HIDDEN_CELLS) {
            out[prism.unit] = 1;
            break search;
          }
        }
        if (hidden[prism.unit] >= MIN_HIDDEN_CELLS && out[prism.unit] === 0) {
          out[prism.unit] = 2;
          if (!prism.inStation) break search;
        }
      }
    }
  }
}
