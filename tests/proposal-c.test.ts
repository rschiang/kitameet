import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { baselineById, buildBaseline } from "../src/data/scene.ts";
import { REBUILD_ZONE } from "../src/data/scenarios/proposal-c.ts";
import {
  NEW_PLATFORM_LENGTH,
  PLATFORM_OFFSETS,
  WORKS_CLEARANCE,
  platform1Axis,
} from "../src/data/scenarios/shared.ts";
import { sideOfPolyline } from "../src/geo/clip.ts";
import { nearestOnPolyline, polygonAxis } from "../src/geo/measure.ts";
import { offsetPolyline, polylineBearingAtX, polylineLength } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";
import { PLATFORM_WIDTH } from "../src/data/schema.ts";

const features = featuresFor("proposal-c");
const byId = new Map(features.map((f) => [f.id, f]));

const MALL_Z = "way/328691510";
const MALL_Z_PASSAGE = "way/1174010641";
/** 西側接軌對象：甲接北線、乙接南線。 */
const WEST_TIE_IN_IDS: Record<string, string> = { 甲: "way/199771201", 乙: "way/199771202" };
/** 東側接軌對象：甲接北線、乙接南線。 */
const EAST_TIE_IN_IDS: Record<string, string> = { 甲: "way/381111230", 乙: "way/593866771" };

/** 基準量體的輪廓或中心線；多邊形補上閉合邊。 */
function outlineOf(id: string): Local[] {
  const { polygon, polyline } = baselineById(id)!.geometry;
  return polygon ? [...polygon, polygon[0]] : polyline!;
}

/**
 * 兩條折線的最短距離（公尺），量到線段而非只量頂點：
 * 月台段是 420 公尺的單一線段，只比頂點會漏掉沿線的障礙物。
 */
function clearance(a: Local[], b: Local[]): number {
  let min = Infinity;
  for (const p of a) min = Math.min(min, nearestOnPolyline(p, b).distance);
  for (const q of b) min = Math.min(min, nearestOnPolyline(q, a).distance);
  return min;
}

/** 兩條折線是否有線段相交。 */
function crosses(a: Local[], b: Local[]): boolean {
  const side = (p: Local, q: Local, r: Local): number =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]];
      if (side(p, q, r) !== side(p, q, s) && side(r, s, p) !== side(r, s, q)) return true;
    }
  }
  return false;
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

/** 股道的西段：接軌點到月台段（全線唯一超過 400 公尺的線段）起點。 */
function westSection(line: Local[]): Local[] {
  const end = line.findIndex(
    (p, i) => i > 0 && Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) > 400,
  );
  expect(end, "找不到月台段").toBeGreaterThan(0);
  return line.slice(0, end);
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
const trackIds = names.flatMap((name) => ["北", "南"].map((side) => `proposal-c/track/${name}-${side}`));
const trackLine = (id: string): Local[] => byId.get(id)!.geometry.polyline!;

describe("方案 C 幾何", () => {
  it("兩座新月台為 410 公尺、寬 12 公尺的島式月台，較既有第一月台順時針轉 5 度", () => {
    const existing = platform1Axis();
    for (const name of names) {
      const platform = byId.get(`proposal-c/platform/${name}`);
      expect(platform, name).toBeDefined();
      const axis = polygonAxis(platform!.geometry.polygon!);
      expect(axis.length).toBeCloseTo(NEW_PLATFORM_LENGTH, 0);
      expect(axis.width).toBeCloseTo(PLATFORM_WIDTH, 1);
      expect(Math.abs(existing.bearing - axis.bearing - 5.0), name).toBeLessThan(0.1);
      expect(platform!.status).toBe("added");
    }
  });

  it("月台任一角點相對方案 B 的位移不超過 50 公尺", () => {
    const proposalB = new Map(featuresFor("proposal-b").map((f) => [f.id, f]));
    for (const name of names) {
      const before = proposalB.get(`proposal-b/platform/${name}`)!.geometry.polygon!;
      const after = byId.get(`proposal-c/platform/${name}`)!.geometry.polygon!;
      before.forEach((p, i) => {
        expect(Math.hypot(p[0] - after[i][0], p[1] - after[i][1]), `${name} 角點 ${i}`).toBeLessThan(50);
      });
    }
  });

  it("新建股道西至中華路一段、東至北平東路", () => {
    for (const id of trackIds) {
      const line = trackLine(id);
      expect(Math.abs(line[0][0] - REBUILD_ZONE.westX), `${id} 西端`).toBeLessThan(1.0);
      expect(Math.abs(line[line.length - 1][0] - REBUILD_ZONE.eastX), `${id} 東端`).toBeLessThan(1.0);
    }
  });

  it("西段曲率半徑為 235 公尺，全線不低於 210 公尺", () => {
    for (const id of trackIds) {
      expect(minRadius(westSection(trackLine(id))), `${id} 西段`).toBeGreaterThan(230);
      expect(minRadius(trackLine(id)), `${id} 全線`).toBeGreaterThan(210);
    }
  });

  it("新建股道東段由北而南的順序不變，互不交叉", () => {
    const sections = trackIds.map((id) => eastSection(trackLine(id)));
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
      const bearing = polylineBearingAtX(outlineOf(EAST_TIE_IN_IDS[name]), REBUILD_ZONE.eastX);
      expect(bearing, name).not.toBeNull();
      for (const side of ["北", "南"]) {
        const line = trackLine(`proposal-c/track/${name}-${side}`);
        const [a, b] = [line[line.length - 2], line[line.length - 1]];
        const end = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        expect(Math.abs(end - bearing!), `${name}-${side} 接軌點折角`).toBeLessThan(1);
      }
    }
  });

  it("新建股道西側接軌點與既有線形切線連續", () => {
    for (const name of names) {
      const bearing = polylineBearingAtX(outlineOf(WEST_TIE_IN_IDS[name]), REBUILD_ZONE.westX);
      expect(bearing, name).not.toBeNull();
      for (const side of ["北", "南"]) {
        const line = trackLine(`proposal-c/track/${name}-${side}`);
        const start = (Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]) * 180) / Math.PI;
        expect(Math.abs(start - bearing!), `${name}-${side} 接軌點折角`).toBeLessThan(1);
      }
    }
  });

  it("新建股道與北門台座淨距不小於 14 公尺", () => {
    for (const id of trackIds) {
      for (const gate of ["landmark/north-gate/base/west", "landmark/north-gate/base/east"]) {
        expect(clearance(trackLine(id), outlineOf(gate)), id).toBeGreaterThan(14);
      }
    }
  });

  it("新建股道與捷運板南線公告圖正線淨距不小於 20 公尺", () => {
    for (const id of trackIds) {
      // 公告圖正線可能在疊式站區的影響範圍切成數段（`#n`），逐段檢查
      const bannan = buildBaseline().filter((f) => /^dorts\/N\/track\/[48](#\d+)?$/.test(f.id));
      expect(bannan.length).toBeGreaterThanOrEqual(2);
      for (const track of bannan) {
        expect(clearance(trackLine(id), outlineOf(track.id)), `${id} × ${track.id}`).toBeGreaterThan(20);
      }
    }
  });

  it("新建股道與臺鐵縱貫線隧道淨距不小於 5.8 公尺", () => {
    for (const id of trackIds) {
      for (const tunnel of ["way/194118015", "way/194118038", "way/194118019", "way/615600483"]) {
        expect(clearance(trackLine(id), outlineOf(tunnel)), id).toBeGreaterThan(5.8);
      }
    }
  });

  it("開挖包絡不切入臺北車站站體、板南線與松山新店線的箱涵", () => {
    const edges = [
      offsetPolyline(trackLine(`proposal-c/track/${names[0]}-北`), WORKS_CLEARANCE),
      offsetPolyline(trackLine(`proposal-c/track/${names[names.length - 1]}-南`), -WORKS_CLEARANCE),
    ];
    // 站體輪廓、板南線車站箱涵、松山新店線車站箱涵北端；門檻為實測值 2.0、5.2、2.4 留餘裕
    for (const [id, margin] of [["station/box", 1.5], ["dorts/N/box/2", 4.5], ["dorts/N/box/1", 2.0]] as const) {
      const outline = outlineOf(id);
      for (const edge of edges) {
        expect(clearance(edge, outline), id).toBeGreaterThan(margin);
        expect(crosses(edge, outline), id).toBe(false);
      }
    }
  });

  it("方案 B 的西側接軌隧道整條改建，中華路一段的隧道只改建界線以東", () => {
    for (const id of ["way/13991375", "way/323105864"]) {
      expect(byId.get(id), id).toBeUndefined();
      expect(byId.get(`${id}/rebuilt`)?.status, id).toBe("removed");
    }
    for (const id of Object.values(WEST_TIE_IN_IDS)) {
      expect(byId.get(`${id}/rebuilt`)?.status, id).toBe("removed");
      const kept = byId.get(id);
      expect(kept, id).toBeDefined();
      for (const [x] of kept!.geometry.polyline!) {
        expect(x, `${id} 保留段`).toBeLessThanOrEqual(REBUILD_ZONE.westX + 1e-6);
      }
    }
  });

  it("站前地下街主體不受開挖影響，只切除一小段通道", () => {
    const kept = byId.get(MALL_Z);
    expect(kept?.status).not.toBe("removed");
    expect(byId.get(`${MALL_Z}/rebuilt`)).toBeUndefined();
    expect(byId.get(`${MALL_Z}/kept/2`)).toBeUndefined();
    const current = area(baselineById(MALL_Z)!.geometry.polygon!);
    expect(Math.abs(area(kept!.geometry.polygon!) - current)).toBeLessThan(1);

    const cut = byId.get(`${MALL_Z_PASSAGE}/rebuilt`);
    expect(cut?.status).toBe("removed");
    expect(polylineLength(cut!.geometry.polyline!)).toBeCloseTo(3.8, 0);
    expect(byId.get(MALL_Z_PASSAGE), "通道保留段").toBeDefined();
  });

  it("現況模式不含方案 C 的量體", () => {
    expect(featuresFor("status-quo").some((f) => f.id.startsWith("proposal-c/"))).toBe(false);
  });
});
