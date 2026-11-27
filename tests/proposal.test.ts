import { describe, expect, it } from "vitest";
import { displayedFeatures, featuresFor } from "../src/app/scenario.ts";
import { baselineById } from "../src/data/scene.ts";
import { REBUILD_ZONE, SPLIT_ALONG, proposalB } from "../src/data/scenarios/proposal-b.ts";
import {
  NEW_PLATFORM_LENGTH,
  PLATFORM_OFFSETS,
  WORKS_CLEARANCE,
  platform1Axis,
} from "../src/data/scenarios/shared.ts";
import { sideOfPolyline } from "../src/geo/clip.ts";
import { decompose, nearestOnPolyline, polygonAxis } from "../src/geo/measure.ts";
import { offsetPolyline, polylineBearingAtX } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";
import { PLATFORM_WIDTH } from "../src/data/schema.ts";
import { featureColor } from "../src/render/palette.ts";

const features = featuresFor("proposal-b");
const byId = new Map(features.map((f) => [f.id, f]));

const MALL_K = "way/450732441";
const MALL_Z = "way/328691510";
const BANNAN_PLATFORM = "way/741259904";
/** 西側接軌對象：甲接北線、乙接南線。 */
const WEST_TIE_IN_IDS: Record<string, string> = { 甲: "way/13991375", 乙: "way/323105864" };
/** 東側接軌對象：甲接北線、乙接南線。 */
const EAST_TIE_IN_IDS: Record<string, string> = { 甲: "way/381111230", 乙: "way/593866771" };

/** 兩組點之間的最短距離（公尺）。 */
function minDistance(a: Local[], b: Local[]): number {
  let min = Infinity;
  for (const p of a) {
    for (const q of b) min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return min;
}

/** 多邊形面積（鞋帶公式，平方公尺）。 */
function area(ring: Local[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

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

/** 沿既有第一月台主軸分解一組點。 */
function bandOf(points: Local[]): { along: number[]; lateral: number[] } {
  const axis = platform1Axis();
  const parts = points.map((p) => decompose(axis.center, axis.bearing, p));
  return { along: parts.map((v) => v.along), lateral: parts.map((v) => v.lateral) };
}

/** 股道的東段：月台段（全線唯一超過 400 公尺的線段）終點到接軌點。 */
function eastSection(line: Local[]): Local[] {
  const start = line.findIndex(
    (p, i) => i > 0 && Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) > 400,
  );
  expect(start, "找不到月台段").toBeGreaterThan(0);
  return line.slice(start);
}

const names = Object.keys(PLATFORM_OFFSETS);
const trackIds = names.flatMap((name) => ["北", "南"].map((side) => `proposal-b/track/${name}-${side}`));
const trunkIds = names.map((name) => `proposal-b/trunk/${name}`);

describe("方案 B 幾何", () => {
  it("兩座新月台為 410 公尺、寬 12 公尺的島式月台", () => {
    for (const name of names) {
      const platform = byId.get(`proposal-b/platform/${name}`);
      expect(platform, name).toBeDefined();
      const axis = polygonAxis(platform!.geometry.polygon!);
      expect(axis.length).toBeCloseTo(NEW_PLATFORM_LENGTH, 0);
      expect(axis.width).toBeCloseTo(PLATFORM_WIDTH, 1);
      expect(platform!.level).toBe("B2");
      expect(platform!.status).toBe("added");
    }
  });

  it("新月台落在 K 區地下街的橫向帶狀範圍內", () => {
    const k = bandOf(baselineById(MALL_K)!.geometry.polygon!);
    const north = Math.max(...k.lateral);
    const south = Math.min(...k.lateral);
    for (const name of names) {
      for (const lateral of bandOf(byId.get(`proposal-b/platform/${name}`)!.geometry.polygon!).lateral) {
        expect(lateral, `${name} 超出 K 區橫向範圍`).toBeLessThan(north);
        expect(lateral, `${name} 超出 K 區橫向範圍`).toBeGreaterThan(south);
      }
    }
  });

  it("新月台東端對齊 K 區地下街東端，西端伸出 K 區外", () => {
    const k = bandOf(baselineById(MALL_K)!.geometry.polygon!).along;
    for (const name of names) {
      const along = bandOf(byId.get(`proposal-b/platform/${name}`)!.geometry.polygon!).along;
      expect(Math.abs(Math.max(...along) - Math.max(...k)), `${name} 東端`).toBeLessThan(1.0);
      expect(Math.min(...k) - Math.min(...along), `${name} 西端`).toBeGreaterThan(100);
    }
  });

  it("新月台與捷運板南線月台淨距不小於 20 公尺", () => {
    const bannan = baselineById(BANNAN_PLATFORM)!.geometry.polygon!;
    for (const name of names) {
      const polygon = byId.get(`proposal-b/platform/${name}`)!.geometry.polygon!;
      expect(minDistance(polygon, bannan), name).toBeGreaterThan(20);
    }
  });

  it("西側雙線幹線西至北門、東至分岔點", () => {
    for (const id of trunkIds) {
      const trunk = byId.get(id);
      expect(trunk, id).toBeDefined();
      const line = trunk!.geometry.polyline!;
      expect(Math.abs(line[0][0] - REBUILD_ZONE.westX), `${id} 西端`).toBeLessThan(1.0);
      expect(
        Math.abs(bandOf([line[line.length - 1]]).along[0] - SPLIT_ALONG),
        `${id} 東端`,
      ).toBeLessThan(1.0);
    }
  });

  it("新建股道西起分岔點、東至北平東路", () => {
    for (const id of trackIds) {
      const track = byId.get(id);
      expect(track, id).toBeDefined();
      const line = track!.geometry.polyline!;
      expect(Math.abs(bandOf([line[0]]).along[0] - SPLIT_ALONG), `${id} 西端`).toBeLessThan(1.0);
      expect(
        Math.abs(line[line.length - 1][0] - REBUILD_ZONE.eastX),
        `${id} 東端`,
      ).toBeLessThan(1.0);
    }
  });

  it("幹線於分岔點與四條股道切線連續", () => {
    for (const name of names) {
      const trunk = byId.get(`proposal-b/trunk/${name}`)!.geometry.polyline!;
      const [a, b] = [trunk[trunk.length - 2], trunk[trunk.length - 1]];
      const end = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      for (const side of ["北", "南"]) {
        const line = byId.get(`proposal-b/track/${name}-${side}`)!.geometry.polyline!;
        const start = (Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]) * 180) / Math.PI;
        expect(Math.abs(start - end), `${name}-${side} 分岔點折角`).toBeLessThan(1);
      }
    }
  });

  it("新建股道與捷運板南線月台淨距不小於 40 公尺", () => {
    const bannan = baselineById(BANNAN_PLATFORM)!.geometry.polygon!;
    for (const id of [...trunkIds, ...trackIds]) {
      expect(minDistance(byId.get(id)!.geometry.polyline!, bannan), id).toBeGreaterThan(40);
    }
  });

  it("新建股道全線最小曲率半徑不低於 90 公尺", () => {
    for (const id of [...trunkIds, ...trackIds]) {
      expect(minRadius(byId.get(id)!.geometry.polyline!), id).toBeGreaterThan(90);
    }
  });

  it("新建股道東段最小曲率半徑不低於 115 公尺", () => {
    for (const id of trackIds) {
      expect(minRadius(eastSection(byId.get(id)!.geometry.polyline!)), `${id} 東段`).toBeGreaterThan(
        115,
      );
    }
  });

  it("新建股道東段由北而南的順序不變，互不交叉", () => {
    const sections = trackIds.map((id) => eastSection(byId.get(id)!.geometry.polyline!));
    for (let i = 1; i < sections.length; i++) {
      for (const p of sections[i - 1]) {
        expect(sideOfPolyline(sections[i], p), `${trackIds[i - 1]} 越過 ${trackIds[i]}`).toBeGreaterThan(
          -0.05,
        );
      }
    }
    // 兩座月台之間的甲-南與乙-北接往不同的既有股道，全程保持股道間距
    const gap = Math.min(...sections[1].map((p) => nearestOnPolyline(p, sections[2]).distance));
    expect(gap).toBeGreaterThan(3.4);
  });

  it("新建股道東側接軌點與既有線形切線連續", () => {
    for (const name of names) {
      const existing = baselineById(EAST_TIE_IN_IDS[name])!.geometry.polyline!;
      const bearing = polylineBearingAtX(existing, REBUILD_ZONE.eastX);
      expect(bearing, name).not.toBeNull();
      for (const side of ["北", "南"]) {
        const line = byId.get(`proposal-b/track/${name}-${side}`)!.geometry.polyline!;
        const [a, b] = [line[line.length - 2], line[line.length - 1]];
        const end = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        expect(Math.abs(end - bearing!), `${name}-${side} 接軌點折角`).toBeLessThan(1);
      }
    }
  });

  it("西側雙線幹線的接軌點與既有線形切線連續", () => {
    for (const name of names) {
      const existing = baselineById(WEST_TIE_IN_IDS[name])!.geometry.polyline!;
      const bearing = polylineBearingAtX(existing, REBUILD_ZONE.westX);
      expect(bearing, name).not.toBeNull();
      const line = byId.get(`proposal-b/trunk/${name}`)!.geometry.polyline!;
      const start = (Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]) * 180) / Math.PI;
      expect(Math.abs(start - bearing!), `${name} 接軌點折角`).toBeLessThan(1);
    }
  });

  it("新建股道與北門台座淨距不小於 40 公尺", () => {
    const gate = ["landmark/north-gate/base/west", "landmark/north-gate/base/east"].map(
      (id) => baselineById(id)!.geometry.polygon!,
    );
    for (const id of [...trunkIds, ...trackIds]) {
      const line = byId.get(id)!.geometry.polyline!;
      for (const ring of gate) {
        expect(minDistance(line, ring), id).toBeGreaterThan(40);
      }
    }
  });

  it("改建區間內的既有高鐵股道標為改建、區間外保留", () => {
    for (const { id, keep, limitX } of proposalB.rebuilt) {
      const rebuilt = byId.get(`${id}/rebuilt`);
      expect(rebuilt, id).toBeDefined();
      expect(rebuilt!.status, id).toBe("removed");
      const kept = byId.get(id);
      expect(kept, id).toBeDefined();
      for (const [x] of kept!.geometry.polyline!) {
        if (keep === "west") expect(x, `${id} 保留段`).toBeLessThanOrEqual(limitX + 1e-6);
        else expect(x, `${id} 保留段`).toBeGreaterThanOrEqual(limitX - 1e-6);
      }
    }
  });

  it("站內 5 條高鐵股道改作臺鐵使用", () => {
    for (const id of ["way/593871124", "way/593871149", "way/615600478", "way/615600479", "way/615600481"]) {
      expect(byId.get(id)?.status, id).toBe("repurposed");
    }
  });

  it("K 區地下街標為拆除、第一二月台標為歸還臺鐵", () => {
    for (const id of proposalB.removed) {
      expect(byId.get(id)?.status, id).toBe("removed");
    }
    expect(byId.get("way/584167409")?.status).toBe("repurposed");
    expect(byId.get("way/584167411")?.status).toBe("repurposed");
  });

  it("站前地下街只拆除三處出入口耳部，主體仍為單一連通量體", () => {
    const pieces = [`${MALL_Z}/rebuilt`, `${MALL_Z}/rebuilt/2`, `${MALL_Z}/rebuilt/3`].map((id) => {
      const piece = byId.get(id);
      expect(piece, id).toBeDefined();
      expect(piece!.status, id).toBe("removed");
      return area(piece!.geometry.polygon!);
    });
    expect(pieces.slice().sort((a, b) => a - b).map((v) => Math.round(v * 10) / 10)).toEqual([
      21.6, 43.4, 169.3,
    ]);

    const kept = byId.get(MALL_Z);
    expect(kept?.status).not.toBe("removed");
    expect(byId.get(`${MALL_Z}/kept/2`), "地下街主體被切斷").toBeUndefined();
    const keptArea = area(kept!.geometry.polygon!);
    expect(keptArea).toBeCloseTo(9889.8, 0);
    const current = area(baselineById(MALL_Z)!.geometry.polygon!);
    expect(Math.abs(keptArea + pieces.reduce((a, b) => a + b, 0) - current)).toBeLessThan(1);
  });

  it("地下街通道段只切除落在開挖範圍內的一段", () => {
    for (const id of ["way/1174010641"]) {
      expect(byId.get(`${id}/rebuilt`)?.status, id).toBe("removed");
      expect(byId.get(id), `${id} 保留段`).toBeDefined();
    }
    for (const id of ["way/1174010640", "way/1174010642", "way/1174010643", "way/1174010644"]) {
      expect(byId.get(`${id}/rebuilt`), id).toBeUndefined();
      expect(byId.get(id)?.geometry.polyline, id).toEqual(baselineById(id)!.geometry.polyline);
    }
  });

  it("保留的站前地下街量體不落在新建工程的開挖包絡內", () => {
    const edge = (id: string, distance: number): Local[] =>
      offsetPolyline(byId.get(id)!.geometry.polyline!, distance);
    const north = edge(`proposal-b/track/${names[0]}-北`, WORKS_CLEARANCE);
    const south = edge(`proposal-b/track/${names[names.length - 1]}-南`, -WORKS_CLEARANCE);
    const envelope = [...north, ...south.slice().reverse()];
    /** 落在包絡內；邊緣 1 公分內視為界上（切割的交點恰在邊緣上）。 */
    const inside = (p: Local): boolean => {
      if (Math.abs(sideOfPolyline(north, p)) < 0.01) return false;
      if (Math.abs(sideOfPolyline(south, p)) < 0.01) return false;
      let hit = false;
      for (let i = 0, j = envelope.length - 1; i < envelope.length; j = i++) {
        const [xi, yi] = envelope[i];
        const [xj, yj] = envelope[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const mallPoints = (scenario: "proposal-b" | "status-quo"): Local[] =>
      featuresFor(scenario)
        .filter((f) => f.status !== "removed" && (f.id.startsWith(MALL_Z) || f.id.startsWith("way/11740106")))
        .flatMap((f) => f.geometry.polygon ?? f.geometry.polyline ?? []);

    expect(mallPoints("proposal-b").filter(inside)).toHaveLength(0);
    // 同一檢查套在現況必定有點落在包絡內，否則這則測試無從失敗
    expect(mallPoints("status-quo").some(inside)).toBe(true);
  });

  it("現況模式不含任何新建量體", () => {
    const statusQuo = featuresFor("status-quo");
    expect(statusQuo.some((f) => f.id.startsWith("proposal-b/"))).toBe(false);
    expect(statusQuo.every((f) => f.status !== "added")).toBe(true);
  });

  it("方案模式不呈現拆除的量體，現況模式全數呈現", () => {
    for (const scenario of ["proposal-b", "proposal-c"] as const) {
      expect(featuresFor(scenario).some((f) => f.status === "removed"), scenario).toBe(true);
      expect(displayedFeatures(scenario).some((f) => f.status === "removed"), scenario).toBe(false);
    }
    expect(displayedFeatures("status-quo").length).toBe(featuresFor("status-quo").length);
  });
});

describe("方案著色", () => {
  it("方案股道沿用路線色，新建與歸還月台維持中性", () => {
    for (const scenario of ["proposal-b", "proposal-c"] as const) {
      const all = featuresFor(scenario);
      const c = (f: (typeof all)[number]): string => featureColor(f.kind, f.layer, f.line);
      const baselineOf = (kind: "track-hsr" | "track-tra"): string => {
        const f = all.find((item) => item.kind === kind && (item.status ?? "existing") === "existing");
        expect(f, `${scenario} ${kind}`).toBeDefined();
        return c(f!);
      };
      const hsr = baselineOf("track-hsr");
      const tra = baselineOf("track-tra");
      expect(hsr).not.toBe(tra);

      const added = all.filter((f) => f.status === "added");
      expect(added.some((f) => f.kind === "track-hsr"), scenario).toBe(true);
      expect(added.some((f) => f.kind === "track-tra"), scenario).toBe(true);
      for (const f of added) {
        if (f.kind === "track-hsr") expect(c(f), f.id).toBe(hsr);
        if (f.kind === "track-tra") expect(c(f), f.id).toBe(tra);
      }

      const returned = all.filter((f) => f.status === "repurposed" && /^track-/.test(f.kind));
      expect(returned.length, scenario).toBeGreaterThan(0);
      for (const f of returned) expect(c(f), f.id).toBe(tra);

      const platforms = all.filter((f) => f.kind === "platform" && f.status !== "removed");
      expect(platforms.some((f) => f.status === "added"), scenario).toBe(true);
      for (const f of platforms) expect(c(f), f.id).toBe("#cfc8bb");
    }
  });
});
