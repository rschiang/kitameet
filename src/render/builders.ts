/**
 * 量體建模：多邊形以 ExtrudeGeometry 長出高度，折線以中心線兩側平移成扁帶後長出厚度。
 * 所有幾何在建模時就把底面高程烘焙進頂點，之後僅以 position／scale 做視圖壓縮。
 */
import { BackSide, DoubleSide, ExtrudeGeometry, Mesh, Shape, type BufferGeometry } from "three";
import { corridorPolygon } from "../geo/offset.ts";
import { exaggerate } from "./depth.ts";
import type { Feature } from "../data/schema.ts";
import { featureColor } from "./palette.ts";
import { createPaperMaterial } from "./materials.ts";

export interface FeatureUserData {
  featureId: string;
  layer: Feature["layer"];
  level: Feature["level"];
  kind: Feature["kind"];
  name?: string;
  confidence: Feature["confidence"];
  sourceNote?: string;
  status: NonNullable<Feature["status"]>;
  /** 量體底面高程（放大後），視圖壓縮時用來換算位移。 */
  base: number;
  /** 量體底面的真實高程（公尺）。 */
  trueBase: number;
}

function shapeFrom(points: [number, number][]): Shape {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

/**
 * 以局部座標的多邊形長出量體。
 * 擠出方向原為 +Z，旋轉後對應場景的 +Y（高程），同時把局部 y 轉為場景 −Z。
 */
function extrude(points: [number, number][], height: number, base: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapeFrom(points), {
    depth: Math.max(height, 0.05),
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** 由 {@link Feature} 建立可直接加入場景的 mesh；幾何不足時回傳 null。 */
export function buildFeatureMesh(feature: Feature): Mesh | null {
  // 深度放大作用於上下兩端高程，高度由差值求得，避免分別放大造成錯位
  const trueBase = feature.base ?? 0;
  const base = exaggerate(trueBase);
  const height = exaggerate(trueBase + (feature.height ?? 1)) - base;

  let geometry: BufferGeometry;
  if (feature.geometry.polygon && feature.geometry.polygon.length >= 3) {
    geometry = extrude(feature.geometry.polygon, height, base);
  } else if (feature.geometry.polyline && feature.geometry.polyline.length >= 2) {
    const band = corridorPolygon(feature.geometry.polyline, feature.width ?? 3);
    geometry = extrude(band, height, base);
  } else {
    return null;
  }

  const status = feature.status ?? "existing";
  // 站體外殼只畫背面，做出掀蓋紙盒的效果，使內部月台、股道不被遮住；
  // 樓板則以半透明呈現，仍能看出層層相疊的關係。
  const shell = feature.layer === "station-box" && feature.kind !== "slab";
  const slab = feature.kind === "slab";
  const opacity = status === "removed" ? 0.25 : shell ? 0.4 : slab ? 0.15 : 1;
  const material = createPaperMaterial({
    color: featureColor(feature.kind, feature.layer, status === "existing" ? undefined : status),
    opacity,
    side: shell ? BackSide : DoubleSide,
  });
  material.userData.baseOpacity = opacity;

  const mesh = new Mesh(geometry, material);
  mesh.castShadow = feature.layer === "building" || feature.layer === "landmark";
  mesh.receiveShadow = feature.level === "G";
  const userData: FeatureUserData = {
    featureId: feature.id,
    layer: feature.layer,
    level: feature.level,
    kind: feature.kind,
    confidence: feature.confidence,
    status,
    base,
    trueBase,
  };
  if (feature.name !== undefined) userData.name = feature.name;
  if (feature.sourceNote !== undefined) userData.sourceNote = feature.sourceNote;
  mesh.userData = userData;
  mesh.name = feature.id;
  return mesh;
}

/** 釋放 mesh 佔用的 GPU 資源。 */
export function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}
