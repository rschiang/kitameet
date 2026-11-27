/**
 * 月台長邊依相鄰軌道重建。
 *
 * OSM 的月台與軌道各自描繪，兩者常差 0.5 公尺以上，股道帶因此壓進月台；
 * 公告圖的捷運軌道與 OSM 月台更相差 3 至 4 公尺。月台邊緣距軌道中心有固定的淨距，
 * 本模組沿月台主軸逐點取兩側最近的軌道，自軌道中心外推該淨距得出月台長邊。
 */
import { resample } from "../../geo/corridor.ts";
import { advance, decompose, polygonArea, polygonAxis } from "../../geo/measure.ts";
import type { Local } from "../../geo/project.ts";
import type { MetroLineId } from "../levels.ts";
import type { Feature } from "../schema.ts";

const TRA_EDGE = 1.575; // 《臺鐵資料》季刊 2020：軌道中心至月台邊緣 1,575 公厘
const HSR_EDGE = 3.38 / 2 + 0.05; // 700T 車寬之半加 0.05 公尺
const METRO_EDGE = 3.2 / 2 + 0.05; // 臺北捷運高運量車寬之半加 0.05 公尺
const AIRPORT_EDGE = 3.03 / 2 + 0.05; // 機場捷運車寬之半加 0.05 公尺
const METRO_PLATFORM_LENGTH = 141; // 6 節列車長（捷運局常見問答）

/** 沿主軸的取樣間距、每個取樣位置前後採計軌道取樣點的範圍（公尺）。 */
const STATION_STEP = 2;
const ALONG_WINDOW = 1;
/** 軌道取樣間距（公尺）。 */
const TRACK_STEP = 1;
/** 軌道須落在原月台半寬再加此距離內才算相鄰（公尺）。 */
const LATERAL_REACH = 8;
/**
 * 重建後的最小寬度（公尺）。月台端部外的道岔區兩側軌道收攏，寬度不足處即月台端點；
 * 達此寬度的連續區段短於原長之半，表示軌道選錯，擲出例外。
 */
const MIN_WIDTH = 2;

const metres = (value: number): number => Number(value.toFixed(3));

const EDGE_NOTE =
  `長邊依相鄰軌道中心線外推月台邊緣距離重建：臺鐵 ${TRA_EDGE} 公尺（《臺鐵資料》季刊 2020）、` +
  `高鐵 ${metres(HSR_EDGE)}、捷運 ${metres(METRO_EDGE)}、機場捷運 ${metres(AIRPORT_EDGE)} 公尺（車寬之半加 0.05 公尺）。`;
const LENGTH_NOTE = `長度取 6 節列車長 ${METRO_PLATFORM_LENGTH} 公尺。`;

/**
 * 重建的月台與其相鄰軌道的來源：
 * `rail` 為臺鐵與高鐵股道、`airport` 為 OSM 的機場捷運正線、`metro` 為該路線的公告圖軌道中心線。
 */
export type PlatformRebuild =
  | { id: string; system: "rail" | "airport" }
  | { id: string; system: "metro"; line: MetroLineId };

export const PLATFORM_REBUILDS: PlatformRebuild[] = [
  { id: "way/584167409", system: "rail" },
  { id: "way/584167411", system: "rail" },
  { id: "way/584167413", system: "rail" },
  { id: "way/584167415", system: "rail" },
  { id: "way/978708478", system: "rail" },
  { id: "way/978708479", system: "rail" },
  { id: "way/871105041", system: "airport" },
  { id: "way/871105042", system: "airport" },
  { id: "way/741259904", system: "metro", line: "bl" },
  { id: "way/741259905", system: "metro", line: "r" },
  { id: "way/877532223", system: "metro", line: "g" },
];

/** 月台的相鄰軌道候選，各附月台邊緣距軌道中心的距離（公尺）。 */
export function platformTracks(
  spec: PlatformRebuild,
  features: Feature[],
): { feature: Feature; edge: number }[] {
  return features.flatMap((feature) => {
    const line = feature.geometry.polyline;
    if (!line || line.length < 2) return [];
    switch (spec.system) {
      case "rail":
        if (feature.kind === "track-tra") return [{ feature, edge: TRA_EDGE }];
        if (feature.kind === "track-hsr") return [{ feature, edge: HSR_EDGE }];
        return [];
      case "airport":
        return feature.kind === "track-metro" && feature.line === "a" && !feature.id.startsWith("dorts/")
          ? [{ feature, edge: AIRPORT_EDGE }]
          : [];
      case "metro":
        return feature.kind === "track-metro" && feature.line === spec.line && feature.id.startsWith("dorts/")
          ? [{ feature, edge: METRO_EDGE }]
          : [];
    }
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 缺值沿用同側最近一個有值的位置；整側皆缺時取 `fallback`。 */
function fillGaps(values: (number | null)[], fallback: number): number[] {
  const known = values.flatMap((v, i) => (v === null ? [] : [i]));
  if (known.length === 0) return values.map(() => fallback);
  return values.map((v, i) => {
    if (v !== null) return v;
    const nearest = known.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
    return values[nearest] as number;
  });
}

function rebuild(platform: Feature, spec: PlatformRebuild, features: Feature[]): Feature {
  const polygon = platform.geometry.polygon as Local[];
  const axis = polygonAxis(polygon);
  const local = polygon.map((p) => decompose(axis.center, axis.bearing, p));
  const half = Math.max(...local.map((q) => Math.abs(q.lateral)));
  const [from, to] =
    spec.system === "metro"
      ? [-METRO_PLATFORM_LENGTH / 2, METRO_PLATFORM_LENGTH / 2]
      : [Math.min(...local.map((q) => q.along)), Math.max(...local.map((q) => q.along))];

  const tracks = platformTracks(spec, features).map(({ feature, edge }) => ({
    edge,
    samples: resample(feature.geometry.polyline as Local[], TRACK_STEP).map((p) =>
      decompose(axis.center, axis.bearing, p),
    ),
  }));

  const stations: number[] = [];
  for (let s = from; s < to; s += STATION_STEP) stations.push(s);
  stations.push(to);

  const lefts: (number | null)[] = [];
  const rights: (number | null)[] = [];
  for (const s of stations) {
    let left: { lateral: number; clearance: number } | null = null;
    let right: { lateral: number; clearance: number } | null = null;
    for (const { edge, samples } of tracks) {
      const near = samples.filter((q) => Math.abs(q.along - s) <= ALONG_WINDOW);
      if (near.length === 0) continue;
      // 以中位數判定軌道在哪一側，月台邊緣則自窗口內最靠近主軸的取樣點外推，彎道上才不會壓進股道帶
      const laterals = near.map((q) => q.lateral);
      const lateral = median(laterals);
      if (Math.abs(lateral) > half + LATERAL_REACH) continue;
      // 軌道斜交主軸時，邊緣距離須沿軌道法向量得：橫向間距放大為 edge·√(1 + 斜率²)
      const [first, last] = [near[0], near[near.length - 1]];
      const run = last.along - first.along;
      const slope = Math.abs(run) > ALONG_WINDOW / 2 ? (last.lateral - first.lateral) / run : 0;
      const clearance = edge * Math.hypot(1, slope);
      if (lateral > 0) {
        const inner = Math.min(...laterals);
        if (left === null || inner < left.lateral) left = { lateral: inner, clearance };
      }
      if (lateral < 0) {
        const inner = Math.max(...laterals);
        if (right === null || inner > right.lateral) right = { lateral: inner, clearance };
      }
    }
    lefts.push(left === null ? null : left.lateral - left.clearance);
    rights.push(right === null ? null : right.lateral + right.clearance);
  }
  const leftEdge = fillGaps(lefts, half);
  const rightEdge = fillGaps(rights, -half);
  // 取寬度達下限的最長連續區段；兩端寬度不足處為原多邊形伸進道岔區的部分
  let best = { start: 0, end: -1 };
  let start = 0;
  stations.forEach((_, i) => {
    if (leftEdge[i] - rightEdge[i] < MIN_WIDTH) start = i + 1;
    else if (i - start > best.end - best.start) best = { start, end: i };
  });
  if ((best.end - best.start) * STATION_STEP < (to - from) / 2) {
    throw new Error(`月台 ${platform.id} 重建後寬度不足`);
  }
  const kept = stations.slice(best.start, best.end + 1);

  const at = (s: number, lateral: number): Local =>
    advance(advance(axis.center, axis.bearing, s), axis.bearing + 90, lateral);
  const ring: Local[] = [
    ...kept.map((s, i) => at(s, leftEdge[best.start + i])),
    ...kept.map((s, i) => at(s, rightEdge[best.start + i])).reverse(),
  ];
  if (polygonArea(ring) < 0) ring.reverse();

  return {
    ...platform,
    geometry: { ...platform.geometry, polygon: ring },
    confidence: "derived",
    sourceNote: (platform.sourceNote ?? "") + EDGE_NOTE + (spec.system === "metro" ? LENGTH_NOTE : ""),
  };
}

/** 以 {@link PLATFORM_REBUILDS} 重建月台多邊形；表列月台不在 `features` 即擲例外。 */
export function rebuildPlatforms(features: Feature[]): Feature[] {
  const rebuilt = new Map<string, Feature>();
  for (const spec of PLATFORM_REBUILDS) {
    const platform = features.find((f) => f.id === spec.id);
    if (!platform?.geometry.polygon) throw new Error(`月台 ${spec.id} 不在場景中`);
    rebuilt.set(spec.id, rebuild(platform, spec, features));
  }
  return features.map((f) => rebuilt.get(f.id) ?? f);
}
