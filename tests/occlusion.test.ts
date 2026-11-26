import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Plane, Vector3 } from "three";
import { featuresFor } from "../src/app/scenario.ts";
import type { Feature } from "../src/data/schema.ts";
import type { Local } from "../src/geo/project.ts";
import {
  addGhostPasses,
  buildFeatureMesh,
  mergeMeshes,
  meshGroupKey,
} from "../src/render/builders.ts";
import {
  buildOcclusionIndex,
  findObstructing,
  type OcclusionIndex,
  type OcclusionOptions,
} from "../src/render/occlusion.ts";

const square = (cx: number, cy: number, half = 10): Local[] => [
  [cx - half, cy - half],
  [cx + half, cy - half],
  [cx + half, cy + half],
  [cx - half, cy + half],
];

const building = (
  id: string,
  cx: number,
  cy: number,
  layer: "building" | "landmark" = "building",
): Feature => ({
  id,
  kind: layer,
  level: "G",
  layer,
  geometry: { polygon: square(cx, cy) },
  base: 0,
  height: 20,
  confidence: "derived",
});

const track: Feature = {
  id: "track",
  kind: "track-tra",
  level: "B2",
  layer: "track",
  line: "tra",
  geometry: {
    polyline: [
      [-100, 0],
      [100, 0],
    ],
  },
  base: -14.5,
  height: 0.3,
  width: 3,
  confidence: "derived",
};

const metroTrack: Feature = {
  id: "metro-track",
  kind: "track-metro",
  level: "B3",
  layer: "track",
  line: "bl",
  geometry: {
    polyline: [
      [-380, 60],
      [-180, 60],
    ],
  },
  base: -16.5,
  height: 0.3,
  width: 3,
  confidence: "derived",
};

const front = building("front", 0, -40);
const behind = building("behind", 0, 40);
const aside = building("aside", 160, -40);
const landmarkA = building("landmark/demo/a", -60, -40, "landmark");
const landmarkB = building("landmark/demo/b", 400, 400, "landmark");
const clipped0 = building("way/1#0", 60, -40);
const clipped1 = building("way/1#1", 600, 400);
const aroundCamera = building("around-camera", 0, -200);
const overMetro = building("over-metro", -280, 10);

const fixture = [
  track,
  metroTrack,
  front,
  behind,
  aside,
  landmarkA,
  landmarkB,
  clipped0,
  clipped1,
  aroundCamera,
  overMetro,
];

const studioCamera = (position: [number, number, number]): PerspectiveCamera => {
  const camera = new PerspectiveCamera(50, 16 / 9, 1, 12000);
  camera.position.set(...position);
  camera.lookAt(0, -17, 0);
  camera.updateMatrixWorld();
  return camera;
};

const FOCUS = new Vector3(0, -17, 0);
const ALL_VISIBLE: OcclusionOptions = { layerVisible: () => true, clipPlane: null, focus: FOCUS };

const flagsFor = (
  camera: PerspectiveCamera,
  options: OcclusionOptions = ALL_VISIBLE,
): { index: OcclusionIndex; out: Uint8Array } => {
  const index = buildOcclusionIndex(fixture);
  const out = new Uint8Array(index.unitCount);
  findObstructing(index, camera, options, out);
  return { index, out };
};

describe("遮蔽判定", () => {
  it("地標各部與裁切片段共用同一個淡化單元", () => {
    const index = buildOcclusionIndex(fixture);
    expect(index.unitCount).toBe(7);
    expect(index.units.get(landmarkA)).toBe(index.units.get(landmarkB));
    expect(index.units.get(clipped0)).toBe(index.units.get(clipped1));
    expect(index.units.has(track)).toBe(false);
  });

  it("只有擋在相機與股道之間的建物被判定為遮蔽", () => {
    const { index, out } = flagsFor(studioCamera([0, 120, 200]));
    expect(out[index.units.get(front)!]).toBe(1);
    expect(out[index.units.get(behind)!]).toBe(0);
    expect(out[index.units.get(aside)!]).toBe(0);
    expect(out[index.units.get(landmarkA)!]).toBe(1);
    expect(out[index.units.get(clipped0)!]).toBe(1);
    expect(out[index.units.get(aroundCamera)!]).toBe(0);
  });

  it("股道圖層關閉時不淡化任何建物", () => {
    const { out } = flagsFor(studioCamera([0, 120, 200]), {
      layerVisible: () => false,
      clipPlane: null,
      focus: FOCUS,
    });
    expect([...out]).toEqual(new Array(out.length).fill(0));
  });

  it("剖面切除股道後不淡化任何建物", () => {
    const { out } = flagsFor(studioCamera([0, 120, 200]), {
      layerVisible: () => true,
      clipPlane: new Plane(new Vector3(0, 0, 1), -50),
      focus: FOCUS,
    });
    expect([...out]).toEqual(new Array(out.length).fill(0));
  });

  it("剖面只留下一段股道時，僅該段前方的建物淡化", () => {
    const { index, out } = flagsFor(studioCamera([0, 120, 200]), {
      layerVisible: () => true,
      clipPlane: new Plane(new Vector3(1, 0, 0), -30),
      focus: FOCUS,
    });
    expect(out[index.units.get(clipped0)!]).toBe(1);
    expect(out[index.units.get(front)!]).toBe(0);
    expect(out[index.units.get(landmarkA)!]).toBe(0);
  });

  it("相機位於建物之內時該建物仍判定為遮蔽", () => {
    const { index, out } = flagsFor(studioCamera([0, 10, 200]));
    expect(out[index.units.get(aroundCamera)!]).toBe(2);
    // 該建物位於忠孝西路以南，不在車站特定區內，因此只做淺淡化
    expect(out[index.units.get(front)!]).toBe(0);
  });

  it("視線目標之後的建物不淡化", () => {
    const { out } = flagsFor(studioCamera([0, 120, 200]), {
      ...ALL_VISIBLE,
      focus: new Vector3(0, 60, 112),
    });
    expect([...out]).toEqual(new Array(out.length).fill(0));
  });

  it("拉遠後遮住的範圍不足時不淡化", () => {
    const { out } = flagsFor(studioCamera([0, 480, 800]));
    expect([...out]).toEqual(new Array(out.length).fill(0));
  });

  it("車站特定區內只擋住捷運的建物仍為淺淡化", () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 1, 12000);
    camera.position.set(-280, 120, 150);
    camera.lookAt(-280, -17, -60);
    camera.updateMatrixWorld();
    const { index, out } = flagsFor(camera, {
      ...ALL_VISIBLE,
      focus: new Vector3(-280, -17, -60),
    });
    expect(out[index.units.get(overMetro)!]).toBe(2);
    expect(out[index.units.get(front)!]).toBe(0);
  });
});

describe("實際資料的遮蔽判定", () => {
  const features = featuresFor("status-quo");
  const index = buildOcclusionIndex(features);
  const station = features.find((f) => f.id.startsWith("landmark/taipei-station/"))!;
  const postOffice = features.find((f) => f.id.startsWith("landmark/post-office/"))!;
  const shinKong = features.find((f) => f.id.startsWith("landmark/shin-kong/"))!;

  const count = (position: [number, number, number]): { out: Uint8Array; total: number } => {
    const camera = new PerspectiveCamera(50, 16 / 9, 1, 12000);
    camera.position.set(...position);
    camera.lookAt(0, -10, 30);
    camera.updateMatrixWorld();
    const out = new Uint8Array(index.unitCount);
    findObstructing(index, camera, { ...ALL_VISIBLE, focus: new Vector3(0, -10, 30) }, out);
    return { out, total: out.reduce((a, b) => a + (b ? 1 : 0), 0) };
  };

  it("預設視角只淡化臺北車站與前景的街廓", () => {
    const { out, total } = count([330, 250, 430]);
    expect(total).toBeGreaterThan(80);
    expect(total).toBeLessThan(160);
    expect(out[index.units.get(station)!]).toBe(1);
  });

  it("預設視角下背景的地標維持實心", () => {
    const { out } = count([330, 250, 430]);
    expect(out[index.units.get(postOffice)!]).toBe(0);
  });

  it("近乎俯視時只淡化正壓在股道上的建物", () => {
    expect(count([20, 500, 60]).total).toBeLessThan(60);
  });

  it("車站特定區外的遮蔽只做淺淡化", () => {
    const { out } = count([330, 250, 430]);
    expect(out[index.units.get(station)!]).toBe(1);
    expect(out[index.units.get(shinKong)!]).toBe(2);
  });
});

describe("淡化單元的頂點屬性", () => {
  it("指定單元編號時逐頂點寫入該編號", () => {
    const mesh = buildFeatureMesh(front, 7)!;
    const occluder = mesh.geometry.getAttribute("occluder");
    expect(occluder.count).toBe(mesh.geometry.getAttribute("position").count);
    expect([...new Set(occluder.array as Float32Array)]).toEqual([7]);

    const plain = buildFeatureMesh(front)!;
    expect(plain.geometry.hasAttribute("occluder")).toBe(false);
    expect(meshGroupKey(mesh)).not.toBe(meshGroupKey(plain));
  });

  it("合併後各量體仍保有自己的單元編號", () => {
    const group = [buildFeatureMesh(front, 3)!, buildFeatureMesh(behind, 5)!];
    const merged = mergeMeshes(meshGroupKey(group[0]), group);
    const occluder = merged.geometry.getAttribute("occluder");
    expect(occluder.count).toBe(merged.geometry.getAttribute("position").count);
    expect([...new Set(occluder.array as Float32Array)].sort()).toEqual([3, 5]);

    const ghost = addGhostPasses(merged)!;
    expect([...ghost.units].sort()).toEqual([3, 5]);
    expect(merged.children).toHaveLength(2);
    expect(merged.children.every((child) => child.visible)).toBe(false);
  });

  it("不帶單元編號的量體不掛淡化繪製", () => {
    expect(addGhostPasses(buildFeatureMesh(track)!)).toBeNull();
  });
});
