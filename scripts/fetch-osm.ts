/**
 * 從 Overpass API 擷取臺北車站周邊圖資，轉為局部公尺座標後寫入 src/data/osm/。
 * 以 `npm run fetch:osm` 執行（Node 原生型別剝離，無需建置步驟）。
 *
 * 網站執行時不連外；本腳本的產出直接進版控。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ORIGIN, toLocal } from "../src/geo/project.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "kitameet/0.1 (https://github.com/; urban planning study)";

/** 保留的 OSM 標籤；其餘捨棄以控制檔案大小與差異雜訊。 */
const KEPT_TAGS = [
  "railway",
  "gauge",
  "usage",
  "electrified",
  "service",
  "public_transport",
  "building",
  "building:levels",
  "building:part",
  "height",
  "min_height",
  "roof:levels",
  "level",
  "layer",
  "tunnel",
  "bridge",
  "location",
  "highway",
  "shop",
  "amenity",
  "parking",
  "man_made",
  "operator",
  "ref",
  "name",
  "name:en",
  "area",
];

type OverpassNode = { lat: number; lon: number };
type OverpassWay = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassNode[];
};

export type OsmKind =
  | "platform"
  | "track-hsr"
  | "track-tra"
  | "track-metro"
  | "underground-mall"
  | "station"
  | "building"
  | "elevated-road"
  | "road"
  | "other";

export interface OsmFeature {
  id: string;
  source: "osm";
  kind: OsmKind;
  name?: string;
  level?: number;
  tags: Record<string, string>;
  polygon?: [number, number][];
  polyline?: [number, number][];
}

export interface OsmDataset {
  generatedAt: string;
  queryBbox: { south: number; west: number; north: number; east: number };
  overpassTimestamp: string | null;
  originLatLon: { lat: number; lon: number };
  features: OsmFeature[];
}

/** 市民大道與忠孝橋引道等高架路段的名稱特徵。 */
const ELEVATED_NAMES = ["市民大道", "忠孝橋", "引道", "高架"];

function parseLevel(tags: Record<string, string>): number | undefined {
  const raw = tags.level ?? tags.layer;
  if (raw === undefined) return undefined;
  const first = raw.split(/[;:-]/).filter((s) => s !== "")[0];
  const sign = raw.trim().startsWith("-") ? -1 : 1;
  const n = Number(first);
  return Number.isFinite(n) ? sign * Math.abs(n) : undefined;
}

export function classify(tags: Record<string, string>, level: number | undefined): OsmKind {
  const name = tags.name ?? "";
  if (tags.railway === "platform") return "platform";
  if (tags.railway === "rail") {
    if (tags.gauge === "1435") return "track-hsr";
    if (tags.gauge === "1067") return "track-tra";
    return name.includes("高速鐵路") ? "track-hsr" : "track-tra";
  }
  if (tags.railway === "subway") return "track-metro";
  if (name.includes("地下街")) return "underground-mall";
  if ((tags.building !== undefined || tags.shop === "mall") && level !== undefined && level < 0) {
    return "underground-mall";
  }
  if (
    tags.building === "train_station" ||
    tags.public_transport === "station" ||
    tags.railway === "station"
  ) {
    return "station";
  }
  if (tags.building !== undefined) return "building";
  if (tags.highway !== undefined) {
    if (tags.bridge === "yes" && ELEVATED_NAMES.some((n) => name.includes(n))) {
      return "elevated-road";
    }
    return "road";
  }
  if (tags.amenity === "parking") return "underground-mall";
  return "other";
}

function readBbox(query: string) {
  const m = query.match(/\[bbox:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]/);
  if (!m) throw new Error("查詢檔缺少 [bbox:...] 設定");
  return { south: +m[1], west: +m[2], north: +m[3], east: +m[4] };
}

/** 伺服器忙碌（429、502、503）或閘道逾時（504）時以指數退避重試，最後才換下一個端點。 */
async function queryOverpass(query: string): Promise<unknown> {
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const delay = 15_000 * 2 ** (attempt - 1);
        console.error(`等待 ${delay / 1000} 秒後重試 ${endpoint}`);
        await sleep(delay);
      }
      let text: string;
      let status: number;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(280_000),
        });
        status = res.status;
        text = await res.text();
      } catch (err) {
        lastError = `${endpoint} 連線失敗：${String(err)}`;
        console.error(lastError);
        continue;
      }
      if (status === 429 || status === 502 || status === 503 || status === 504) {
        lastError = `${endpoint} HTTP ${status}：${text.slice(0, 200)}`;
        console.error(lastError);
        continue;
      }
      if (status !== 200) {
        lastError = `${endpoint} HTTP ${status}：${text.slice(0, 200)}`;
        console.error(lastError);
        break;
      }
      try {
        const json = JSON.parse(text) as { elements?: unknown };
        if (!Array.isArray(json.elements)) {
          lastError = `${endpoint} 回應缺少 elements：${text.slice(0, 200)}`;
          console.error(lastError);
          break;
        }
        return json;
      } catch {
        lastError = `${endpoint} 回應非 JSON：${text.slice(0, 200)}`;
        console.error(lastError);
      }
    }
  }
  throw new Error(`Overpass 查詢失敗：${lastError}`);
}

const round = (n: number) => Math.round(n * 100) / 100;

function convert(
  json: { elements: OverpassWay[]; osm3s?: { timestamp_osm_base?: string } },
  bbox: OsmDataset["queryBbox"],
): OsmDataset {
  const features: OsmFeature[] = [];
  for (const el of json.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const kept: Record<string, string> = {};
    for (const key of KEPT_TAGS) if (tags[key] !== undefined) kept[key] = tags[key];

    const level = parseLevel(tags);
    const kind = classify(tags, level);
    if (kind === "other") continue;

    const pts = el.geometry.map((n) => {
      const [x, y] = toLocal(n.lon, n.lat);
      return [round(x), round(y)] as [number, number];
    });
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed =
      pts.length > 3 && Math.abs(first[0] - last[0]) < 0.02 && Math.abs(first[1] - last[1]) < 0.02;

    const feature: OsmFeature = {
      id: `way/${el.id}`,
      source: "osm",
      kind,
      tags: kept,
    };
    if (tags.name !== undefined) feature.name = tags.name;
    if (level !== undefined) feature.level = level;
    if (closed || tags.area === "yes") feature.polygon = pts.slice(0, closed ? -1 : undefined);
    else feature.polyline = pts;
    features.push(feature);
  }

  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    generatedAt: new Date().toISOString(),
    queryBbox: bbox,
    overpassTimestamp: json.osm3s?.timestamp_osm_base ?? null,
    originLatLon: { lat: ORIGIN.lat, lon: ORIGIN.lon },
    features,
  };
}

async function run(name: string) {
  const query = await readFile(join(ROOT, `data/queries/${name}.overpassql`), "utf8");
  const bbox = readBbox(query);
  const json = (await queryOverpass(query)) as Parameters<typeof convert>[0];

  await mkdir(join(ROOT, "data/cache"), { recursive: true });
  await writeFile(join(ROOT, `data/cache/${name}.json`), JSON.stringify(json), "utf8");

  const dataset = convert(json, bbox);
  const outDir = join(ROOT, "src/data/osm");
  await mkdir(outDir, { recursive: true });
  const tmp = join(outDir, `.${name}.json.tmp`);
  await writeFile(tmp, `${JSON.stringify(dataset, null, 1)}\n`, "utf8");
  await rename(tmp, join(outDir, `${name}.json`));

  const byKind = new Map<string, number>();
  for (const f of dataset.features) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  console.log(
    `${name}: ${dataset.features.length} 項（${[...byKind]
      .map(([k, v]) => `${k} ${v}`)
      .join("、")}），OSM 時間 ${dataset.overpassTimestamp}`,
  );
}

for (const name of ["underground", "surface"]) {
  await run(name);
}
