/**
 * 自臺北市捷運工程局「兩側禁限建範圍公告圖查詢系統」擷取逐幅的向量 PDF，
 * 解析為捷運結構、軌道中心線、限建線與 1/1000 地形圖底圖，轉為局部公尺座標後
 * 寫入 src/data/dorts/。以 `npm run fetch:dorts` 執行（Node 原生型別剝離，無需建置步驟）。
 *
 * 網站執行時不連外；本腳本的產出直接進版控，PDF 快取則否。
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ORIGIN, toTm2, type Local } from "../src/geo/project.ts";
import type {
  DortsBasemap,
  DortsLine,
  DortsLineCode,
  DortsStructures,
  DortsTunnel,
} from "../src/data/dorts-types.ts";
import { buildBasemap } from "./dorts/basemap.ts";
import { buildStructures, type LineGeometry, type TunnelShape } from "./dorts/structures.ts";
import { loadSheet, type SheetGeometry, type SheetIndex } from "./dorts/sheet.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USER_AGENT = "kitameet/0.1 (https://github.com/; urban planning study)";

const INDEX_URL =
  "https://wwwgs.dorts.gov.taipei/server/rest/services/Hosted/BRshpNewCodeView/FeatureServer/0/query";
const PDF_URL = "https://eng.dorts.gov.taipei/br/pdf";

/**
 * 納入的路線：南港線、板橋線、淡水線、新店線、松山線。
 * 新莊線（K）與蘆洲線（L）的圖幅只切到查詢範圍東緣、與臺北車站站區無關，故排除。
 */
const LINE_CODES: DortsLineCode[] = ["N", "P", "T", "H", "G"];

/**
 * 圖幅索引的查詢範圍較 bbox 外擴的距離（公尺）。
 * SA01RWH003A 與 SA01RWT008A 的圖框分別差 17 與 10 公尺才碰到 bbox，
 * 但兩幅都緊鄰範圍、且含站區路線的連續結構，不應因圖框邊界而漏掉。
 */
const INDEX_MARGIN = 50;

/**
 * 本範圍納入的固定圖幅；缺少任一幅即中止，避免靜默產生不完整的場景。
 * 索引另有的新圖幅不會自動納入，只列出警告，須人工確認後再加入此清單。
 */
const EXPECTED_SHEETS = [
  "SA01RWH001A", "SA01RWH002A", "SA01RWH003A",
  "SA01RWN005A", "SA01RWN006A", "SA01RWN007B", "SA01RWN008B", "SA01RWN009A", "SA01RWN010A",
  "SA01RWN011A", "SA01RWN012A", "SA01RWN013A", "SA01RWN014A", "SA01RWN015A",
  "SA01RWP027A",
  "SA01RWSS01A", "SA01RWSS02A", "SA01RWSS03A", "SA01RWSS04A", "SA01RWSS05A", "SA01RWSS06A",
  "SA01RWSS07A", "SA01RWSS08A", "SA01RWSS09A", "SA01RWSS10A", "SA01RWSS11A", "SA01RWSS12A",
  "SA01RWT001A", "SA01RWT002A", "SA01RWT003A", "SA01RWT004A", "SA01RWT005A", "SA01RWT006A",
  "SA01RWT007A", "SA01RWT008A",
];

/** 品質門檻；任一項超出即不寫出產出檔。 */
const LIMITS = {
  gridResidual: 0.25,
  snapCorrection: 2.0,
  sheetMatch: 0.5,
  restriction: { min: 48, max: 52 },
};

const round = (n: number) => Math.round(n * 100) / 100;

// ── 圖幅索引與下載 ──────────────────────────────────────

function readBbox(query: string) {
  const m = query.match(/\[bbox:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]/);
  if (!m) throw new Error("查詢檔缺少 [bbox:...] 設定");
  return { south: +m[1], west: +m[2], north: +m[3], east: +m[4] };
}

async function fetchRetry(url: string, attempts = 3): Promise<Response> {
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delay = 5_000 * 2 ** (attempt - 1);
      console.error(`等待 ${delay / 1000} 秒後重試 ${url}`);
      await sleep(delay);
    }
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return res;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }
    console.error(`${url} 失敗：${lastError}`);
  }
  throw new Error(`下載失敗：${url}（${lastError}）`);
}

async function fetchIndex(): Promise<SheetIndex[]> {
  const query = await readFile(join(ROOT, "data/queries/underground.overpassql"), "utf8");
  const bbox = readBbox(query);
  const corners = [
    toTm2(bbox.west, bbox.south),
    toTm2(bbox.east, bbox.south),
    toTm2(bbox.east, bbox.north),
    toTm2(bbox.west, bbox.north),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const envelope = [
    Math.min(...xs) - INDEX_MARGIN,
    Math.min(...ys) - INDEX_MARGIN,
    Math.max(...xs) + INDEX_MARGIN,
    Math.max(...ys) + INDEX_MARGIN,
  ];

  const url = new URL(INDEX_URL);
  for (const [key, value] of Object.entries({
    where: "1=1",
    geometry: envelope.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "3826",
    outSR: "3826",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "name,no,linename,linecode",
    returnGeometry: "true",
    f: "json",
  })) {
    url.searchParams.set(key, value);
  }

  const res = await fetchRetry(url.toString());
  const json = (await res.json()) as {
    features?: {
      attributes: { name: string; no: string; linename: string; linecode: string };
      geometry: { rings: [number, number][][] };
    }[];
  };
  if (!Array.isArray(json.features)) throw new Error("圖幅索引回應缺少 features");

  const byName = new Map<string, SheetIndex>();
  for (const feature of json.features) {
    const { name, no, linename, linecode } = feature.attributes;
    if (!name.startsWith("SA01RW")) continue;
    if (!LINE_CODES.includes(linecode as DortsLineCode)) continue;
    if (byName.has(name)) continue;
    byName.set(name, {
      name,
      no,
      lineName: linename,
      lineCode: linecode as DortsLineCode,
      ring: feature.geometry.rings[0].slice(0, 4),
    });
  }

  const all = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const got = all.map((s) => s.name);
  const missing = EXPECTED_SHEETS.filter((n) => !got.includes(n));
  if (missing.length > 0) throw new Error(`圖幅索引缺少 ${missing.join("、")}`);
  const extra = got.filter((n) => !EXPECTED_SHEETS.includes(n));
  if (extra.length > 0) console.warn(`圖幅索引另有未納入的圖幅：${extra.join("、")}`);
  return all.filter((s) => EXPECTED_SHEETS.includes(s.name));
}

async function cachedPdf(name: string): Promise<Buffer> {
  const dir = join(ROOT, "data/cache/dorts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.pdf`);
  try {
    await stat(path);
    return await readFile(path);
  } catch {
    const res = await fetchRetry(`${PDF_URL}/${name}.pdf`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(path, buffer);
    return buffer;
  }
}

// ── 產出 ────────────────────────────────────────────────

const roundLine = (line: Local[]): Local[] => line.map(([x, y]) => [round(x), round(y)] as Local);

/** 識別字串須在重新擷取後穩定：先依幾何最小角點排序再編號。 */
function sortByCorner<T>(items: T[], points: (item: T) => Local[]): T[] {
  const key = (item: T) => {
    const pts = points(item);
    const x = round(Math.min(...pts.map((p) => p[0])));
    const y = round(Math.min(...pts.map((p) => p[1])));
    return [x, y] as const;
  };
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
}

function toTunnels(shapes: TunnelShape[]): DortsTunnel[] {
  const sorted = sortByCorner(shapes, (t) => (t.kind === "bore" ? t.line : t.polygon));
  const counters = new Map<string, number>();
  return sorted.map((shape) => {
    const key = `${shape.lineCode}/${shape.kind}`;
    const serial = (counters.get(key) ?? 0) + 1;
    counters.set(key, serial);
    const id = `dorts/${shape.lineCode}/${shape.kind}/${serial}`;
    return shape.kind === "bore"
      ? { id, lineCode: shape.lineCode, kind: "bore", line: roundLine(shape.line), radius: round(shape.radius) }
      : {
          id,
          lineCode: shape.lineCode,
          kind: "box",
          polygon: roundLine(shape.polygon),
          width: round(shape.width),
        };
  });
}

function toLines(items: LineGeometry[], kind: string): DortsLine[] {
  const sorted = sortByCorner(items, (item) => item.line);
  const counters = new Map<string, number>();
  return sorted.map((item) => {
    const serial = (counters.get(item.lineCode) ?? 0) + 1;
    counters.set(item.lineCode, serial);
    return {
      id: `dorts/${item.lineCode}/${kind}/${serial}`,
      lineCode: item.lineCode,
      line: roundLine(item.line),
    };
  });
}

async function writeJson(name: string, data: DortsStructures | DortsBasemap): Promise<number> {
  const dir = join(ROOT, "src/data/dorts");
  await mkdir(dir, { recursive: true });
  const text = `${JSON.stringify(data, null, 1)}\n`;
  const tmp = join(dir, `.${name}.json.tmp`);
  await writeFile(tmp, text, "utf8");
  await rename(tmp, join(dir, `${name}.json`));
  return Buffer.byteLength(text);
}

// ── 品質報告 ────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 相鄰圖幅重疊區的建物吻合度：逐幅求面後，比對彼此形心的最近距離。 */
function sheetMatchMedian(sheets: SheetGeometry[], buildingsPerSheet: { name: string; count: number }[]): number {
  // 以整體產出為準的近似：成面數為 0 的圖幅無從比對，於報告另行列出
  void buildingsPerSheet;
  const cell = 5;
  const index = new Map<string, { sheet: string; centre: Local }[]>();
  const distances: number[] = [];
  for (const sheet of sheets) {
    const points: Local[] = [];
    for (const path of sheet.paths) {
      if (path.category !== "building") continue;
      for (let i = 1; i < path.points.length; i++) {
        points.push([
          (path.points[i][0] + path.points[i - 1][0]) / 2,
          (path.points[i][1] + path.points[i - 1][1]) / 2,
        ]);
      }
    }
    for (const centre of points) {
      const gx = Math.floor(centre[0] / cell);
      const gy = Math.floor(centre[1] / cell);
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of index.get(`${gx + dx},${gy + dy}`) ?? []) {
            if (other.sheet === sheet.index.name) continue;
            best = Math.min(best, Math.hypot(centre[0] - other.centre[0], centre[1] - other.centre[1]));
          }
        }
      }
      if (best < 5) distances.push(best);
      const key = `${gx},${gy}`;
      const list = index.get(key);
      if (list) list.push({ sheet: sheet.index.name, centre });
      else index.set(key, [{ sheet: sheet.index.name, centre }]);
    }
  }
  return median(distances);
}

// ── 主流程 ──────────────────────────────────────────────

const index = await fetchIndex();
console.log(`圖幅索引：${index.length} 幅`);

const sheets: SheetGeometry[] = [];
for (const entry of index) {
  sheets.push(loadSheet(entry, await cachedPdf(entry.name)));
}

const structures = buildStructures(sheets);
const basemap = buildBasemap(sheets);

const failures: string[] = [];
for (const sheet of sheets) {
  if (sheet.meta.gridResidual > LIMITS.gridResidual) {
    failures.push(`${sheet.meta.name} 格網殘差 ${sheet.meta.gridResidual.toFixed(3)} 公尺`);
  }
  if (sheet.snapCorrection > LIMITS.snapCorrection) {
    failures.push(`${sheet.meta.name} 格網校正量 ${sheet.snapCorrection.toFixed(2)} 公尺`);
  }
}

const match = sheetMatchMedian(sheets, basemap.buildingsPerSheet);
if (!(match <= LIMITS.sheetMatch)) {
  failures.push(`相鄰圖幅建物吻合中位數 ${match.toFixed(2)} 公尺`);
}

const offset = median(structures.restrictionOffsets);
if (!(offset >= LIMITS.restriction.min && offset <= LIMITS.restriction.max)) {
  failures.push(`限建線到結構外緣的距離中位數 ${offset.toFixed(2)} 公尺`);
}

const generatedAt = new Date().toISOString();
const originLatLon = { lat: ORIGIN.lat, lon: ORIGIN.lon };

const structuresData: DortsStructures = {
  generatedAt,
  originLatLon,
  sheets: sheets.map((s) => ({
    ...s.meta,
    ring: roundLine(s.meta.ring),
    rotationDeg: round(s.meta.rotationDeg),
    scale: Math.round(s.meta.scale * 1e6) / 1e6,
    gridResidual: Math.round(s.meta.gridResidual * 1000) / 1000,
  })),
  tunnels: toTunnels(structures.tunnels),
  tracks: toLines(structures.tracks, "track"),
  restrictionLines: toLines(structures.restrictionLines, "limit"),
};

const basemapData: DortsBasemap = {
  generatedAt,
  originLatLon,
  buildings: sortByCorner(basemap.buildings, (p) => p).map((polygon, i) => ({
    id: `dorts/building/${i + 1}`,
    polygon: roundLine(polygon),
  })),
  roadEdges: sortByCorner(basemap.roadEdges, (p) => p).map((line, i) => ({
    id: `dorts/road/${i + 1}`,
    line: roundLine(line),
  })),
};

console.log("── 品質報告 ──");
const residuals = sheets.map((s) => s.meta.gridResidual);
const snaps = sheets.map((s) => s.snapCorrection);
console.log(`各幅格網殘差：最大 ${Math.max(...residuals).toFixed(3)} 公尺（門檻 ${LIMITS.gridResidual}）`);
console.log(`各幅格網校正量：最大 ${Math.max(...snaps).toFixed(2)} 公尺（門檻 ${LIMITS.snapCorrection}）`);
console.log(`相鄰圖幅建物吻合中位數：${match.toFixed(2)} 公尺（門檻 ${LIMITS.sheetMatch}）`);
console.log(
  `限建線到結構外緣距離中位數：${offset.toFixed(2)} 公尺` +
    `（門檻 ${LIMITS.restriction.min}–${LIMITS.restriction.max}，取樣 ${structures.restrictionOffsets.length} 點）`,
);
const bores = structuresData.tunnels.filter((t) => t.kind === "bore").length;
console.log(
  `產出：隧道 ${structuresData.tunnels.length} 段（潛盾 ${bores}、箱形 ${structuresData.tunnels.length - bores}）、` +
    `軌道中心線 ${structuresData.tracks.length} 條、限建線 ${structuresData.restrictionLines.length} 條、` +
    `建物 ${basemapData.buildings.length} 棟、道路邊線 ${basemapData.roadEdges.length} 條`,
);
const thin = basemap.buildingsPerSheet.filter((s) => s.count === 0);
if (thin.length > 0) console.log(`未解析出任何建物面的圖幅：${thin.map((s) => s.name).join("、")}`);

if (failures.length > 0) {
  console.error("品質檢查未通過，未寫出產出檔：");
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

const structuresBytes = await writeJson("structures", structuresData);
const basemapBytes = await writeJson("basemap", basemapData);
console.log(
  `已寫出 src/data/dorts/structures.json（${(structuresBytes / 1048576).toFixed(2)} MB）` +
    `與 src/data/dorts/basemap.json（${(basemapBytes / 1048576).toFixed(2)} MB）`,
);
