#!/usr/bin/env node
/**
 * release-guard-mutation.mjs — release-guard.mjs 的配套变异测试（1.3 · B5 + B6）
 *
 * 两条方向都要（`references/lessons.md` #33）：
 *   【能抓错】把六条检查逐条做坏，断言**该条** FAIL，其余不误伤；
 *   【不误报】注入**合法的**状态，断言 PASS —— 本文件里最要紧的一条是 **#9 反向对照**：
 *             `VERSION` 与 CHANGELOG 顶部 `-dev` 段**不相等**但序关系正确时必须 PASS。
 *             因为 B5 在候选清单里的原始前提就是错的（它想校「两者一致」），
 *             而 `CHANGELOG.md` 第 7–11 行明写两者**语义不同、允许并存**。
 *             若不钉住这一条，下一次有人"顺手"把它改成校相等，测试不会出声。
 *
 * 另有一条专门钉**「核不了必须说核不了」**（#61/#72）：非 git 目录下 E/F 必须进 `unchecked`，
 * 退出码默认 0 但**结论行必须写明「N 项没查成（不是通过）」**；加 `--strict` 才阻塞。
 *
 * 用法：node tools/release-guard-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "release-guard.mjs");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "release-mut-"));

const GOOD_CL = [
  "## [1.3.0-dev] — 未发布",
  "",
  "### 开工第一刀",
  "",
  "## [1.2.0] — 2026-09-17",
  "",
  "### 收尾",
  "",
  "## [1.1.0] — 2026-09-16",
  "",
].join("\n");

function sh(dir, cmd, extra = []) {
  return spawnSync("git", [...cmd, ...extra], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "mut", GIT_AUTHOR_EMAIL: "mut@x", GIT_COMMITTER_NAME: "mut", GIT_COMMITTER_EMAIL: "mut@x" },
  });
}

/**
 * 造一个假仓库。
 * `tagAt` 用于第 8 例：先以 VERSION=tagAt 提交、打 tag，再改成 `version` 提交（不重打）⇒ 落点不一致。
 */
function makeRepo({ version = "1.2.0", changelog = GOOD_CL, tag = "v1.2.0", tagAt = null, git = true, dirName } = {}) {
  const dir = fs.mkdtempSync(path.join(FX, "r-"));
  if (version !== null) fs.writeFileSync(path.join(dir, "VERSION"), version, "utf8");
  if (changelog !== null) fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog, "utf8");
  if (!git) return dir;

  sh(dir, ["init", "-q"]);
  if (tagAt !== null) {
    // 第一步：以「旧版本」提交并打 tag
    fs.writeFileSync(path.join(dir, "VERSION"), tagAt, "utf8");
    sh(dir, ["add", "-A"]);
    sh(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "release"]);
    if (tag) sh(dir, ["tag", tag]);
    // 第二步：把 VERSION 改成新版本再提交（tag 留在旧提交上）
    fs.writeFileSync(path.join(dir, "VERSION"), version, "utf8");
    sh(dir, ["add", "-A"]);
    sh(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "bump"]);
    return dir;
  }
  sh(dir, ["add", "-A"]);
  sh(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "release"]);
  if (tag) sh(dir, ["tag", tag]);
  return dir;
}

function run(dir, extra = []) {
  const r = spawnSync(process.execPath, [TOOL, "--root", dir, ...extra], { encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* --json 的纯净性由第 12 例单独断言 */
  }
  return { status: r.status, out, json };
}

/** 取某条检查的结果（PASS/FAIL），找不到返回 undefined。 */
const verdictOf = (json, id) => {
  if (!json) return undefined;
  const c = json.checks.find((x) => x.id === id);
  if (c) return c.ok;
  const u = json.unchecked.find((x) => x.id === id);
  return u ? "unchecked" : undefined;
};

/* ====================================================================
 *  能抓错：六条检查逐条做坏
 * ==================================================================== */

// 1 健康仓库 —— 基线（后面的每一例都相对它）
{
  const d = makeRepo();
  const { status, json } = run(d, ["--json"]);
  check(status === 0, `1 健康仓库退出码 0（实际 ${status}）`);
  check(json && json.checks.length === 6 && json.checks.every((c) => c.ok), "1 六条检查全 PASS");
  check(json && json.unchecked.length === 0, "1 无未核对项");
  check(json && json.tag === "v1.2.0", "1 拼出的 tag 名为 v1.2.0");
}

// 2 VERSION 不是合法 semver ⇒ 只有 A 挂
{
  const { status, json } = run(makeRepo({ version: "1.2" }), ["--json"]);
  check(status === 1, `2 非法 VERSION 退出码 1（实际 ${status}）`);
  check(verdictOf(json, "A") === false, "2 A FAIL");
  check(verdictOf(json, "B") === "unchecked" && verdictOf(json, "C") === "unchecked", "2 版本号读不出来时 B/C 记未核对（**不许编一个「CHANGELOG 没段」的错理由**）");
  check(verdictOf(json, "D") === "unchecked", "2 D 同样记未核对");
  check(verdictOf(json, "E") === "unchecked", "2 E 转为未核对（拼不出 tag 名）");
}

// 3 CHANGELOG 里没有当前版本的定版段 ⇒ B 挂
{
  const cl = ["## [1.3.0-dev] — 未发布", "", "## [1.1.0] — 2026-09-16", ""].join("\n");
  const { status, json } = run(makeRepo({ changelog: cl }), ["--json"]);
  check(verdictOf(json, "B") === false, "3 B FAIL（VERSION=1.2.0 却无 [1.2.0] 段）");
  check(status === 1, "3 退出码 1");
  check(verdictOf(json, "D") === true, "3 D 仍 PASS（1.3.0-dev > 1.2.0）—— 单条坏不误伤他条");
}

// 4 版本段顺序被插反（小的在上、大的在下）⇒ C 挂
{
  const cl = ["## [1.2.0] — 2026-09-17", "", "## [1.3.0-dev] — 未发布", ""].join("\n");
  const { json } = run(makeRepo({ changelog: cl }), ["--json"]);
  check(verdictOf(json, "C") === false, "4 C FAIL（1.2.0 之后又出现 1.3.0）");
}

// 5 顶部 -dev 段版本 <= VERSION ⇒ D 挂（B5 的真形态：序关系，不是相等）
{
  const cl = ["## [1.2.0-dev] — 未发布", "", "## [1.2.0] — 2026-09-17", ""].join("\n");
  const { status, json } = run(makeRepo({ changelog: cl }), ["--json"]);
  check(verdictOf(json, "D") === false, "5 D FAIL（顶部 -dev 段 1.2.0 不大于 VERSION 1.2.0）");
  check(verdictOf(json, "B") === true, "5 B 仍 PASS（[1.2.0] 定版段确实存在）");
  check(status === 1, "5 退出码 1");
}

// 6 根本没打 tag ⇒ E 挂，且 F 如实转未核对（无落点可查）
{
  const { status, json } = run(makeRepo({ tag: null }), ["--json"]);
  check(verdictOf(json, "E") === false, "6 E FAIL（v1.2.0 不存在）");
  check(verdictOf(json, "F") === "unchecked", "6 F 转未核对，而不是「当作通过也不 FAIL」（无落点就是核不了）");
  check(status === 1, "6 退出码 1");
  check(json && /发版后须打 tag/.test(JSON.stringify(json.checks)), "6 FAIL 的说明里给出该怎么修");
}

// 7 tag 打在 VERSION 还没更新的提交上 ⇒ F 挂（抓"落点不纯"里可机械判的那一半）
{
  const { status, json } = run(makeRepo({ tagAt: "1.1.0" }), ["--json"]);
  check(verdictOf(json, "E") === true, "7 E PASS（tag 存在）");
  check(verdictOf(json, "F") === false, "7 F FAIL（tag 处 VERSION=1.1.0 ≠ 工作区 1.2.0）");
  check(status === 1, "7 退出码 1");
}

/* ====================================================================
 *  不误报：合法状态必须 PASS
 * ==================================================================== */

// 8 **反向对照（本文件最要紧的一条）**：VERSION 与 CHANGELOG 顶部**不相等**但序关系正确 ⇒ 全绿
//    B5 的原始前提「不校两者一致」是错的；CHANGELOG 第 7–11 行明写两者语义不同、允许并存。
//    钉住它，是为了下一次有人把它「顺手改成校相等」时测试会出声。
{
  const { status, json } = run(makeRepo(), ["--json"]);
  check(json && json.version === "1.2.0" && json.changelogSections[0].label === "1.3.0-dev", "8 前置成立：VERSION=1.2.0 而顶部段是 1.3.0-dev（**两者不相等**）");
  check(status === 0 && json.checks.every((c) => c.ok), "8 不相等但序关系正确 ⇒ 六条全 PASS（**校的是序关系，不是相等**）");
  check(json && /不校「VERSION 与 CHANGELOG 顶部相等」/.test(json._meta.judged), "8 JSON 里写明所校的是序关系（免得下游误读成「相等校验」）");
}

// 9 同版本的多份子段（`1.2.0` 与 `1.2.0 · D2 运行 A`）允许并存 —— 不得因"重复"报 C
{
  const cl = ["## [1.3.0-dev] — 未发布", "", "## [1.2.0] — 2026-09-17", "", "## [1.2.0 · D2 运行 A] — 2026-09-17", "", "## [1.1.0] — 2026-09-16", ""].join("\n");
  const { json } = run(makeRepo({ changelog: cl }), ["--json"]);
  check(verdictOf(json, "C") === true, "9 同版本子段（带 ` · ` 后缀）判为不增，不误报");
  check(json && json.changelogSections.length === 4, "9 四段全部解析到（含带后缀的）");
}

// 10 非 git 目录 ⇒ E/F 如实"未核对"，默认不阻塞、结论行不得说成"通过"
{
  const d = makeRepo({ git: false });
  const { status, out, json } = run(d, ["--json"]);
  check(status === 0, `10 无 git 时默认退出码 0（未核对不阻塞，实际 ${status}）`);
  check(verdictOf(json, "E") === "unchecked" && verdictOf(json, "F") === "unchecked", "10 E/F 均记未核对");
  check(json && json.summary.unchecked === 2, "10 汇总里未核对计数为 2");

  const t = run(d);
  check(/2 项没查成/.test(t.out) && !/发版一致性 OK/.test(t.out), "10 文本结论写「2 项没查成」而**不是**「OK」——不把没查折算为通过");
}

// 11 `--strict` 下未核对阻塞
{
  const d = makeRepo({ git: false });
  const { status } = run(d, ["--json", "--strict"]);
  check(status === 1, `11 --strict 下有未核对 ⇒ 退出码 1（实际 ${status}）`);
  const ok = run(makeRepo(), ["--json", "--strict"]);
  check(ok.status === 0, "11 --strict 下全绿仍为 0（strict 不误伤健康仓库）");
}

/* ====================================================================
 *  JSON 契约
 * ==================================================================== */

// 12 `--json` 是机器可读的：stdout 必须**只**是 JSON（#82：成品工具说可读就得真可读）
{
  const r = spawnSync(process.execPath, [TOOL, "--root", makeRepo(), "--json"], { encoding: "utf8" });
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    /* 下面断言会报 */
  }
  check(parsed !== null, "12 `--json` 的 stdout 可被 JSON.parse 直接吃掉（无尾随人话）");
  check(parsed && ["tool", "version", "tag", "changelogSections", "checks", "unchecked", "summary"].every((k) => k in parsed), "12 关键字段齐备");
  check(parsed && parsed.summary.pass + parsed.summary.fail === parsed.checks.length, "12 summary 的 PASS/FAIL 计数与 checks 长度自洽");
}

// 13 用法错误 ⇒ 退出码 2（`--root` 指向不存在的目录时不得静默按仓库根跑）
{
  const r = spawnSync(process.execPath, [TOOL, "--root", path.join(FX, "does-not-exist"), "--json"], { encoding: "utf8" });
  const j = (() => {
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  })();
  check(j !== null && verdictOf(j, "A") === false, "13 目录不存在 ⇒ A FAIL（找不到 VERSION），而不是回落到仓库根");
  check(r.status === 1, `13 退出码 1（实际 ${r.status}）`);
}

/* ---------------- 汇总 ---------------- */

fs.rmSync(FX, { recursive: true, force: true });

const bar = "=".repeat(62);
console.log(bar);
if (!fail.length) console.log(`  PASS  ${pass.length} 例`);
else for (const m of pass) console.log(`  PASS  ${m}`);
for (const m of fail) console.log(`  FAIL  ${m}`);
console.log(bar);
if (fail.length) {
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— release-guard 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— release-guard 变异测试 ALL GREEN（能抓错、不误报、核不了就说核不了）`);
