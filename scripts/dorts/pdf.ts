/**
 * 捷運禁限建範圍公告圖的向量解析。
 *
 * 來源為 AutoCAD 經 `pdfplot10.hdi` 輸出的向量 PDF：A3、`/Rotate 270`、無加密、
 * 無物件流，xref 為傳統表格並有一次增修。圖層名只存在於增修前的舊版頁物件
 * （`/Resources /Properties` 含 `/ocNN`），現行頁物件的標記已退化為 `/OC BMC`，
 * 因此本模組一律解析舊版頁物件與其內容流。
 *
 * 不依賴任何第三方套件，`node:zlib` 的 `inflateSync` 即足夠。
 */
import { inflateSync } from "node:zlib";

/** 單一路徑；座標為 PDF 使用者空間（點），尚未定位到地理座標。 */
export interface SheetPath {
  points: [number, number][];
  /** 所屬圖層名；不在任何標記內容中時為 null。 */
  layer: string | null;
  /** 繪製時的顏色（描邊路徑取描邊色，填色路徑取填色）。 */
  color: [number, number, number];
  /** 是否以 `h` 或 `re` 明確封閉。 */
  closed: boolean;
  /** 繪製運算子，例如 `S`、`f`、`B`、`n`。 */
  paint: string;
  /** 是否含貝茲曲線（已折線化）。 */
  curved: boolean;
}

export interface SheetPaths {
  paths: SheetPath[];
  /** 圖框裁切矩形的四角（內容流的第一條路徑）。 */
  frame: [number, number][];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const WHITESPACE = new Set([" ", "\n", "\r", "\t", "\f", "\0"]);
const DELIMITER = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

// ── PDF 檔案結構 ────────────────────────────────────────

/** 掃描全檔的 `N 0 obj`，同一編號可能有舊版與增修版兩筆，依出現順序保留。 */
function indexObjects(src: string): Map<number, number[]> {
  const offsets = new Map<number, number[]>();
  const re = /(?:^|[\r\n\s>])(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const id = Number(m[1]);
    const at = m.index + m[0].indexOf(m[1]);
    const list = offsets.get(id);
    if (list) list.push(at);
    else offsets.set(id, [at]);
  }
  return offsets;
}

/** 物件自 `N 0 obj` 至 `endobj` 的原文。 */
function objectAt(src: string, offset: number): string {
  const end = src.indexOf("endobj", offset);
  return src.slice(offset, end === -1 ? src.length : end);
}

/**
 * 沿 `/Prev` 回溯檢查 xref 鏈，確認為傳統表格且未加密。
 * 僅作結構檢查：物件位置改以全檔掃描取得，才能同時讀到舊版與增修版。
 */
function assertClassicXref(src: string): void {
  if (/\/Encrypt\b/.test(src)) throw new Error("不支援的 PDF 結構：檔案已加密");
  if (/\/ObjStm\b/.test(src)) throw new Error("不支援的 PDF 結構：含物件流（/ObjStm）");

  const last = src.lastIndexOf("startxref");
  if (last === -1) throw new Error("不支援的 PDF 結構：找不到 startxref");
  let offset = Number(/startxref\s+(\d+)/.exec(src.slice(last))?.[1]);
  const seen = new Set<number>();
  while (Number.isFinite(offset) && !seen.has(offset)) {
    seen.add(offset);
    const head = src.slice(offset, offset + 32).trimStart();
    if (!head.startsWith("xref")) throw new Error("不支援的 PDF 結構：xref 非傳統表格");
    const trailer = src.indexOf("trailer", offset);
    if (trailer === -1) break;
    const prev = /\/Prev\s+(\d+)/.exec(src.slice(trailer, trailer + 400));
    if (!prev) break;
    offset = Number(prev[1]);
  }
  if (seen.size === 0) throw new Error("不支援的 PDF 結構：xref 鏈無法解析");
}

/** 解出物件內的資料流；非 Flate 編碼者回傳 null。 */
function streamOf(src: string, buffer: Buffer, offset: number): Buffer | null {
  const header = objectAt(src, offset);
  const at = header.indexOf("stream");
  if (at === -1) return null;
  if (!/\/FlateDecode\b/.test(header.slice(0, at))) return null;

  let start = offset + at + "stream".length;
  if (src[start] === "\r") start++;
  if (src[start] === "\n") start++;
  const length = Number(/\/Length\s+(\d+)/.exec(header.slice(0, at))?.[1]);
  const end = Number.isFinite(length) ? start + length : src.indexOf("endstream", start);
  try {
    return inflateSync(buffer.subarray(start, end));
  } catch {
    return null;
  }
}

/** PDF 字串形式的圖層名：字面字串直接取用，`<...>` 以 UTF-16BE 解碼。 */
function decodeName(raw: string): string {
  if (raw.startsWith("<")) {
    const hex = raw.slice(1, -1).replace(/[^0-9A-Fa-f]/g, "");
    const bytes = Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, "hex");
    bytes.swap16(); // UTF-16BE → UTF-16LE
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return raw
    .slice(1, -1)
    .replace(/\\([nrtbf()\\])/g, (_, c: string) =>
      c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c === "b" ? "\b" : c === "f" ? "\f" : c,
    );
}

// ── 內容流 ──────────────────────────────────────────────

type Operand = { kind: "number"; value: number } | { kind: "name"; value: string } | { kind: "other" };

/** 自 `at` 起略過空白與註解。 */
function skipBlank(src: string, at: number): number {
  let i = at;
  for (;;) {
    while (i < src.length && WHITESPACE.has(src[i])) i++;
    if (src[i] !== "%") return i;
    while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
  }
}

/** 跳過字面字串，處理巢狀括號與跳脫字元。 */
function skipLiteral(src: string, at: number): number {
  let depth = 0;
  let i = at;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return i;
}

interface Subpath {
  points: [number, number][];
  closed: boolean;
  curved: boolean;
}

/**
 * 解析內容流為一串路徑。
 * 維護 CTM 堆疊、顏色與標記內容堆疊；貝茲曲線以 t = 0.25/0.5/0.75/1.0 取四點近似。
 */
function parseContent(src: string, layers: Map<string, string>): SheetPath[] {
  const paths: SheetPath[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: { ctm: Matrix; fill: [number, number, number]; stroke: [number, number, number] }[] = [];
  let fill: [number, number, number] = [0, 0, 0];
  let stroke: [number, number, number] = [0, 0, 0];
  const marks: (string | null)[] = [];

  let subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  let start: [number, number] | null = null;
  let cursor: [number, number] = [0, 0];

  const operands: Operand[] = [];
  const num = (back: number): number => {
    const op = operands[operands.length - back];
    return op !== undefined && op.kind === "number" ? op.value : 0;
  };

  const begin = (x: number, y: number) => {
    current = { points: [apply(ctm, x, y)], closed: false, curved: false };
    subpaths.push(current);
    start = [x, y];
    cursor = [x, y];
  };
  const lineTo = (x: number, y: number) => {
    if (!current) begin(x, y);
    else {
      current.points.push(apply(ctm, x, y));
      cursor = [x, y];
    }
  };
  const curveTo = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) => {
    if (!current) begin(cursor[0], cursor[1]);
    const [x0, y0] = cursor;
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const u = 1 - t;
      const bx = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const by = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      current!.points.push(apply(ctm, bx, by));
    }
    current!.curved = true;
    cursor = [x3, y3];
  };
  /** `h`：接回子路徑起點並封閉。 */
  const closeSubpath = () => {
    if (current === null || start === null) return;
    current.points.push(apply(ctm, start[0], start[1]));
    current.closed = true;
    cursor = start;
    current = null;
  };
  /** `re`：矩形自成一條封閉子路徑。 */
  const rect = (x: number, y: number, w: number, h: number) => {
    begin(x, y);
    lineTo(x + w, y);
    lineTo(x + w, y + h);
    lineTo(x, y + h);
    if (current !== null) current.closed = true;
    current = null;
  };

  const layerName = (): string | null => {
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i] !== null) return marks[i];
    return null;
  };

  const paint = (op: string) => {
    const layer = layerName();
    const color = op === "S" || op === "s" ? stroke : fill;
    for (const sub of subpaths) {
      if (sub.points.length < 2) continue;
      paths.push({
        points: sub.points,
        layer,
        color,
        closed: sub.closed,
        paint: op,
        curved: sub.curved,
      });
    }
    subpaths = [];
    current = null;
    start = null;
  };

  let i = 0;
  while (i < src.length) {
    i = skipBlank(src, i);
    if (i >= src.length) break;
    const c = src[i];

    if (c === "/") {
      let j = i + 1;
      while (j < src.length && !WHITESPACE.has(src[j]) && !DELIMITER.has(src[j])) j++;
      operands.push({ kind: "name", value: src.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (c === "(") {
      i = skipLiteral(src, i);
      operands.push({ kind: "other" });
      continue;
    }
    if (c === "<") {
      if (src[i + 1] === "<") {
        let depth = 0;
        let j = i;
        while (j < src.length) {
          if (src[j] === "<" && src[j + 1] === "<") {
            depth++;
            j += 2;
          } else if (src[j] === ">" && src[j + 1] === ">") {
            depth--;
            j += 2;
            if (depth === 0) break;
          } else if (src[j] === "(") j = skipLiteral(src, j);
          else j++;
        }
        i = j;
      } else {
        const close = src.indexOf(">", i);
        i = close === -1 ? src.length : close + 1;
      }
      operands.push({ kind: "other" });
      continue;
    }
    if (c === "[" || c === "]" || c === "{" || c === "}") {
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === "+" || c === "-" || c === ".") {
      let j = i + 1;
      while (j < src.length && /[0-9.\-+eE]/.test(src[j])) j++;
      operands.push({ kind: "number", value: Number.parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }

    let j = i;
    while (j < src.length && !WHITESPACE.has(src[j]) && !DELIMITER.has(src[j])) j++;
    const op = src.slice(i, j);
    i = j;

    switch (op) {
      case "q":
        stack.push({ ctm, fill, stroke });
        break;
      case "Q": {
        const saved = stack.pop();
        if (saved) {
          ctm = saved.ctm;
          fill = saved.fill;
          stroke = saved.stroke;
        }
        break;
      }
      case "cm":
        ctm = multiply(
          [num(6), num(5), num(4), num(3), num(2), num(1)] as Matrix,
          ctm,
        );
        break;
      case "rg":
        fill = [num(3), num(2), num(1)];
        break;
      case "RG":
        stroke = [num(3), num(2), num(1)];
        break;
      case "g":
        fill = [num(1), num(1), num(1)];
        break;
      case "G":
        stroke = [num(1), num(1), num(1)];
        break;
      case "BDC": {
        const last = operands[operands.length - 1];
        marks.push(last !== undefined && last.kind === "name" ? (layers.get(last.value) ?? null) : null);
        break;
      }
      case "BMC":
        marks.push(null);
        break;
      case "EMC":
        marks.pop();
        break;
      case "m":
        begin(num(2), num(1));
        break;
      case "l":
        lineTo(num(2), num(1));
        break;
      case "c":
        curveTo(num(6), num(5), num(4), num(3), num(2), num(1));
        break;
      case "v":
        curveTo(cursor[0], cursor[1], num(4), num(3), num(2), num(1));
        break;
      case "y":
        curveTo(num(4), num(3), num(2), num(1), num(2), num(1));
        break;
      case "re":
        rect(num(4), num(3), num(2), num(1));
        break;
      case "h":
        closeSubpath();
        break;
      case "S":
      case "s":
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*":
      case "n":
        paint(op);
        break;
      case "BI": {
        const end = src.indexOf("EI", i);
        i = end === -1 ? src.length : end + 2;
        break;
      }
      default:
        break;
    }
    if (op !== "") operands.length = 0;
  }

  return paths;
}

// ── 匯出 ────────────────────────────────────────────────

/** 解析一幅公告圖，回傳全部向量路徑與圖框裁切矩形。 */
export function readSheet(buffer: Buffer): SheetPaths {
  const src = buffer.toString("latin1");
  assertClassicXref(src);
  const objects = indexObjects(src);

  // 舊版頁物件：唯一帶有 /Properties /ocNN 的 /Type /Page
  let pageText: string | null = null;
  for (const offsets of objects.values()) {
    for (const offset of offsets) {
      const text = objectAt(src, offset);
      if (!/\/Type\s*\/Page[^s]/.test(text)) continue;
      if (!/\/Properties/.test(text) || !/\/oc\d+/.test(text)) continue;
      pageText = text;
    }
  }
  if (pageText === null) throw new Error("公告圖缺少帶有圖層資訊的頁物件");

  // /ocNN → 圖層名
  const layers = new Map<string, string>();
  const properties = pageText.slice(pageText.indexOf("/Properties"));
  for (const m of properties.matchAll(/\/(oc\d+)\s+(\d+)\s+0\s+R/g)) {
    const offsets = objects.get(Number(m[2])) ?? [];
    for (const offset of offsets) {
      const text = objectAt(src, offset);
      if (!/\/Type\s*\/OCG/.test(text)) continue;
      const name = /\/Name\s*(\([\s\S]*?\)|<[0-9A-Fa-f\s]*>)/.exec(text);
      if (name) layers.set(m[1], decodeName(name[1].trim()));
    }
  }
  if (layers.size === 0) throw new Error("公告圖的圖層名解析失敗");

  // 內容流：同編號可能出現多次，取解壓後最長者
  const contents = /\/Contents\s*\[?\s*(\d+)\s+0\s+R/.exec(pageText);
  if (!contents) throw new Error("公告圖的頁物件缺少 /Contents");
  let stream: Buffer | null = null;
  for (const offset of objects.get(Number(contents[1])) ?? []) {
    const data = streamOf(src, buffer, offset);
    if (data && (stream === null || data.length > stream.length)) stream = data;
  }
  if (stream === null) throw new Error("公告圖的內容流解壓失敗");

  const paths = parseContent(stream.toString("latin1"), layers);
  const frame = paths.find((p) => p.points.length >= 4);
  if (!frame) throw new Error("公告圖缺少圖框裁切矩形");
  return { paths, frame: frame.points.slice(0, 4) };
}
