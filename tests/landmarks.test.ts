import { describe, expect, it } from "vitest";
import { Box3 } from "three";
import { buildBaseline } from "../src/data/scene.ts";
import { buildLandmarks, landmarkClaims } from "../src/data/structures/landmarks/index.ts";
import { buildFeatureMesh } from "../src/render/builders.ts";
import { pointInPolygon, polygonCentroid } from "../src/geo/measure.ts";
import { insetRing } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";

const features = buildBaseline();
const parts = buildLandmarks();

const groupTop = (prefix: string): number =>
  Math.max(
    ...parts
      .filter((f) => f.id.startsWith(`landmark/${prefix}/`))
      .map((f) => (f.base ?? 0) + (f.height ?? 0)),
  );

describe("地標細部量體", () => {
  const SLUGS = [
    "taipei-station",
    "post-office",
    "shin-kong",
    "north-gate",
    "presidential-office",
    "judicial-building",
    "zhongshan-hall",
    "mitsui-warehouse",
    "taiwan-museum",
    "peace-monument",
    "taipei-guest-house",
    "longshan-temple",
    "qingshan-temple",
    "red-house",
    "railway-department",
    "moca-taipei",
    "executive-yuan",
    "control-yuan",
    "jiancheng-circle",
    "south-gate",
  ];

  it("二十座地標各有細部量體，最高點合於文獻或照片比例", () => {
    for (const id of SLUGS) {
      expect(parts.filter((f) => f.id.startsWith(`landmark/${id}/`)).length, id).toBeGreaterThan(10);
    }
    // 站體 48 公尺、新光尖頂 244.15 公尺、司法大廈 31.8 公尺為文獻值
    expect(groupTop("taipei-station")).toBeCloseTo(48, 6);
    expect(groupTop("shin-kong")).toBeCloseTo(244.15, 6);
    expect(groupTop("judicial-building")).toBeCloseTo(31.8, 6);
    // 郵局四層與北門城樓依立面照片推估，量級須合理
    expect(groupTop("post-office")).toBeGreaterThan(18);
    expect(groupTop("post-office")).toBeLessThan(24);
    expect(groupTop("north-gate")).toBeGreaterThan(12);
    expect(groupTop("north-gate")).toBeLessThan(16);
    // 其餘地標的最高點須落在合理量級：最低的建成圓環廣場亦應高於 0.5 公尺
    for (const id of SLUGS) {
      expect(groupTop(id), id).toBeGreaterThan(0.5);
      expect(groupTop(id), id).toBeLessThan(250);
    }
  });

  it("地標量體一律歸入地標圖層的地面層，並附來源說明", () => {
    for (const feature of parts) {
      expect(feature.layer, feature.id).toBe("landmark");
      expect(feature.kind, feature.id).toBe("landmark");
      expect(feature.level, feature.id).toBe("G");
      expect(feature.base, feature.id).toBeGreaterThanOrEqual(0);
      expect(feature.height ?? 0, feature.id).toBeGreaterThan(0);
      expect(feature.sourceNote ?? "", feature.id).not.toHaveLength(0);
    }
  });

  it("認領範圍內不再留下原本的建物量體", () => {
    const claims = landmarkClaims();
    const strays = features.filter((f) => {
      if (f.id.startsWith("landmark/")) return false;
      if (f.kind !== "building" && f.kind !== "landmark") return false;
      const polygon = f.geometry.polygon;
      if (!polygon) return false;
      return claims.some((claim) => pointInPolygon(polygonCentroid(polygon), claim));
    });
    expect(strays.map((f) => f.id)).toEqual([]);
    // 細部量體確實進入場景
    expect(features.filter((f) => f.id.startsWith("landmark/")).length).toBe(parts.length);
  });

  it("放樣量體的上下輪廓頂點一一對應，且建出的 mesh 高度正確", () => {
    const lofted = parts.filter((f) => f.geometry.polygonTop);
    expect(lofted.length).toBeGreaterThan(8);
    for (const feature of lofted) {
      expect(feature.geometry.polygonTop!.length, feature.id).toBe(
        feature.geometry.polygon!.length,
      );
      const mesh = buildFeatureMesh(feature);
      expect(mesh, feature.id).not.toBeNull();
      // 頂點為 float32，238 公尺高處的誤差約 0.01 公釐等級
      const box = new Box3().setFromObject(mesh!);
      expect(box.min.y, feature.id).toBeCloseTo(feature.base!, 3);
      expect(box.max.y - box.min.y, feature.id).toBeCloseTo(feature.height!, 3);
    }
  });

  it("環的平移保持頂點數，正值往內、負值往外", () => {
    const square: Local[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const inner = insetRing(square, 1);
    expect(inner).toHaveLength(4);
    expect(inner[0][0]).toBeCloseTo(1, 6);
    expect(inner[2][1]).toBeCloseTo(9, 6);
    const outer = insetRing(square, -1.5);
    expect(outer[0][0]).toBeCloseTo(-1.5, 6);
    expect(outer[2][1]).toBeCloseTo(11.5, 6);
    // 順時針環的內外側與逆時針一致
    const clockwise = [...square].reverse();
    const innerCw = insetRing(clockwise, 1);
    expect(innerCw[0][0]).toBeCloseTo(1, 6);
    expect(innerCw[2][1]).toBeCloseTo(1, 6);
  });
});
