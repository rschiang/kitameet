/**
 * 機場捷運 A1 直通化：兩座島式月台的四條股道皆可東行，北側正線與北側外側側線匯入北尾軌、
 * 南側正線與南側外側側線匯入南尾軌。方案 B 的尾軌下穿淡水信義線車站與其基礎後止於中山北路一段西側；
 * 方案 C 的尾軌維持坡度 0，止於淡水信義線車站箱涵前。
 * 方案幾何疊加在現況路網上：起點、方位、軌道面與所跨越構造物的深度一律於測試時自現況路網讀取，
 * 現況路網一變動，方案幾何須隨之更新，否則本檔失敗。
 */
import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { BOX_BASE_DROP, BOX_HEIGHT } from "../src/data/dorts.ts";
import { elevationAt, vertexElevations } from "../src/data/elevation.ts";
import { STRUCTURES } from "../src/data/levels.ts";
import { baselineById, buildBaseline } from "../src/data/scene.ts";
import { A1_TERRAIN_GRADE, WORKS_CLEARANCE, platform1Axis } from "../src/data/scenarios/shared.ts";
import type { Feature } from "../src/data/schema.ts";
import { arcLengths, MIN_TRACK_SEPARATION, nearestArc } from "../src/data/structures/metro-profile.ts";
import { sideOfPolyline } from "../src/geo/clip.ts";
import { resample } from "../src/geo/corridor.ts";
import { decompose, nearestOnPolyline, pointInPolygon } from "../src/geo/measure.ts";
import type { Local } from "../src/geo/project.ts";

/** 兩組喉道：正線與外側側線匯入同一條尾軌。 */
const GROUPS = [
  { side: "北", main: "metro/a/north", siding: "way/619251069" },
  { side: "南", main: "metro/a/south", siding: "way/619251068" },
] as const;
/** 尾軌東端的沿主軸位置（公尺）：中山北路一段西側車道。 */
const TAIL_END = 309;
/** 淡水信義線台北車站箱涵。 */
const RED_BOX = "dorts/T/box/1";

/** 折線的最小曲率半徑（公尺）；直線段略過。 */
function minRadius(points: Local[]): number {
  let min = Infinity;
  for (let i = 2; i < points.length - 2; i++) {
    const [a, b, c] = [points[i - 2], points[i], points[i + 2]];
    const ab = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const bc = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    if (area < 1e-6) continue;
    min = Math.min(min, (ab * bc * ca) / (4 * area));
  }
  return min;
}

/** 兩組折線之間的最短距離（公尺），量到線段而非頂點。 */
function segmentDistance(a: Local[], b: Local[]): number {
  let min = Infinity;
  for (const p of a) min = Math.min(min, nearestOnPolyline(p, b).distance);
  for (const q of b) min = Math.min(min, nearestOnPolyline(q, a).distance);
  return min;
}

const bearingOf = (a: Local, b: Local): number => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const angleDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/** 兩折線的平面交點，各附沿兩線的弧長。 */
function crossings(a: Local[], b: Local[]): { arcA: number; arcB: number }[] {
  const [ca, cb] = [arcLengths(a), arcLengths(b)];
  const out: { arcA: number; arcB: number }[] = [];
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [p, r] = [a[i - 1], [a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]]];
      const [q, s] = [b[j - 1], [b[j][0] - b[j - 1][0], b[j][1] - b[j - 1][1]]];
      const denom = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(denom) < 1e-12) continue;
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denom;
      const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / denom;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({ arcA: ca[i - 1] + t * (ca[i] - ca[i - 1]), arcB: cb[j - 1] + u * (cb[j] - cb[j - 1]) });
    }
  }
  return out;
}

/** 量體各線段的坡度（絕對值）。 */
function grades(feature: Feature): number[] {
  const line = feature.geometry.polyline!;
  const elevations = vertexElevations(feature);
  const arcs = arcLengths(line);
  return line.slice(1).map((_, i) => Math.abs(elevations[i + 1] - elevations[i]) / (arcs[i + 1] - arcs[i]));
}

/** 現況股道的東端：位置、東行方位與軌道面高程。 */
function eastEnd(id: string): { end: Local; bearing: number; elevation: number } {
  const axis = platform1Axis();
  const feature = baselineById(id)!;
  const line = feature.geometry.polyline!;
  const band = line.map((p) => decompose(axis.center, axis.bearing, p).along);
  const last = band.indexOf(Math.max(...band));
  const prev = line[last === 0 ? 1 : last - 1];
  return { end: line[last], bearing: bearingOf(prev, line[last]), elevation: vertexElevations(feature)[last] };
}

describe.each([
  { scenario: "proposal-b", mode: "underpass" },
  { scenario: "proposal-c", mode: "stub" },
] as const)("$scenario 的機場捷運尾軌（$mode）", ({ scenario, mode }) => {
  const features = featuresFor(scenario);
  const byId = new Map(features.map((f) => [f.id, f]));
  const get = (id: string): Feature => {
    const feature = byId.get(id);
    expect(feature, id).toBeDefined();
    return feature!;
  };
  const tail = (side: string): Feature => get(`${scenario}/a1/tail/${side}`);
  const branch = (side: string): Feature => get(`${scenario}/a1/branch/${side}`);
  const lineOf = (feature: Feature): Local[] => feature.geometry.polyline!;
  const railAt = (feature: Feature, p: Local): number => {
    const line = lineOf(feature);
    return elevationAt(feature)(nearestArc(line, arcLengths(line), p).arc);
  };

  it("起點位置與方位取自現況股道的東端", () => {
    for (const group of GROUPS) {
      for (const [feature, id] of [
        [tail(group.side), group.main],
        [branch(group.side), group.siding],
      ] as const) {
        const anchor = eastEnd(id);
        const line = lineOf(feature);
        expect(Math.hypot(line[0][0] - anchor.end[0], line[0][1] - anchor.end[1]), `${feature.id} 起點`).toBeLessThan(
          0.05,
        );
        expect(angleDiff(bearingOf(line[0], line[1]), anchor.bearing), `${feature.id} 起點方位`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("軌道面與現況股道、尾軌連續，坡度不超過該方案的上限", () => {
    const link = get(`${scenario}/a1/link/X1`);
    for (const group of GROUPS) {
      const t = tail(group.side);
      const b = branch(group.side);
      expect(vertexElevations(t)[0], `${t.id} 起點高程`).toBeCloseTo(eastEnd(group.main).elevation, 6);
      expect(vertexElevations(b)[0], `${b.id} 起點高程`).toBeCloseTo(eastEnd(group.siding).elevation, 6);
      const bLine = lineOf(b);
      expect(vertexElevations(b).at(-1)!, `${b.id} 匯入處高程`).toBeCloseTo(railAt(t, bLine.at(-1)!), 6);
    }
    const [from, to] = lineOf(link);
    expect(vertexElevations(link)[0], "X1 南端高程").toBeCloseTo(railAt(tail("南"), from), 6);
    expect(vertexElevations(link)[1], "X1 北端高程").toBeCloseTo(railAt(tail("北"), to), 6);
    // 下穿援用地形限制段的特例上限；止於箱涵前者全段水平
    const limit = mode === "underpass" ? A1_TERRAIN_GRADE : 0;
    for (const feature of [tail("北"), tail("南"), branch("北"), branch("南"), link]) {
      expect(Math.max(...grades(feature)), feature.id).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it.runIf(mode === "underpass")("尾軌自淡水信義線正線與車站構造物的結構底下方通過", () => {
    const red = features.filter((f) => f.kind === "track-metro" && f.line === "r" && f.trackRole === "main");
    const structures = buildBaseline().filter(
      (f) => f.line === "r" && f.layer === "metro" && f.structure !== undefined && f.geometry.polygon,
    );
    for (const group of GROUPS) {
      const t = tail(group.side);
      const line = lineOf(t);
      const at = elevationAt(t);
      let crossed = 0;
      for (const main of red) {
        const hits = crossings(line, lineOf(main));
        if (hits.length > 0) crossed += 1;
        for (const hit of hits) {
          expect(at(hit.arcA), `${t.id} 跨越 ${main.id}`).toBeLessThanOrEqual(
            elevationAt(main)(hit.arcB) - MIN_TRACK_SEPARATION + 1e-6,
          );
        }
      }
      expect(crossed, `${t.id} 橫越的淡水信義線正線`).toBeGreaterThanOrEqual(2);

      const samples = resample(line, 0.5);
      const arcs = arcLengths(samples);
      const entered = new Set<string>();
      for (const s of structures) {
        const bottom = STRUCTURES[s.structure!].bottom;
        samples.forEach((p, i) => {
          if (!pointInPolygon(p, s.geometry.polygon!)) return;
          entered.add(s.id);
          expect(at(arcs[i]) + (BOX_HEIGHT - BOX_BASE_DROP), `${t.id} 箱頂於 ${s.id}`).toBeLessThanOrEqual(bottom + 1e-6);
        });
      }
      expect(entered.has(RED_BOX), `${t.id} 穿越 ${RED_BOX}`).toBe(true);
    }
  });

  it.runIf(mode === "stub")("尾軌止於淡水信義線車站箱涵前，不跨越淡水信義線", () => {
    const ring = baselineById(RED_BOX)!.geometry.polygon!;
    const outline = [...ring, ring[0]];
    const red = features.filter((f) => f.kind === "track-metro" && f.line === "r" && f.trackRole === "main");
    for (const group of GROUPS) {
      const t = tail(group.side);
      const line = lineOf(t);
      for (const p of resample(line, 0.5)) {
        expect(pointInPolygon(p, ring), `${t.id} 落入 ${RED_BOX}`).toBe(false);
        expect(nearestOnPolyline(p, outline).distance, `${t.id} 距 ${RED_BOX}`).toBeGreaterThanOrEqual(WORKS_CLEARANCE - 1e-6);
      }
      // 止於箱涵前而非更早：東端距箱涵不超過淨距加一個取樣間距
      expect(nearestOnPolyline(line.at(-1)!, outline).distance, `${t.id} 東端`).toBeLessThan(WORKS_CLEARANCE + 1);
      for (const main of red) expect(crossings(line, lineOf(main)), `${t.id} 跨越 ${main.id}`).toHaveLength(0);
    }
  });

  it("側線延伸匯入同側尾軌，角色與銜接關係正確", () => {
    for (const group of GROUPS) {
      const t = tail(group.side);
      const b = branch(group.side);
      const tLine = lineOf(t);
      const bLine = lineOf(b);
      const merge = bLine.at(-1)!;
      expect(nearestOnPolyline(merge, tLine).distance, `${b.id} 匯入點`).toBeLessThanOrEqual(0.05);
      // 兩線取樣點不同：以側線末段兩端在尾軌上的垂足為弦，與側線末段比較方位。
      // 側線自緩和曲線起點三次方漸離尾軌，匯入點（距 0.05 公尺）的 4 公尺末段弦約差 1.5 度；
      // 上限 2 度遠小於道岔的分岔角（1:9 約 6.3 度），足以排除斜交。
      const before = nearestOnPolyline(bLine.at(-2)!, tLine).point;
      const after = nearestOnPolyline(merge, tLine).point;
      expect(
        angleDiff(bearingOf(bLine.at(-2)!, merge), bearingOf(before, after)),
        `${b.id} 匯入方位`,
      ).toBeLessThanOrEqual(2);
      expect(t.joins).toEqual([group.main, null]);
      expect(b.joins).toEqual([group.siding, t.id]);
      expect(t.trackRole).toBe("main");
      expect(b.trackRole).toBe("siding");
    }
    const link = get(`${scenario}/a1/link/X1`);
    expect(link.trackRole).toBe("crossover");
    expect(link.joins).toEqual([tail("南").id, tail("北").id]);
    for (const feature of [tail("北"), tail("南"), branch("北"), branch("南"), link]) {
      expect(feature.status, feature.id).toBe("added");
      expect(feature.line, feature.id).toBe("a");
      expect(feature.kind, feature.id).toBe("track-metro");
    }
  });

  it("喉道內股道互不交叉", () => {
    for (const group of GROUPS) {
      const tLine = lineOf(tail(group.side));
      const signs = lineOf(branch(group.side))
        .slice(0, -1)
        .map((p) => sideOfPolyline(tLine, p))
        .filter((d) => Math.abs(d) >= 0.05)
        .map(Math.sign);
      expect(new Set(signs).size, `${group.side} 側線延伸維持在尾軌同一側`).toBe(1);
    }
    expect(segmentDistance(lineOf(tail("北")), lineOf(tail("南"))), "兩尾軌").toBeGreaterThanOrEqual(5);
    expect(segmentDistance(lineOf(branch("北")), lineOf(tail("南"))), "北側線延伸與南尾軌").toBeGreaterThanOrEqual(5);
    expect(segmentDistance(lineOf(branch("南")), lineOf(tail("北"))), "南側線延伸與北尾軌").toBeGreaterThanOrEqual(5);
  });

  it.runIf(mode === "underpass")("尾軌止於中山北路一段，末端為長於 150 公尺的水平直線", () => {
    for (const group of GROUPS) {
      const t = tail(group.side);
      const line = lineOf(t);
      const elevations = vertexElevations(t);
      const axis = platform1Axis();
      const east = decompose(axis.center, axis.bearing, line.at(-1)!).along;
      expect(Math.abs(east - TAIL_END), `${t.id} 東端`).toBeLessThan(1.0);
      const [a, b] = [line.at(-2)!, line.at(-1)!];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1]), `${t.id} 末端直線`).toBeGreaterThan(150);
      expect(elevations.at(-1), `${t.id} 末端水平`).toBe(elevations.at(-2));
    }
  });

  it("尾軌與側線延伸的最小曲率半徑大於 195 公尺，距臺北車站地下量體大於 5 公尺", () => {
    const box = baselineById("station/box")!.geometry.polygon!;
    for (const feature of [tail("北"), tail("南"), branch("北"), branch("南")]) {
      expect(minRadius(lineOf(feature)), feature.id).toBeGreaterThan(195);
      expect(segmentDistance(lineOf(feature), box), feature.id).toBeGreaterThan(5);
    }
  });

  it("兩條尾軌之間有一條渡線，依東行方向由右（南）往左（北）", () => {
    const [a, b] = lineOf(get(`${scenario}/a1/link/X1`));
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(length).toBeGreaterThan(45);
    expect(length).toBeLessThan(60);
    // 機場捷運靠右行駛：西端在南尾軌、東端在北尾軌
    const axis = platform1Axis();
    expect(decompose(axis.center, axis.bearing, b).along).toBeGreaterThan(decompose(axis.center, axis.bearing, a).along);
    expect(nearestOnPolyline(a, lineOf(tail("南"))).distance, "X1 西端").toBeLessThan(0.05);
    expect(nearestOnPolyline(b, lineOf(tail("北"))).distance, "X1 東端").toBeLessThan(0.05);
  });
});
