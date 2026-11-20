/**
 * 剖面控制：單一剖切面，方位角以正東為 0 度、逆時針為正，
 * 位置為剖切面沿法線方向距原點的公尺數。
 */
import type { SectionState } from "./state.ts";

export const SECTION_OFFSET_RANGE = 800;

export interface SectionPanel {
  element: HTMLElement;
  sync(state: SectionState): void;
}

export function createSectionPanel(
  state: SectionState,
  onChange: (next: SectionState) => void,
): SectionPanel {
  const element = document.createElement("section");
  element.className = "panel";
  element.id = "section";

  const toggle = document.createElement("label");
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = state.enabled;
  toggle.append(toggleInput, document.createTextNode("剖面"));

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

  const bearingLabel = document.createElement("span");
  bearingLabel.textContent = "方位";
  const offsetLabel = document.createElement("span");
  offsetLabel.textContent = "位置";
  toggle.style.gridColumn = "1 / -1";

  element.append(toggle, bearingLabel, bearing, bearingValue, offsetLabel, offset, offsetValue);

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

  const panel: SectionPanel = {
    element,
    sync(next) {
      toggleInput.checked = next.enabled;
      bearing.value = String(next.bearing);
      offset.value = String(next.offset);
      bearingValue.textContent = `${Math.round(next.bearing)}°`;
      offsetValue.textContent = `${Math.round(next.offset)} m`;
      bearing.disabled = !next.enabled;
      offset.disabled = !next.enabled;
    },
  };
  panel.sync(state);
  return panel;
}
