/**
 * 高架道路的橋墩。
 *
 * OSM 只有橋面中心線，沒有橋墩圖徵；位置與尺寸一律為推估：
 * 沿各橋面中心線每 {@link PIER_SPACING} 公尺一柱，柱頂接該處的橋面底面。
 */
import { pointInPolygon } from "../../geo/measure.ts";
import { polylineLength, truncatePolyline } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { elevationAt } from "../elevation.ts";
import { GROUND_EL, aboveGround, type Feature } from "../schema.ts";

/** 主線橋面的梁深（公尺）：橋面頂維持 {@link LEVELS}.elevated 的離地 8.0 公尺。 */
export const VIADUCT_GIRDER = 1.8;
/** 匝道橋面的梁深（公尺）；單車道橋面較主線淺。 */
export const RAMP_GIRDER = 1.0;
/** 匝道落地端的高程（公尺）。 */
export const RAMP_GROUND = aboveGround(0.1);

/**
 * 橋墩間距與斷面邊長（公尺）。間距取《中華技術》〈都市高架快速道路之設計與施工〉
 * 所載市民大道跨徑（環河南路—金山街段 30～62 公尺、其餘路段 40～85 公尺）的下限。
 */
const PIER_SPACING = 40;
const PIER_SIZE = 2.0;
/** 兩根橋墩視為同一根的距離（公尺）：雙幅並行的橋面共用一柱。 */
const PIER_MERGE_DISTANCE = 8;
/** 共用一柱的柱頂高差上限（公尺）；超過即為不同層的高架，各自立柱。 */
const PIER_MERGE_RISE = 1.0;
/** 柱高下限（公尺）：落地段離地不足者不立柱。 */
const PIER_MIN_HEIGHT = 2.0;

const NOTE =
  `橋墩位置與尺寸為推估：沿各高架橋面中心線每 ${PIER_SPACING} 公尺一柱，` +
  "柱頂接該處橋面底面，柱底落在河道內者伸至河床；" +
  `離地不足 ${PIER_MIN_HEIGHT} 公尺的落地段不立柱。`;

/** 以中心點與邊長產生正方形輪廓。 */
function square(centre: Local, size: number): Local[] {
  const half = size / 2;
  return [
    [centre[0] - half, centre[1] - half],
    [centre[0] + half, centre[1] - half],
    [centre[0] + half, centre[1] + half],
    [centre[0] - half, centre[1] + half],
  ];
}

/**
 * 高架橋面的橋墩。`decks` 為高架主線量體（匝道不立柱，由主線橋墩支撐），
 * `waters` 為河道多邊形，柱底落在其中者伸至 `channelBed`。
 * 量體依 id 排序後處理，使結果可重現。
 */
export function buildViaduct(decks: Feature[], waters: Local[][], channelBed: number): Feature[] {
  const lines = decks
    .filter((deck) => (deck.geometry.polyline?.length ?? 0) >= 2)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const placed: { centre: Local; top: number }[] = [];
  const piers: Feature[] = [];
  for (const deck of lines) {
    const points = deck.geometry.polyline as Local[];
    const length = polylineLength(points);
    // 柱頂即該處的橋面底面：依逐頂點高程或兩端高程沿弧長內插
    const topAt = elevationAt(deck);
    let index = 0;
    for (let along = PIER_SPACING / 2; along < length; along += PIER_SPACING) {
      const walked = truncatePolyline(points, along);
      const centre = walked[walked.length - 1];
      const top = topAt(along);
      index += 1;
      if (
        placed.some(
          (p) =>
            Math.hypot(p.centre[0] - centre[0], p.centre[1] - centre[1]) < PIER_MERGE_DISTANCE &&
            Math.abs(p.top - top) < PIER_MERGE_RISE,
        )
      ) {
        continue;
      }
      const bottom = waters.some((water) => pointInPolygon(centre, water)) ? channelBed : GROUND_EL;
      if (top - bottom < PIER_MIN_HEIGHT) continue;
      placed.push({ centre, top });
      piers.push({
        id: `${deck.id}/pier/${index}`,
        kind: "elevated-road",
        name: `${deck.name ?? "高架橋"}橋墩`,
        level: "G",
        layer: "elevated-road",
        geometry: { polygon: square(centre, PIER_SIZE) },
        base: bottom,
        height: top - bottom,
        confidence: "estimated",
        sourceNote: NOTE,
        status: "existing",
      });
    }
  }
  return piers;
}
