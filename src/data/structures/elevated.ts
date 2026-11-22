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
import type { OsmDataset } from "../osm-types.ts";
import { polylineLength } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { LEVELS } from "../schema.ts";
import { VIADUCT_GIRDER } from "./viaduct.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

/** 相鄰層高架的高差（公尺）：市區道路車道淨高 4.6 加主線梁深。 */
export const TIER_RISE = 4.6 + VIADUCT_GIRDER;

/** 高架縱坡上限；層級變化靠相鄰橋面爬升吸收。 */
const MAX_GRADE = 0.06;

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

let deckList: Deck[] | null = null;

/** 車行高架主線（匝道不計；匝道高程沿橋面與地面之間內插）。 */
function decks(): Deck[] {
  if (deckList) return deckList;
  const seen = new Set<string>();
  deckList = [];
  for (const osm of [...underground.features, ...surface.features]) {
    if (seen.has(osm.id)) continue;
    seen.add(osm.id);
    const highway = osm.tags.highway ?? "";
    const points = osm.polyline ?? [];
    if (highway === "" || highway.endsWith("_link") || points.length < 2) continue;
    if (FOOT_HIGHWAY[highway]) continue;
    if (!isElevatedTags(osm.tags)) continue;
    deckList.push({ id: osm.id, points, layer: Number(osm.tags.layer ?? 0) });
  }
  deckList.sort((a, b) => (a.id < b.id ? -1 : 1));
  return deckList;
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
 * 高架主線端點的橋面底面高程。相接的橋面分屬不同層時，
 * 共用節點取較高者，再以 {@link MAX_GRADE} 沿各橋面放坡，讓層級變化在鄰接橋面上吸收。
 */
export function deckNodeElevations(): Map<string, number> {
  if (nodeElevations) return nodeElevations;
  const all = decks();
  const tier = tiers();
  const elevations = new Map<string, number>();
  const edges: { a: string; b: string; length: number }[] = [];
  all.forEach((deck, d) => {
    const base = LEVELS.elevated.floor + tier[d] * TIER_RISE - VIADUCT_GIRDER;
    const ends = [nodeKey(deck.points[0]), nodeKey(deck.points[deck.points.length - 1])];
    for (const end of ends) elevations.set(end, Math.max(elevations.get(end) ?? -Infinity, base));
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

let profiles: Map<string, { base: number; baseEnd: number }> | null = null;

/** 各高架主線橋面的底面高程；兩端不等高者即為縱坡段。 */
export function deckProfiles(): Map<string, { base: number; baseEnd: number }> {
  if (profiles) return profiles;
  const elevations = deckNodeElevations();
  profiles = new Map();
  for (const deck of decks()) {
    const base = elevations.get(nodeKey(deck.points[0])) as number;
    const baseEnd = elevations.get(nodeKey(deck.points[deck.points.length - 1])) as number;
    profiles.set(deck.id, { base, baseEnd });
  }
  return profiles;
}

export const ELEVATED_NOTE =
  "高架橋面高程為推估：以 OSM `layer` 判定的實際交叉關係分層，" +
  `每層相差 ${TIER_RISE.toFixed(1)} 公尺（市區道路車道淨高 4.6 公尺加主線梁深 ${VIADUCT_GIRDER} 公尺），` +
  `最低層橋面頂沿用 ${LEVELS.elevated.floor} 公尺；層級變化以不超過 ${(MAX_GRADE * 100).toFixed(0)}% 的縱坡在鄰接橋面上吸收。`;
