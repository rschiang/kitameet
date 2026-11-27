/**
 * 捷運路網：每條路線每個行車方向一條連續的正線，配線端點落在所銜接的軌道上，
 * 右側行車、曲率與平滑偏移合於規範，西門站的聯絡線分上下兩層，機場捷運有雙圓潛盾。
 */
import { describe, expect, it } from "vitest";
import { UNDERGROUND_RING } from "../src/data/coverage.ts";
import { elevationAt, vertexElevations } from "../src/data/elevation.ts";
import { railLevelOf } from "../src/data/levels.ts";
import { baselineById, buildBaseline } from "../src/data/scene.ts";
import { MIN_TRACK_SEPARATION, XIMEN_UPPER } from "../src/data/structures/metro-profile.ts";
import { buildMetroNetwork, networkDiagnostics } from "../src/data/structures/metro-network.ts";
import { nearestOnPolyline, pointInPolygon } from "../src/geo/measure.ts";
import type { Local } from "../src/geo/project.ts";

const features = buildBaseline();
const network = buildMetroNetwork();
const byId = new Map(network.map((f) => [f.id, f]));

const MAIN_IDS = [
  "metro/bl/to-nangang",
  "metro/bl/to-dingpu",
  "metro/g/to-songshan",
  "metro/g/to-xindian",
  "metro/r/to-tamsui",
  "metro/r/to-xiangshan",
  "metro/o/to-luzhou",
  "metro/o/to-nanshijiao",
  "metro/a/north",
  "metro/a/south",
];

/** 同一路線的兩條正線（機場捷運除外）。 */
const PARTNERS: [string, string][] = [
  ["metro/bl/to-nangang", "metro/bl/to-dingpu"],
  ["metro/g/to-songshan", "metro/g/to-xindian"],
  ["metro/r/to-tamsui", "metro/r/to-xiangshan"],
  ["metro/o/to-luzhou", "metro/o/to-nanshijiao"],
];

/** 點在折線上的投影：距離、最近點與弧長。 */
function project(line: Local[], p: Local): { distance: number; point: Local; arc: number } {
  let best = { distance: Infinity, point: line[0], arc: 0 };
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(vx, vy);
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (len * len)));
    const q: Local = [a[0] + vx * t, a[1] + vy * t];
    const distance = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (distance < best.distance) best = { distance, point: q, arc: walked + t * len };
    walked += len;
  }
  return best;
}

describe("捷運路網", () => {
  it("每條路線每個行車方向各一條連續的正線", () => {
    const mains = features.filter((f) => f.trackRole === "main").map((f) => f.id);
    expect([...mains].sort()).toEqual([...MAIN_IDS].sort());
  });

  it("配線端點落在所銜接的軌道上，且與該軌道等高", () => {
    const links = network.filter((f) => f.trackRole !== "main");
    expect(links.length).toBeGreaterThan(20);
    for (const link of links) {
      const line = link.geometry.polyline!;
      const z = vertexElevations(link);
      link.joins!.forEach((join, n) => {
        if (join === null) return;
        const track = byId.get(join);
        expect(track, `${link.id} → ${join}`).toBeDefined();
        const end = n === 0 ? line[0] : line[line.length - 1];
        const hit = project(track!.geometry.polyline!, end);
        expect(hit.distance, `${link.id} 端點 ${n} 距 ${join}`).toBeLessThan(1e-6);
        const elevation = n === 0 ? z[0] : z[z.length - 1];
        expect(Math.abs(elevationAt(track!)(hit.arc) - elevation), `${link.id} 端點 ${n} 高程`).toBeLessThan(1e-6);
      });
    }
  });

  it("右側行車：另一條正線位於行車方向的左側", () => {
    for (const [a, b] of PARTNERS) {
      for (const [self, other] of [
        [a, b],
        [b, a],
      ]) {
        const line = byId.get(self)!.geometry.polyline!;
        const partner = byId.get(other)!.geometry.polyline!;
        let checked = 0;
        for (let i = 0; i + 1 < line.length; i += 10) {
          if (!pointInPolygon(line[i], UNDERGROUND_RING)) continue;
          const hit = nearestOnPolyline(line[i], partner);
          if (hit.distance < 3 || hit.distance > 30) continue;
          checked++;
          const [tx, ty] = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]];
          const [vx, vy] = [hit.point[0] - line[i][0], hit.point[1] - line[i][1]];
          expect(tx * vy - ty * vx, `${self} (${line[i].map((v) => v.toFixed(1))})`).toBeGreaterThan(0);
        }
        expect(checked, self).toBeGreaterThan(50);
      }
    }
  });

  it("正線 40 公尺弦長的曲率半徑不低於 140 公尺（表 2-3-1 絕對最小值）", () => {
    for (const id of MAIN_IDS) {
      const line = byId.get(id)!.geometry.polyline!;
      for (let i = 10; i + 10 < line.length; i++) {
        if (!pointInPolygon(line[i], UNDERGROUND_RING)) continue;
        const [a, b, c] = [line[i - 10], line[i], line[i + 10]];
        const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
        const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
        const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
        const radius = cross === 0 ? Infinity : (ab * bc * ca) / (2 * cross);
        expect(radius, `${id} (${b.map((v) => v.toFixed(1))})`).toBeGreaterThanOrEqual(140);
      }
    }
  });

  it("平滑偏移不超過 1 公尺，正線大多取自公告圖", () => {
    const minimum: Record<string, number> = { bl: 3500, g: 3500, r: 2700, o: 200 };
    const diagnostics = networkDiagnostics();
    expect(diagnostics.map((d) => d.id).sort()).toEqual([...MAIN_IDS].sort());
    for (const { id, dortsLength, maxSmoothingShift } of diagnostics) {
      expect(maxSmoothingShift, id).toBeLessThanOrEqual(1.0);
      const line = id.split("/")[1];
      if (line !== "a") expect(dortsLength, id).toBeGreaterThanOrEqual(minimum[line]);
    }
  });

  it("西門：地下街下方的 OSM 渡線不存在，聯絡線分上下兩層", () => {
    expect(baselineById("way/194585047")).toBeUndefined();
    const upper = byId.get("way/194585055/upper")!;
    const lower = byId.get("way/194585055/lower")!;
    expect(upper.joins).toEqual(["metro/g/to-songshan", "metro/bl/to-nangang"]);
    expect(lower.joins).toEqual(["metro/g/to-xindian", "metro/bl/to-dingpu"]);
    const zUpper = vertexElevations(upper);
    const zLower = vertexElevations(lower);
    for (const z of zUpper) expect(z).toBeCloseTo(railLevelOf("metro-station-ximen", "B2"), 6);
    expect(zLower[zLower.length - 1]).toBeCloseTo(XIMEN_UPPER - MIN_TRACK_SEPARATION, 6);
    expect(zLower).toHaveLength(zUpper.length);
    zUpper.forEach((z, i) => expect(z - zLower[i], `${i}`).toBeGreaterThanOrEqual(MIN_TRACK_SEPARATION - 1e-6));
  });

  it("機場捷運雙圓潛盾沿兩條正線的中線，止於北門站西側", () => {
    const bore = baselineById("a/dot-bore");
    expect(bore).toBeDefined();
    expect(bore!.twinSpacing).toBe(5.2);
    expect(bore!.radius).toBe(3.1);
    expect(bore!.lining).toBe(0.3);
    const axis = bore!.geometry.tube!;
    expect(Math.abs(Math.max(...axis.map((p) => p[0])) + 747.7)).toBeLessThan(0.01);
    const north = byId.get("metro/a/north")!.geometry.polyline!;
    const south = byId.get("metro/a/south")!.geometry.polyline!;
    for (const p of axis) {
      const [n, s] = [nearestOnPolyline(p, north).point, nearestOnPolyline(p, south).point];
      const mid: Local = [(n[0] + s[0]) / 2, (n[1] + s[1]) / 2];
      expect(Math.hypot(p[0] - mid[0], p[1] - mid[1]), `(${p.map((v) => v.toFixed(1))})`).toBeLessThan(0.5);
    }
  });
});
