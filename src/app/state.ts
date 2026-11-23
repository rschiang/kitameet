import { DEFAULT_CAMERA, type CameraState } from "../render/scene.ts";
import { LAYER_GROUP_IDS, type LayerGroupId } from "./layerGroups.ts";
import type { ViewMode } from "./viewMode.ts";

export type ScenarioId = "status-quo" | "proposal-b" | "proposal-c";

export interface SectionState {
  enabled: boolean;
  /** 剖切面法線方位，自正東起算的度數。 */
  bearing: number;
  /** 剖切面沿法線方向的位置（公尺）。 */
  offset: number;
}

export interface AppState {
  mode: ViewMode;
  scenario: ScenarioId;
  layers: Record<LayerGroupId, boolean>;
  section: SectionState;
  camera: CameraState;
}

/** 預設顯示全部圖層群組，3D 視圖、現況、不剖切；限建線會蓋住整個畫面，預設關閉。 */
export function defaultState(): AppState {
  const layers = {} as Record<LayerGroupId, boolean>;
  for (const id of LAYER_GROUP_IDS) layers[id] = id !== "restriction";
  return {
    mode: "3d",
    scenario: "status-quo",
    layers,
    section: { enabled: false, bearing: 100, offset: 0 },
    camera: { ...DEFAULT_CAMERA },
  };
}
