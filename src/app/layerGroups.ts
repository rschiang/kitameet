/**
 * 介面層的圖層分組：資料層的 {@link LayerId} 維持 13 種，
 * 開關只給使用者四組，避免面板塞滿一眼看不完的核取方塊。
 */
import { LAYER_COLORS, LINE_COLORS } from "../render/palette.ts";
import { LAYER_LABELS, type LayerId } from "../data/schema.ts";

export type LayerGroupId = "surface" | "rail" | "metro" | "restriction";

export interface LayerGroup {
  id: LayerGroupId;
  label: string;
  hint: string;
  swatch: string;
  layers: LayerId[];
}

export const LAYER_GROUPS: LayerGroup[] = [
  {
    id: "surface",
    label: "地面街廓",
    hint: "建物、地標、道路、公園水域與地塊",
    swatch: LAYER_COLORS.building,
    layers: ["building", "landmark", "road", "elevated-road", "ground", "terrain"],
  },
  {
    id: "rail",
    label: "鐵路車站",
    hint: "臺鐵高鐵站體、月台與股道",
    swatch: LINE_COLORS.tra,
    layers: ["station-box", "platform", "track"],
  },
  {
    id: "metro",
    label: "捷運與地下街",
    hint: "捷運站體與隧道、地下街與通道",
    swatch: LAYER_COLORS.metro,
    layers: ["metro", "mall", "passage"],
  },
  {
    id: "restriction",
    label: "禁限建範圍",
    hint: "捷運兩側禁限建公告線",
    swatch: LAYER_COLORS.restriction,
    layers: ["restriction"],
  },
];

export const LAYER_GROUP_IDS = LAYER_GROUPS.map((g) => g.id);

/** 圖層代號對應的群組；每個 LayerId 必屬於且僅屬於一組。 */
export const GROUP_OF_LAYER: Record<LayerId, LayerGroupId> = (() => {
  const map = {} as Record<LayerId, LayerGroupId>;
  for (const group of LAYER_GROUPS) for (const layer of group.layers) map[layer] = group.id;
  for (const id of Object.keys(LAYER_LABELS) as LayerId[]) {
    if (map[id] === undefined) throw new Error(`圖層 ${id} 未歸入任何群組`);
  }
  return map;
})();
