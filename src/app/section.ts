/**
 * 剖面控制：單一剖切面，方位角以正東為 0 度、逆時針為正，
 * 位置為剖切面沿法線方向距原點的公尺數。
 */
import type { SectionState } from "./state.ts";

export const SECTION_OFFSET_RANGE = 800;

export interface SectionContent {
  element: HTMLElement;
  sync(state: SectionState): void;
}

export function createSectionContent(
  state: SectionState,
  onChange: (next: SectionState) => void,
): SectionContent {
  const element = document.createElement("div");
  element.className = "rows";

  const toggle = document.createElement("label");
  toggle.className = "switch";
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = state.enabled;
  const track = document.createElement("span");
  track.className = "track";
  const toggleText = document.createElement("span");
  toggleText.className = "switch-text";
  const toggleLabel = document.createElement("span");
  toggleLabel.className = "switch-label";
  toggleLabel.textContent = "啟用剖切面";
  toggleText.append(toggleLabel);
  toggle.append(toggleInput, track, toggleText);

  const bearing = document.createElement("input");
  bearing.type = "range";
  bearing.min = "0";
  bearing.max = "360";
  bearing.step = "1";
  bearing.value = String(state.bearing);
  bearing.setAttribute("aria-label", "剖切面方位角");

  const bearingValue = document.createElement("span");
  bearingValue.className = "value";

  const offset = document.createElement("input");
  offset.type = "range";
  offset.min = String(-SECTION_OFFSET_RANGE);
  offset.max = String(SECTION_OFFSET_RANGE);
  offset.step = "5";
  offset.value = String(state.offset);
  offset.setAttribute("aria-label", "剖切面位置");

  const offsetValue = document.createElement("span");
  offsetValue.className = "value";

  const bearingRow = document.createElement("div");
  bearingRow.className = "slider-row";
  const bearingLabel = document.createElement("span");
  bearingLabel.textContent = "方位";
  bearingRow.append(bearingLabel, bearing, bearingValue);

  const offsetRow = document.createElement("div");
  offsetRow.className = "slider-row";
  const offsetLabel = document.createElement("span");
  offsetLabel.textContent = "位置";
  offsetRow.append(offsetLabel, offset, offsetValue);

  element.append(toggle, bearingRow, offsetRow);

  const emit = () => {
    onChange({
      enabled: toggleInput.checked,
      bearing: Number(bearing.value),
      offset: Number(offset.value),
    });
  };

  toggleInput.addEventListener("change", emit);
  bearing.addEventListener("input", emit);
  offset.addEventListener("input", emit);

  const content: SectionContent = {
    element,
    sync(next) {
      toggleInput.checked = next.enabled;
      bearing.value = String(next.bearing);
      offset.value = String(next.offset);
      bearingValue.textContent = `${Math.round(next.bearing)}°`;
      offsetValue.textContent = `${Math.round(next.offset)} m`;
      bearing.disabled = !next.enabled;
      offset.disabled = !next.enabled;
      for (const row of [bearingRow, offsetRow]) {
        if (next.enabled) delete row.dataset.disabled;
        else row.dataset.disabled = "true";
      }
    },
  };
  content.sync(state);
  return content;
}
