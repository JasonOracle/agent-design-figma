#!/usr/bin/env node
/**
 * anchor-compare —— F3 第 ② 条「锚点产品并置比对」的机械装置（1.3 立项书判据 1）。
 *
 * 修的是什么环：运行 B 的 L4 报告里 Commercial「商业产品相似度（40% 权重）」未评，
 * 理由是「需与锚点产品同场景并置比对」——而链路里**没有装置**做这个比对 ⇒
 * 设计感最核心的项结构性无法评估（`1.3-candidates.md` F3 来历第 3 条）。
 *
 * 锚点源（外部，可选，不 vendored）：
 *   `nexu-io/open-design` 的 `design-systems/<brand>/DESIGN.md`（151+ 品牌设计契约，Apache-2.0）。
 *   「随包」的是**协议与装置**（本工具 + `references/anchor-compare.md`），不是锚点集本身
 *   （许可证 / 会漂 / 体积三条理由，见 `1.3-candidates.md` 资产层行）。
 *
 * 并置协议（五步，全部留痕）：
 *   ① 选锚 —— 人选与产品定位同类的品牌（选锚是判断，不机械化）；
 *   ② 快照 —— 取当时那份 DESIGN.md，本工具算 sha256 记入报告（结论必须能回放到具体快照）；
 *   ③ 提取 —— 从锚点契约解析「声明的 token」（色板 / 字族 / 字号），从画布回读解析「实际用的 token」；
 *   ④ 比对 —— 逐 token 算差（色 = RGB 欧氏距离的**粗糙代理**，非感知色差；字族 / 字号 = 集合差）；
 *   ⑤ 留痕 —— 产出 `anchor-compare-report.json`（Schema：assets/templates/）供读图 R11 与 Commercial 项引用。
 *
 * ⚠️ 本工具的判据是「**装置有没有如实运转**」（出处完整 / 两侧都解析出 token），**不是相似度评分**：
 *   「像不像锚点」的结论仍属读图项 R11（`references/read-image-checklist.md`）+ 人 —— H3 零目测评分。
 *   本工具只负责让那个判断**有可回放的证据**，不再「无装置可评」。
 *
 * 用法：
 *   node tools/anchor-compare.mjs <readback.json> --anchor <DESIGN.md> --source <url> --license Apache-2.0 [--json] [--out file]
 *
 * 判据（全部 FAIL 即 exit 1）：
 *   J1 出处：--source 必须是 http(s) URL（快照哪来的必须可追溯）
 *   J2 出处：--license 必须非空（外部素材不记许可证 = 不可分发地引用）
 *   J3 锚点侧：解析出 ≥3 个色 token 且 ≥1 个字族（解析不出 ≠ 锚点干净，是提取失败，不许出空报告）
 *   J4 画布侧：解析出 ≥1 个色 token 且 ≥1 个字族（画布没颜色 = 结构性无法比对，如实失败）
 *   J5 快照：sha256 始终计算并写入报告（无哈希的报告无法回放）
 *
 * 退出码：0 = 判据全过（不代表「像」，只代表证据成立）；1 = 判据失败；2 = 用法错误。
 * 零依赖。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const hasFlag = (name) => argv.includes(name);

/** 直跑判定：被 import（如变异测试）时只取纯函数，不进 CLI 主流程。 */
const IS_MAIN =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

/* ---------------- 解析锚点 DESIGN.md ---------------- */

const HEX_RE = /`#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})`/g;

/** 规范化 hex → 小写 6 位 */
const normHex = (h) => {
  h = h.toLowerCase();
  if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h;
};

/**
 * 从 DESIGN.md 提取「声明的 token」。
 * 色：反引号内的 #hex（带上同一行的 **名称**，无名称记 null）。
 * 字族：**Primary**: `Fam` / **Monospace**: `Fam` 两个显式标记 + 层级表格第 2 列（字体列）。
 * 字号：层级表格行里的 `<n>px`。
 */
export function parseAnchor(md) {
  const colors = [];
  const seenColor = new Set();
  const lines = md.split("\n");
  for (const line of lines) {
    const nameM = line.match(/\*\*(.+?)\*\*/);
    for (const m of line.matchAll(HEX_RE)) {
      const hex = normHex("#" + m[1]);
      if (!seenColor.has(hex)) {
        seenColor.add(hex);
        colors.push({ name: nameM ? nameM[1].trim() : null, hex });
      }
    }
  }

  const families = new Set();
  for (const m of md.matchAll(/\*\*(?:Primary|Monospace)\*\*:\s*`([^`]+)`/g)) {
    families.add(m[1].trim().split(",")[0].trim());
  }
  // 字阶层级表：| Role | Font | Size | ... —— 形态签名是**第 3 列含 px**（其他表如阴影/断点没有），
  // 满足签名才把第 2 列当字族。实测教训：不设签名会把阴影表的 rgba / 断点表的范围收进字族。
  for (const line of lines) {
    if (!/^\s*\|[^|]+\|[^|]+\|/.test(line)) continue;
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length < 4) continue;
    if (!/\d+px/.test(cols[3])) continue;
    const font = cols[2].replace(/\*/g, "").trim();
    if (!font || font.length >= 40) continue;
    if (/[`#]|rgba|px/i.test(font)) continue;
    if (!/[a-zA-Z]/.test(font)) continue;
    families.add(font);
  }

  const sizes = new Set();
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    for (const m of line.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      const v = Number(m[1]);
      if (v > 0 && v <= 200) sizes.add(v);
    }
  }

  return {
    colors,
    families: [...families].filter(Boolean),
    sizes: [...sizes].sort((a, b) => a - b),
  };
}

/* ---------------- 解析画布回读 ---------------- */

/** 在回读 JSON 里找到节点树根（含 type + (width|children) 的第一个对象）。 */
export function findTree(d) {
  const isNode = (o) =>
    o && typeof o === "object" && !Array.isArray(o) && o.type && (o.width !== undefined || o.children);
  const walk = (o) => {
    if (isNode(o)) return o;
    if (Array.isArray(o)) {
      for (const v of o) {
        const r = walk(v);
        if (r) return r;
      }
      return null;
    }
    if (o && typeof o === "object") {
      for (const v of Object.values(o)) {
        const r = walk(v);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(d);
}

/** 收集画布实际用的 token：色（fills+strokes 的 hex，带出现次数）/ 字族 / 字号。 */
export function parseCanvas(tree) {
  const colors = new Map();
  const families = new Map();
  const sizes = new Map();
  let nodes = 0;
  let colorNodes = 0;
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const walk = (n) => {
    nodes++;
    let hasColor = false;
    for (const f of n.fills || []) {
      if (typeof f === "string" && /^#/.test(f)) {
        bump(colors, normHex(f));
        hasColor = true;
      }
    }
    for (const s of n.strokes || []) {
      if (typeof s === "string" && /^#/.test(s)) {
        bump(colors, normHex(s));
        hasColor = true;
      }
    }
    if (hasColor) colorNodes++;
    const fam = n.fontName && n.fontName.family;
    if (fam) bump(families, fam);
    if (typeof n.fontSize === "number") bump(sizes, n.fontSize);
    for (const c of n.children || []) walk(c);
  };
  walk(tree);
  const toArr = (m) => [...m.entries()].map(([v, count]) => ({ value: v, count }));
  return {
    nodeTotal: nodes,
    colorNodes,
    colors: toArr(colors).sort((a, b) => b.count - a.count),
    families: toArr(families).sort((a, b) => b.count - a.count),
    sizes: toArr(sizes).sort((a, b) => a.value - b.value),
  };
}

/* ---------------- 比对 ---------------- */

/** RGB 欧氏距离（粗糙代理，非感知色差 —— 报告里如实标注）。 */
export const rgbDist = (a, b) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  return Math.round(Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) * 10) / 10;
};

/** 每个画布色找锚点色板里最近的（含 exact 命中标记）。 */
export function colorDelta(canvasColors, anchorColors) {
  return canvasColors.map((c) => {
    let best = null;
    for (const a of anchorColors) {
      const d = rgbDist(c.value, a.hex);
      if (!best || d < best.distance) best = { name: a.name, hex: a.hex, distance: d };
    }
    return {
      hex: c.value,
      count: c.count,
      exact: best.distance === 0,
      nearest: best,
    };
  });
}

/* ---------------- 主流程（仅直跑；import 只取上面的纯函数） ---------------- */

if (!IS_MAIN) {
  // 被当作模块加载：什么都不做，让变异测试拿到导出的纯函数。
} else {
  main();
}

function main() {
  const readbackPath = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
const anchorPath = arg("--anchor", null);
const source = arg("--source", null);
const license = arg("--license", null);
const outPath = arg("--out", null);
const asJson = hasFlag("--json");

const fail = (msg) => {
  if (asJson) console.log(JSON.stringify({ ok: false, errors: [msg] }, null, 2));
  else console.error(`✗ ${msg}`);
  process.exit(msg.startsWith("用法") ? 2 : 1);
};

if (!readbackPath || !anchorPath) {
  fail(
    "用法：node tools/anchor-compare.mjs <readback.json> --anchor <DESIGN.md> --source <url> --license <id> [--json] [--out file]",
  );
}
if (!fs.existsSync(readbackPath)) fail(`用法错误：回读文件不存在 ${readbackPath}`);
if (!fs.existsSync(anchorPath)) fail(`用法错误：锚点快照不存在 ${anchorPath}`);

// J1/J2 —— 出处判据（在任何解析之前：出处不完整，比对结果不许产出）
if (!source || !/^https?:\/\//.test(source.trim()))
  fail("J1 出处不全：--source 必须是 http(s) URL —— 没有来源的快照无法回放，比对结论不得产出");
if (!license || !license.trim())
  fail("J2 出处不全：--license 必须非空 —— 引用外部素材不记许可证等于不可分发地引用");

const anchorMd = fs.readFileSync(anchorPath, "utf8");
const anchor = parseAnchor(anchorMd);
const snapshotSha256 = crypto.createHash("sha256").update(anchorMd).digest("hex");

// J3 —— 锚点侧解析判据
if (anchor.colors.length < 3 || anchor.families.length < 1)
  fail(
    `J3 锚点解析不足：从快照只提出 ${anchor.colors.length} 个色 token / ${anchor.families.length} 个字族 —— ` +
      "这通常不是「锚点很素」，是提取失败或拿错文件；空锚点比对 = 假证据，拒绝产出",
  );

let readback;
try {
  readback = JSON.parse(fs.readFileSync(readbackPath, "utf8"));
} catch (e) {
  fail(`用法错误：回读文件不是合法 JSON（${e.message}）`);
}
const tree = findTree(readback);
if (!tree) fail("用法错误：回读 JSON 里找不到节点树（缺 type+width/children 的根）");
const canvas = parseCanvas(tree);

// J4 —— 画布侧解析判据
if (canvas.colors.length < 1 || canvas.families.length < 1)
  fail(
    `J4 画布无 token 可比（色 ${canvas.colors.length} / 字族 ${canvas.families.length}）—— ` +
      "结构性无法比对，如实失败；不许产出一个空报告被人读成「比对过没问题」",
  );

const cd = colorDelta(canvas.colors, anchor.colors);
const exact = cd.filter((c) => c.exact);
const offPalette = cd.filter((c) => !c.exact);

const canvasFamSet = new Set(canvas.families.map((f) => f.value));
const anchorFamSet = new Set(anchor.families);
const famMatch = canvas.families.filter((f) => anchorFamSet.has(f.value));
const famMiss = canvas.families.filter((f) => !anchorFamSet.has(f.value));

const anchorSizeSet = new Set(anchor.sizes);
const sizeMatch = canvas.sizes.filter((s) => anchorSizeSet.has(s.value));
const sizeMiss = canvas.sizes.filter((s) => !anchorSizeSet.has(s.value));

const report = {
  _meta: {
    tool: "tools/anchor-compare.mjs",
    note:
      "本报告是**可回放的机械证据**，不是相似度评分。色距 = RGB 欧氏距离（粗糙代理，非感知色差）。" +
      "「像不像锚点」的结论属读图项 R11（references/read-image-checklist.md）+ 人。",
  },
  provenance: {
    source: source.trim(),
    license: license.trim(),
    snapshotSha256,
    snapshotBytes: Buffer.byteLength(anchorMd),
    fetchedAt: arg("--fetched-at", new Date().toISOString().slice(0, 10)),
    anchorFile: path.basename(anchorPath),
  },
  anchor: {
    colorCount: anchor.colors.length,
    colors: anchor.colors,
    families: anchor.families,
    sizes: anchor.sizes,
  },
  canvas: {
    nodeTotal: canvas.nodeTotal,
    colorNodes: canvas.colorNodes,
    colorCount: canvas.colors.length,
    colors: cd, // 含逐色最近锚点色与距离
    families: canvas.families,
    sizes: canvas.sizes,
  },
  colorDelta: {
    exactCount: exact.length,
    exactHexes: exact.map((c) => c.hex),
    offPaletteCount: offPalette.length,
    maxDistance: offPalette.length ? Math.max(...offPalette.map((c) => c.nearest.distance)) : 0,
    meanDistance: cd.length
      ? Math.round((cd.reduce((s, c) => s + c.nearest.distance, 0) / cd.length) * 10) / 10
      : 0,
  },
  familyDelta: {
    matched: famMatch.map((f) => f.value),
    unmatched: famMiss.map((f) => ({ family: f.value, count: f.count })),
    anchorOnly: anchor.families.filter((f) => !canvasFamSet.has(f)),
  },
  sizeDelta: {
    matched: sizeMatch.map((s) => s.value),
    unmatched: sizeMiss.map((s) => s.value),
  },
};

// J5 —— 快照哈希必须落进报告（能回放 = 有哈希 + 有来源 + 有日期）
if (!report.provenance.snapshotSha256) fail("J5 快照哈希缺失 —— 无法回放到具体快照");

if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const p = report.provenance;
  console.log(`锚点并置比对（机械证据，非相似度评分）`);
  console.log(`  锚点  ${p.anchorFile}  ${p.source}`);
  console.log(`  快照  sha256=${p.snapshotSha256.slice(0, 16)}…  ${p.snapshotBytes}B  取于 ${p.fetchedAt}  许可 ${p.license}`);
  console.log(
    `  色    画布 ${canvas.colors.length} 色：${exact.length} 色精确命中锚点色板，` +
      `${offPalette.length} 色在板外（最近距 ${report.colorDelta.maxDistance}，均距 ${report.colorDelta.meanDistance}）`,
  );
  for (const c of offPalette.slice(0, 8))
    console.log(
      `        板外  ${c.hex} ×${c.count}  →  最近 ${c.nearest.hex}${c.nearest.name ? `（${c.nearest.name}）` : ""} 距 ${c.nearest.distance}`,
    );
  console.log(
    `  字族  画布 [${canvas.families.map((f) => f.value).join(", ")}]  锚点 [${anchor.families.join(", ")}]` +
      `  命中 ${famMatch.length}/${canvas.families.length}`,
  );
  console.log(
    `  字号  画布 ${canvas.sizes.length} 档，命中锚点字阶 ${sizeMatch.length} 档` +
      (sizeMiss.length ? `；板外 [${sizeMiss.map((s) => s.value).join(", ")}]` : ""),
  );
  console.log(`  ✅ 判据全过（出处完整 · 两侧解析成立 · 快照可回放）—— 相似度结论交读图 R11 + 人`);
}
process.exit(0);
}
