#!/usr/bin/env node
/**
 * qa-l2.mjs — L2 Design System 产出校验（references/design-system.md §13）
 *
 * 四项检查：
 *   QA1  JSON 可解析        —— Schema + Spec 可解析，顶层必填字段齐备
 *   QA2  Token 无未知颜色   —— 非派生值 ∈ preset 色板；derived: 值按 §5 公式复算并精确匹配
 *   QA3  Component 覆盖数量 —— briefRefs 并集 = Brief 全量；P0 100%；绿地 ≤12 / 存量 = 0；reject 仅 P1/P2
 *   QA4  DS 单源原则        —— create-local 无 DS/ 前缀；四件套状态矩阵完整；estOps ≤30；chart 逐字一致
 *
 * 用法：
 *   node tools/qa-l2.mjs                                  # 校验仓库自带 few-shot（回归自检）
 *   node tools/qa-l2.mjs --examples <dir>                 # 校验某目录下的 example-* 对
 *   node tools/qa-l2.mjs --spec <产物> --brief <Brief>     # 校验用户自己的 L2 产物
 *   可选：--quiet（只出汇总）
 *
 * 零依赖（仅 node 内置模块）；路径由 import.meta.url 自定位，任意 cwd 可跑。
 * 移植自上游 tools/stage10-4-qa.py（204 行），逻辑等价，路径适配本仓库。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS_DIR = path.join(ROOT, "assets", "style-library");
const EXAMPLES_DIR = path.join(ROOT, "assets", "examples");
const SCHEMA_PATH = path.join(ROOT, "assets", "templates", "design-system-spec.json");

const QUIET = process.argv.includes("--quiet");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);
const orNone = (v) => (Array.isArray(v) && v.length ? (v.length <= 4 ? v.join(", ") : `${v.slice(0, 4).join(", ")} …共 ${v.length} 项`) : "无");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tryRead = (p, label) => {
  try {
    return readJson(p);
  } catch (e) {
    fail.push(`QA1 ${label} 解析失败：${e.message}`);
    return null;
  }
};

const hx = (c) => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

/** 逐通道线性混合后四舍五入（与 design-system.md §5 的 RD 公式一致，half-up） */
function mix(base, other, ratio) {
  const b = hx(base);
  const o = hx(other);
  return (
    "#" +
    b
      .map((bv, i) => Math.floor(bv * ratio + o[i] * (1 - ratio) + 0.5))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/* ---------------- 载入 preset ---------------- */

const presets = {};
for (const f of fs.readdirSync(PRESETS_DIR).filter((n) => n.endsWith(".json")).sort()) {
  const p = readJson(path.join(PRESETS_DIR, f));
  presets[p.id] = p;
}

/* ---------------- 载入待校验的 (Brief, Spec) 对 ---------------- */

/** @type {{name:string, brief:object|null, spec:object|null}[]} */
const pairs = [];
const specArg = arg("--spec");
const briefArg = arg("--brief");
const examplesArg = arg("--examples");

if (specArg || briefArg) {
  if (!specArg || !briefArg) {
    console.error("用法：--spec <产物.json> --brief <配套 Brief.json>（两者必须同时给出，QA3 的覆盖校验需要 Brief）");
    process.exit(2);
  }
  if (!fs.existsSync(specArg) || !fs.existsSync(briefArg)) {
    console.error(`文件不存在：${!fs.existsSync(specArg) ? specArg : briefArg}`);
    process.exit(2);
  }
  const name = path.basename(specArg).replace(/\.json$/, "");
  pairs.push({ name, brief: tryRead(briefArg, path.basename(briefArg)), spec: tryRead(specArg, path.basename(specArg)) });
} else {
  const dir = examplesArg ? path.resolve(examplesArg) : EXAMPLES_DIR;
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在：${dir}`);
    process.exit(2);
  }
  const briefFiles = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("example-") && n.endsWith(".json") && !n.endsWith(".dsspec.json"))
    .sort();
  if (!briefFiles.length) {
    console.error(`目录内没有 example-*.json：${dir}`);
    process.exit(2);
  }
  for (const f of briefFiles) {
    const name = f.replace(/\.json$/, "");
    const sp = path.join(dir, `${name}.dsspec.json`);
    const brief = tryRead(path.join(dir, f), f);
    if (!fs.existsSync(sp)) {
      fail.push(`QA1 ${name}.dsspec.json 不存在（同名 Brief 有、Spec 缺）`);
      pairs.push({ name, brief, spec: null });
      continue;
    }
    pairs.push({ name, brief, spec: tryRead(sp, path.basename(sp)) });
  }
}

/* ---------------- QA1 ---------------- */

let specRequired = [];
try {
  const schema = readJson(SCHEMA_PATH);
  specRequired = schema.required || [];
  check(true, `QA1 Schema 可解析：${path.basename(SCHEMA_PATH)}（required=${specRequired.length} 字段）`);
} catch (e) {
  fail.push(`QA1 Schema 解析失败：${e.message}`);
}

for (const { name, spec } of pairs) {
  if (!spec) continue;
  const missing = specRequired.filter((f) => !(f in spec));
  check(missing.length === 0, `QA1 ${name} 顶层必填字段齐备（缺 ${orNone(missing)}）`);
}

/* ---------------- QA2 ---------------- */

function collectPresetPalette(preset) {
  const vs = preset.visualSystem || {};
  const palette = new Set();
  for (const v of [vs.primaryColor, vs.background, vs.surface, vs.stroke]) {
    if (typeof v === "string" && HEX_RE.test(v)) palette.add(v.toUpperCase());
  }
  for (const list of [vs.textColors, vs.chartColors]) {
    for (const c of Array.isArray(list) ? list : []) {
      if (HEX_RE.test(c)) palette.add(c.toUpperCase());
    }
  }
  palette.add("#FFFFFF"); // RD 规则混合基
  palette.add("#000000");
  return palette;
}

/** 展开 tokens.color 为 { "tokens.color.x.y": tokenObject } */
function tokenPaths(node, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(node)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("value" in v) out[p] = v;
      else tokenPaths(v, p, out);
    }
  }
  return out;
}

for (const { name, spec } of pairs) {
  if (!spec) continue;
  const pid = spec.brand?.stylePresetId;
  if (!presets[pid]) {
    fail.push(`QA2 ${name} 引用了不存在的 preset「${pid}」（合法值：${Object.keys(presets).join(" / ")}）`);
    continue;
  }
  const palette = collectPresetPalette(presets[pid]);
  const toks = tokenPaths(spec.tokens?.color || {}, "tokens.color");
  const bad = [];
  const badDerived = [];

  for (const [tpath, tok] of Object.entries(toks)) {
    const val = String(tok.value).toUpperCase();
    const src = tok.source || "";

    // 派生 token 一律走公式复算——不能因为值恰好命中色板就跳过。
    // 上游脚本先判 palette 命中、再判 derived，于是「把派生值填成任意一个色板色」
    // 能蒙混过关（写成 #000000 / #FFFFFF / primary 本身都不会被发现）。这里把顺序
    // 倒过来：带 derived: 前缀就必须能被公式复算出同一个值。
    if (!src.startsWith("derived:")) {
      if (palette.has(val)) continue;
      bad.push(`${tpath}=${val} (source=${src || "缺失"})`);
      continue;
    }

    const m = src.match(/^derived:(RD-\d[^@]*)@(.+)$/);
    if (!m) {
      badDerived.push(`${tpath} 带 derived: 前缀但格式不符 derived:<rule>@<父token路径>：${src}`);
      continue;
    }
    const [, rule, parent] = m;
    const parentTok = toks[parent];
    if (!parentTok) {
      badDerived.push(`${tpath} 父 token ${parent} 不存在`);
      continue;
    }
    const pv = parentTok.value;
    const bg = spec.tokens.color.background.page.value;
    const sf = spec.tokens.color.surface.card.value;
    const dark = hx(bg).reduce((a, b) => a + b, 0) / 3 < 128;

    let expect;
    if (rule.startsWith("RD-1")) expect = mix(pv, dark ? bg : "#FFFFFF", 0.88);
    else if (rule.startsWith("RD-2")) expect = mix(pv, "#000000", 0.92);
    else if (rule.startsWith("RD-3")) expect = mix(pv, dark ? sf : "#FFFFFF", 0.5);
    else {
      badDerived.push(`${tpath} 未知派生规则 ${rule}`);
      continue;
    }

    if (val === expect) pass.push(`QA2 ${name} ${tpath} 派生复算一致（${rule}: ${val}）`);
    else badDerived.push(`${tpath}=${val} 但 ${rule} 复算应为 ${expect}`);
  }

  check(bad.length === 0, `QA2 ${name} 非派生色全部命中 preset 色板（违例 ${orNone(bad)}）`);
  check(badDerived.length === 0, `QA2 ${name} 派生色公式复算一致（违例 ${orNone(badDerived)}）`);
}

/* ---------------- QA3 ---------------- */

for (const { name, brief, spec } of pairs) {
  if (!spec) continue;
  if (!brief) {
    fail.push(`QA3 ${name} 缺少配套 Brief，无法校验覆盖（用 --brief 指定）`);
    continue;
  }

  const briefNames = (brief.componentExpectation || []).map((c) => c.name);
  const covered = new Set();
  for (const c of spec.components || []) for (const r of c.briefRefs || []) covered.add(r);

  const missing = briefNames.filter((n) => !covered.has(n));
  const extra = [...covered].filter((n) => !briefNames.includes(n));
  check(missing.length === 0 && extra.length === 0, `QA3 ${name} briefRefs 并集 = Brief 全量（缺 ${orNone(missing)}；多 ${orNone(extra)}）`);

  const p0Brief = (brief.componentExpectation || []).filter((c) => c.priority === "P0").map((c) => c.name);
  const p0Missing = p0Brief.filter((n) => !covered.has(n));
  check(p0Missing.length === 0, `QA3 ${name} P0 覆盖率 100%（缺 ${orNone(p0Missing)}）`);

  const gen = (spec.components || []).filter((c) => c.decision === "generate-core");
  const existing = spec.sourceMapping?.existingDsRefs || [];
  if (existing.length > 0) check(gen.length === 0, `QA3 ${name} 存量项目 generate-core = 0（实际 ${gen.length}）`);
  else check(gen.length <= 12, `QA3 ${name} 绿地项目 generate-core ≤ 12（实际 ${gen.length}）`);

  const badRej = (spec.components || []).filter((c) => c.decision === "reject" && c.priority === "P0").map((c) => c.name);
  check(badRej.length === 0, `QA3 ${name} reject 仅限 P1/P2（P0 违例 ${orNone(badRej)}）`);
}

/* ---------------- QA4 ---------------- */

for (const { name, spec } of pairs) {
  if (!spec) continue;
  const comps = spec.components || [];

  const badNaming = comps.filter((c) => c.decision === "create-local" && String(c.figmaNaming || "").startsWith("DS/")).map((c) => c.name);
  check(badNaming.length === 0, `QA4 ${name} create-local 无 DS/ 前缀命名（违例 ${orNone(badNaming)}）`);

  // 状态矩阵：briefRefs 命中优先，组件名兜底（CD-3 补充组件的 briefRefs 可为空）
  const joined = {};
  for (const c of comps) {
    const states = new Set(c.states || []);
    for (const ref of c.briefRefs || []) joined[ref] = states;
    if (!(c.name in joined)) joined[c.name] = states;
  }

  const REQUIRED = [
    ["Button", ["primary", "secondary", "disabled", "loading"]],
    ["Input", ["default", "focus", "error", "disabled"]],
    ["Table", ["header", "row", "empty", "loading"]],
    ["Card", ["default", "hover"]],
  ];
  for (const [comp, required] of REQUIRED) {
    const appears = comps.some((c) => (c.briefRefs || []).includes(comp) || c.name === comp);
    if (!appears) continue;
    const states = joined[comp];
    if (!states) {
      fail.push(`QA4 ${name} 必选组件 ${comp} 未出现在任何 componentPlan 条目`);
    } else {
      const miss = required.filter((s) => !states.has(s));
      check(miss.length === 0, `QA4 ${name} ${comp} 状态矩阵完整（缺 ${orNone(miss)}）`);
    }
  }

  const over = (spec.buildPlan?.batches || []).filter((b) => b.estOps > 30).map((b) => b.estOps);
  check(over.length === 0, `QA4 ${name} buildPlan.estOps 全部 ≤30（超限 ${orNone(over)}）`);

  const pid = spec.brand?.stylePresetId;
  if (presets[pid]) {
    const pc = (presets[pid].visualSystem?.chartColors || []).map((c) => c.toUpperCase());
    const sc = [1, 2, 3, 4, 5].map((i) => String(spec.tokens.color.chart[`series${i}`]?.value).toUpperCase());
    check(JSON.stringify(sc) === JSON.stringify(pc), `QA4 ${name} chart 色板与 preset 逐字一致`);
  }
}

/* ---------------- 汇总 ---------------- */

const bar = "=".repeat(62);
console.log(bar);
if (!QUIET) for (const m of pass) console.log(`  PASS  ${m}`);
console.log(bar);
if (fail.length) {
  for (const m of fail) console.log(`  FAIL  ${m}`);
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— L2 校验未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— L2 QA ALL GREEN`);
