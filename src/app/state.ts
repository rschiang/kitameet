import { LAYER_LABELS, LEVELS, type LayerId, type LevelId } from "../data/schema.ts";
import { DEFAULT_CAMERA, type CameraState } from "../render/scene.ts";
import type { ViewMode } from "./viewMode.ts";

export type ScenarioId = "status-quo" | "proposal-b";

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
  layers: Record<LayerId, boolean>;
  levels: Record<LevelId, boolean>;
  section: SectionState;
  camera: CameraState;
}

export const LAYER_IDS = Object.keys(LAYER_LABELS) as LayerId[];
export const LEVEL_IDS = Object.keys(LEVELS) as LevelId[];

/** 預設顯示全部圖層與樓層，3D 視圖、現況、不剖切。 */
export function defaultState(): AppState {
  const layers = {} as Record<LayerId, boolean>;
  for (const id of LAYER_IDS) layers[id] = true;
  const levels = {} as Record<LevelId, boolean>;
  for (const id of LEVEL_IDS) levels[id] = true;
  return {
    mode: "3d",
    scenario: "status-quo",
    layers,
    levels,
    section: { enabled: false, bearing: 100, offset: 0 },
    camera: { ...DEFAULT_CAMERA },
  };
}
