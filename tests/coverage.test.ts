import { describe, expect, it } from "vitest";
import {
  OVERGROUND_BOUNDARY,
  OVERGROUND_RING,
  TERRAIN_DEPTH,
  UNDERGROUND_BOUNDARY,
  UNDERGROUND_RING,
  coverageRingFor,
  insideRing,
} from "../src/data/coverage.ts";
import { clipPolygonToRing, clipPolylineToRing } from "../src/geo/clip.ts";
import { nearestOnPolyline, polygonArea } from "../src/geo/measure.ts";
import { buildBaseline } from "../src/data/scene.ts";
import type { Local } from "../src/geo/project.ts";

/** 判定頂點是否落在範圍內或界線上；共用的界線段距離為零，不應判為界外。 */
const withinRing = (p: Local, ring: Local[], boundary: Local[], tolerance: number): boolean =>
  insideRing(p, ring) || nearestOnPolyline(p, boundary).distance <= tolerance;

describe("涵蓋範圍", () => {
  it("兩圈皆為逆時針，地下範圍涵蓋地面範圍的全部頂點", () => {
    expect(polygonArea(OVERGROUND_RING)).toBeGreaterThan(0);
    expect(polygonArea(UNDERGROUND_RING)).toBeGreaterThan(0);
    for (const p of OVERGROUND_RING) {
      expect(withinRing(p, UNDERGROUND_RING, UNDERGROUND_BOUNDARY, 1e-6), String(p)).toBe(true);
    }
    // 地下範圍北至民生東西路、南至信義路，面積必然較大
    expect(polygonArea(UNDERGROUND_RING)).toBeGreaterThan(polygonArea(OVERGROUND_RING));
  });

  it("依底面高程選範圍：負值取地下、其餘取地面", () => {
    expect(coverageRingFor(-0.01)).toBe(UNDERGROUND_RING);
    expect(coverageRingFor(0)).toBe(OVERGROUND_RING);
    expect(coverageRingFor(8)).toBe(OVERGROUND_RING);
  });

  it("多邊形與折線裁切至環內", () => {
    const ring: Local[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    // 跨界：界內為 50 × 20 的矩形
    const crossing = clipPolygonToRing(
      [
        [50, 20],
        [150, 20],
        [150, 40],
        [50, 40],
      ],
      ring,
    );
    expect(crossing).toHaveLength(1);
    expect(polygonArea(crossing[0])).toBeCloseTo(1000, 6);

    // 跨越範圍轉角：封口時沿環補回轉角頂點，界內為 50 × 50
    const corner = clipPolygonToRing(
      [
        [50, 50],
        [150, 50],
        [150, 150],
        [50, 150],
      ],
      ring,
    );
    expect(corner).toHaveLength(1);
    expect(polygonArea(corner[0])).toBeCloseTo(2500, 6);

    // 完全界內者原樣回傳一塊，完全界外者回傳空陣列
    const inside: Local[] = [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ];
    expect(clipPolygonToRing(inside, ring)).toEqual([inside]);
    expect(
      clipPolygonToRing(
        [
          [110, 10],
          [120, 10],
          [120, 20],
          [110, 20],
        ],
        ring,
      ),
    ).toEqual([]);

    const line = clipPolylineToRing(
      [
        [-20, 50],
        [50, 50],
        [120, 50],
      ],
      ring,
    );
    expect(line).toHaveLength(1);
    expect(line[0][0]).toEqual([0, 50]);
    expect(line[0][line[0].length - 1]).toEqual([100, 50]);
  });
});

describe("場景的涵蓋裁切", () => {
  const features = buildBaseline();

  it("地塊恰有一項，厚度 60 公尺且底面在最深結構之下", () => {
    const terrain = features.filter((f) => f.kind === "terrain");
    expect(terrain).toHaveLength(1);
    expect(terrain[0].base).toBe(-TERRAIN_DEPTH);
    expect(terrain[0].height).toBe(TERRAIN_DEPTH);
    expect(terrain[0].layer).toBe("terrain");
    expect(terrain[0].geometry.polygon).toEqual(OVERGROUND_RING);
    const deepest = Math.min(...features.map((f) => f.base ?? 0));
    expect(terrain[0].base!).toBeLessThanOrEqual(deepest);
  });

  it("每個量體都落在所屬的涵蓋範圍內", () => {
    for (const feature of features) {
      if (feature.kind === "terrain") continue;
      const ring = coverageRingFor(feature.base ?? 0);
      const boundary = ring === UNDERGROUND_RING ? UNDERGROUND_BOUNDARY : OVERGROUND_BOUNDARY;
      const points = [
        ...(feature.geometry.polygon ?? []),
        ...(feature.geometry.polyline ?? []),
        ...(feature.geometry.tube ?? []),
      ];
      for (const p of points) {
        expect(withinRing(p, ring, boundary, 1), `${feature.id} ${p}`).toBe(true);
      }
    }
  });

  it("地下結構可以伸出地面範圍之外", () => {
    const outside = features.filter((f) => {
      if ((f.base ?? 0) >= 0) return false;
      const points = [
        ...(f.geometry.polygon ?? []),
        ...(f.geometry.polyline ?? []),
        ...(f.geometry.tube ?? []),
      ];
      return points.some((p) => !insideRing(p, OVERGROUND_RING));
    });
    expect(outside.length).toBeGreaterThan(0);
  });
});
