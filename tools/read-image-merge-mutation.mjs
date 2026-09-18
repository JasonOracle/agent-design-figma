#!/usr/bin/env node
/**
 * read-image-merge-mutation.mjs — `read-image-merge.mjs`（A3）+ `qa-critic` QA9 接线的配套变异测试
 *
 * 为什么必须有（`references/lessons.md` #33 / #48）：校验器没有变异测试，它的「全绿」就没有意义。
 * 本工具尤其需要 —— 「记录合格」的判据**可以因为输入恰好完整而恒真**，所以每条判据都成对出现：
 * 一个「该拦的拦住了」，一个「不该拦的放过了」。
 *
 * 分两层：
 *   纯函数（直接 import —— IS_MAIN 哨兵保证 import 零副作用，lessons.md #88）：
 *     validateReview  —— 12 类：全覆盖基线 · 缺条目=没查 · 清单外 id · verdict 枚举 ·
 *                        ok/issue 缺 evidence · n-a 缺 note · issue 缺 dimension（WARN 不 ERROR）·
 *                        checklist 常量 · 版本格式 · mode 互斥 · images 非空 · id 重复
 *     mergeReport     —— structured-only 拒绝 · 缺 _evidence 拒绝 · 派生计数 · **幂等**（重跑逐字节一致）·
 *                        保留既有非自动观察 · 记录变更后旧自动条目被替换
 *     reviewSha       —— 内容指纹随 items 变化
 *   CLI（spawnSync，真工具真文件）：
 *     --check 合格 → 0 · 不合格 → 1 · --out 与 --report 同路径 → 2 ·
 *     合并产物再 --check 指纹通过 · **防合并后改记录**（改 review 指纹 → 1）·
 *     **qa-critic QA9 接线**：合格 → QA9 PASS 且退出 0 · 坏记录 → 退出 1 ·
 *     structured-only 报告配读图记录 → 拦（伪造档位）·
 *     **#48 反向对照**：QA9 对 structured-only 报告**不提供 --review** 时不得误报 FAIL（基线零扰动）
 *
 * 用法：node tools/read-image-merge-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateReview, mergeReport, deriveFromReview, reviewSha, EXPECTED_IDS } from "./read-image-merge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "read-image-merge-mut-"));

/* ---------------- 夹具 ---------------- */

const items = (over = {}) => {
  const base = [];
  const DIMS = ["Layout", "Color", "Consistency", "Commercial", "Usability"];
  for (let i = 1; i <= 11; i++) {
    const id = `R${i}`;
    base.push(
      {
        id,
        verdict: i <= 3 ? "ok" : i <= 5 ? "issue" : "n-a",
        ...(i <= 5 ? { evidence: `看了 ${id} 对应区域，未见异常` } : {}),
        ...(i <= 5 ? { dimension: DIMS[i - 1] } : {}),
        ...(i > 5 ? { note: `本产物无 ${id} 的检查对象` } : {}),
      },
    );
  }
  for (const [idx, patch] of Object.entries(over)) base[Number(idx)] = { ...base[Number(idx)], ...patch };
  return base;
};
const review = (over = {}) => ({
  checklist: "read-image-checklist",
  checklistVersion: "1.0.0",
  mode: "structured+vision",
  images: ["page-01.png"],
  items: items(over.items),
  ...over,
});
const report = (over = {}) => ({
  project: "示例产品",
  page: "Page 1",
  action: "PASS",
  _evidence: {
    mode: "structured+vision",
    visionObservations: [],
    unassessed: [],
    ...(over.evidence || {}),
  },
  ...(over.top || {}),
});

/* ---------------- validateReview 纯函数 ---------------- */

{
  const { errors, warnings } = validateReview(review());
  check(errors.length === 0, `判据基线：完整记录 0 error（实际 ${errors.join(" | ")}）`);
  check(warnings.length === 0, `判据基线：完整记录 0 warning`);
}

{
  const items2 = items();
  items2.splice(3, 1); // 拿掉 R4
  const { errors } = validateReview(review({ items: items2 }));
  check(errors.some((e) => e.includes("R4") && e.includes("未覆盖")), `判据「缺条目=没查」：删 R4 必须拦（实际 ${errors[0] || "未拦"}）`);
}

{
  const items2 = items();
  items2.push({ id: "R12", verdict: "ok", evidence: "x" });
  const { errors } = validateReview(review({ items: items2 }));
  check(errors.some((e) => e.includes("R12")), `判据「清单外 id」：R12 必须拦（清单条目可增不可删，版本对齐）`);
}

{
  const { errors } = validateReview(review({ items: items({ 1: { verdict: "maybe" } }) }));
  check(errors.some((e) => e.includes("R2") && e.includes("verdict")), `判据「verdict 枚举」：maybe 必须拦`);
}

{
  const { errors } = validateReview(review({ items: items({ 0: { evidence: "" } }) }));
  check(errors.some((e) => e.includes("R1") && e.includes("evidence")), `判据「ok 缺 evidence」：空串必须拦（没写=没查）`);
}

{
  const { errors } = validateReview(review({ items: items({ 6: { note: "  " } }) }));
  check(errors.some((e) => e.includes("R7") && e.includes("note")), `判据「n-a 缺 note」：纯空白必须拦（无对象必须给理由）`);
}

{
  const { errors, warnings } = validateReview(review({ items: items({ 3: { dimension: null } }) }));
  check(errors.length === 0 && warnings.some((w) => w.includes("R4")), `判据「issue 缺 dimension」：WARN 不是 ERROR（Schema 原文「建议填写」）`);
}

{
  const { errors } = validateReview(review({ checklist: "other-checklist" }));
  check(errors.some((e) => e.includes("checklist")), `判据「清单常量」：改 checklist 名必须拦`);
}

{
  const { errors } = validateReview(review({ checklistVersion: "1.0" }));
  check(errors.some((e) => e.includes("checklistVersion")), `判据「版本格式」：非语义版本必须拦`);
}

{
  const { errors } = validateReview(review({ mode: "structured-only" }));
  check(errors.some((e) => e.includes("mode")), `判据「mode 互斥」：structured-only 的读图记录必须拦（伪造档位）`);
}

{
  const { errors } = validateReview(review({ images: [] }));
  check(errors.some((e) => e.includes("images")), `判据「images 非空」：没图可回放必须拦`);
}

{
  const items2 = items();
  items2.push({ ...items2[0] });
  const { errors } = validateReview(review({ items: items2 }));
  check(errors.some((e) => e.includes("重复")), `判据「id 重复」：必须拦`);
}

check(EXPECTED_IDS.length === 11 && EXPECTED_IDS[0] === "R1" && EXPECTED_IDS[10] === "R11", `守卫：清单 1.0.0 = R1–R11（11 条）`);

/* ---------------- mergeReport 纯函数 ---------------- */

{
  let threw = null;
  try {
    mergeReport(report({ evidence: { mode: "structured-only" } }), review());
  } catch (e) {
    threw = e;
  }
  check(threw && threw.message.includes("structured+vision"), `合并守卫①：structured-only 报告拒绝落读图观察（伪造档位）`);
}

{
  let threw = null;
  try {
    mergeReport({ project: "x" }, review());
  } catch (e) {
    threw = e;
  }
  check(threw && threw.message.includes("_evidence"), `合并守卫②：缺 _evidence（档位未声明）拒绝合并`);
}

{
  const r = mergeReport(report(), review());
  const vis = r._evidence.visionObservations;
  const un = r._evidence.unassessed;
  check(vis.length === 5 && vis.every((v) => v.source === "read-image-review"), `合并派生①：ok3+issue2 = 5 条观察，全部带 source 留痕`);
  check(un.length === 6 && un.every((s) => s.includes("n-a") && s.includes("R")), `合并派生②：n-a 6 条进 unassessed，且带 id 可追溯`);
  check(r._evidence.readImageMerge.checklistVersion === "1.0.0" && r._evidence.readImageMerge.sha256 === reviewSha(review()), `合并派生③：落痕含版本与内容指纹`);
}

{
  const once = mergeReport(report(), review());
  const twice = mergeReport(once, review());
  check(JSON.stringify(once) === JSON.stringify(twice), `合并幂等：同 report × 同 review 重跑结果逐字节一致（#74 漂移拦截）`);
}

{
  const existing = [{ id: "X1", verdict: "issue", evidence: "人工观察，非自动", source: "human" }];
  const r = mergeReport(report({ evidence: { visionObservations: existing } }), review());
  check(r._evidence.visionObservations.filter((v) => v.id === "X1").length === 1, `合并保真：既有非自动观察不被吞掉`);
}

{
  const r1 = mergeReport(report(), review());
  const changed = review({ items: items({ 3: { dimension: "Usability" } }) });
  const r2 = mergeReport(r1, changed);
  const entry = r2._evidence.visionObservations.find((v) => v.id === "R4");
  check(entry && entry.dimension === "Usability", `合并更新：记录变更后自动条目被替换为新内容（不残留旧值）`);
  check(r1._evidence.readImageMerge.sha256 !== r2._evidence.readImageMerge.sha256, `合并更新②：内容指纹随记录变化`);
}

{
  const { observations } = deriveFromReview(review());
  check(observations.length === 5, `deriveFromReview：与 mergeReport 的观察数一致`);
}

/* ---------------- CLI ---------------- */

const reviewPath = path.join(FX, "read-image-review.json");
const reportPath = path.join(FX, "critic-report.json");
const outPath = path.join(FX, "merged.json");
fs.writeFileSync(reviewPath, JSON.stringify(review(), null, 2));
/* CLI/QA9 层的报告夹具取**真实样例**（example-saas）改档位 —— 极简夹具会死于 QA1 Schema，
   那是无关噪音；真实样例保证 QA1–QA8 基线绿，QA9 的进出才可判。 */
const SAMPLE = JSON.parse(fs.readFileSync(path.join(HERE, "..", "assets", "examples", "example-saas", "critic-report.json"), "utf8"));
const SAMPLE_VISION = {
  ...SAMPLE,
  _evidence: { ...(SAMPLE._evidence || {}), mode: "structured+vision" },
  _meta: { ...(SAMPLE._meta || {}), reviewer: "mutation fixture (structured+vision；A3 变异测试夹具)" },
};
fs.writeFileSync(reportPath, JSON.stringify(SAMPLE_VISION, null, 2));

const run = (args) => spawnSync(NODE, [path.join(HERE, "read-image-merge.mjs"), ...args], { encoding: "utf8" });

{
  const r = run(["--report", reportPath, "--review", reviewPath, "--check"]);
  check(r.status === 0, `CLI --check：合格记录退出 0（实际 ${r.status}：${(r.stderr || "").slice(0, 120)}）`);
}

{
  const bad = path.join(FX, "bad-review.json");
  fs.writeFileSync(bad, JSON.stringify(review({ items: items({ 2: { evidence: "" } }) }), null, 2));
  const r = run(["--report", reportPath, "--review", bad, "--check"]);
  check(r.status === 1 && r.stderr.includes("R3"), `CLI --check：R3 缺 evidence 退出 1 且点名`);
}

{
  const r = run(["--report", reportPath, "--review", reviewPath, "--out", reportPath]);
  check(r.status === 2, `CLI 守卫：--out 与 --report 同路径退出 2（绝不覆盖原始报告）`);
}

{
  const r = run(["--report", reportPath, "--review", reviewPath, "--out", outPath]);
  check(r.status === 0 && fs.existsSync(outPath), `CLI 合并：正常写出`);
  const merged = JSON.parse(fs.readFileSync(outPath, "utf8"));
  check(merged._evidence.visionObservations.length === 5, `CLI 合并产物：观察 5 条落地`);
  const re = run(["--report", outPath, "--review", reviewPath, "--check"]);
  check(re.status === 0, `CLI 回核：合并产物 --check 指纹通过（实际 ${(re.stderr || "").slice(0, 120)}）`);
}

{
  // 防合并后改记录：产物已落指纹 A，喂记录 B → 必须拦
  const changed = path.join(FX, "changed-review.json");
  fs.writeFileSync(changed, JSON.stringify(review({ items: items({ 0: { evidence: "被人事后改过的证据" } }) }), null, 2));
  const r = run(["--report", outPath, "--review", changed, "--check"]);
  check(r.status === 1 && r.stderr.includes("指纹"), `CLI 防篡改：落痕后改记录必须拦（指纹不一致）`);
}

/* ---------------- qa-critic QA9 接线 ---------------- */

const QAC = path.join(HERE, "qa-critic.mjs");
const runQa = (args) => spawnSync(NODE, [QAC, "--report", reportPath, "--quiet", ...args], { encoding: "utf8" });

{
  // 正例必须用**合并后的产物**：QA9 会交叉核对 n-a ⊆ unassessed —— 原始样例还没落痕，本就该 FAIL
  const r = spawnSync(NODE, [QAC, "--report", outPath, "--review", reviewPath], { encoding: "utf8" });
  check(r.status === 0 && r.stdout.includes("QA9"), `QA9 接线①：合并产物 + 合格记录 → 退出 0 且 QA9 有产出（实际 ${r.status}）`);
}

{
  const bad = path.join(FX, "bad2.json");
  fs.writeFileSync(bad, JSON.stringify(review({ items: items().slice(0, 9) }), null, 2));
  const r = runQa(["--review", bad]);
  check(r.status === 1, `QA9 接线②：缺 2 条记录 → 退出 1（缺一条=没查）`);
}

{
  const soReport = path.join(FX, "so-report.json");
  fs.writeFileSync(soReport, JSON.stringify(report({ evidence: { mode: "structured-only" } }), null, 2));
  const r = spawnSync(NODE, [QAC, "--report", soReport, "--quiet", "--review", reviewPath], { encoding: "utf8" });
  check(r.status === 1, `QA9 接线③：structured-only 报告配读图记录 → 拦（伪造档位）`);
}

{
  const r = spawnSync(NODE, [QAC, "--report", outPath], { encoding: "utf8" });
  // ⚠️ 不能用 includes("FAIL") —— 汇总行「0 FAIL / 0 WARN」自带 FAIL 字样；明细行的形态是「  FAIL  …」
  const hasFailLine = /^  FAIL  /m.test(r.stdout);
  check(r.status === 0 && !hasFailLine && r.stdout.includes("QA9"), `#48 反向对照：不提供 --review 时 QA9 只 WARN 不 FAIL（未核对不得折算为通过，但也不阻塞）`);
}

{
  const r = spawnSync(NODE, [QAC, "--quiet"], { encoding: "utf8" });
  const baselineOk = r.status === 0;
  check(baselineOk, `基线零扰动①：qa-critic 无参数（三样例）仍退出 0`);
  check(!r.stdout.includes("QA9"), `基线零扰动②：三样例（structured-only）不触发 QA9`);
}

/* ---------------- 汇总 ---------------- */

const bar = "=".repeat(62);
console.log(bar);
for (const m of pass) console.log(`  PASS  ${m}`);
if (fail.length) {
  console.log(bar);
  for (const m of fail) console.log(`  FAIL  ${m}`);
  console.error(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— read-image-merge 变异测试未通过`);
  fs.rmSync(FX, { recursive: true, force: true });
  process.exit(1);
}
console.log(bar);
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— read-image-merge（A3）+ QA9 接线全部例通过`);
fs.rmSync(FX, { recursive: true, force: true });
