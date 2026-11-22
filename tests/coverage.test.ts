import { describe, expect, it } from "vitest";
import {
  OVERGROUND_BOUNDARY,
  OVERGROUND_RING,
  TERRAIN_DEPTH,
  UNDERGROUND_BOUNDARY,
  UNDERGROUND_RING,
  clipToCoverage,
  coverageRingFor,
  insideRing,
} from "../src/data/coverage.ts";
import { clipPolygonToRing, clipPolylineToRing } from "../src/geo/clip.ts";
import {
  nearestOnPolyline,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "../src/geo/measure.ts";
import { featureColor } from "../src/render/palette.ts";
import { polylineLength } from "../src/geo/offset.ts";
import { buildBaseline } from "../src/data/scene.ts";
import surfaceJson from "../src/data/osm/surface.json";
import type { OsmDataset } from "../src/data/osm-types.ts";
import type { Feature } from "../src/data/schema.ts";
import type { Local } from "../src/geo/project.ts";

const surface = surfaceJson as unknown as OsmDataset;

/** 判定頂點是否落在範圍內或界線上；共用的界線段距離為零，不應判為界外。 */
const withinRing = (p: Local, ring: Local[], boundary: Local[], tolerance: number): boolean =>
  insideRing(p, ring) || nearestOnPolyline(p, boundary).distance <= tolerance;

/** 兩線段是否真正相交（共端點不算）。 */
function segmentsCross(a: Local, b: Local, c: Local, d: Local): boolean {
  const side = (p: Local, q: Local, r: Local) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return (
    side(a, b, c) > 0 !== side(a, b, d) > 0 && side(c, d, a) > 0 !== side(c, d, b) > 0
  );
}

/** 沿環的每條邊等距取樣，間距不超過 `step` 公尺。 */
function sampleRing(ring: Local[], step: number): Local[] {
  const out: Local[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k <= steps; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
    }
  }
  return out;
}

const pointsOf = (f: Feature): Local[] => [
  ...(f.geometry.polygon ?? []),
  ...(f.geometry.polyline ?? []),
  ...(f.geometry.tube ?? []),
];

/** 自 OSM 產出取指定路名的全部節點。 */
const osmNodesNamed = (...names: string[]): Local[] =>
  surface.features
    .filter((f) => names.includes(f.tags.name ?? ""))
    .flatMap((f) => f.polygon ?? f.polyline ?? []);

describe("涵蓋範圍", () => {
  it("兩圈皆為逆時針、無自交，且地下範圍完整涵蓋地面範圍", () => {
    expect(polygonArea(OVERGROUND_RING)).toBeGreaterThan(0);
    expect(polygonArea(UNDERGROUND_RING)).toBeGreaterThan(0);
    // 地下範圍北至民生東西路、南至信義路，面積必然較大
    expect(polygonArea(UNDERGROUND_RING)).toBeGreaterThan(polygonArea(OVERGROUND_RING));

    for (const [name, ring] of [
      ["地面", OVERGROUND_RING],
      ["地下", UNDERGROUND_RING],
    ] as const) {
      for (let i = 0; i < ring.length; i++) {
        for (let j = i + 2; j < ring.length; j++) {
          if ((j + 1) % ring.length === i) continue;
          const cross = segmentsCross(
            ring[i],
            ring[(i + 1) % ring.length],
            ring[j],
            ring[(j + 1) % ring.length],
          );
          expect(cross, `${name}範圍第 ${i} 與第 ${j} 邊相交`).toBe(false);
        }
      }
    }

    // 逐頂點檢查不足：兩圈的轉折處不同，邊的中段才是會越界的地方
    for (const p of sampleRing(OVERGROUND_RING, 20)) {
      expect(withinRing(p, UNDERGROUND_RING, UNDERGROUND_BOUNDARY, 1), String(p)).toBe(true);
    }
  });

  it("依圖層選範圍：軌道系統取地下、其餘取地面", () => {
    for (const layer of ["station-box", "platform", "track", "mall", "metro", "passage", "restriction"] as const) {
      expect(coverageRingFor(layer), layer).toBe(UNDERGROUND_RING);
    }
    for (const layer of ["ground", "road", "building", "terrain", "landmark", "elevated-road"] as const) {
      expect(coverageRingFor(layer), layer).toBe(OVERGROUND_RING);
    }
  });

  it("景福門圓環整圈在地面範圍內", () => {
    const nodes = osmNodesNamed("東門圓環");
    expect(nodes.length).toBeGreaterThan(0);
    for (const p of nodes) expect(insideRing(p, OVERGROUND_RING), String(p)).toBe(true);
  });

  it("西藏路與三元街在地面範圍外", () => {
    for (const p of osmNodesNamed("西藏路", "三元街")) {
      expect(insideRing(p, OVERGROUND_RING), String(p)).toBe(false);
    }
  });

  it("斜帶量體裁切後兩端高程依弧長內插", () => {
    // 自地面範圍北緣的中點向內外各取 200 公尺；逆時針環的內側在行進方向左側
    const [ax, ay] = OVERGROUND_RING[0];
    const [bx, by] = OVERGROUND_RING[1];
    const len = Math.hypot(bx - ax, by - ay);
    const inward: Local = [-(by - ay) / len, (bx - ax) / len];
    const mid: Local = [(ax + bx) / 2, (ay + by) / 2];
    const from: Local = [mid[0] + inward[0] * 200, mid[1] + inward[1] * 200];
    const to: Local = [mid[0] - inward[0] * 200, mid[1] - inward[1] * 200];
    expect(insideRing(from, OVERGROUND_RING)).toBe(true);
    expect(insideRing(to, OVERGROUND_RING)).toBe(false);

    const clipped = clipToCoverage({
      id: "test/ramp",
      kind: "elevated-road",
      level: "elevated",
      layer: "elevated-road",
      geometry: { polyline: [from, to] },
      base: 0,
      baseEnd: 10,
      confidence: "estimated",
    });
    expect(clipped).toHaveLength(1);
    expect(clipped[0].base).toBeCloseTo(0, 6);
    const ratio = polylineLength(clipped[0].geometry.polyline!) / polylineLength([from, to]);
    expect(clipped[0].baseEnd!).toBeGreaterThan(0);
    expect(clipped[0].baseEnd!).toBeLessThan(10);
    expect(Math.abs(clipped[0].baseEnd! / 10 - ratio)).toBeLessThan(0.02);
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
      const ring = coverageRingFor(feature.layer);
      const boundary = ring === UNDERGROUND_RING ? UNDERGROUND_BOUNDARY : OVERGROUND_BOUNDARY;
      for (const p of pointsOf(feature)) {
        expect(withinRing(p, ring, boundary, 1), `${feature.id} ${p}`).toBe(true);
      }
    }
  });

  it("機場捷運過河隧道不因裁切而中斷", () => {
    const nodes = features.filter((f) => f.line === "a").flatMap(pointsOf);
    expect(nodes.length).toBeGreaterThan(0);
    // 隧道末端在淡水河西岸，局部座標 x 約 −2245
    expect(Math.min(...nodes.map((p) => p[0]))).toBeLessThan(-2240);
    for (const p of nodes) {
      expect(withinRing(p, UNDERGROUND_RING, UNDERGROUND_BOUNDARY, 1), String(p)).toBe(true);
    }
  });

  it("OSM 的面沒有共面重複", () => {
    // 多重多邊形的外環與其成員 way 若同時成為量體，兩者完全重合、渲染時互閃
    const polys = features
      .filter((f) => /^(way|relation)\//.test(f.id) && (f.geometry.polygon?.length ?? 0) >= 3)
      .map((f) => {
        const polygon = f.geometry.polygon!;
        const base = f.base ?? 0;
        return {
          id: f.id,
          area: Math.abs(polygonArea(polygon)),
          centroid: polygonCentroid(polygon),
          base,
          top: base + (f.height ?? 0),
        };
      })
      .filter((p) => p.area > 400);

    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const a = polys[i];
        const b = polys[j];
        if (Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1]) >= 3) continue;
        if (Math.abs(a.area - b.area) / Math.max(a.area, b.area) >= 0.05) continue;
        expect(a.base > b.top || b.base > a.top, `${a.id} 與 ${b.id} 共面重複`).toBe(true);
      }
    }
  });

  it("重疊量體的頂面不會共面異色", () => {
    // 台北雙星 C1 塔基下方：A1 站體的分層量體與誤繪的重複輪廓曾頂面共面，旋轉時互閃
    const probes: Local[] = [
      [-317, 96],
      [-420, 140],
    ];
    expect(features.find((f) => f.id === "way/646262272")).toBeUndefined();
    for (const probe of probes) {
      const stack = features
        .filter((f) => {
          const polygon = f.geometry.polygon;
          return polygon !== undefined && polygon.length >= 3 && pointInPolygon(probe, polygon);
        })
        .map((f) => ({
          id: f.id,
          color: featureColor(f.kind, f.layer, f.status, f.line),
          top: (f.base ?? 0) + (f.height ?? 0),
        }));
      for (let i = 0; i < stack.length; i++) {
        for (let j = i + 1; j < stack.length; j++) {
          const [a, b] = [stack[i], stack[j]];
          if (a.color === b.color) continue;
          expect(Math.abs(a.top - b.top) > 0.05, `${a.id} 與 ${b.id} 在 ${probe} 頂面共面異色`).toBe(
            true,
          );
        }
      }
    }
  });

  it("地下結構可以伸出地面範圍之外", () => {
    const outside = features.filter((f) => {
      if ((f.base ?? 0) >= 0) return false;
      return pointsOf(f).some((p) => !insideRing(p, OVERGROUND_RING));
    });
    expect(outside.length).toBeGreaterThan(0);
  });
});
