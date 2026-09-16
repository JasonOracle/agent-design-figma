#!/usr/bin/env node
/**
 * check-refs-mutation.mjs — check-refs.mjs 的配套变异测试（1.2 · A4）
 *
 * 为什么要有这个文件：`qa-l2` 的教训（references/lessons.md #33）——**校验器没有配套变异测试，
 * 它的「全绿」就没有意义**。一个永远报 0 悬空的检查器，与一个永远报 0 的摆设无法区分。
 *
 * 做法：在临时目录里造两个样本仓库，把「应该被抓」和「不该误报」的引用逐条喂进去，
 * 断言 check-refs.mjs 的**输出与退出码**都符合预期。
 *
 * 覆盖 9 类引用形态：
 *   应报（悬空）3：命令式缺脚本 · 裸名全局无同名 · 相对路径缺文件
 *   应豁免     6：真实路径 · basename 兜底 · glob · 运行时产物 · 点路径 · 角度占位符
 *   另有 1 类「整篇跳过」：开发者内部文档（`<版本号>-*.md`）允许引用包外文件
 *
 * 用法：node tools/check-refs-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, "check-refs.mjs");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "check-refs-mut-"));
const write = (rel, content) => {
  const p = path.join(FX, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
};

/* ---------------- 样本 A：含已知错误 + 全部豁免类 ---------------- */

write("references/real.md", "# real\n");
write("tools/ok.mjs", "// ok\n");
write("manifest.json", "{}\n"); // 2 段点路径 —— 必须走正常解析，不得被点路径豁免
write(
  "references/doc.md",
  [
    "1 真实相对路径：`references/real.md`",
    "2 basename 兜底：`ok.mjs`",
    "3 glob 通配：`references/*.md`",
    "4 命令式缺脚本：`node tools/run.mjs`",
    "5 裸名全局无同名：`ghost.md`",
    "6 相对路径缺文件：`references/missing.md`",
    "7 运行时产物豁免：`.vibe/runtime-capability.json`",
    "8 点路径豁免：`tokens.radius.md`",
    "9 角度占位符剥除：`node <skill 根目录>/tools/ok.mjs`",
    "10 二段点路径是真文件：`manifest.json`",
  ].join("\n") + "\n",
);
// 开发者内部文档：允许引用包外文件，整篇跳过
write("9.9-plan.md", "包外引用：`docs/upstream/never-exists.md` 与 `tools/zzz.py`\n");

const runA = spawnSync(process.execPath, [CHECKER, "--root", FX], { encoding: "utf8" });
const outA = `${runA.stdout}${runA.stderr}`;
const danglingOf = (out) =>
  out
    .split(/\r?\n/)
    .filter((l) => l.includes("FAIL  "))
    .map((l) => l.split("→")[1]?.trim())
    .filter(Boolean);
const bad = danglingOf(outA);

check(runA.status === 1, `样本A 退出码为 1（实际 ${runA.status}）`);
check(bad.length === 3, `样本A 恰好报 3 条悬空（实际 ${bad.length}：${bad.join(" / ") || "无"}）`);
for (const ref of ["tools/run.mjs", "ghost.md", "references/missing.md"]) {
  check(bad.some((b) => b.endsWith(ref) || b === ref), `样本A 抓到应报项 ${ref}`);
}
for (const ref of ["references/real.md", "ok.mjs", "references/*.md", ".vibe/runtime-capability.json", "tokens.radius.md", "manifest.json"]) {
  check(!bad.some((b) => b.includes(ref)), `样本A 未误报豁免项 ${ref}`);
}
check(!outA.includes("never-exists.md") && !outA.includes("tools/zzz.py"), "样本A 开发者内部文档（9.9-plan.md）整篇跳过");
check(/运行时=1/.test(outA), "样本A 运行时豁免计数 = 1（规则真的生效，不是空转）");
check(/点路径=1/.test(outA), "样本A 点路径豁免计数 = 1");

/* ---------------- 样本 B：干净样本（反向用例） ---------------- */

write("references/clean.md", "只有落地引用：`references/real.md`、`node tools/ok.mjs`\n");
fs.rmSync(path.join(FX, "references/doc.md"));
fs.rmSync(path.join(FX, "9.9-plan.md"));

const runB = spawnSync(process.execPath, [CHECKER, "--root", FX], { encoding: "utf8" });
const outB = `${runB.stdout}${runB.stderr}`;
check(runB.status === 0, `样本B 干净样本退出码为 0（实际 ${runB.status}）`);
check(/DOC REFS ALL GREEN/.test(outB), "样本B 输出 ALL GREEN");

/* ---------------- 汇总 ---------------- */

fs.rmSync(FX, { recursive: true, force: true });

const bar = "=".repeat(62);
console.log(bar);
if (!fail.length) console.log(`  PASS  ${pass.length} 例`);
else for (const m of pass) console.log(`  PASS  ${m}`);
for (const m of fail) console.log(`  FAIL  ${m}`);
console.log(bar);
if (fail.length) {
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— check-refs 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— check-refs 变异测试 ALL GREEN（能抓错、不误报）`);
