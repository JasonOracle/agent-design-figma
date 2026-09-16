#!/usr/bin/env node
/**
 * qa-export-mutation.mjs — qa-export.mjs 的配套变异测试（1.2 · C3）
 *
 * 为什么必须有它：references/lessons.md #33 —— **校验器没有配套变异测试，它的「全绿」就没有意义**。
 * L5 是出口闸门：一个永远报 0 的 L5 校验器 = 出口没闸门（1.2 之前 L5 正是一条空规则）。
 *
 * 做法：在临时目录里搭一份**自包含的小仓库**（真 Schema + 真三份样例清单 + 假导出物占位文件 +
 * 真 git 仓库），逐项注入已知缺陷，断言 qa-export.mjs 的**退出码 + 输出关键词**都符合预期。
 * 额外断言：
 *   · 基线（未变异）必须 exit 0 且 0 FAIL / 0 WARN —— 防「什么都报错」的过校正；
 *   · 断言 PASS 数 ≥800 —— 防「只跑了一份清单」还被当成全绿；
 *   · **Schema 条件分支方向**：design-phase 空 png 必须放行、live-build 空 png 必须拦下 ——
 *     这两条是 1.2 修掉「description 说允许、语义上不允许」那个谎之后的回归守卫；
 *   · **source 注记不得被误伤**：在继承来的 source 后面追加括注必须仍然通过（判据是前缀不是相等）；
 *   · 冻结态核不了时必须说「核不了」，不许静默通过。
 *
 * 用法：node tools/qa-export-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

/** 夹具仓库（含 .git，供 QA7 使用）与变异副本目录（**在夹具之外**，否则变异文件本身会把工作树弄脏） */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-export-mut-"));
const MUT = fs.mkdtempSync(path.join(os.tmpdir(), "qa-export-mut-cases-"));
const TOOL = path.join(TMP, "tools", "qa-export.mjs");

const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
const copy = (rel) => {
  const src = path.join(ROOT, rel);
  const dst = path.join(TMP, rel);
  mkdirp(path.dirname(dst));
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, dst, { recursive: true });
  else fs.copyFileSync(src, dst);
  return dst;
};

/* ---------------- 搭夹具仓库 ---------------- */

mkdirp(path.join(TMP, "tools"));
fs.copyFileSync(path.join(HERE, "qa-export.mjs"), TOOL);
copy("assets/templates/export-manifest.json");
copy("assets/style-library");
const EXAMPLES_DIR = path.join(TMP, "assets/examples");
mkdirp(EXAMPLES_DIR);
for (const f of fs.readdirSync(path.join(ROOT, "assets/examples"))) {
  if (/^example-.*\.json$/.test(f)) fs.copyFileSync(path.join(ROOT, "assets/examples", f), path.join(EXAMPLES_DIR, f));
}
for (const n of ["saas", "health", "highway"]) {
  const dir = path.join(ROOT, "assets/examples", `example-${n}`);
  if (!fs.existsSync(dir)) continue;
  mkdirp(path.join(EXAMPLES_DIR, `example-${n}`));
  fs.copyFileSync(path.join(dir, "critic-report.json"), path.join(EXAMPLES_DIR, `example-${n}`, "critic-report.json"));
}
// 随包副本目录：.json 真拷（QA8 要读 product.name/brand.name），二进制造空占位（QA2 只查存在）
{
  const srcDir = path.join(ROOT, "assets/examples/export/files");
  const dstDir = path.join(TMP, "assets/examples/export/files");
  mkdirp(dstDir);
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
    else fs.writeFileSync(path.join(dstDir, f), "");
  }
}
const MANIFEST_DIR = path.join(TMP, "assets/examples/export");
for (const f of fs.readdirSync(path.join(ROOT, "assets/examples/export"))) {
  if (/^example-.*\.json$/.test(f)) fs.copyFileSync(path.join(ROOT, "assets/examples/export", f), path.join(MANIFEST_DIR, f));
}
// 清单里引用的其余路径（criticReport 等）补空占位
for (const f of fs.readdirSync(MANIFEST_DIR).filter((x) => x.endsWith(".json"))) {
  const m = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), "utf8"));
  const refs = [
    ...(m.exports?.png || []).map((e) => e.path),
    ...(m.exports?.svg || []).map((e) => e.path),
    m.exports?.figmaJson?.path,
    m.exports?.designSpec?.brief,
    m.exports?.designSpec?.dsSpec,
    m.exports?.designSpec?.buildPlan,
    m.exports?.designSpec?.criticReport,
  ].filter((p) => typeof p === "string" && p);
  for (const r of refs) {
    const abs = path.join(TMP, r);
    if (!fs.existsSync(abs)) {
      mkdirp(path.dirname(abs));
      fs.writeFileSync(abs, "");
    }
  }
}
// 冻结禁区：必须被 git 跟踪，否则「脏」根本不会出现在 status 里
mkdirp(path.join(TMP, "figma-plugin"));
mkdirp(path.join(TMP, "bridge"));
fs.writeFileSync(path.join(TMP, "figma-plugin", "code.js"), "// frozen\n");
fs.writeFileSync(path.join(TMP, "bridge", "server.js"), "// frozen\n");

const git = (args, cwd = TMP) => spawnSync("git", args, { cwd, encoding: "utf8" });
git(["init", "-q"]);
git(["add", "-A"]);
git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fixture"]);
check(git(["status", "--porcelain"]).stdout.trim() === "", "夹具自检：初始化后工作树干净（否则 QA7 永远报脏，其余例的断言会失去意义）");

/* ---------------- 跑工具 ---------------- */

function run(args, cwd = TMP) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", cwd });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

const readManifest = (n) => JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, `example-${n}-export.json`), "utf8"));

let caseNo = 0;
/** 变异一份清单并跑工具；mutate=null 表示不注入 */
function runManifest(n, mutate, extra = []) {
  const m = readManifest(n);
  if (mutate) mutate(m);
  const p = path.join(MUT, `case-${++caseNo}.json`);
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
  return run(["--manifest", p, ...extra]);
}

function expectCase(label, r, wantCode, keyword) {
  const okCode = r.code === wantCode;
  const okKey = !keyword || r.out.includes(keyword);
  const detail = okCode && okKey ? "" : `（exit=${r.code} 期望 ${wantCode}${!okKey ? `；输出缺「${keyword}」` : ""}）`;
  check(okCode && okKey, `${label}${detail}`);
}

/* ---------------- 0. 基线 ---------------- */

{
  const r = run([]);
  check(r.code === 0 && /0 FAIL \/ 0 WARN/.test(r.out), `基线 未变异的夹具仓库 → exit 0 且 0 FAIL / 0 WARN（实际 exit=${r.code}）`);
  const strict = run(["--strict"]);
  check(strict.code === 0, `基线 --strict 也是 exit 0（软检查在干净数据上不得误报）`);
  const m = /结果：(\d+) PASS/.exec(r.out);
  check(!!m && Number(m[1]) >= 800, `基线断言数 ≥800（实际 ${m ? m[1] : "-"}）—— 防「只跑了一份清单」被当成全绿`);
  // 三份清单都要进统计
  check(["saas", "health", "highway"].every((n) => r.out.includes(`example-${n}-export`)), "三份样例清单都被校验到");
}

/* ---------------- 1. QA1 Schema 真校验（用仓库真 Schema） ---------------- */

expectCase("缺必填 project", runManifest("saas", (m) => delete m.project), 1, "required");
expectCase("criticScore 越界 11", runManifest("saas", (m) => (m.audit.criticScore = 11)), 1, "maximum");
expectCase("freezeStatus 非法枚举", runManifest("saas", (m) => (m.audit.freezeStatus = "ok")), 1, "enum");
expectCase("rootNodeIds 格式非法", runManifest("saas", (m) => (m.source.rootNodeIds = ["abc"])), 1, "pattern");
expectCase("缺 figmaFileKey 字段", runManifest("saas", (m) => delete m.source.figmaFileKey), 1, "required");
expectCase("tokens.color 少于 8 条", runManifest("saas", (m) => (m.tokens.color = m.tokens.color.slice(0, 3))), 1, "minItems");
expectCase("tokens.typography 少于 5 条", runManifest("saas", (m) => (m.tokens.typography = m.tokens.typography.slice(0, 2))), 1, "minItems");
expectCase("design-phase 的空 png 必须放行", runManifest("highway", null), 0, "0 FAIL");
expectCase("live-build 的空 png 必须拦下", runManifest("highway", (m) => (m._meta.status = "live-build")), 1, "/exports/png");
expectCase(
  "无 _meta + 空 png 必须按最严档拦下（不许被当成 design-phase 放过）",
  runManifest("highway", (m) => delete m._meta),
  1,
  "/exports/png"
);

/* ---------------- 2. QA2 导出物存在 ---------------- */

expectCase("png 指向不存在的文件", runManifest("saas", (m) => (m.exports.png[0].path = "assets/nope.png")), 1, "文件存在");
expectCase("png.path 为空", runManifest("saas", (m) => (m.exports.png[0].path = "")), 1, "path 非空");
expectCase("designSpec.dsSpec 指向不存在", runManifest("saas", (m) => (m.exports.designSpec.dsSpec = "assets/nope.json")), 1, "文件存在");
expectCase("figmaJson.path 为空且无 note", runManifest("saas", (m) => { m.exports.figmaJson.path = null; delete m.exports.figmaJson.note; }), 1, "note 说明");
expectCase("规划路径 existsCheck=false 但无 _meta", runManifest("saas", (m) => { m.exports.png[0].existsCheck = false; m._meta = undefined; }), 1, "_meta");

/* ---------------- 3. QA3 node id 可回读 ---------------- */

expectCase("命中越界（导出 nodeId ∉ rootNodeIds）", runManifest("saas", (m) => (m.source.rootNodeIds = ["19:330"])), 1, "rootNodeIds");
expectCase("live-build 缺 figmaFileKey", runManifest("saas", (m) => (m.source.figmaFileKey = null)), 1, "figmaFileKey");
expectCase("design-phase 却带 figmaFileKey（不诚实标注）", runManifest("highway", (m) => (m.source.figmaFileKey = "K")), 1, "figmaFileKey=null");

/* ---------------- 4. QA4 Component Mapping ---------------- */

expectCase("class 非法枚举", runManifest("saas", (m) => (m.mapping.components[0].class = "D-manual")), 1, "class");
expectCase("A 类缺 props", runManifest("saas", (m) => (m.mapping.components[0].props = [])), 1, "props 非空");
expectCase("C 类缺 manualNote", runManifest("highway", (m) => { const c = m.mapping.components.find((x) => x.class === "C-manual"); c.manualNote = ""; }), 1, "manualNote");
expectCase("layoutRules 少于 3 条", runManifest("saas", (m) => (m.mapping.layoutRules = ["一条"])), 1, "layoutRules");

/* ---------------- 5. QA5 Token Mapping（value 快照 / source 继承 / 命名 / 回溯） ---------------- */

const tok = (m, dsToken) => Object.values(m.tokens).flat().find((e) => e.dsToken === dsToken);
expectCase("value 快照编错（色号）", runManifest("saas", (m) => (tok(m, "tokens.color.brand.primary").value = "#000000")), 1, "value 快照与 dsspec 一致");
expectCase("value 快照写成自由文本", runManifest("highway", (m) => (tok(m, "tokens.typography.caption").value = "14（大屏提升档）")), 1, "value 快照与 dsspec 一致");
expectCase("value 快照与字阶不符", runManifest("saas", (m) => (tok(m, "tokens.typography.body").value = "15/21/400")), 1, "value 快照与 dsspec 一致");
expectCase("source 指向别的来源", runManifest("saas", (m) => (tok(m, "tokens.radius.md").source = "preset:enterprise-dashboard.visualSystem.radius")), 1, "不是 dsspec");
expectCase("source 丢五类前缀", runManifest("saas", (m) => (tok(m, "tokens.color.brand.primary").source = "whatever")), 1, "前缀");
expectCase("cssVariable 不符命名规则", runManifest("saas", (m) => (tok(m, "tokens.typography.body").cssVariable = "--ds-typo-body")), 1, "命名规则一致");
expectCase("dsToken 在 dsspec 中不存在", runManifest("saas", (m) => { const e = tok(m, "tokens.radius.sm"); e.dsToken = "tokens.color.nope"; e.cssVariable = "--ds-color-nope"; }), 1, "可回溯");
expectCase("color 映射不足 8 条", runManifest("saas", (m) => (m.tokens.color = m.tokens.color.slice(0, 7))), 1, "≥8");
{
  // 关键反向守卫：继承来的 source 后**追加括注**是合法的，判据是前缀不是相等
  const r = runManifest("saas", (m) => {
    const e = tok(m, "tokens.color.brand.primary");
    e.source = e.source + "（本地注记：与本仓库无关的说明）";
  });
  check(r.code === 0 && /0 FAIL/.test(r.out), `source 追加括注不得被误伤（判据是前缀不是相等）（exit=${r.code}）`);
}

/* ---------------- 6. QA6 无孤儿 + Export Gate 自洽 ---------------- */

expectCase("孤儿映射（dsName 不在 dsspec）", runManifest("saas", (m) => m.mapping.components.push({ figmaComponent: "X", dsName: "Nope", class: "A-direct", frontendComponent: "DsX", props: ["a"] })), 1, "孤儿");
expectCase("dsspec 组件未被映射", runManifest("saas", (m) => (m.mapping.components = m.mapping.components.filter((c) => c.dsName !== "Table"))), 1, "未覆盖");
expectCase("criticScore<8 却不是 design-phase（放行了不该放行的）", runManifest("saas", (m) => (m.audit.criticScore = 7.5)), 1, "必须 design-phase");
expectCase("criticScore 与 Critic Report average 不一致", runManifest("saas", (m) => (m.audit.criticScore = 8.5)), 1, "average");
{
  const r = runManifest("saas", (m) => (m.audit.qaPassed = "L3 QA 37 PASS / 3 FAIL"));
  check(r.code === 0 && /WARN/.test(r.out), `qaPassed 声称 3 FAIL → 软告警（不阻塞）（exit=${r.code}）`);
  const s = runManifest("saas", (m) => (m.audit.qaPassed = "L3 QA 37 PASS / 3 FAIL"), ["--strict"]);
  check(s.code === 1, `同一份在 --strict 下必须失败（否则「样例必须干净」的门禁是空的）（exit=${s.code}）`);
}

/* ---------------- 7. QA7 冻结零修改 ---------------- */

{
  const f = path.join(TMP, "figma-plugin", "code.js");
  const orig = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, orig + "// 被改动\n");
  expectCase("冻结禁区被改动", run([]), 1, "冻结禁区零修改");
  fs.writeFileSync(f, orig);
  const clean = run([]);
  check(clean.code === 0, `恢复后重新变干净（证明这条检查是活的，不是恒报）（exit=${clean.code}）`);
}
{
  // 冻结态核不了时必须说核不了 —— 不许把「没查」写成「干净」
  const gitDir = path.join(TMP, ".git");
  const off = path.join(TMP, ".git-off");
  fs.renameSync(gitDir, off);
  const r = run([]);
  expectCase("无 .git 时冻结态必须明说核不了", r, 1, "无法核对");
  check(!/冻结禁区零修改（.*工作树干净/.test(r.out), "无 .git 时**不得**输出「工作树干净」");
  fs.renameSync(off, gitDir);
}

/* ---------------- 8. QA8 身份一致 ---------------- */

expectCase("project 与 brief.product.name 不符", runManifest("health", (m) => (m.project = m.project + " App")), 1, "product.name");
expectCase("随包副本换了项目", runManifest("saas", (m) => (m.exports.designSpec.brief = "assets/examples/example-highway.json")), 1, "同项目");

/* ---------------- 9. QA9 可追溯性 ---------------- */

expectCase("preset 源路径在预设里不存在", runManifest("saas", (m) => (tok(m, "tokens.color.brand.primary").source = "preset:enterprise-dashboard.visualSystem.nope")), 1, "可解析");
expectCase("preset 指向不存在的预设", runManifest("saas", (m) => (tok(m, "tokens.color.brand.primary").source = "preset:no-such-preset.visualSystem.primaryColor")), 1, "不存在");
expectCase("derived 源缺 @ 指向", runManifest("saas", (m) => (tok(m, "tokens.color.brand.hover").source = "derived:RD-1")), 1, "@<源 token>");
expectCase("derived 的 @ 指向不存在的 token", runManifest("saas", (m) => (tok(m, "tokens.color.brand.hover").source = "derived:RD-1@tokens.color.nope")), 1, "在 dsspec 中存在");

/* ---------------- 10. 参数与用法 ---------------- */

{
  const r = run(["--examples", path.join(TMP, "no-such-dir")]);
  check(r.code === 2, `不存在的目录 → exit 2（实际 ${r.code}）`);
  const empty = path.join(MUT, "empty");
  mkdirp(empty);
  const r2 = run(["--examples", empty]);
  check(r2.code === 2 && /没有找到/.test(r2.out), `空目录 → exit 2 且明说没找到（实际 exit=${r2.code}）`);
  const r3 = runManifest("saas", null, ["--quiet"]);
  check(r3.code === 0 && !/QA5/.test(r3.out), `--quiet 只出汇总（实际 exit=${r3.code}）`);
}
{
  // --freeze 覆盖生效：把禁区指到一个干净目录，脏的 figma-plugin 就不再参与判定
  const f = path.join(TMP, "figma-plugin", "code.js");
  const orig = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, orig + "// 脏\n");
  const r = run(["--freeze", "bridge"]);
  check(r.code === 0, `--freeze 覆盖生效（只查 bridge 时 exit 0）（实际 ${r.code}）`);
  fs.writeFileSync(f, orig);
}

/* ---------------- 汇总 ---------------- */

console.log("=".repeat(62));
for (const m of pass) console.log(`  PASS  ${m}`);
console.log("=".repeat(62));
if (fail.length) {
  for (const m of fail) console.log(`  FAIL  ${m}`);
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— qa-export 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— qa-export 变异测试 ALL GREEN`);
