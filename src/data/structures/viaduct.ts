/**
 * 市民大道高架的橋墩。
 *
 * OSM 只有橋面中心線，沒有橋墩圖徵；位置與尺寸一律為推估：
 * 沿橋面每 {@link PIER_SPACING} 公尺一柱，兩幅橋面之間以單柱呈現。
 */
import { nearestOnPolyline } from "../../geo/measure.ts";
import { polylineLength, truncatePolyline } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { LEVELS, type Feature } from "../schema.ts";

/** 主線橋面的梁深（公尺）：橋面頂維持 {@link LEVELS}.elevated 的 8.0 公尺。 */
export const VIADUCT_GIRDER = 1.8;
/** 匝道橋面的梁深（公尺）；單車道橋面較主線淺。 */
export const RAMP_GIRDER = 1.0;

/** 橋墩間距與斷面邊長（公尺）。 */
const PIER_SPACING = 30;
const PIER_SIZE = 1.6;
/** 另一幅橋面納入同一根橋墩的距離上限（公尺）。 */
const PAIR_DISTANCE = 30;
/** 兩根橋墩視為同一根的距離（公尺）。 */
const PIER_MERGE_DISTANCE = 5;

const NOTE = "橋墩位置與尺寸為推估：沿橋面中心線每 30 公尺一柱，兩幅橋面間以單柱呈現。";

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
 * 高架主線橋面的橋墩。`decks` 須為高架主線量體（匝道不立柱，由主線橋墩支撐）。
 * 量體依 id 排序後處理，使結果可重現。
 */
export function buildViaduct(decks: Feature[]): Feature[] {
  const lines = decks
    .flatMap((deck) => {
      const points = deck.geometry.polyline;
      return points && points.length >= 2 ? [{ id: deck.id, points }] : [];
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const top = LEVELS.elevated.floor - VIADUCT_GIRDER;
  const placed: Local[] = [];
  const piers: Feature[] = [];
  for (const deck of lines) {
    const length = polylineLength(deck.points);
    let index = 0;
    for (let along = PIER_SPACING / 2; along < length; along += PIER_SPACING) {
      const walked = truncatePolyline(deck.points, along);
      const point = walked[walked.length - 1];
      // 兩幅橋面之間立單柱：取另一幅橋面上的最近點，以兩點中點為柱心
      let centre = point;
      let best = Infinity;
      for (const other of lines) {
        if (other.id === deck.id) continue;
        const near = nearestOnPolyline(point, other.points);
        if (near.distance < best && near.distance <= PAIR_DISTANCE) {
          best = near.distance;
          centre = [(point[0] + near.point[0]) / 2, (point[1] + near.point[1]) / 2];
        }
      }
      index += 1;
      if (placed.some((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1]) < PIER_MERGE_DISTANCE)) {
        continue;
      }
      placed.push(centre);
      piers.push({
        id: `${deck.id}/pier/${index}`,
        kind: "elevated-road",
        name: "市民大道高架橋墩",
        level: "G",
        layer: "elevated-road",
        geometry: { polygon: square(centre, PIER_SIZE) },
        base: 0,
        height: top,
        confidence: "estimated",
        sourceNote: NOTE,
        status: "existing",
      });
    }
  }
  return piers;
}
