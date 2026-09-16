#!/usr/bin/env node
/**
 * qa-critic-mutation.mjs — qa-critic.mjs 的配套变异测试（1.2 · C3）
 *
 * 为什么必须有它：references/lessons.md #33 —— **校验器没有配套变异测试，它的「全绿」就没有意义**。
 * L4 是本项目断言数最多的一层（上游 90 条），一个永远报 0 的 L4 校验器与一个摆设无法区分。
 * 而且 qa-critic 里有一半断言来自 Schema 与跨产物核对——那些恰恰是最容易「写了但从未跑过」的。
 *
 * 做法：在临时目录造一份**可解析的** Brief / DS Spec / critic-report 三元组，逐项注入已知缺陷，
 * 断言 qa-critic.mjs 的**输出关键词与退出码**都符合预期；并单独断言：
 *   · 软检查（WARN）**命中数非零**——否则无法区分「没有问题」与「软规则从未生效」；
 *   · `--strict` 能把 WARN 升为失败（否则仓库自带样例的「零告警」无法当作门禁）；
 *   · 一次注入多处时**逐条全报**（不是 fail-fast 只报第一条）。
 *
 * 覆盖 34 例：基线 1 · 硬拦截 24 · 软提示 5 · 参数与用法 4。
 *
 * 用法：node tools/qa-critic-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "qa-critic.mjs");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-critic-mut-"));
const SPEC_P = path.join(TMP, "spec.json");
const BRIEF_P = path.join(TMP, "brief.json");
const REPORT_P = path.join(TMP, "critic-report.json");

/* ---------------- 最小但合法的三元组 ---------------- */

const baseSpec = () => ({
  brand: { name: "测试产品", stylePresetId: "premium-saas" },
  tokens: {
    color: {
      background: { page: { value: "#FFFFFF", source: "preset:x" } },
      surface: { card: { value: "#FFFFFF", source: "preset:x" } },
      text: {
        primary: { value: "#111827", source: "preset:x" },
        regular: { value: "#6B7280", source: "preset:x" },
        secondary: { value: "#9CA3AF", source: "preset:x" },
      },
    },
    spacing: { scale: { value: "4/8/12/16/24/32", source: "preset:x" } },
    typography: {
      display: { size: 24, lineHeight: 32, weight: 500 },
      heading: { size: 17, lineHeight: 23, weight: 500 },
      body: { size: 15, lineHeight: 21, weight: 400 },
      caption: { size: 13, lineHeight: 19, weight: 400 },
      number: { size: 15, lineHeight: 21, weight: 500 },
    },
    radius: { sm: { value: 8 }, md: { value: 12 }, lg: { value: 16 } },
  },
  accessibility: {
    minFontSize: { value: 11, source: "rule:TY-3" },
    touchTarget: { value: 44, source: "rule:AC-1" },
  },
});

const baseBrief = () => ({
  product: { name: "测试产品" },
  informationArchitecture: { pages: [{ name: "首页" }, { name: "详情" }] },
});

const baseReport = () => ({
  project: "测试产品",
  page: "首页",
  scores: { layout: 8.5, color: 8.5, consistency: 8.5, commercial: 8.5, usability: 8.5 },
  average: 8.5,
  issues: [],
  action: "PASS",
  _loop: { round: 1, maxLoop: 3, history: [8.5] },
  _meta: {
    reviewer: "agent (structured-only；测试装置)",
    reviewedAt: "2026-09-16T00:00:00+08:00",
    // 指向仓库里真实存在的文件：既让「路径存在」检查有东西可查，又不会因临时目录而误报
    inputs: ["assets/examples/example-health.dsspec.json"],
  },
  _evidence: { mode: "structured-only", unassessed: ["Commercial §1.4 商业产品相似度 40%：需读图"], visionObservations: [] },
});

/** 造一条合法 issue，按需覆盖字段 */
const issue = (o = {}) => ({
  severity: "medium",
  location: "Card/hero",
  evidence: "readback gap 13px，非 spacing.scale 档位",
  suggestion: "对齐 16 档",
  targetLayer: "L2",
  ...o,
});

fs.writeFileSync(SPEC_P, JSON.stringify(baseSpec(), null, 2));
fs.writeFileSync(BRIEF_P, JSON.stringify(baseBrief(), null, 2));

function run(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

/** 写一份报告（可先经 mutate 注入缺陷）并跑工具 */
function runReport(mutate, extra = []) {
  const rep = baseReport();
  if (mutate) mutate(rep);
  fs.writeFileSync(REPORT_P, JSON.stringify(rep, null, 2));
  return run(["--report", REPORT_P, "--brief", BRIEF_P, "--spec", SPEC_P, ...extra]);
}

/** 断言「退出码 + 输出含某关键词」，一次给两件事，避免只断言"失败了"（否则任何失败都能让它变绿） */
function expectCase(label, r, wantCode, keyword) {
  const okCode = r.code === wantCode;
  const okKey = keyword ? r.out.includes(keyword) : true;
  const detail = okCode && okKey ? "" : `（exit=${r.code} 期望 ${wantCode}${keyword && !okKey ? `；输出缺「${keyword}」` : ""}）`;
  check(okCode && okKey, `${label}${detail}`);
}

/* ---------------- 0. 基线：未变异必须全绿（防"什么都报错"的过校正） ---------------- */

{
  const r = runReport(null);
  const zeroWarn = /0 FAIL \/ 0 WARN/.test(r.out);
  check(r.code === 0 && zeroWarn, `基线 未变异的合法报告 → exit 0 且 0 FAIL / 0 WARN（实际 exit=${r.code}${zeroWarn ? "" : "，存在告警"}）`);
  const strict = runReport(null, ["--strict"]);
  check(strict.code === 0, `基线 --strict 也是 exit 0（软检查在干净数据上不得误报）`);
}

/* ---------------- 1. QA7 证据档位契约（C2 §1.6 的落地） ---------------- */

expectCase("_evidence 整体缺失", runReport((r) => delete r._evidence), 1, "_evidence 声明");
expectCase(
  "_evidence.mode 非法值",
  runReport((r) => {
    r._evidence.mode = "vision";
  }),
  1,
  "_evidence.mode"
);
expectCase(
  "structured-only 却带读图观察（自相矛盾）",
  runReport((r) => {
    r._evidence.visionObservations = ["KPI 卡缺环比箭头（节点 12:34）"];
  }),
  1,
  "visionObservations 为空"
);
expectCase(
  "structured-only 却声称零未评估项（过度声称）",
  runReport((r) => {
    r._evidence.unassessed = [];
  }),
  1,
  "unassessed 非空"
);
expectCase(
  "reviewer 未写明档位",
  runReport((r) => {
    r._meta.reviewer = "agent (视觉审查)";
  }),
  1,
  "写明本次证据档位"
);
expectCase(
  "reviewer 档位与 _evidence.mode 矛盾",
  runReport((r) => {
    r._meta.reviewer = "agent (structured+vision；看了 PNG)";
  }),
  1,
  "与 _evidence.mode"
);
expectCase(
  "_meta 整体缺失",
  runReport((r) => delete r._meta),
  1,
  "顶层必填字段齐备"
);
expectCase(
  "unassessed 列表里塞空串",
  runReport((r) => {
    r._evidence.unassessed = [""];
  }),
  1,
  "非空字符串"
);

/* ---------------- 2. QA7 软分支：声明有读图能力却无观察 ---------------- */

{
  const r = runReport((r) => {
    r._evidence.mode = "structured+vision";
    r._evidence.visionObservations = [];
    r._meta.reviewer = "agent (structured+vision；测试)";
  });
  expectCase("structured+vision 但零观察 → 只告警", r, 0, "一条观察都没有");
  check(r.out.includes("WARN"), "上述软提示确实以 WARN 出现（软规则命中数非零，防空转）");
  const strict = runReport(
    (r2) => {
      r2._evidence.mode = "structured+vision";
      r2._evidence.visionObservations = [];
      r2._meta.reviewer = "agent (structured+vision；测试)";
    },
    ["--strict"]
  );
  expectCase("同上在 --strict 下升为失败", strict, 1, "软检查计为失败");
}

/* ---------------- 3. QA3 五维评分与 average ---------------- */

expectCase(
  "average 与实算不符",
  runReport((r) => {
    r.average = 8.9;
  }),
  1,
  "与五维实算"
);
expectCase(
  "average 先舍入再判等（8.65 声称 8.6，half-up 应为 8.7）",
  runReport((r) => {
    for (const k of Object.keys(r.scores)) r.scores[k] = 8.65;
    r.average = 8.6;
  }),
  1,
  "与五维实算"
);
expectCase(
  "缺一维",
  runReport((r) => delete r.scores.usability),
  1,
  "五维评分完整"
);
expectCase(
  "评分超范围",
  runReport((r) => {
    r.scores.usability = 11;
  }),
  1,
  "0-10 数值"
);
expectCase(
  "评分是布尔（bool 不算数值）",
  runReport((r) => {
    r.scores.usability = true;
  }),
  1,
  "0-10 数值"
);
expectCase(
  "评分是数字字符串",
  runReport((r) => {
    r.scores.usability = "8.5";
  }),
  1,
  "0-10 数值"
);

/* ---------------- 4. QA4 / QA5 issue 证据与路由 ---------------- */

expectCase(
  "issues 为空却 action=FIX",
  runReport((r) => {
    r.action = "FIX";
  }),
  1,
  "issues 非空或明确 PASS"
);
expectCase(
  "evidence 为空",
  runReport((r) => {
    r.issues = [issue({ evidence: "   " })];
  }),
  1,
  "evidence 非空"
);
expectCase(
  "evidence 无实测痕迹（'感觉不对'）",
  runReport((r) => {
    r.issues = [issue({ evidence: "整体观感不够高级" })];
  }),
  1,
  "实测痕迹"
);
expectCase(
  "suggestion 为空",
  runReport((r) => {
    r.issues = [issue({ suggestion: "" })];
  }),
  1,
  "suggestion 非空"
);
expectCase(
  "severity 非法",
  runReport((r) => {
    r.issues = [issue({ severity: "fatal" })];
  }),
  1,
  "severity"
);
expectCase(
  "targetLayer 非法（L4）",
  runReport((r) => {
    r.issues = [issue({ targetLayer: "L4" })];
  }),
  1,
  "targetLayer"
);

/* ---------------- 5. QA6 Critic Loop 自洽 ---------------- */

expectCase(
  "round 超上限（4）",
  runReport((r) => {
    r._loop.round = 4;
  }),
  1,
  "_loop.round"
);
expectCase(
  "maxLoop 不是 3",
  runReport((r) => {
    r._loop.maxLoop = 5;
  }),
  1,
  "maxLoop"
);
expectCase(
  "history 长度大于 round",
  runReport((r) => {
    r._loop.round = 1;
    r._loop.history = [8.5, 8.6];
  }),
  1,
  "history 长度"
);
expectCase(
  "PASS 但 average<8",
  runReport((r) => {
    for (const k of Object.keys(r.scores)) r.scores[k] = 7.9;
    r.average = 7.9;
  }),
  1,
  "PASS 自洽"
);
expectCase(
  "PASS 但存在 <7 单维",
  runReport((r) => {
    r.scores.usability = 6.9;
    r.average = 8.2;
  }),
  1,
  "PASS 自洽"
);
expectCase(
  "FIX 但全维 ≥7 且 average ≥8（无理由 FIX）",
  runReport((r) => {
    r.action = "FIX";
    r.issues = [issue()];
  }),
  1,
  "FIX 自洽"
);
expectCase(
  "STOP_MAX_LOOP 但 average ≥8",
  runReport((r) => {
    r.action = "STOP_MAX_LOOP";
    r._loop.round = 3;
    r._loop.history = [8.0, 8.4, 8.6];
    r.average = 8.6;
    r.scores = { layout: 8.6, color: 8.6, consistency: 8.6, commercial: 8.6, usability: 8.6 };
  }),
  1,
  "STOP_MAX_LOOP 自洽"
);
expectCase(
  "STOP_MAX_LOOP 但 3 轮无进展（history[0] > average）",
  runReport((r) => {
    r.action = "STOP_MAX_LOOP";
    r._loop.round = 3;
    r._loop.history = [9.0, 8.2, 7.8];
    r.average = 7.8;
    r.scores = { layout: 7.8, color: 7.8, consistency: 7.8, commercial: 7.8, usability: 7.8 };
  }),
  1,
  "有进展"
);
expectCase(
  "存在 critical issue 却 PASS（critic-mapping §5）",
  runReport((r) => {
    r.issues = [issue({ severity: "critical" })];
  }),
  1,
  "critical issue 时 action"
);

/* ---------------- 6. QA8 跨产物一致 ---------------- */

expectCase(
  "page 不在 Brief IA 清单内",
  runReport((r) => {
    r.page = "主驾驶舱";
  }),
  1,
  "IA 页面清单"
);
expectCase(
  "project 与 spec.brand.name 不符",
  runReport((r) => {
    r.project = "另一个产品";
  }),
  1,
  "brand.name"
);
expectCase(
  "_meta.inputs 悬空路径",
  runReport((r) => {
    r._meta.inputs = ["assets/examples/不存在的文件.dsspec.json"];
  }),
  1,
  "悬空"
);
expectCase(
  "证据把 token 色值写错（C1 同类缺陷）",
  runReport((r) => {
    r.issues = [issue({ evidence: "text.secondary #6B7A99 on surface.card #FFFFFF 对比度实测 3.2:1" })];
  }),
  0,
  "该 token 是"
);
expectCase(
  "证据引用的 accessibility 标量不符",
  runReport((r) => {
    r.issues = [issue({ evidence: "低于 accessibility.minFontSize=14（readback fontSize=12）" })];
  }),
  0,
  "DS Spec 里该值是"
);
expectCase(
  "证据引用的档位列表与 Spec 声明都不一致",
  runReport((r) => {
    r.issues = [issue({ evidence: "实测 gap 13px，非 spacing.scale 档位（14/16/20/24/32）" })];
  }),
  0,
  "档位列表"
);
{
  // 软规则整体命中数非零（三条软提示都应出现），并确认 --strict 下会致命
  const r = runReport((rep) => {
    rep.issues = [
      issue({ evidence: "text.secondary #6B7A99 on surface.card #FFFFFF 对比度实测 3.2:1" }),
      issue({ evidence: "低于 accessibility.minFontSize=14" }),
    ];
  });
  const warns = (r.out.match(/^ {2}WARN /gm) || []).length;
  check(warns >= 2, `软检查命中数非零（实际 ${warns} 条 WARN）`);
  const strict = runReport(
    (rep) => {
      rep.issues = [issue({ evidence: "text.secondary #6B7A99 on surface.card #FFFFFF 对比度实测 3.2:1" })];
    },
    ["--strict"]
  );
  expectCase("软检查在 --strict 下升为失败", strict, 1, "软检查计为失败");
}
{
  // 未提供 DS Spec / Brief：应降级为软提示而不是静默通过，也不能崩
  fs.writeFileSync(REPORT_P, JSON.stringify(baseReport(), null, 2));
  const r = run(["--report", REPORT_P]);
  expectCase("未提供 --spec/--brief → 软提示而非静默通过", r, 0, "未提供 DS Spec");
  check(r.out.includes("未提供 Brief"), "未提供 Brief 时也明确说明该项未校验");
}

/* ---------------- 7. 一次注入多处：逐条全报，不 fail-fast ---------------- */

{
  const r = runReport((rep) => {
    rep.average = 9.9; // QA3
    rep.issues = [issue({ severity: "fatal", targetLayer: "L4" })]; // QA4 + QA5
    rep._loop.maxLoop = 7; // QA6
    delete rep._evidence; // QA7
    rep.page = "不存在的页"; // QA8
  });
  const all = ["与五维实算", "severity", "targetLayer", "maxLoop", "_evidence 声明", "IA 页面清单"]
    .map((k) => [k, r.out.includes(k)])
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  check(r.code === 1 && all.length === 0, `一次注入 6 处 → 6 类全被逐条报出（未报出的：${all.length ? all.join(", ") : "无"}）`);
}

/* ---------------- 8. 用法与参数 ---------------- */

expectCase("--report 指向不存在的文件 → exit 2", run(["--report", path.join(TMP, "没有这个.json")]), 2, "文件不存在");
expectCase("--examples 指向不存在的目录 → exit 2", run(["--examples", path.join(TMP, "没有这个目录")]), 2, "目录不存在");
{
  const empty = path.join(TMP, "empty");
  fs.mkdirSync(empty, { recursive: true });
  expectCase("--examples 目录里没有 example-*/ → exit 2", run(["--examples", empty]), 2, "没有 example-");
}

/* ---------------- 仓库自带样例：--strict 零告警（门禁） ---------------- */

{
  const r = run(["--strict"]);
  check(r.code === 0, `仓库自带三份样例在 --strict 下零告警（exit=${r.code}）`);
  const m = r.out.match(/(\d+) PASS \/ (\d+) FAIL \/ (\d+) WARN/);
  check(!!m && Number(m[2]) === 0 && Number(m[3]) === 0, `样例汇总为 0 FAIL / 0 WARN（实际 ${m ? m[0] : "未匹配到"}）`);
  check(!!m && Number(m[1]) >= 100, `样例断言数 ≥100（实际 ${m ? m[1] : "-"}）`);
}

/* ---------------- 汇总 ---------------- */

console.log("=".repeat(62));
for (const m of pass) console.log(`  PASS  ${m}`);
console.log("=".repeat(62));
if (fail.length) {
  for (const m of fail) console.log(`  FAIL  ${m}`);
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— qa-critic 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— qa-critic 变异测试 ALL GREEN`);
