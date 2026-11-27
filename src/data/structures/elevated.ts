/**
 * 高架道路的分層高程。
 *
 * 原本所有高架一律取 {@link LEVELS}.elevated 的單一高程，忠孝橋、市民大道、
 * 環河快速道路在塔城街口因此等高互穿。改以實際交叉關係定層：兩條橋面在平面上
 * 相交、不共節點、且 OSM `layer` 不同時，`layer` 大者在上；層級自 0 起逐層疊加
 * {@link TIER_RISE}。絕對高程仍為推估值（市民大道與環河快速道路均未公布橋面高程），
 * 但何者在上為可信。
 */
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset, OsmFeature } from "../osm-types.ts";
import { polylineLength } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { LEVELS } from "../schema.ts";
import { RAMP_GIRDER, RAMP_GROUND, VIADUCT_GIRDER } from "./viaduct.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

/** 相鄰層高架的高差（公尺）：市區道路車道淨高 4.6 加主線梁深。 */
export const TIER_RISE = 4.6 + VIADUCT_GIRDER;

/** 高架縱坡上限；層級變化靠相鄰橋面爬升吸收。 */
const MAX_GRADE = 0.06;

/** 主線落地端的底面高程：橋面頂與匝道落地端的頂面齊平。 */
const LANDING_BASE = RAMP_GROUND + RAMP_GIRDER - VIADUCT_GIRDER;

/** 節點比對的座標格距（公尺）。 */
const nodeKey = (p: Local): string => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

/**
 * 是否為高架結構。`bridge=viaduct`（環河南路快速道路、新北環河快速道路、中山高架）
 * 與 `bridge=yes` 一視同仁：只要有 bridge 標籤且 `layer` 為正即在橋上。
 */
export function isElevatedTags(tags: Record<string, string>): boolean {
  return (
    tags.bridge !== undefined && tags.bridge !== "no" && Number(tags.layer ?? 0) >= 1
  );
}

interface Deck {
  id: string;
  points: Local[];
  layer: number;
}

/** 人行天橋不列入分層：其高程固定於人行橋面層，也不替車行高架定層。 */
const FOOT_HIGHWAY: Record<string, true> = {
  footway: true,
  steps: true,
  path: true,
  cycleway: true,
};

let wayList: OsmFeature[] | null = null;

/** 地下與地面資料集中的道路（去重；至少兩個頂點）。 */
function roadWays(): OsmFeature[] {
  if (wayList) return wayList;
  const seen = new Set<string>();
  wayList = [];
  for (const osm of [...underground.features, ...surface.features]) {
    if (seen.has(osm.id)) continue;
    seen.add(osm.id);
    if ((osm.tags.highway ?? "") === "" || (osm.polyline ?? []).length < 2) continue;
    wayList.push(osm);
  }
  return wayList;
}

/** 地面道路：非高架、非匝道、非快速道路（`trunk` 可能是無 bridge 標籤的落地段）、非人行。 */
export function isGroundRoadTags(tags: Record<string, string>): boolean {
  const highway = tags.highway ?? "";
  return (
    highway !== "" &&
    !isElevatedTags(tags) &&
    !highway.endsWith("_link") &&
    highway !== "trunk" &&
    !FOOT_HIGHWAY[highway]
  );
}

let deckList: Deck[] | null = null;

/** 車行高架主線（匝道不計；匝道高程沿橋面與地面之間內插）。 */
function decks(): Deck[] {
  if (deckList) return deckList;
  deckList = [];
  for (const osm of roadWays()) {
    const highway = osm.tags.highway as string;
    if (highway.endsWith("_link") || FOOT_HIGHWAY[highway]) continue;
    if (!isElevatedTags(osm.tags)) continue;
    deckList.push({ id: osm.id, points: osm.polyline as Local[], layer: Number(osm.tags.layer ?? 0) });
  }
  deckList.sort((a, b) => (a.id < b.id ? -1 : 1));
  return deckList;
}

let groundSet: Set<string> | null = null;

/** 地面道路的所有頂點。 */
function groundVertices(): Set<string> {
  if (groundSet) return groundSet;
  groundSet = new Set();
  for (const osm of roadWays()) {
    if (!isGroundRoadTags(osm.tags)) continue;
    for (const p of osm.polyline as Local[]) groundSet.add(nodeKey(p));
  }
  return groundSet;
}

let elevatedCount: Map<string, number> | null = null;

/** 各頂點為幾條不同的車行高架（含匝道）所共有。 */
function elevatedVertices(): Map<string, number> {
  if (elevatedCount) return elevatedCount;
  elevatedCount = new Map();
  for (const osm of roadWays()) {
    if (FOOT_HIGHWAY[osm.tags.highway as string] || !isElevatedTags(osm.tags)) continue;
    for (const key of new Set((osm.polyline as Local[]).map(nodeKey))) {
      elevatedCount.set(key, (elevatedCount.get(key) ?? 0) + 1);
    }
  }
  return elevatedCount;
}

/** 落地端：只接地面道路、不接其他高架的主線端點。 */
function isLandingEnd(key: string): boolean {
  return groundVertices().has(key) && elevatedVertices().get(key) === 1;
}

/** 主線首尾是否為落地端。 */
function landingEnds(deck: Deck): [boolean, boolean] {
  return [
    isLandingEnd(nodeKey(deck.points[0])),
    isLandingEnd(nodeKey(deck.points[deck.points.length - 1])),
  ];
}

/** 線段是否相交（含端點接觸）。 */
function segmentsCross(a1: Local, a2: Local, b1: Local, b2: Local): boolean {
  const cross = (o: Local, p: Local, q: Local): number =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0) || d1 === 0 || d2 === 0) &&
    ((d3 > 0) !== (d4 > 0) || d3 === 0 || d4 === 0);
}

/** 以格網索引各橋面的線段，供交叉偵測篩候選。 */
const CELL = 50;

function segmentIndex(): Map<string, { deck: number; segment: number }[]> {
  const index = new Map<string, { deck: number; segment: number }[]>();
  decks().forEach((deck, d) => {
    for (let i = 0; i + 1 < deck.points.length; i++) {
      const [a, b] = [deck.points[i], deck.points[i + 1]];
      const minX = Math.floor(Math.min(a[0], b[0]) / CELL);
      const maxX = Math.floor(Math.max(a[0], b[0]) / CELL);
      const minY = Math.floor(Math.min(a[1], b[1]) / CELL);
      const maxY = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x},${y}`;
          const list = index.get(key);
          if (list) list.push({ deck: d, segment: i });
          else index.set(key, [{ deck: d, segment: i }]);
        }
      }
    }
  });
  return index;
}

/** 層級：由交叉關係解出，`layer` 小者在下。 */
function tiers(): number[] {
  const all = decks();
  const nodes = all.map((deck) => new Set(deck.points.map(nodeKey)));
  const index = segmentIndex();
  /** 下層 → 上層的邊。 */
  const above = new Map<number, Set<number>>();
  const seenPair = new Set<string>();
  for (const bucket of index.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [p, q] = [bucket[i], bucket[j]];
        if (p.deck === q.deck) continue;
        const [lo, hi] = all[p.deck].layer < all[q.deck].layer ? [p, q] : [q, p];
        if (all[lo.deck].layer === all[hi.deck].layer) continue;
        const pair = `${p.deck},${p.segment},${q.deck},${q.segment}`;
        if (seenPair.has(pair)) continue;
        seenPair.add(pair);
        // 交會於共用節點者為路網接續，不是立體交叉
        if ([...nodes[p.deck]].some((key) => nodes[q.deck].has(key))) continue;
        const a = all[p.deck].points;
        const b = all[q.deck].points;
        if (!segmentsCross(a[p.segment], a[p.segment + 1], b[q.segment], b[q.segment + 1])) continue;
        const list = above.get(lo.deck);
        if (list) list.add(hi.deck);
        else above.set(lo.deck, new Set([hi.deck]));
      }
    }
  }

  const tier = all.map(() => 0);
  // `layer` 低者必在下，邊必為有向無環圖；輪數以橋面數為上限即可收斂
  for (let round = 0; round <= all.length; round++) {
    let changed = false;
    for (const [lo, his] of above) {
      for (const hi of his) {
        if (tier[hi] >= tier[lo] + 1) continue;
        tier[hi] = tier[lo] + 1;
        changed = true;
      }
    }
    if (!changed) return tier;
  }
  throw new Error("高架分層未收斂：交叉關係出現環路");
}

let nodeElevations: Map<string, number> | null = null;

/**
 * 高架主線端點（落地端除外）的橋面底面高程。相接的橋面分屬不同層時，
 * 共用節點取較高者，再以 {@link MAX_GRADE} 沿各橋面放坡，讓層級變化在鄰接橋面上吸收。
 * 有落地端的橋面不參與放坡，其高程見 {@link deckVertexElevations}。
 */
function deckNodeElevations(): Map<string, number> {
  if (nodeElevations) return nodeElevations;
  const all = decks();
  const tier = tiers();
  const elevations = new Map<string, number>();
  const edges: { a: string; b: string; length: number }[] = [];
  all.forEach((deck, d) => {
    const base = LEVELS.elevated.floor + tier[d] * TIER_RISE - VIADUCT_GIRDER;
    const ends = [nodeKey(deck.points[0]), nodeKey(deck.points[deck.points.length - 1])];
    const lands = landingEnds(deck);
    ends.forEach((end, i) => {
      if (!lands[i]) elevations.set(end, Math.max(elevations.get(end) ?? -Infinity, base));
    });
    if (lands[0] || lands[1]) return;
    edges.push({ a: ends[0], b: ends[1], length: polylineLength(deck.points) });
  });

  for (let round = 0; ; round++) {
    let changed = false;
    for (const edge of edges) {
      const ea = elevations.get(edge.a) as number;
      const eb = elevations.get(edge.b) as number;
      const limit = MAX_GRADE * edge.length;
      if (ea < eb - limit) {
        elevations.set(edge.a, eb - limit);
        changed = true;
      } else if (eb < ea - limit) {
        elevations.set(edge.b, ea - limit);
        changed = true;
      }
    }
    if (!changed) break;
    if (round > 50) throw new Error("高架節點高程未收斂");
  }
  nodeElevations = elevations;
  return nodeElevations;
}

/** 各高架主線的中心線；供橋墩定位與測試使用。 */
export function deckCentrelines(): { id: string; points: Local[] }[] {
  return decks().map(({ id, points }) => ({ id, points }));
}

/** 折線各頂點的累計弧長。 */
function arcLengths(points: Local[]): number[] {
  const arc = [0];
  for (let i = 1; i < points.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return arc;
}

let vertexElevationList: Map<string, number[]> | null = null;

/**
 * 各高架主線逐頂點的橋面底面高程。無落地端者依弧長在兩端節點高程之間內插；
 * 落地端自最近的高架交會頂點（錨點）以直線斜降至 {@link LANDING_BASE}，錨點以內維持橋面高程。
 */
export function deckVertexElevations(): Map<string, number[]> {
  if (vertexElevationList) return vertexElevationList;
  const nodes = deckNodeElevations();
  const shared = elevatedVertices();
  let tier: number[] | undefined;
  const result = new Map<string, number[]>();
  decks().forEach((deck, d) => {
    const { points } = deck;
    const last = points.length - 1;
    const arc = arcLengths(points);
    const isAnchor = (i: number): boolean => (shared.get(nodeKey(points[i])) ?? 0) >= 2;
    /** 自錨點 `anchor` 的高程 `high` 依弧長斜降至落地端 `landing`。 */
    const descend = (out: number[], anchor: number, landing: number, high: number): void => {
      const span = Math.abs(arc[landing] - arc[anchor]);
      const step = landing >= anchor ? 1 : -1;
      for (let i = anchor; i !== landing + step; i += step) {
        out[i] = span > 0 ? high + ((LANDING_BASE - high) * Math.abs(arc[i] - arc[anchor])) / span : LANDING_BASE;
      }
    };
    const [startLands, endLands] = landingEnds(deck);
    let out: number[];
    if (!startLands && !endLands) {
      const base = nodes.get(nodeKey(points[0])) as number;
      const end = nodes.get(nodeKey(points[last])) as number;
      const total = arc[last];
      out = arc.map((s) => (total > 0 ? base + ((end - base) * s) / total : base));
    } else if (startLands !== endLands) {
      const [landing, far, step] = startLands ? [0, last, 1] : [last, 0, -1];
      const high = nodes.get(nodeKey(points[far])) as number;
      let anchor = far;
      for (let i = landing + step; i !== far; i += step) {
        if (isAnchor(i)) {
          anchor = i;
          break;
        }
      }
      out = points.map(() => high);
      descend(out, anchor, landing, high);
    } else {
      tier ??= tiers();
      const high = LEVELS.elevated.floor + tier[d] * TIER_RISE - VIADUCT_GIRDER;
      let first = -1;
      let final = -1;
      for (let i = 1; i < last; i++) {
        if (!isAnchor(i)) continue;
        if (first < 0) first = i;
        final = i;
      }
      if (first < 0) {
        // 無交會頂點：以最接近弧長中點的頂點為共同錨點
        let mid = 0;
        for (let i = 1; i <= last; i++) {
          if (Math.abs(arc[i] - arc[last] / 2) < Math.abs(arc[mid] - arc[last] / 2)) mid = i;
        }
        first = final = mid;
      }
      out = points.map(() => high);
      descend(out, first, 0, high);
      descend(out, final, last, high);
      out[0] = LANDING_BASE;
      out[last] = LANDING_BASE;
    }
    result.set(deck.id, out);
  });
  vertexElevationList = result;
  return result;
}

interface DeckProfile {
  base: number;
  baseEnd: number;
  /** 逐頂點的底面高程；只有帶落地端的主線才有。 */
  elevations?: number[];
}

let profiles: Map<string, DeckProfile> | null = null;

/** 各高架主線橋面的底面高程；兩端不等高者即為縱坡段。 */
export function deckProfiles(): Map<string, DeckProfile> {
  if (profiles) return profiles;
  const vertices = deckVertexElevations();
  profiles = new Map();
  for (const deck of decks()) {
    const elevations = vertices.get(deck.id) as number[];
    const lands = landingEnds(deck);
    profiles.set(deck.id, {
      base: elevations[0],
      baseEnd: elevations[elevations.length - 1],
      ...(lands[0] || lands[1] ? { elevations } : {}),
    });
  }
  return profiles;
}

let vertexIndex: Map<string, number> | null = null;

/** 高架主線各頂點的橋面底面高程；多條主線共用的頂點取最高者。供匝道鏈定橋面錨點。 */
export function deckVertexIndex(): Map<string, number> {
  if (vertexIndex) return vertexIndex;
  const index = new Map<string, number>();
  for (const deck of decks()) {
    const elevations = deckVertexElevations().get(deck.id) as number[];
    deck.points.forEach((p, i) => {
      const key = nodeKey(p);
      index.set(key, Math.max(index.get(key) ?? -Infinity, elevations[i]));
    });
  }
  vertexIndex = index;
  return index;
}

export const ELEVATED_NOTE =
  "高架橋面高程為推估：以 OSM `layer` 判定的實際交叉關係分層，" +
  `每層相差 ${TIER_RISE.toFixed(1)} 公尺（市區道路車道淨高 4.6 公尺加主線梁深 ${VIADUCT_GIRDER} 公尺），` +
  `最低層橋面頂沿用 ${LEVELS.elevated.floor} 公尺；層級變化以不超過 ${(MAX_GRADE * 100).toFixed(0)}% 的縱坡在鄰接橋面上吸收。` +
  "只接地面道路的主線端點視為落地端，自最近的高架交會點以直線斜降至地面。";
