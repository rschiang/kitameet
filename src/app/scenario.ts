/**
 * 方案切換：現況回傳基準量體，方案 B 另外標記拆除、新建與歸還臺鐵的量體。
 * 著色由 {@link Feature.status} 決定，渲染端不需認得方案。
 */
import { buildBaseline } from "../data/scene.ts";
import type { Feature } from "../data/schema.ts";
import { proposalB } from "../data/scenarios/proposal-b.ts";
import { splitPolygonByPolyline, splitPolylineByPolyline } from "../geo/clip.ts";
import { splitPolylineAtX } from "../geo/offset.ts";
import type { Local } from "../geo/project.ts";
import type { ScenarioId } from "./state.ts";

/**
 * 既有股道跨越改建區間界線時切成兩段：保留段沿用原 id，
 * 改建段另立 `<id>/rebuilt` 並標為拆除重建。
 */
function splitRebuilt(
  feature: Feature,
  zone: { keep: "west" | "east"; limitX: number; note: string },
): Feature[] {
  const polyline = feature.geometry.polyline;
  if (!polyline) return [feature];

  const sides = splitPolylineAtX(polyline, zone.limitX);
  const kept = sides[zone.keep];
  const rebuilt = sides[zone.keep === "west" ? "east" : "west"];
  const out: Feature[] = [];
  if (kept.length >= 2) out.push({ ...feature, geometry: { polyline: kept } });
  if (rebuilt.length >= 2) {
    out.push({
      ...feature,
      id: `${feature.id}/rebuilt`,
      geometry: { polyline: rebuilt },
      status: "removed",
      sourceNote: `${zone.note}${feature.sourceNote ?? ""}`,
    });
  }
  return out.length > 0 ? out : [feature];
}

/**
 * 既有構造物與新建工程的開挖範圍重疊時沿包絡邊緣切開：
 * 落在範圍內的片段標為拆除重建，其餘片段保留（第一塊沿用原 id）。
 */
function encroach(feature: Feature, zone: { edge: Local[]; note: string }): Feature[] {
  const { polygon, polyline } = feature.geometry;
  const sides = polygon
    ? splitPolygonByPolyline(polygon, zone.edge)
    : polyline
      ? splitPolylineByPolyline(polyline, zone.edge)
      : null;
  if (!sides) return [feature];

  const minPoints = polygon ? 3 : 2;
  const inside = sides.left.filter((part) => part.length >= minPoints);
  if (inside.length === 0) return [feature];
  const kept = sides.right.filter((part) => part.length >= minPoints);
  const geometry = (part: Local[]) => (polygon ? { polygon: part } : { polyline: part });
  const note = `${zone.note}${feature.sourceNote ?? ""}`;

  return [
    ...kept.map((part, i) => ({
      ...feature,
      id: i === 0 ? feature.id : `${feature.id}/kept/${i + 1}`,
      geometry: geometry(part),
    })),
    ...inside.map((part, i) => ({
      ...feature,
      id: i === 0 ? `${feature.id}/rebuilt` : `${feature.id}/rebuilt/${i + 1}`,
      geometry: geometry(part),
      status: "removed" as const,
      sourceNote: note,
    })),
  ];
}

export function featuresFor(scenario: ScenarioId): Feature[] {
  const baseline = buildBaseline();
  if (scenario === "status-quo") return baseline;

  const removed = new Set(proposalB.removed);
  const repurposed = new Map(proposalB.repurposed.map((item) => [item.id, item.note]));
  const rebuilt = new Map(proposalB.rebuilt.map((item) => [item.id, item]));
  const encroached = proposalB.encroached.map((zone) => ({ ...zone, ids: new Set(zone.ids) }));

  const adjusted = baseline.flatMap((feature): Feature[] => {
    if (removed.has(feature.id)) {
      return [{ ...feature, status: "removed", sourceNote: `方案 B 拆除。${feature.sourceNote ?? ""}` }];
    }
    const note = repurposed.get(feature.id);
    if (note !== undefined) {
      return [{ ...feature, status: "repurposed", sourceNote: `方案 B：${note}。${feature.sourceNote ?? ""}` }];
    }
    const zone = rebuilt.get(feature.id);
    if (zone !== undefined) return splitRebuilt(feature, zone);
    const works = encroached.find((item) => item.ids.has(feature.id));
    if (works !== undefined) return encroach(feature, works);
    return [feature];
  });

  return [...adjusted, ...proposalB.added];
}
