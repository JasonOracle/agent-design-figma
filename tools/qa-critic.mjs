#!/usr/bin/env node
/**
 * qa-critic.mjs — L4 Visual Critic 产出校验（critic-report.json）
 *
 * 八组检查：
 *   QA1  Schema 契约      —— Schema 可解析；顶层 required 齐备；issues.items.required 齐备；
 *                            targetLayer / action / scores 五维 / _evidence.mode 枚举齐备
 *   QA2  顶层字段          —— 每份报告顶层必填字段齐备
 *   QA3  五维评分 + average —— 五维齐全、均为 0-10 数值（bool 不算数值）；
 *                            average 与五维实算一致（half-up 保留一位小数）
 *   QA4  issue 必备证据    —— issues 非空或明确 PASS；evidence / suggestion / location 非空；
 *                            severity 合法；evidence 含可复现实测痕迹（防「感觉不对」）
 *   QA5  路由              —— targetLayer ∈ {L1,L2,L3}
 *   QA6  Critic Loop       —— round ≤3 / maxLoop==3 / history 长度与取值 / action 合法 /
 *                            action ↔ 分数自洽 / 存在 critical issue 时禁止 PASS（critic-mapping §5）
 *   QA7  证据档位契约 ★    —— _evidence.mode 合法；structured-only 下 visionObservations 必须为空
 *                            （无读图能力不可能有读图观察）；structured-only 下 unassessed 必须非空
 *                            （§1.6 分档表里 Commercial「商业产品相似度 40%」在结构化档不可判定，
 *                             声称「零未评估项」即把没看当看过）；_meta.reviewer 须写明档位且与 mode 一致
 *   QA8  跨产物一致 ★      —— report.project == spec.brand.name == brief.product.name；
 *                            report.page ∈ brief.informationArchitecture.pages[].name（Schema 明文要求）；
 *                            _meta.inputs 里形如路径的条目必须存在；
 *                            证据里引用的「可解析量」必须与 DS Spec 一致——token 色值（`text.secondary #5A7CA6`）、
 *                            accessibility 标量（`minFontSize=11`）、档位列表（`8/16/24`）（后三条为软检查：
 *                            自由文本交叉核对只作提示，`--strict` 下才致命）
 *
 * ★ = 1.2 · C3 新增；QA1–QA6 移植自上游 tools/stage10-6-qa.py（144 行），逻辑等价，路径适配本仓库。
 *
 * 硬 / 软两档：只有 check() 的断言进退出码；soft() 只出 WARN（不阻塞）。软规则同样要有变异测试
 * 断言「命中数非零」，否则无法区分「没有问题」与「规则从未生效」（references/lessons.md #33）。
 * 软检查的存在理由：`issue.evidence` 是自由文本，从中抽出的量只能当**交叉核对提示**——但
 * 「证据里引用的 token 色值与 Spec 不符」这类提示，恰恰是 C1 抓到的那一类缺陷（数字是被编的）。
 *
 * 用法：
 *   node tools/qa-critic.mjs                                  # 校验仓库自带的三份样例报告
 *   node tools/qa-critic.mjs --examples <dir>                 # 校验某目录下形如 example-<名>/ 的报告目录
 *   node tools/qa-critic.mjs --report <r.json> [--brief <brief.json>] [--spec <spec.json>]
 *   --quiet（只出汇总）
 *   --strict（WARN 计为失败 —— 仓库自带样例用这一档，用户产物用默认档）
 *
 * 零依赖（仅 node 内置模块）；路径由 import.meta.url 自定位，任意 cwd 可跑。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = path.join(ROOT, "assets", "examples");
const SCHEMA_PATH = path.join(ROOT, "assets", "templates", "critic-report.json");

const QUIET = process.argv.includes("--quiet");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

const SCORE_KEYS = ["layout", "color", "consistency", "commercial", "usability"];
const LAYERS = ["L1", "L2", "L3"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const ACTIONS = ["PASS", "FIX", "STOP_MAX_LOOP"];
const MODES = ["structured-only", "structured+vision"];
const ISSUE_REQUIRED = ["severity", "location", "evidence", "suggestion", "targetLayer"];

const pass = [];
const fail = [];
const warn = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);
const bad = (msg) => fail.push(msg);
const soft = (cond, msg) => {
  if (!cond) warn.push(msg);
};
const orNone = (v) =>
  Array.isArray(v) && v.length ? (v.length <= 4 ? v.join(", ") : `${v.slice(0, 4).join(", ")} …共 ${v.length} 项`) : "无";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tryRead = (p, label, required) => {
  try {
    return readJson(p);
  } catch (e) {
    (required ? bad : soft)(false, `${required ? "QA2" : "QA8"} ${label} 读取失败：${e.message}`);
    return null;
  }
};
const sortedEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/* ---------------- 载入待校验的（report, Brief, DS Spec）三元组 ---------------- */

const reportArg = arg("--report");
const examplesArg = arg("--examples");
/** @type {{name:string, report:object|null, brief:object|null, spec:object|null}[]} */
const targets = [];

if (reportArg) {
  const abs = path.resolve(reportArg);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在：${arg("--report")}`);
    process.exit(2);
  }
  const parent = path.basename(path.dirname(abs));
  const name = parent && parent !== "." ? parent : path.basename(abs).replace(/\.json$/, "");
  const briefArg = arg("--brief");
  const specArg = arg("--spec");
  for (const [p, flag] of [
    [briefArg, "--brief"],
    [specArg, "--spec"],
  ]) {
    if (p && !fs.existsSync(p)) {
      console.error(`文件不存在：${p}（${flag}）`);
      process.exit(2);
    }
  }
  // 用户产物：Brief / DS Spec 是可选上下文，缺了只告警（它们不在产物目录约定下）
  targets.push({
    name,
    report: tryRead(abs, path.basename(abs), true),
    brief: briefArg ? tryRead(briefArg, path.basename(briefArg), false) : null,
    spec: specArg ? tryRead(specArg, path.basename(specArg), false) : null,
  });
} else {
  const dir = examplesArg ? path.resolve(examplesArg) : EXAMPLES_DIR;
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在：${dir}`);
    process.exit(2);
  }
  // 正向形状筛选：`example-<不含点的名字>/` 才是样例报告目录。
  // 别写成「排除 xxx」这种反向排除法——目录里一旦出现新的兄弟类型就会误伤（lessons #36）。
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^example-[^.]+$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (!names.length) {
    console.error(`目录内没有 example-<名字>/ 报告目录：${dir}`);
    process.exit(2);
  }
  for (const n of names) {
    const rp = path.join(dir, n, "critic-report.json");
    if (!fs.existsSync(rp)) {
      bad(`QA2 ${n} 缺少 ${n}/critic-report.json`);
      targets.push({ name: n, report: null, brief: null, spec: null });
      continue;
    }
    // 目录约定下 Brief / Spec 与报告目录同级 —— 缺了算失败（样例自身的完整性问题）
    const bp = path.join(dir, `${n}.json`);
    const sp = path.join(dir, `${n}.dsspec.json`);
    if (!fs.existsSync(bp)) bad(`QA8 ${n} 缺少同级 Brief ${n}.json（project/page 无法校验）`);
    if (!fs.existsSync(sp)) bad(`QA8 ${n} 缺少同级 DS Spec ${n}.dsspec.json（project↔brand.name 无法校验）`);
    targets.push({
      name: n,
      report: tryRead(rp, `${n}/critic-report.json`, true),
      brief: fs.existsSync(bp) ? tryRead(bp, `${n}.json`, false) : null,
      spec: fs.existsSync(sp) ? tryRead(sp, `${n}.dsspec.json`, false) : null,
    });
  }
}

/* ---------------- QA1 Schema 契约 ---------------- */

let schemaReq = ["project", "page", "scores", "average", "issues", "action"];
try {
  const schema = readJson(SCHEMA_PATH);
  const req = schema.required || [];
  schemaReq = req.length ? req : schemaReq;
  const issueReq = schema.properties?.issues?.items?.required || [];
  const layerEnum = schema.properties?.issues?.items?.properties?.targetLayer?.enum || [];
  const actionEnum = schema.properties?.action?.enum || [];
  const scoreReq = schema.properties?.scores?.required || [];
  const evReq = schema.properties?._evidence?.required || [];
  const modeEnum = schema.properties?._evidence?.properties?.mode?.enum || [];
  const metaReq = schema.properties?._meta?.required || [];

  check(true, `QA1 Schema 可解析：${path.basename(SCHEMA_PATH)}（顶层 required ${req.length} 项）`);
  check(
    ["project", "page", "scores", "average", "issues", "action"].every((f) => req.includes(f)),
    `QA1 Schema 顶层 required 含 project/page/scores/average/issues/action（实际 ${orNone(req)}）`
  );
  check(req.includes("_evidence"), `QA1 Schema 顶层 required 含 _evidence —— 证据档位声明是契约，不是可选`);
  check(evReq.includes("mode"), `QA1 Schema _evidence.required 含 mode`);
  check(metaReq.includes("reviewer"), `QA1 Schema _meta.required 含 reviewer（§1.6 要求写明档位）`);
  check(sortedEq(scoreReq, SCORE_KEYS), `QA1 Schema scores.required = 五维（实际 ${orNone(scoreReq)}）`);
  check(sortedEq(issueReq, ISSUE_REQUIRED), `QA1 Schema issues.items.required 齐备（实际 ${orNone(issueReq)}）`);
  check(sortedEq(layerEnum, LAYERS), `QA1 Schema targetLayer enum = L1/L2/L3（实际 ${orNone(layerEnum)}）`);
  check(sortedEq(actionEnum, ACTIONS), `QA1 Schema action enum = PASS/FIX/STOP_MAX_LOOP（实际 ${orNone(actionEnum)}）`);
  check(sortedEq(modeEnum, MODES), `QA1 Schema _evidence.mode enum = structured-only/structured+vision（实际 ${orNone(modeEnum)}）`);
} catch (e) {
  bad(`QA1 Schema 解析失败：${e.message}（后续依赖 Schema 的检查已按内置默认值继续，不静默跳过）`);
}

/* ---------------- QA2 顶层字段 ---------------- */

for (const { name, report } of targets) {
  if (!report) continue;
  const missing = schemaReq.filter((f) => !(f in report));
  check(missing.length === 0, `QA2 ${name} 顶层必填字段齐备（缺 ${orNone(missing)}）`);
}

/* ---------------- QA3 五维评分 + average 实算 ---------------- */

const isScore = (v) => typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v);

for (const { name, report: r } of targets) {
  if (!r) continue;
  const scores = r.scores && typeof r.scores === "object" ? r.scores : {};
  const missing = SCORE_KEYS.filter((k) => !(k in scores));
  check(missing.length === 0, `QA3 ${name} 五维评分完整（缺 ${orNone(missing)}）`);

  const inRange = SCORE_KEYS.every((k) => isScore(scores[k]) && scores[k] >= 0 && scores[k] <= 10);
  check(inRange, `QA3 ${name} 五维评分均为 0-10 数值（bool 不算数值）`);
  if (!inRange) {
    for (const k of SCORE_KEYS) {
      if (!isScore(scores[k]) || scores[k] < 0 || scores[k] > 10)
        bad(`QA3 ${name} scores.${k}=${JSON.stringify(scores[k])} 非法`);
    }
  } else {
    // half-up 保留一位小数（与 visual-critic.md §2 汇总规则一致）
    const raw = SCORE_KEYS.reduce((a, k) => a + scores[k], 0) / SCORE_KEYS.length;
    const expect = Math.floor(raw * 10 + 0.5) / 10;
    const actual = r.average;
    const ok = isScore(actual) && Math.abs(actual - expect) < 1e-9;
    // 先舍入再判等会放过 8.65 → 声称 8.6（half-up 应为 8.7）：判等用未舍入原值
    check(ok, `QA3 ${name} average=${JSON.stringify(actual)} 与五维实算 ${expect} 一致（未舍入 ${raw}，half-up 一位小数）`);
  }
}

/* ---------------- QA4 issue 必备证据 ---------------- */

/**
 * evidence 须含实测痕迹（防「感觉不对」）。这里**故意不用关键词袋**：
 * 上游是 `["px","#",":","%","档","级","分","实测","readback","对比度"]`，其中「级」「分」
 * 会命中「不够**高级**」「大部**分**」——于是「整体观感不够高级」这种纯观感话术照样通过，
 * 而它正是 critic-report.json 明令禁止的（suggestion 不得说「不够高级」）。
 * 改为判**形状**：要么带量（hex 色值 / 带单位的数字），要么带明确的核对动作词。
 */
const MEASURE_RE =
  /#[0-9A-Fa-f]{3,8}\b|\d+(?:\.\d+)?\s*(?:px|:1|%|pt|档|级)|实测|readback|扫描|复算|逐节点|逐条|比对|抽查|get-node|node id|WCAG|档位|阈值|越界|溢出|触控|字号|行高|间距|圆角|宽高比|色值/i;

for (const { name, report: r } of targets) {
  if (!r) continue;
  const issues = Array.isArray(r.issues) ? r.issues : [];
  check(issues.length > 0 || r.action === "PASS", `QA4 ${name} issues 非空或明确 PASS（action=${JSON.stringify(r.action)}）`);

  issues.forEach((issue, i) => {
    const src = issue && typeof issue === "object" ? issue : {};
    const ev = typeof src.evidence === "string" ? src.evidence : "";
    const sg = typeof src.suggestion === "string" ? src.suggestion : "";
    check(ev.trim() !== "", `QA4 ${name} issue[${i}] evidence 非空`);
    check(sg.trim() !== "", `QA4 ${name} issue[${i}] suggestion 非空（必须可执行）`);
    check(SEVERITIES.includes(src.severity), `QA4 ${name} issue[${i}] severity=${JSON.stringify(src.severity)} 合法`);
    check(typeof src.location === "string" && src.location.trim() !== "", `QA4 ${name} issue[${i}] location 非空`);
    check(MEASURE_RE.test(ev), `QA4 ${name} issue[${i}] evidence 含可复现实测痕迹（量或核对动作，不接受「不够高级」类观感话术）`);
  });
}

/* ---------------- QA5 targetLayer 合法 ---------------- */

for (const { name, report: r } of targets) {
  if (!r) continue;
  const issues = Array.isArray(r.issues) ? r.issues : [];
  issues.forEach((issue, i) => {
    const tl = issue && typeof issue === "object" ? issue.targetLayer : undefined;
    check(LAYERS.includes(tl), `QA5 ${name} issue[${i}] targetLayer=${JSON.stringify(tl)} ∈ {L1,L2,L3}`);
  });
}

/* ---------------- QA6 Critic Loop ---------------- */

for (const { name, report: r } of targets) {
  if (!r) continue;
  const loop = r._loop && typeof r._loop === "object" ? r._loop : {};
  const round = loop.round;
  const hist = Array.isArray(loop.history) ? loop.history : [];

  check(typeof round === "number" && round <= 3, `QA6 ${name} _loop.round=${JSON.stringify(round)} ≤ 3`);
  check(loop.maxLoop === 3, `QA6 ${name} _loop.maxLoop=${JSON.stringify(loop.maxLoop)} == 3`);
  check(hist.length <= (typeof round === "number" ? round : 0), `QA6 ${name} history 长度 ${hist.length} ≤ round ${JSON.stringify(round)}`);
  check(hist.every((h) => isScore(h) && h >= 0 && h <= 10), `QA6 ${name} history 数值均为 0-10`);
  // CL-5「修复必复评」：轮次多于历史长度，说明有轮次的均分没被记录 → 无法验证逐轮收敛
  soft(
    hist.length >= (typeof round === "number" ? round : 0),
    `QA6 ${name} round=${JSON.stringify(round)} 但 history 只有 ${hist.length} 条——有轮次的均分未记录（CL-5 修复必复评）`
  );

  const action = r.action;
  check(ACTIONS.includes(action), `QA6 ${name} action=${JSON.stringify(action)} 合法`);
  const scores = r.scores && typeof r.scores === "object" ? r.scores : {};
  const avg = isScore(r.average) ? r.average : 0;
  const minScore = SCORE_KEYS.length && scores ? Math.min(...SCORE_KEYS.map((k) => (isScore(scores[k]) ? scores[k] : 10))) : 0;

  if (action === "PASS") {
    check(avg >= 8 && minScore >= 7, `QA6 ${name} PASS 自洽：average=${avg}≥8 且最低分 ${minScore}≥7`);
  } else if (action === "STOP_MAX_LOOP") {
    check(round === 3 && avg < 8, `QA6 ${name} STOP_MAX_LOOP 自洽：round=${JSON.stringify(round)}=3 且 average=${avg}<8`);
    check(hist.length > 0 && avg >= hist[0], `QA6 ${name} STOP_MAX_LOOP 前提：3 轮循环确实发生过且有进展（history[0]=${hist.length ? hist[0] : "-"}）`);
  } else if (action === "FIX") {
    check(avg < 8 || minScore < 7, `QA6 ${name} FIX 自洽：average=${avg}<8 或最低分 ${minScore}<7`);
  }

  const hasCritical = (Array.isArray(r.issues) ? r.issues : []).some((i) => i && i.severity === "critical");
  check(!(hasCritical && action === "PASS"), `QA6 ${name} 存在 critical issue 时 action ≠ PASS（critic-mapping.md §5）`);
}

/* ---------------- QA7 证据档位契约（★ 1.2·C3 新增，与 visual-critic.md §1.6 配套） ---------------- */

const DIM_RE = /layout|color|consistency|commercial|usability|§|布局|色彩|色|一致性|商业|可用|触控|层级/i;

for (const { name, report: r } of targets) {
  if (!r) continue;
  const ev = r._evidence;
  const hasEv = !!ev && typeof ev === "object" && !Array.isArray(ev);
  check(hasEv, `QA7 ${name} 含 _evidence 声明（下游据此判断本次评审到底看到了什么）`);
  if (!hasEv) {
    warn.push(`QA7 ${name} 无 _evidence，档位一致性检查未执行——不计为通过`);
    continue;
  }

  const mode = ev.mode;
  check(MODES.includes(mode), `QA7 ${name} _evidence.mode=${JSON.stringify(mode)} ∈ {structured-only, structured+vision}`);

  const vis = Array.isArray(ev.visionObservations) ? ev.visionObservations : [];
  const un = Array.isArray(ev.unassessed) ? ev.unassessed : [];

  check(
    !(mode === "structured-only" && vis.length > 0),
    `QA7 ${name} structured-only 下 visionObservations 为空（实际 ${vis.length} 条——无读图能力不可能有读图观察）`
  );
  soft(!(mode === "structured+vision" && vis.length === 0), `QA7 ${name} 声明 structured+vision 但一条观察都没有——确认是否真的读了图`);

  // §1.6 分档表：Commercial「商业产品相似度（40%）」在结构化档不可判定，故 structured-only 必然存在
  // 无法评估项。声称「零未评估」= 把没看当看过（"把没看按满分计入"）。
  check(
    !(mode === "structured-only" && un.length === 0),
    `QA7 ${name} structured-only 下 unassessed 非空（§1.6 结构性档下「商业产品相似度 40%」等项不可评估；零未评估项即过度声称完整评估）`
  );

  check(un.every((s) => typeof s === "string" && s.trim() !== ""), `QA7 ${name} unassessed 每项均为非空字符串（共 ${un.length} 项）`);
  un.forEach((s, i) => {
    soft(DIM_RE.test(String(s)), `QA7 ${name} unassessed[${i}] 未指明归属维度/章节：「${String(s).slice(0, 40)}」——剔除项须可追溯到具体维`);
  });

  const rev = typeof r._meta?.reviewer === "string" ? r._meta.reviewer : "";
  const saysTier = MODES.find((m) => rev.includes(m)) || null;
  check(!!saysTier, `QA7 ${name} _meta.reviewer 写明本次证据档位（structured-only / structured+vision）`);
  check(saysTier === null || saysTier === mode, `QA7 ${name} _meta.reviewer 档位（${saysTier || "未写"}）与 _evidence.mode（${JSON.stringify(mode)}）一致`);
}

/* ---------------- QA8 跨产物一致（★ 1.2·C3 新增） ---------------- */

const isPathLike = (s) => {
  if (typeof s !== "string") return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false; // URL 不核
  if (!/[\\/]/.test(s)) return false; // 无分隔符的散文（如「真实视觉回归实测数据」）不核
  return /\.(json|md|png|svg|txt|csv)$/i.test(s);
};
const existsAnywhere = (s) => [ROOT, process.cwd()].some((base) => fs.existsSync(path.resolve(base, s)));

/** 把 DS Spec 展开成「点路径 → 标量」的可解析表（token 叶值 + accessibility 标量） */
function specFacts(spec) {
  const m = new Map();
  const walk = (o, prefix) => {
    for (const [k, v] of Object.entries(o || {})) {
      const p = `${prefix}.${k}`;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if ("value" in v) m.set(p, v.value);
        else walk(v, p);
      }
    }
  };
  walk(spec.tokens, "tokens");
  for (const k of ["minFontSize", "touchTarget"]) {
    const a = spec.accessibility?.[k];
    if (a && typeof a === "object" && "value" in a) m.set(`accessibility.${k}`, a.value);
  }
  return m;
}

/**
 * 只在「点名 + 值」同时出现、且点名能**唯一**解析到 Spec 时才判。
 * 歧义（命中多条）或点名不认识（`fill` / `menu` / `shadow` 这类裸词）一律不判——
 * 判不了的当没事，比凭空造出违规强（precheck 的教训：装置多给属性会造出假契约错误）。
 */
function resolveFact(facts, name) {
  if (!name.includes(".")) return null;
  const hits = [...facts.entries()].filter(([p]) => p === name || p.endsWith(`.${name}`));
  return hits.length === 1 ? hits[0] : null;
}

/** Spec 声明的档位集合（去重后升序）——spacing.scale / typography 字号 / radius */
function specScales(spec) {
  const out = new Set();
  const norm = (ns) => [...new Set(ns)].sort((a, b) => a - b).join("/");
  const scale = spec.tokens?.spacing?.scale?.value;
  if (typeof scale === "string") {
    const ns = scale.split("/").map(Number).filter(Number.isFinite);
    if (ns.length >= 3) out.add(norm(ns));
  }
  const sizes = Object.values(spec.tokens?.typography || {}).map((t) => t?.size).filter(Number.isFinite);
  if (sizes.length >= 2) out.add(norm(sizes));
  const radii = Object.values(spec.tokens?.radius || {}).map((t) => t?.value).filter(Number.isFinite);
  if (radii.length >= 2) out.add(norm(radii));
  return out;
}

// 点名允许大小写混写（`text.secondary` 全小写、`accessibility.minFontSize` 驼峰都要能认），
// 但必须含「点」——裸词（fill / menu / shadow）歧义太大，一律不判。
const HEX_CITE_RE = /([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)\s*(#[0-9A-Fa-f]{6})/g;
const SCALAR_CITE_RE = /([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)\s*=\s*([0-9]+(?:\.[0-9]+)?)\b/g;
const SCALE_LIST_RE = /(?<![\d.])(\d+(?:\s*\/\s*\d+){2,})(?![\d.])/g;

for (const { name, report: r, brief, spec } of targets) {
  if (!r) continue;

  if (spec) {
    const bn = spec.brand?.name;
    check(typeof bn === "string" && bn !== "" && r.project === bn, `QA8 ${name} report.project「${r.project}」== spec.brand.name「${bn ?? "缺失"}」`);
  } else {
    warn.push(`QA8 ${name} 未提供 DS Spec，report.project ↔ brand.name 未校验`);
  }

  if (brief) {
    const pn = brief.product?.name;
    check(typeof pn === "string" && pn !== "" && r.project === pn, `QA8 ${name} report.project「${r.project}」== brief.product.name「${pn ?? "缺失"}」`);
    const pages = (brief.informationArchitecture?.pages || []).map((p) => p && p.name).filter(Boolean);
    check(pages.length > 0 && pages.includes(r.page), `QA8 ${name} report.page「${r.page}」∈ Brief IA 页面清单（${pages.length ? pages.join(" / ") : "未声明"}）`);
  } else {
    warn.push(`QA8 ${name} 未提供 Brief，report.page 无法与 IA 页面清单核对`);
  }

  const inputs = Array.isArray(r._meta?.inputs) ? r._meta.inputs : [];
  const dangling = inputs.filter((s) => isPathLike(s) && !existsAnywhere(s));
  const checked = inputs.filter(isPathLike).length;
  check(dangling.length === 0, `QA8 ${name} _meta.inputs 中 ${checked} 条形如路径的条目均存在（悬空 ${orNone(dangling)}）`);

  if (!spec) continue;

  // 证据里引用的「可解析量」必须与 DS Spec 对得上。自由文本只能交叉核对，故记为 WARN。
  // 覆盖范围是**有意的**：只查「点路径点名 + 值」同现的引用，查不到就当没说。
  const facts = specFacts(spec);
  const scales = specScales(spec);
  const texts = [];
  (Array.isArray(r.issues) ? r.issues : []).forEach((it, i) => {
    if (it && typeof it.evidence === "string") texts.push([`issue[${i}].evidence`, it.evidence]);
  });
  if (typeof r._loop?.note === "string") texts.push(["_loop.note", r._loop.note]);

  for (const [where, text] of texts) {
    for (const m of text.matchAll(HEX_CITE_RE)) {
      const hit = resolveFact(facts, m[1]);
      if (hit && typeof hit[1] === "string" && hit[1].toUpperCase() !== m[2].toUpperCase()) {
        warn.push(`QA8 ${name} ${where} 把 ${m[1]} 写成 ${m[2]}，而 DS Spec 里该 token 是 ${hit[1]}——若这是画布实测值则说明节点未按 token 上色（L3 缺陷），若是笔误请改证据`);
      }
    }
    for (const m of text.matchAll(SCALAR_CITE_RE)) {
      const hit = resolveFact(facts, m[1]);
      if (hit && typeof hit[1] === "number" && hit[1] !== Number(m[2])) {
        warn.push(`QA8 ${name} ${where} 引用 ${m[1]}=${m[2]}，而 DS Spec 里该值是 ${hit[1]}`);
      }
    }
    for (const m of text.matchAll(SCALE_LIST_RE)) {
      const ns = m[1].split("/").map((x) => Number(x.trim()));
      if (!scales.has([...new Set(ns)].sort((a, b) => a - b).join("/"))) {
        warn.push(`QA8 ${name} ${where} 引用档位列表 ${m[1]}，与 DS Spec 声明的档位（${[...scales].join("；")}）都不一致`);
      }
    }
  }
}

/* ---------------- 汇总 ---------------- */

const STRICT = process.argv.includes("--strict"); // 软检查升为致命：仓库自带样例用这一档

const bar = "=".repeat(62);
console.log(bar);
if (!QUIET) for (const m of pass) console.log(`  PASS  ${m}`);
if (!QUIET) for (const m of warn) console.log(`  WARN  ${m}`);
console.log(bar);
if (fail.length || (STRICT && warn.length)) {
  for (const m of fail) console.log(`  FAIL  ${m}`);
  if (STRICT) for (const m of warn) console.log(`  FAIL  ${m}（--strict：软检查计为失败）`);
  const tail = STRICT && warn.length ? "（--strict：WARN 计为失败）" : "";
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL / ${warn.length} WARN${tail} —— L4 校验未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL / ${warn.length} WARN —— L4 QA ALL GREEN`);
