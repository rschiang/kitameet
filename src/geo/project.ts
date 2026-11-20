import proj4 from "proj4";

/**
 * 專案原點：臺北車站站體中心附近。局部座標以公尺計，x 為東、y 為北。
 * 全專案僅此處做經緯度換算；渲染端一律使用局部公尺座標。
 */
export const ORIGIN = { lat: 25.0478, lon: 121.5172 } as const;

/** TWD97 TM2（中央經線 121 度），即 EPSG:3826。 */
const EPSG_3826 =
  "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

const forward = proj4("EPSG:4326", EPSG_3826);

const originTm2 = forward.forward([ORIGIN.lon, ORIGIN.lat]) as [number, number];

/** 局部公尺座標：[東, 北]，相對於 {@link ORIGIN}。 */
export type Local = [number, number];

/** WGS84 經緯度轉為以原點為基準的局部公尺座標。 */
export function toLocal(lon: number, lat: number): Local {
  const [e, n] = forward.forward([lon, lat]) as [number, number];
  return [e - originTm2[0], n - originTm2[1]];
}

/** WGS84 經緯度轉 TWD97 TM2（EPSG:3826）絕對座標，供圖資查詢的範圍參數使用。 */
export function toTm2(lon: number, lat: number): [number, number] {
  return forward.forward([lon, lat]) as [number, number];
}

/** TWD97 TM2 絕對座標轉為局部公尺座標。 */
export function fromTm2(e: number, n: number): Local {
  return [e - originTm2[0], n - originTm2[1]];
}

/** 局部公尺座標轉回 WGS84 經緯度，供除錯與資料校正使用。 */
export function toLonLat([x, y]: Local): [number, number] {
  const [lon, lat] = forward.inverse([x + originTm2[0], y + originTm2[1]]) as [number, number];
  return [lon, lat];
}

/**
 * 局部座標轉 three.js 場景座標。
 * 場景 X 為東、Y 為高程、Z 為南（即 −北），維持右手座標系。
 */
export function localToScene([x, y]: Local, z: number): [number, number, number] {
  return [x, z, -y];
}
