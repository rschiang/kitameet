/**
 * 方案切換：現況回傳基準量體，方案 B、C 另外標記拆除、新建與歸還臺鐵的量體。
 * 拆除的量體於呈現前即濾除（{@link displayedFeatures}）；著色只看 {@link Feature.line}，渲染端不需認得方案。
 */
import { buildBaseline } from "../data/scene.ts";
import type { Feature } from "../data/schema.ts";
import { proposalB } from "../data/scenarios/proposal-b.ts";
import { proposalC } from "../data/scenarios/proposal-c.ts";
import { splitPolygonByPolyline, splitPolylineByPolyline, splitPolylineByRing } from "../geo/clip.ts";
import { pointInPolygon } from "../geo/measure.ts";
import { splitPolylineAtX } from "../geo/offset.ts";
import { splitAtAlong } from "../data/scenarios/shared.ts";
import type { Local } from "../geo/project.ts";
import type { ScenarioId } from "./state.ts";

/**
 * 既有股道跨越改建區間界線時切成兩段：保留段沿用原 id，
 * 改建段另立 `<id>/rebuilt` 並標為拆除重建。
 * 改建段中改作臺鐵喉道的區間（`zone.tra`，沿既有第一月台主軸）另立 `<id>/tra` 保留。
 */
function splitRebuilt(
  feature: Feature,
  zone: { keep: "west" | "east"; limitX: number; note: string; tra?: { from: number; to: number } },
  label: string,
): Feature[] {
  const polyline = feature.geometry.polyline;
  if (!polyline) return [feature];

  const sides = splitPolylineAtX(polyline, zone.limitX);
  const kept = sides[zone.keep];
  const rebuilt = sides[zone.keep === "west" ? "east" : "west"];
  const out: Feature[] = [];
  if (kept.length >= 2) out.push({ ...feature, geometry: { polyline: kept } });
  if (rebuilt.length >= 2) {
    const { tra, outside } = carveTra(rebuilt, zone.tra);
    out.push(
      ...outside.map((part, i) => ({
        ...feature,
        id: i === 0 ? `${feature.id}/rebuilt` : `${feature.id}/rebuilt/${i + 1}`,
        geometry: { polyline: part },
        status: "removed" as const,
        sourceNote: `${zone.note}${feature.sourceNote ?? ""}`,
      })),
    );
    if (tra) {
      out.push({
        ...feature,
        id: `${feature.id}/tra`,
        line: "tra",
        geometry: { polyline: tra },
        status: "repurposed",
        sourceNote: `${label}：改作臺鐵喉道，軌距由 1435 mm 改為 1067 mm。${feature.sourceNote ?? ""}`,
      });
    }
  }
  return out.length > 0 ? out : [feature];
}

/** 改建段沿主軸切出改作臺鐵的區間；其餘段落仍為拆除重建。 */
function carveTra(
  rebuilt: Local[],
  range: { from: number; to: number } | undefined,
): { tra: Local[] | null; outside: Local[][] } {
  if (range === undefined) return { tra: null, outside: [rebuilt] };

  const outside: Local[][] = [];
  let rest = rebuilt;
  if (Number.isFinite(range.from)) {
    const { before, after } = splitAtAlong(rest, range.from);
    if (before.length >= 2) outside.push(before);
    rest = after;
  }
  if (Number.isFinite(range.to)) {
    const { before, after } = splitAtAlong(rest, range.to);
    if (after.length >= 2) outside.push(after);
    rest = before;
  }
  return { tra: rest.length >= 2 ? rest : null, outside };
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

/**
 * 拆除地下街範圍內的 B1、地面層動線：通道沿輪廓切開，只拆除界內的段落；
 * 其餘量體（階梯、電扶梯、電梯、出入口雨棚）只要有一個頂點落在界內即整座拆除。
 * 界外完全沒有交集時回傳 null，由呼叫端沿用原量體。
 */
function clearMall(
  feature: Feature,
  mall: { ring: Local[]; name: string },
  label: string,
): Feature[] | null {
  if (feature.layer !== "passage" || (feature.level !== "B1" && feature.level !== "G")) return null;
  const { polygon, polyline } = feature.geometry;
  const note = `${label}：位於拆除的${mall.name}範圍內，一併拆除。${feature.sourceNote ?? ""}`;

  if (feature.kind === "passage" && polyline) {
    const { inside, outside } = splitPolylineByRing(polyline, mall.ring);
    if (inside.length === 0) return null;
    return [
      ...outside.map((part, i) => ({
        ...feature,
        id: i === 0 ? feature.id : `${feature.id}/kept/${i + 1}`,
        geometry: { polyline: part },
      })),
      ...inside.map((part, i) => ({
        ...feature,
        id: i === 0 ? `${feature.id}/cleared` : `${feature.id}/cleared/${i + 1}`,
        geometry: { polyline: part },
        status: "removed" as const,
        sourceNote: note,
      })),
    ];
  }

  const points = polygon ?? polyline;
  if (!points?.some((p) => pointInPolygon(p, mall.ring))) return null;
  return [{ ...feature, status: "removed", sourceNote: note }];
}

export function featuresFor(scenario: ScenarioId): Feature[] {
  const baseline = buildBaseline();
  if (scenario === "status-quo") return baseline;

  const proposal = scenario === "proposal-b" ? proposalB : proposalC;
  const removed = new Set(proposal.removed);
  const repurposed = new Map(proposal.repurposed.map((item) => [item.id, item.note]));
  const rebuilt = new Map(proposal.rebuilt.map((item) => [item.id, item]));
  const encroached = proposal.encroached.map((zone) => ({ ...zone, ids: new Set(zone.ids) }));
  const malls = baseline.flatMap((f) =>
    removed.has(f.id) && f.kind === "underground-mall" && f.geometry.polygon
      ? [{ ring: f.geometry.polygon, name: f.name ?? "地下街" }]
      : [],
  );

  const adjusted = baseline.flatMap((feature): Feature[] => {
    if (removed.has(feature.id)) {
      return [{ ...feature, status: "removed", sourceNote: `${proposal.label} 拆除。${feature.sourceNote ?? ""}` }];
    }
    const note = repurposed.get(feature.id);
    if (note !== undefined) {
      return [{ ...feature, line: "tra", status: "repurposed", sourceNote: `${proposal.label}：${note}。${feature.sourceNote ?? ""}` }];
    }
    const zone = rebuilt.get(feature.id);
    if (zone !== undefined) return splitRebuilt(feature, zone, proposal.label);
    const works = encroached.find((item) => item.ids.has(feature.id));
    if (works !== undefined) return encroach(feature, works);
    for (const mall of malls) {
      const cleared = clearMall(feature, mall, proposal.label);
      if (cleared !== null) return cleared;
    }
    return [feature];
  });

  return [...adjusted, ...proposal.added];
}

/** 畫面呈現的量體：方案模式不呈現拆除的量體。 */
export function displayedFeatures(scenario: ScenarioId): Feature[] {
  return featuresFor(scenario).filter((f) => f.status !== "removed");
}
