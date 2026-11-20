import type { LayerId, LevelId } from "../data/schema.ts";

export type ViewMode = "3d" | "aerial";

/** 空拍（正投影俯視）模式隱藏的圖層：地面以上的一切。 */
export const AERIAL_HIDDEN_LAYERS: Partial<Record<LayerId, true>> = {
  building: true,
  landmark: true,
  "elevated-road": true,
  road: true,
};

/** 空拍模式的高程壓縮比例：量體壓成薄板，僅保留相對厚度。 */
export const AERIAL_SQUASH = 0.04;

/** 視圖模式切換的轉場長度（毫秒）：量體漸變與相機轉向共用。 */
export const VIEW_TRANSITION_MS = 420;

/** 空拍模式各層薄板的高程（公尺），由深到淺等距排列。 */
export const AERIAL_PLATE_Y: Record<LevelId, number> = {
  elevated: 4,
  G: 2,
  B1: -2,
  B2: -5,
  B3: -8,
  B4: -11,
};

/** 繪製順序：淺層後畫，確保俯視時壓在深層之上。 */
export const LEVEL_ORDER: Record<LevelId, number> = {
  B4: 0,
  B3: 1,
  B2: 2,
  B1: 3,
  G: 4,
  elevated: 5,
};
