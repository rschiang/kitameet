/**
 * 介面元件：品牌卡、分段切換，以及工具列各彈出面板的內容。
 * 全部以原生 DOM 建立，不引入 UI 框架。
 */
import { KIND_COLORS, LAYER_COLORS, LINE_COLORS } from "../render/palette.ts";
import { LAYER_GROUPS, LAYER_GROUP_IDS, type LayerGroupId } from "./layerGroups.ts";
import { defaultState, type AppState, type ScenarioId } from "./state.ts";
import type { ViewMode } from "./viewMode.ts";

export function createBrandCard(): HTMLElement {
  const element = document.createElement("div");
  element.id = "brand";
  const heading = document.createElement("h1");
  heading.textContent = "KitaMeet";
  const note = document.createElement("p");
  note.textContent = "臺北車站地下空間模擬";
  element.append(heading, note);
  return element;
}

export interface TogglePanel<T extends string> {
  element: HTMLElement;
  sync(active: T): void;
}

export function createSegmented<T extends string>(
  id: string,
  ariaLabel: string,
  options: { value: T; label: string }[],
  onSelect: (value: T) => void,
): TogglePanel<T> {
  const element = document.createElement("div");
  element.id = id;
  element.className = "pill";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", ariaLabel);

  const buttons = new Map<T, HTMLButtonElement>();
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.dataset.value = option.value;
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
  return createSegmented(
    "views",
    "視圖模式",
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
  return createSegmented(
    "scenario",
    "方案",
    [
      { value: "status-quo", label: "現況" },
      { value: "proposal-b", label: "方案 B" },
      { value: "proposal-c", label: "方案 C" },
    ],
    onSelect,
  );
}

export interface LayerContent {
  element: HTMLElement;
  sync(state: AppState): void;
}

/** 圖層群組開關；最後一列禁限建預設關閉，另提供回復預設的連結。 */
export function createLayerContent(
  onToggle: (group: LayerGroupId, visible: boolean) => void,
  onReset: () => void,
): LayerContent {
  const element = document.createElement("div");
  element.className = "rows";
  const inputs = {} as Record<LayerGroupId, HTMLInputElement>;

  for (const group of LAYER_GROUPS) {
    const label = document.createElement("label");
    label.className = "switch";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => onToggle(group.id, input.checked));

    const track = document.createElement("span");
    track.className = "track";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = group.swatch;

    const text = document.createElement("span");
    text.className = "switch-text";
    const name = document.createElement("span");
    name.className = "switch-label";
    name.textContent = group.label;
    const hint = document.createElement("span");
    hint.className = "switch-hint";
    hint.textContent = group.hint;
    text.append(name, hint);

    label.append(input, track, swatch, text);
    element.append(label);
    inputs[group.id] = input;
  }

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "link-button";
  reset.textContent = "回到預設顯示";
  reset.addEventListener("click", onReset);
  element.append(reset);

  const defaults = defaultState().layers;
  return {
    element,
    sync(state) {
      let pristine = true;
      for (const id of LAYER_GROUP_IDS) {
        inputs[id].checked = state.layers[id];
        if (state.layers[id] !== defaults[id]) pristine = false;
      }
      reset.disabled = pristine;
    },
  };
}

const LEGEND_SECTIONS: { title: string; rows: { color: string; label: string }[] }[] = [
  {
    title: "軌道系統",
    rows: [
      { color: LINE_COLORS.tra, label: "臺鐵" },
      { color: LINE_COLORS.hsr, label: "高鐵" },
    ],
  },
  {
    title: "捷運路線",
    rows: [
      { color: LINE_COLORS.bl, label: "板南線" },
      { color: LINE_COLORS.r, label: "淡水信義線" },
      { color: LINE_COLORS.g, label: "松山新店線" },
      { color: LINE_COLORS.o, label: "中和新蘆線" },
      { color: LINE_COLORS.a, label: "機場捷運" },
    ],
  },
  {
    title: "量體",
    rows: [
      { color: LAYER_COLORS.platform, label: "月台" },
      { color: LAYER_COLORS.mall, label: "地下街" },
      { color: KIND_COLORS.parking!, label: "停車場" },
      { color: LAYER_COLORS["station-box"], label: "車站量體" },
      { color: LAYER_COLORS.passage, label: "通道" },
      { color: KIND_COLORS.stairs!, label: "階梯" },
      { color: KIND_COLORS.escalator!, label: "電扶梯" },
      { color: KIND_COLORS.elevator!, label: "電梯" },
      { color: KIND_COLORS["exit-shed"]!, label: "出入口雨棚" },
    ],
  },
];

export function createLegendContent(): HTMLElement {
  const element = document.createElement("div");
  for (const section of LEGEND_SECTIONS) {
    const title = document.createElement("h3");
    title.className = "legend-title";
    title.textContent = section.title;
    element.append(title);
    for (const row of section.rows) {
      const div = document.createElement("div");
      div.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = row.color;
      div.append(swatch, document.createTextNode(row.label));
      element.append(div);
    }
  }
  return element;
}

const COPY_RESET_MS = 1600;

export function createInfoContent(provenance: string): HTMLElement {
  const element = document.createElement("div");
  for (const text of [
    provenance,
    "幾何來源：OpenStreetMap contributors（ODbL）、臺北市捷運工程局兩側禁限建範圍公告圖。",
    "地下深度放大 1.2 倍；各構造物樓層深度不同，數值多為推估值。",
  ]) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = text;
    element.append(note);
  }

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "wide-button";
  const label = "複製目前畫面連結";
  copy.textContent = label;
  let timer: number | undefined;
  const settle = (text: string) => {
    copy.textContent = text;
    timer = window.setTimeout(() => (copy.textContent = label), COPY_RESET_MS);
  };
  copy.addEventListener("click", () => {
    window.clearTimeout(timer);
    // 未授權或瀏覽器不支援剪貼簿 API 時給明確回饋，不靜默失敗
    const written = navigator.clipboard?.writeText(location.href);
    if (!written) {
      settle("複製失敗");
      return;
    }
    written.then(
      () => settle("已複製"),
      () => settle("複製失敗"),
    );
  });
  element.append(copy);
  return element;
}
