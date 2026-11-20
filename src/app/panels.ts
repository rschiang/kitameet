/**
 * 介面面板：標題、圖層開關、方案與視圖切換、圖例。
 * 全部以原生 DOM 建立，不引入 UI 框架。
 */
import { LAYER_LABELS, LEVELS, type LayerId, type LevelId } from "../data/schema.ts";
import { KIND_COLORS, LAYER_COLORS, STATUS_COLORS } from "../render/palette.ts";
import { LAYER_IDS, LEVEL_IDS, type AppState, type ScenarioId } from "./state.ts";
import type { ViewMode } from "./viewMode.ts";

function panel(id: string): HTMLElement {
  const element = document.createElement("section");
  element.className = "panel";
  element.id = id;
  return element;
}

export function createTitlePanel(provenance: string): HTMLElement {
  const element = panel("title");
  const heading = document.createElement("h1");
  heading.textContent = "KitaMeet — 臺北車站地下空間模擬";
  const note = document.createElement("p");
  note.textContent = provenance;
  element.append(heading, note);
  return element;
}

export interface LayerPanel {
  element: HTMLElement;
  sync(state: AppState): void;
}

export function createLayerPanel(
  onLayer: (layer: LayerId, visible: boolean) => void,
  onLevel: (level: LevelId, visible: boolean) => void,
): LayerPanel {
  const element = panel("layers");
  const layerInputs = {} as Record<LayerId, HTMLInputElement>;
  const levelInputs = {} as Record<LevelId, HTMLInputElement>;

  const layerSet = document.createElement("fieldset");
  const layerLegend = document.createElement("legend");
  layerLegend.textContent = "圖層";
  layerSet.append(layerLegend);
  for (const id of LAYER_IDS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.addEventListener("change", () => onLayer(id, input.checked));
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = LAYER_COLORS[id];
    label.append(input, swatch, document.createTextNode(LAYER_LABELS[id]));
    layerSet.append(label);
    layerInputs[id] = input;
  }

  const levelSet = document.createElement("fieldset");
  const levelLegend = document.createElement("legend");
  levelLegend.textContent = "樓層";
  levelSet.append(levelLegend);
  for (const id of LEVEL_IDS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.addEventListener("change", () => onLevel(id, input.checked));
    label.append(input, document.createTextNode(`${LEVELS[id].label}（${id}）`));
    levelSet.append(label);
    levelInputs[id] = input;
  }

  element.append(layerSet, levelSet);

  return {
    element,
    sync(state) {
      for (const id of LAYER_IDS) layerInputs[id].checked = state.layers[id];
      for (const id of LEVEL_IDS) levelInputs[id].checked = state.levels[id];
    },
  };
}

export interface TogglePanel<T extends string> {
  element: HTMLElement;
  sync(active: T): void;
}

function createTogglePanel<T extends string>(
  id: string,
  options: { value: T; label: string }[],
  onSelect: (value: T) => void,
): TogglePanel<T> {
  const element = panel(id);
  const buttons = new Map<T, HTMLButtonElement>();
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => onSelect(option.value));
    element.append(button);
    buttons.set(option.value, button);
  }
  return {
    element,
    sync(active) {
      for (const [value, button] of buttons) {
        button.setAttribute("aria-pressed", String(value === active));
      }
    },
  };
}

export function createViewPanel(onSelect: (mode: ViewMode) => void): TogglePanel<ViewMode> {
  return createTogglePanel(
    "views",
    [
      { value: "3d", label: "3D" },
      { value: "aerial", label: "空拍" },
    ],
    onSelect,
  );
}

export function createScenarioPanel(
  onSelect: (scenario: ScenarioId) => void,
): TogglePanel<ScenarioId> {
  return createTogglePanel(
    "scenario",
    [
      { value: "status-quo", label: "現況" },
      { value: "proposal-b", label: "方案 B" },
    ],
    onSelect,
  );
}

const LEGEND_ROWS: { color: string; label: string }[] = [
  { color: KIND_COLORS["track-tra"]!, label: "臺鐵股道" },
  { color: KIND_COLORS["track-hsr"]!, label: "高鐵股道" },
  { color: LAYER_COLORS.metro, label: "捷運" },
  { color: LAYER_COLORS.platform, label: "月台" },
  { color: LAYER_COLORS.mall, label: "地下街" },
  { color: STATUS_COLORS.added!, label: "方案新建" },
  { color: STATUS_COLORS.removed!, label: "方案拆除" },
  { color: STATUS_COLORS.repurposed!, label: "歸還臺鐵" },
];

export function createLegendPanel(): HTMLElement {
  const element = panel("legend");
  for (const row of LEGEND_ROWS) {
    const div = document.createElement("div");
    div.className = "legend-row";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = row.color;
    div.append(swatch, document.createTextNode(row.label));
    element.append(div);
  }
  const note = document.createElement("p");
  note.className = "note";
  note.textContent =
    "幾何來源：OpenStreetMap contributors（ODbL）。地下深度放大 1.2 倍；各構造物樓層深度不同，數值多為推估值。";
  element.append(note);
  return element;
}
