/**
 * 公告圖的圖層分類。
 *
 * 圖層名形如 `<圖號>$0$<名稱>`，同一範圍的圖幅有三套命名慣例：
 * 捷運結構沿用 AutoCAD 的英文圖層名（`CN-ALIGN$0$rt_ce_st2`、`0DG-CL16-公告$0$TUNNEL-UP`），
 * 1/1000 地形圖底圖則依版本分別採中文敘述（`3846$0$RC、BC、建築中或高架道路下房屋`）、
 * 國土測繪中心編碼（`3946-67$0$93110_永久性房屋`）或純編號（`3845$0$6`）。
 * 純編號者無從判定語意，一律捨棄；其涵蓋範圍由相鄰圖幅或 OSM 補足。
 */

export type Category = "structure" | "limit" | "track" | "building" | "road";

/** 捷運結構外緣：各路線的圖層名大小寫與序號不一，連 `RT_CE_1ST` 都有。 */
const STRUCTURE = /RT_CE_\d*ST\d*|結構外緣|TUNNEL(-UP|-DN)?$/i;
/** 軌道中心線：松山線圖幅改以「車站編號區間 + 上下行」命名，例如 `CL-16-17U`。 */
const TRACK = /RT_CE_TRACK|(^|\$)CL-\d/i;
const BUILDING = ["93110_永久性房屋", "RC、BC、建築中或高架道路下房屋"];
const ROAD = ["94213_市區道路", "94219_區塊內道路", "94230_人行道", "高架道路、鬆土路面、道路"];

/** 判定圖層類別；與本專案無關的註記、方格、圖框、索引圖層一律回傳 null。 */
export function classify(name: string | null): Category | null {
  if (name === null) return null;
  if (STRUCTURE.test(name)) return "structure";
  if (name.includes("限建線")) return "limit";
  if (TRACK.test(name)) return "track";
  if (BUILDING.some((k) => name.includes(k))) return "building";
  // 市區高架道路（94213a）由 OSM 的高架道路量體提供，不取地形圖的邊線
  if (name.includes("94213a")) return null;
  if (ROAD.some((k) => name.includes(k))) return "road";
  return null;
}
