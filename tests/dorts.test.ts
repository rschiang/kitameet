import { describe, expect, it } from "vitest";
import { splitRuns, type Measured } from "../scripts/dorts/structures.ts";
import { buildBaseline } from "../src/data/scene.ts";
import { buildDorts, dortsBuildingPolygons } from "../src/data/dorts.ts";
import { METRO_LINES, type MetroLineId } from "../src/data/levels.ts";
import { nearestOnPolyline, pointInPolygon, polygonArea, polygonCentroid } from "../src/geo/measure.ts";
import { BUILDING_LEVEL_HEIGHT, DEFAULT_BUILDING_LEVELS } from "../src/data/overrides.ts";
import { polylineLength } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";

const DEFAULT_HEIGHT = DEFAULT_BUILDING_LEVELS * BUILDING_LEVEL_HEIGHT;

/** 沿 x 軸、每 4 公尺一點的合成量測序列。 */
function samples(widths: number[]): Measured[] {
  return widths.map((width, i) => ({
    point: [i * 4, 0] as Local,
    normal: [0, 1] as Local,
    left: width / 2,
    right: width / 2,
  }));
}

describe("潛盾與明挖的分段", () => {
  it("淨寬 6 公尺與 24 公尺各一段，依序分為潛盾段與箱形段", () => {
    const runs = splitRuns(samples([...new Array(20).fill(6), ...new Array(20).fill(24)]));
    expect(runs).toHaveLength(2);
    expect(runs[0].bore).toBe(true);
    expect(runs[1].bore).toBe(false);
    expect(runs[0].items).toHaveLength(20);
    expect(runs[1].items).toHaveLength(20);
  });

  it("長度不足 20 公尺的段併入相鄰段", () => {
    // 中間只有 3 點（8 公尺）寬度突增，不足以自成一段
    const runs = splitRuns(samples([...new Array(20).fill(6), 24, 24, 24, ...new Array(20).fill(6)]));
    expect(runs).toHaveLength(1);
    expect(runs[0].bore).toBe(true);
    expect(runs[0].items).toHaveLength(43);
  });
});

describe("公告圖量體", () => {
  const features = buildDorts();

  it("潛盾隧道的半徑與軸心高程合於所屬路線", () => {
    const bores = features.filter(
      (f) => f.id.startsWith("dorts/N/bore/") || f.id.startsWith("dorts/P/bore/"),
    );
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) {
      expect(bore.geometry.tube!.length, bore.id).toBeGreaterThan(1);
      // 公告圖的單孔淨寬隨圖幅年代分成 5.2 與 5.8 公尺兩種畫法
      expect(bore.radius!, bore.id).toBeGreaterThan(2.5);
      expect(bore.radius!, bore.id).toBeLessThan(3.5);
      // 圖幅代號不等於路線：N、P 圖幅也畫了鄰線的隧道，深度須跟著幾何判定的路線
      expect(bore.line, bore.id).toBeDefined();
      expect(bore.base!, bore.id).toBeCloseTo(
        METRO_LINES[bore.line as MetroLineId].rail + 1.5,
        6,
      );
    }
    // 長度 100 公尺以上的主要區間，淨寬量測最穩定
    const long = bores.filter((f) => polylineLength(f.geometry.tube!) >= 100);
    expect(long.length).toBeGreaterThan(3);
    for (const bore of long) {
      expect(bore.radius!, bore.id).toBeGreaterThan(2.55);
      expect(bore.radius!, bore.id).toBeLessThan(3.0);
    }
  });

  it("車站箱涵頂版止於地面下 5 公尺，明挖箱涵淨高 9 公尺", () => {
    const boxes = features.filter((f) => f.geometry.polygon && f.id.includes("/box/"));
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      if (box.kind === "station-box") expect(box.base! + box.height!, box.id).toBeCloseTo(-5.0, 6);
      else expect(box.height!, box.id).toBeCloseTo(9.0, 6);
    }
  });

  it("潛盾隧道與軌道中心線沒有重複畫法", () => {
    const duplicated = (items: Local[][]) =>
      items.some((a) =>
        items.some((b) => {
          if (a === b) return false;
          const near = a.filter((p) => nearestOnPolyline(p, b).distance <= 1.5).length;
          return near / a.length >= 0.9;
        }),
      );
    const bores = features.flatMap((f) => (f.geometry.tube ? [f.geometry.tube] : []));
    const tracks = features.flatMap((f) =>
      f.kind === "track-metro" && f.geometry.polyline ? [f.geometry.polyline] : [],
    );
    expect(bores.length).toBeGreaterThan(20);
    expect(tracks.length).toBeGreaterThan(20);
    expect(duplicated(bores)).toBe(false);
    expect(duplicated(tracks)).toBe(false);
  });
});

describe("公告圖取代 OSM 平面", () => {
  const features = buildBaseline();
  const faces = dortsBuildingPolygons();

  it("形心落在公告圖建物面內的 OSM 建物不再出現，且該面承接其高度", () => {
    const osmBuildings = features.filter(
      (f) => f.id.startsWith("way/") && (f.kind === "building" || f.kind === "landmark"),
    );
    for (const building of osmBuildings) {
      const centre = polygonCentroid(building.geometry.polygon!);
      expect(faces.some((face) => pointInPolygon(centre, face)), building.id).toBe(false);
    }

    // 亞洲廣場大樓的輪廓改由公告圖提供，高度沿用 OSM 的 101 公尺
    const tower = features.filter((f) => f.name === "亞洲廣場大樓");
    expect(tower.length).toBeGreaterThan(0);
    for (const part of tower) {
      expect(part.id.startsWith("dorts/building/"), part.id).toBe(true);
      expect(part.height, part.id).toBeCloseTo(101, 2);
    }
  });

  it("公告圖提供道路邊線與捷運正線，OSM 路面仍保留於其下", () => {
    const dorts = features.filter((f) => f.id.startsWith("dorts/"));
    expect(dorts.filter((f) => f.kind === "road-edge").length).toBeGreaterThan(100);
    expect(dorts.filter((f) => f.kind === "track-metro").length).toBeGreaterThan(10);
    // 機場捷運不在公告圖範圍內，OSM 的正線須留下
    expect(features.some((f) => f.kind === "track-metro" && f.id.startsWith("way/"))).toBe(true);
    // 路面為 OSM 的道路中心線外擴而成，與公告圖的路緣線並存
    expect(features.filter((f) => f.kind === "road").length).toBeGreaterThan(100);
  });

  it("同一棟建物的附屬小面不繼承主量體樓高", () => {
    const faces = features.filter((f) => f.id.startsWith("dorts/building/"));
    const groups = new Map<string, { area: number; height: number }[]>();
    for (const face of faces) {
      const source = face.sourceNote?.match(/way\/\d+/)?.[0];
      if (source === undefined) continue;
      const entry = {
        area: Math.abs(polygonArea(face.geometry.polygon!)),
        height: face.height ?? 0,
      };
      const list = groups.get(source);
      if (list) list.push(entry);
      else groups.set(source, [entry]);
    }
    expect(groups.size).toBeGreaterThan(50);
    for (const [source, list] of groups) {
      const largest = Math.max(...list.map((f) => f.area));
      for (const face of list) {
        if (face.height <= DEFAULT_HEIGHT) continue;
        expect(face.area / largest, source).toBeGreaterThanOrEqual(0.4);
      }
    }
  });
});
