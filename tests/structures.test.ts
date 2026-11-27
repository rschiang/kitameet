import { describe, expect, it } from "vitest";
import { baselineById, buildBaseline } from "../src/data/scene.ts";
import { STRUCTURES, levelOf, railLevelOf } from "../src/data/levels.ts";
import { vertexElevations } from "../src/data/elevation.ts";
import { GROUND_EL, LEVELS, type LevelId } from "../src/data/schema.ts";
import { PLATFORM_REBUILDS, platformTracks } from "../src/data/structures/platforms.ts";
import { resample } from "../src/geo/corridor.ts";
import { decompose, nearestOnPolyline, pointInPolygon, polygonAxis } from "../src/geo/measure.ts";
import type { Local } from "../src/geo/project.ts";
import { DEPTH_EXAGGERATION } from "../src/render/depth.ts";
import { buildFeatureMesh } from "../src/render/builders.ts";

const features = buildBaseline();
const DEPTHS: LevelId[] = ["B1", "B2", "B3", "B4"];

describe("構造物樓層表", () => {
  it("每個構造物的樓層由淺至深遞減且層層相疊", () => {
    for (const [id, info] of Object.entries(STRUCTURES)) {
      const present = DEPTHS.filter((level) => info.levels[level] !== undefined);
      expect(present.length, id).toBeGreaterThan(0);
      for (let i = 1; i < present.length; i++) {
        const upper = info.levels[present[i - 1]]!;
        const lower = info.levels[present[i]]!;
        expect(upper.floor, `${id} ${present[i - 1]}`).toBeGreaterThan(lower.floor);
        // 上層樓板不得低於下層的淨高頂面
        expect(upper.floor, `${id} ${present[i - 1]} 層高`).toBeGreaterThanOrEqual(
          lower.floor + lower.height - 0.01,
        );
      }
      const deepest = info.levels[present[present.length - 1]]!;
      expect(deepest.floor, `${id} 結構底`).toBeGreaterThanOrEqual(info.bottom);
    }
  });

  it("未指定構造物或缺少該層時回退預設樓層表", () => {
    expect(levelOf(undefined, "B2").floor).toBe(LEVELS.B2.floor);
    expect(() => levelOf("mall-z", "B3")).not.toThrow();
    expect(levelOf("mall-z", "B3").floor).toBe(LEVELS.B3.floor);
  });

  it("同一樓層標籤在不同構造物有不同深度", () => {
    const station = levelOf("tra-hsr-station", "B2").floor;
    const a1 = levelOf("airport-mrt-a1", "B2").floor;
    expect(Math.abs(station - a1)).toBeGreaterThan(1);
  });
});

describe("分層地下構造", () => {
  it("兩線站體各層皆有量體，兩線月台深度相差超過 5 公尺", () => {
    const present = (structure: "metro-station" | "metro-station-r", levels: LevelId[]): void => {
      for (const level of levels) {
        const atLevel = features.filter((f) => f.structure === structure && f.level === level);
        expect(atLevel.length, `${structure} ${level}`).toBeGreaterThan(0);
      }
    };
    present("metro-station", ["B1", "B2", "B3"]);
    present("metro-station-r", ["B1", "B3", "B4"]);

    const bannan = baselineById("way/741259904")!;
    const tamsui = baselineById("way/741259905")!;
    expect(bannan.base).toBeCloseTo(railLevelOf("metro-station", "B3"), 6);
    expect(tamsui.base).toBeCloseTo(railLevelOf("metro-station-r", "B4"), 6);
    expect(bannan.base! - tamsui.base!).toBeGreaterThan(5);
  });

  it("捷運與機場捷運的單一 OSM 輪廓已排除", () => {
    expect(baselineById("way/366766273")).toBeUndefined();
    expect(baselineById("way/1226069619")).toBeUndefined();
  });

  it("A1 車站結構底為最終開挖面 EL −23.175 公尺，月台與股道改用 OSM 圖徵呈現於 B3", () => {
    expect(baselineById("a1/box")?.base).toBe(-23.175);
    // 合成的月台與股道已刪除，改以 OSM 原圖徵呈現
    expect(baselineById("a1/platform")).toBeUndefined();
    for (const id of ["way/871105041", "way/871105042"]) {
      const platform = baselineById(id);
      expect(platform, id).toBeDefined();
      expect(platform!.level, id).toBe("B3");
      expect(platform!.structure, id).toBe("airport-mrt-a1");
      expect(platform!.base, id).toBeCloseTo(railLevelOf("airport-mrt-a1", "B3"), 6);
    }
    const tracks = features.filter(
      (f) => f.structure === "airport-mrt-a1" && f.kind === "track-metro",
    );
    expect(tracks.length).toBeGreaterThanOrEqual(4);
    for (const f of tracks) expect(f.level, f.id).toBe("B3");
  });

  it("重建的月台與相鄰軌道保持標準距離", () => {
    for (const spec of PLATFORM_REBUILDS) {
      const polygon = baselineById(spec.id)!.geometry.polygon!;
      const ring: Local[] = [...polygon, polygon[0]];
      const axis = polygonAxis(polygon);
      const along = polygon.map((p) => decompose(axis.center, axis.bearing, p).along);
      const [from, to] = [Math.min(...along), Math.max(...along)];
      for (const { feature, edge } of platformTracks(spec, features)) {
        for (const p of resample(feature.geometry.polyline!, 1)) {
          const s = decompose(axis.center, axis.bearing, p).along;
          if (s < from || s > to) continue;
          const label = `${spec.id} × ${feature.id} (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`;
          expect(pointInPolygon(p, polygon), label).toBe(false);
          expect(nearestOnPolyline(p, ring).distance, label).toBeGreaterThanOrEqual(edge - 0.05);
        }
      }
    }
  });

  it("北門站月台位於 B4，機場捷運自其上方通過", () => {
    const floor = railLevelOf("metro-station-beimen", "B4");
    let top = -Infinity;
    for (const id of ["way/194585045", "way/194585056"]) {
      const platform = baselineById(id)!;
      expect(platform.base, id).toBeCloseTo(floor, 6);
      top = Math.max(top, platform.base! + platform.height!);
    }
    const airport = baselineById("metro/a/north")!;
    const bottom = Math.min(...vertexElevations(airport));
    expect(bottom - top).toBeGreaterThanOrEqual(5);
  });
});

describe("深度放大", () => {
  const boundsY = (id: string): { min: number; max: number } => {
    const feature = baselineById(id)!;
    const mesh = buildFeatureMesh(feature)!;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    return { min: box.min.y, max: box.max.y };
  };

  it("地下量體的高程放大 1.2 倍，地面建物不變", () => {
    const underground = baselineById("a1/concourse/B1")!;
    const bounds = boundsY(underground.id);
    const depth = underground.base! - GROUND_EL;
    expect(bounds.min).toBeCloseTo(depth * DEPTH_EXAGGERATION, 2);
    expect(bounds.max).toBeCloseTo((depth + underground.height!) * DEPTH_EXAGGERATION, 2);

    // 地面建物不受放大影響；輪廓可能來自 OSM 或公告圖地形底圖，故不綁定單一 id
    const ground = features.find(
      (f) => (f.kind === "building" || f.kind === "landmark") && f.base === GROUND_EL && f.geometry.polygon,
    )!;
    expect(boundsY(ground.id).min).toBeCloseTo(0, 6);
  });
});
