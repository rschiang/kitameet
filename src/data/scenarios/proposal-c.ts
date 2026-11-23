/**
 * 方案 C：方案 B 的西側變體。月台小幅旋轉與平移，西側改建區間延伸到中華路一段，
 * 四股道以單一半徑的主曲線轉入既有直線段；東側界線與方案 B 相同。
 * 共用的量體建構見 `shared.ts`，本檔只給定方案 C 專屬的參數。
 */
import { turnConnector } from "../../geo/alignment.ts";
import { buildScenario } from "./shared.ts";

/**
 * 月台擺放：相對方案 B 的位置轉 −5.0 度（順時針）、沿主軸西移 36 公尺、北移 8.5 公尺。
 * 股道端點的最大位移為 49.9 公尺（上限 50），已達邊界；開挖包絡距站體輪廓 2.0 公尺。
 */
export const PLACEMENT = { rotation: -5.0, along: -36, lateral: 8.5 } as const;
/**
 * 西側曲線半徑（公尺）：四股道一致。規劃時的上限為 237.6（含與松山新店線公告圖中心線
 * 保持 8 公尺的條件），取 235 保留餘裕；只計其餘條件時上限為 249，見 docs/proposals.md。
 */
export const WEST_RADIUS = 235;
/** 西側曲線前的切線段長度（公尺）。 */
export const WEST_TANGENT = 10;
/**
 * 東側相切連接器的標稱半徑上限（公尺）；四股道共用同一半徑，自此往下試到 {@link MIN_RADIUS}，
 * 取第一個四股道皆能與既有高鐵股道相切銜接的解（實際為 218）。
 */
export const EAST_RADIUS = 235;
/**
 * 改建區間的東西界（局部座標 x，公尺）。西界取中華路一段直線段上的接軌點；
 * 東界延伸至北平東路下方，與方案 B 相同。
 */
export const REBUILD_ZONE = { westX: -815, eastX: 540 } as const;

export const proposalC = buildScenario({
  id: "proposal-c",
  label: "方案 C",
  placement: PLACEMENT,
  rebuildZone: REBUILD_ZONE,
  eastRadius: EAST_RADIUS,
  west: {
    // 方案 B 的接軌對象只延伸到 x −773／−768，不通過西界，改接更西側的兩條
    tieInIds: {
      甲: { west: "way/199771201", east: "way/381111230" },
      乙: { west: "way/199771202", east: "way/593866771" },
    },
    tangent: WEST_TANGENT,
    build(tie, tieBearing, start, startBearing, name, side) {
      // 連接器自月台往接軌點（西行）計算，方位與點序皆須反轉
      const joined = turnConnector(start, startBearing - 180, tie, tieBearing - 180, WEST_RADIUS);
      if (!joined) {
        throw new Error(
          `新建股道 ${name}-${side} 西側無法以 ${WEST_RADIUS} 公尺的半徑轉入既有線形`,
        );
      }
      return joined.points.slice().reverse();
    },
    note: `西側自月台西端 ${WEST_TANGENT} 公尺切線段後，先以同半徑的反向曲線北偏 2.6–3.1 度，再以 ${WEST_RADIUS} 公尺主曲線左轉轉入中華路一段的既有直線段，四股道西側半徑一律 ${WEST_RADIUS} 公尺。`,
  },
  // 後兩條整條位於西界以東，全段改建
  rebuiltWest: ["way/199771201", "way/199771202", "way/13991375", "way/323105864"],
  hsrNote: "方案 C 改建區間（中華路一段至北平東路）內之既有高鐵隧道。",
});
