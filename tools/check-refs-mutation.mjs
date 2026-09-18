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
 * 覆盖 15 类引用形态（1.3 · B4 收紧后）：
 *   应报（悬空）4：命令式缺脚本 · 裸名全局无同名 · 相对路径缺文件 · **带目录但目录错**
 *   应豁免/解析 10：真实路径 · basename 兜底 · glob · 运行时产物 · 点路径 · 角度占位符 · 后缀式提及 ·
 *     **部署路径（`~/…`）** · **占位符根（`/skill/…`）** · **产物类型名（templates 有同名）**
 *   应报歧义 1：**同名多份 → WARN**（列全部候选，不改退出码）
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
write("assets/templates/thing.json", "{}\n"); // 产物类型定义 —— 裸名 `thing.json` 应判 artifact
write("a/dup.json", "{}\n"); // 同名多份之一
write("b/dup.json", "{}\n"); // 同名多份之二 —— 裸名 `dup.json` 应报歧义
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
    "11 后缀式提及（扩展名，不是文件）：`.dsspec.json`",
    "12 带目录但目录错（B4 收紧后应 FAIL）：`wrong/dir/ok.mjs`",
    "13 部署路径豁免：`node ~/.workbuddy/skills/x/tools/ok.mjs`",
    "14 占位符根豁免：`/skill/bridge/ok.mjs`",
    "15 产物类型名（templates 有同名 ⇒ 落点为定义）：`thing.json`",
    "16 同名多份（应 WARN，不改退出码）：`dup.json`",
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
check(bad.length === 4, `样本A 恰好报 4 条悬空（实际 ${bad.length}：${bad.join(" / ") || "无"}）`);
for (const ref of ["tools/run.mjs", "ghost.md", "references/missing.md", "wrong/dir/ok.mjs"]) {
  check(bad.some((b) => b.endsWith(ref) || b === ref), `样本A 抓到应报项 ${ref}`);
}
for (const ref of [
  "references/real.md",
  "ok.mjs",
  "references/*.md",
  ".vibe/runtime-capability.json",
  "tokens.radius.md",
  "manifest.json",
  ".dsspec.json",
  "thing.json",
  "dup.json",
  "~/.workbuddy/skills/x/tools/ok.mjs",
  "/skill/bridge/ok.mjs",
]) {
  // 精确匹配（容 `./` 前缀）。用子串匹配会误伤：应报项 `wrong/dir/ok.mjs` 里含豁免项 `ok.mjs`
  check(!bad.some((b) => b === ref || b === `./${ref}`), `样本A 未误报豁免项 ${ref}`);
}
check(!outA.includes("never-exists.md") && !outA.includes("tools/zzz.py"), "样本A 开发者内部文档（9.9-plan.md）整篇跳过");
check(/运行时=1/.test(outA), "样本A 运行时豁免计数 = 1（规则真的生效，不是空转）");
check(/点路径=1/.test(outA), "样本A 点路径豁免计数 = 1");
check(/后缀=1/.test(outA), "样本A 后缀式提及豁免计数 = 1（规则真的生效，不是空转）");
check(/部署路径=1/.test(outA), "样本A 部署路径（~/…）豁免计数 = 1 —— B4 新增规则真的生效");
check(/占位符根=1/.test(outA), "样本A 占位符根（/skill/…）豁免计数 = 1 —— B4 新增规则真的生效");
check(/artifact=1/.test(outA), "样本A 产物类型名计数 = 1 —— 裸 `thing.json` 判为产物而非兜底");
check(/WARN.*dup\.json/.test(outA), "样本A 报出同名多份歧义 dup.json（不再静默取第一个）");
check(/同名 2 份/.test(outA) && /另有 b\/dup\.json/.test(outA), "样本A 歧义行列明份数与全部候选落点");

// 产物名的**落点**必须定为 templates 那份定义（这是 B4 修「假落点」的核心行为）
const runList = spawnSync(process.execPath, [CHECKER, "--root", FX, "--list"], { encoding: "utf8" });
const outList = `${runList.stdout}${runList.stderr}`;
check(
  /thing\.json\s+\[artifact\]\s+→\s+assets\/templates\/thing\.json/.test(outList),
  "样本A --list 下产物名落点为 assets/templates/thing.json（不是遍历顺序里的某个实例）",
);

/* ---------------- 样本 B：干净样本（反向用例） ---------------- */

write(
  "references/clean.md",
  "只有落地引用：`references/real.md`、`node tools/ok.mjs`\n剩余唯一待定项（同名多份，应 WARN 而非 FAIL）：`dup.json`\n",
);
fs.rmSync(path.join(FX, "references/doc.md"));
fs.rmSync(path.join(FX, "9.9-plan.md"));

const runB = spawnSync(process.execPath, [CHECKER, "--root", FX], { encoding: "utf8" });
const outB = `${runB.stdout}${runB.stderr}`;
check(runB.status === 0, `样本B 干净样本退出码为 0（实际 ${runB.status}）`);
check(/DOC REFS ALL GREEN/.test(outB), "样本B 输出 ALL GREEN");
check(/歧义 1/.test(outB), "样本B 歧义计数 = 1（dup.json 有两个同名文件）");
check(/另有 1 条指代歧义/.test(outB), "样本B 结尾如实标注「另有 1 条指代歧义」，不笼统宣称全绿");

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
