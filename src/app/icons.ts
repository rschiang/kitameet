/**
 * 工具列圖示：20×20 線稿，粗細與顏色由 CSS 的 currentColor 決定。
 * 以 DOM 建立而非內嵌字串，避免 innerHTML。
 */
export type IconName = "layers" | "slice" | "legend" | "info";

const PATHS: Record<IconName, string[]> = {
  layers: ["M10 2.5 18 7l-8 4.5L2 7l8-4.5Z", "M2 10.5 10 15l8-4.5", "M2 13.8 10 18.3l8-4.5"],
  slice: ["M3 6.5 10 3l7 3.5v7L10 17l-7-3.5v-7Z", "M3.4 12.6 16.6 6.9"],
  legend: ["M3 5h3v3H3z", "M3 10h3v3H3z", "M3 15h3v2.5H3z", "M9 6.5h8", "M9 11.5h8", "M9 16h8"],
  info: ["M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "M10 9v5", "M10 6.3h.01"],
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
