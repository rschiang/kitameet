/**
 * 二十座地標建物的細部量體。
 *
 * OSM 與禁限建公告圖都只有 2D 輪廓，拉高後是一塊塊方盒子，看不出哪一棟是哪一棟。
 * 本目錄逐座一檔，依現場照片的立面比例把每座地標拆成台基、柱列、腰線、簷口、
 * 屋頂斜面與塔冠等量體；平面一律由既有輪廓（公告圖優先、其次 OSM）推算，
 * 不新增座標常數，高度則以文獻值為準、其餘依立面照片的比例換算。
 *
 * 每座地標各自宣告一塊認領範圍（{@link landmarkClaims}），形心落在範圍內的建物量體
 * 由 `buildBaseline()` 移除，避免地形圖的房屋面與細部量體重疊。
 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import { buildControlYuan, claim as controlYuanClaim } from "./control-yuan.ts";
import { buildExecutiveYuan, claim as executiveYuanClaim } from "./executive-yuan.ts";
import { buildJianchengCircle, claim as jianchengCircleClaim } from "./jiancheng-circle.ts";
import { buildJudicialBuilding, claim as judicialBuildingClaim } from "./judicial-building.ts";
import { buildLongshanTemple, claim as longshanTempleClaim } from "./longshan-temple.ts";
import { buildMitsuiWarehouse, claim as mitsuiWarehouseClaim } from "./mitsui-warehouse.ts";
import { buildMocaTaipei, claim as mocaTaipeiClaim } from "./moca-taipei.ts";
import { NORTH_GATE, buildNorthGate, claim as northGateClaim } from "./north-gate.ts";
import { buildPeaceMonument, claim as peaceMonumentClaim } from "./peace-monument.ts";
import { POST_OFFICE, buildPostOffice, claim as postOfficeClaim } from "./post-office.ts";
import {
  buildPresidentialOffice,
  claim as presidentialOfficeClaim,
} from "./presidential-office.ts";
import { buildQingshanTemple, claim as qingshanTempleClaim } from "./qingshan-temple.ts";
import { buildRailwayDepartment, claim as railwayDepartmentClaim } from "./railway-department.ts";
import { buildRedHouse, claim as redHouseClaim } from "./red-house.ts";
import { SHIN_KONG, buildShinKong, claim as shinKongClaim } from "./shin-kong.ts";
import { buildSouthGate, claim as southGateClaim } from "./south-gate.ts";
import { buildTaipeiGuestHouse, claim as taipeiGuestHouseClaim } from "./taipei-guest-house.ts";
import {
  TAIPEI_STATION,
  buildTaipeiStation,
  claim as taipeiStationClaim,
} from "./taipei-station.ts";
import { buildTaiwanMuseum, claim as taiwanMuseumClaim } from "./taiwan-museum.ts";
import { buildZhongshanHall, claim as zhongshanHallClaim } from "./zhongshan-hall.ts";

/**
 * 由本目錄建模、因而於覆寫表標為 `exclude` 的 OSM 建物。
 * 其餘十六座靠認領範圍移除重疊量體，不需覆寫。
 */
export const LANDMARK_MODEL_IDS = [NORTH_GATE, POST_OFFICE, SHIN_KONG, TAIPEI_STATION] as const;

/** 二十座地標的建模函式與認領範圍，順序即量體在場景中的順序。 */
const LANDMARKS: { build: () => Feature[]; claim: () => Local[] }[] = [
  { build: buildTaipeiStation, claim: taipeiStationClaim },
  { build: buildPostOffice, claim: postOfficeClaim },
  { build: buildShinKong, claim: shinKongClaim },
  { build: buildNorthGate, claim: northGateClaim },
  { build: buildPresidentialOffice, claim: presidentialOfficeClaim },
  { build: buildJudicialBuilding, claim: judicialBuildingClaim },
  { build: buildZhongshanHall, claim: zhongshanHallClaim },
  { build: buildMitsuiWarehouse, claim: mitsuiWarehouseClaim },
  { build: buildTaiwanMuseum, claim: taiwanMuseumClaim },
  { build: buildPeaceMonument, claim: peaceMonumentClaim },
  { build: buildTaipeiGuestHouse, claim: taipeiGuestHouseClaim },
  { build: buildLongshanTemple, claim: longshanTempleClaim },
  { build: buildQingshanTemple, claim: qingshanTempleClaim },
  { build: buildRedHouse, claim: redHouseClaim },
  { build: buildRailwayDepartment, claim: railwayDepartmentClaim },
  { build: buildMocaTaipei, claim: mocaTaipeiClaim },
  { build: buildExecutiveYuan, claim: executiveYuanClaim },
  { build: buildControlYuan, claim: controlYuanClaim },
  { build: buildJianchengCircle, claim: jianchengCircleClaim },
  { build: buildSouthGate, claim: southGateClaim },
];

let cached: Feature[] | null = null;

/** 二十座地標的細部量體。 */
export function buildLandmarks(): Feature[] {
  if (cached) return cached;
  cached = LANDMARKS.flatMap((landmark) => landmark.build());
  return cached;
}

/**
 * 地標的認領範圍：形心落在其中的建物量體改由本目錄的細部量體呈現。
 * 範圍即該地標的既有輪廓，因此公告圖切成數塊的房屋面也會一併讓位。
 */
export function landmarkClaims(): Local[][] {
  return LANDMARKS.map((landmark) => landmark.claim());
}
