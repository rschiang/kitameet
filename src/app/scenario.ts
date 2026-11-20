/**
 * 方案切換：現況回傳基準量體，方案 B 另外標記拆除、新建與歸還臺鐵的量體。
 * 著色由 {@link Feature.status} 決定，渲染端不需認得方案。
 */
import { buildBaseline } from "../data/scene.ts";
import type { Feature } from "../data/schema.ts";
import { proposalB } from "../data/scenarios/proposal-b.ts";
import { splitPolylineAtX } from "../geo/offset.ts";
import type { ScenarioId } from "./state.ts";

const REBUILD_NOTE = "方案 B 改建區間（延平北路以東至中山北路）內之既有高鐵隧道。";

/**
 * 既有股道跨越改建區間界線時切成兩段：保留段沿用原 id，
 * 改建段另立 `<id>/rebuilt` 並標為拆除重建。
 */
function splitRebuilt(feature: Feature, keep: "west" | "east", limitX: number): Feature[] {
  const polyline = feature.geometry.polyline;
  if (!polyline) return [feature];

  const sides = splitPolylineAtX(polyline, limitX);
  const kept = sides[keep];
  const rebuilt = sides[keep === "west" ? "east" : "west"];
  const out: Feature[] = [];
  if (kept.length >= 2) out.push({ ...feature, geometry: { polyline: kept } });
  if (rebuilt.length >= 2) {
    out.push({
      ...feature,
      id: `${feature.id}/rebuilt`,
      geometry: { polyline: rebuilt },
      status: "removed",
      sourceNote: `${REBUILD_NOTE}${feature.sourceNote ?? ""}`,
    });
  }
  return out.length > 0 ? out : [feature];
}

export function featuresFor(scenario: ScenarioId): Feature[] {
  const baseline = buildBaseline();
  if (scenario === "status-quo") return baseline;

  const removed = new Set(proposalB.removed);
  const repurposed = new Map(proposalB.repurposed.map((item) => [item.id, item.note]));
  const rebuilt = new Map(proposalB.rebuilt.map((item) => [item.id, item]));

  const adjusted = baseline.flatMap((feature): Feature[] => {
    if (removed.has(feature.id)) {
      return [{ ...feature, status: "removed", sourceNote: `方案 B 拆除。${feature.sourceNote ?? ""}` }];
    }
    const note = repurposed.get(feature.id);
    if (note !== undefined) {
      return [{ ...feature, status: "repurposed", sourceNote: `方案 B：${note}。${feature.sourceNote ?? ""}` }];
    }
    const zone = rebuilt.get(feature.id);
    if (zone !== undefined) return splitRebuilt(feature, zone.keep, zone.limitX);
    return [feature];
  });

  return [...adjusted, ...proposalB.added];
}
