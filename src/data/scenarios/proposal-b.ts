/**
 * 方案 B：新建月台對齊 K 區地下街東端、與既有第一月台平行，
 * 西側以反向曲線與北門北側的既有喉道曲線相切銜接。
 * 共用的量體建構見 `shared.ts`，本檔只給定方案 B 專屬的參數。
 */
import { tangentConnector } from "../../geo/alignment.ts";
import { MIN_RADIUS, buildScenario } from "./shared.ts";

/**
 * 東側相切連接器的標稱半徑上限（公尺）；四股道共用同一半徑，自此往下試到 {@link MIN_RADIUS}，
 * 取第一個四股道皆能與既有高鐵股道相切銜接的解（實際為 118）。
 */
export const EAST_RADIUS = 200;
/**
 * 西側相切連接器的標稱半徑上限（公尺）；自此往下試到 {@link MIN_RADIUS}，
 * 取第一個能與既有喉道曲線相切銜接的解（兩條幹線實際為甲 102、乙 95）。
 * 正本 B′ 西側量得 81.5–94.5 公尺。
 */
export const WEST_RADIUS = 122;
/** 西側反向曲線前的切線段長度（公尺）；東側無切線段，曲線自月台東端起算。 */
export const WEST_TANGENT = 10;
/**
 * 改建區間的東西界（局部座標 x，公尺）。
 * 西界取北門北側（局部座標 x −606）既有喉道曲線上的相切接軌點；
 * 原依 B′ 疊圖取 −589，但該處相切銜接只能做到 R 86–98。
 * 東界延伸至北平東路下方：新建股道須在此之前完全離開臺鐵第一、二月台所夾的四股道。
 */
export const REBUILD_ZONE = { westX: -606, eastX: 540 } as const;
/** 分岔點（沿既有第一月台主軸，公尺）：三井倉庫（`way/589683660`，沿主軸 −494⋯−471）西緣。 */
export const SPLIT_ALONG = -494;

export const proposalB = buildScenario({
  id: "proposal-b",
  label: "方案 B",
  placement: { rotation: 0, along: 0, lateral: 0 },
  rebuildZone: REBUILD_ZONE,
  eastRadius: EAST_RADIUS,
  west: {
    tieInIds: {
      甲: { west: "way/13991375", east: "way/381111230" },
      乙: { west: "way/323105864", east: "way/593866771" },
    },
    tangent: WEST_TANGENT,
    splitAlong: SPLIT_ALONG,
    build(tie, tieBearing, start, startBearing, name, side) {
      const joined = tangentConnector(tie, tieBearing, start, startBearing, WEST_RADIUS, MIN_RADIUS);
      if (!joined) {
        throw new Error(
          `新建股道 ${name}-${side} 西側無法以不低於 ${MIN_RADIUS} 公尺的半徑相切接回既有線形`,
        );
      }
      return joined.points;
    },
    note: `西側兩條幹線與既有喉道曲線相切銜接（甲 102、乙 95 公尺），於沿主軸 ${SPLIT_ALONG} 公尺分岔為四條股道，漸移段 134 與 138 公尺，四條股道的最小曲率半徑 93–107 公尺。`,
  },
  rebuiltWest: ["way/13991375", "way/323105864"],
  hsrNote: "方案 B 改建區間（北門至北平東路）內之既有高鐵隧道。",
});
