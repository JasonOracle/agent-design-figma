#!/usr/bin/env node
/**
 * contract-usage-mutation.mjs — `contract-usage.mjs` 的配套变异测试（1.3 · F4 第 3 步）
 *
 * 为什么必须有（`references/lessons.md` #33）：**校验器没有配套变异测试，它的「全绿」就没有意义**。
 * 本工具尤其需要 —— 它的判据是「每个契约字段要么有消费者、要么在 UNUSED_OK 里写明理由」，
 * 而这条判据**可以因为空白而恒真**：`UNUSED_OK` 空着但恰好所有字段都「在用」时它也是绿的。
 * 所以下面每一条都成对出现：一个「该拦的拦住了」，一个「不该拦的放过了」。
 *
 * 沙箱做法：把**真实的** `figma-plugin/code.js` 复制进临时目录，`tools/` 下只放
 * 本工具的副本 + 自造的小探针。这样契约解析走的是真文件（含两个下限守卫），
 * 而 UNUSED_OK 用文本替换改写 —— 因为待测的正是那段清单本身。
 *
 * 10 类：
 *   判据一致 2：自动补齐所有零引用/弱引用字段 ⇒ 通过（且 `unused`/`weak` 两份清单**完备**，
 *              少一个字段就会因为「没写理由」而失败 —— 这条同时是那两份清单的完备性断言）·
 *              **反向对照**：清单空 ⇒ 必须拦（证明上一条的「通过」不是判据空转）
 *   判据① 1：理由为纯空白 ⇒ 拦（空话等于没写）
 *   判据② 1：清单里塞一个契约里不存在的键 ⇒ 拦（防清单腐烂）
 *   判据③ 1：**反向控制** —— 清单里放一个**已被消费**的字段 ⇒ 拦（否则「全塞进清单」就能全绿）
 *   解析守卫 3：字面量字段（id/name/type/width/x）真的被解析出来且出处标对
 *              —— **这条就是本工具第一版那个「缩进写死导致 7 个字段被静默漏掉」的回归测试** ·
 *              `styleInfo` 改名 ⇒ **退出码 2**（不是 0 —— 解析失败绝不许静默变成绿）·
 *              契约整体退化（字段数 < 下限）⇒ 退出码 2
 *   语义 1：注释与字符串里出现字段名**不算**消费（只被 JSDoc/模板串提到的字段仍是「零引用」）
 *   形状 1：`--json` 的字段齐备
 *
 * 用法：node tools/contract-usage-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TOOL_SRC = fs.readFileSync(path.join(HERE, "contract-usage.mjs"), "utf8");
const REAL_CODE = fs.readFileSync(path.join(REPO, "figma-plugin", "code.js"), "utf8");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "contract-usage-mut-"));
fs.mkdirSync(path.join(FX, "tools"), { recursive: true });
fs.mkdirSync(path.join(FX, "figma-plugin"), { recursive: true });
fs.writeFileSync(path.join(FX, "figma-plugin", "code.js"), REAL_CODE, "utf8");

/* 沙箱里只放一个消费方：读 `cornerRadius`（真 code.js 有该字段）。其余字段一律零引用。 */
fs.writeFileSync(
  path.join(FX, "tools", "probe.mjs"),
  "export const r = (n) => n.cornerRadius;\n",
  "utf8",
);

/**
 * 把工具里的 `const UNUSED_OK = { … };` 换成给定正文。
 * 用大括号配对而不是找 `};` —— 清单里的理由字符串含 `{horizontal:FIXED}` 这类花括号。
 */
function patchUnusedOk(src, body) {
  const at = src.indexOf("const UNUSED_OK = {");
  if (at === -1) throw new Error("找不到 UNUSED_OK（工具结构变了？）");
  const open = src.indexOf("{", at);
  let depth = 0;
  let end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) throw new Error("UNUSED_OK 大括号不配对");
  return src.slice(0, open + 1) + "\n" + body + "\n" + src.slice(end);
}

/** 写一份打好补丁的工具，返回其路径。`code` 可覆盖 code.js（测解析守卫用）。 */
function install(body, code) {
  const p = path.join(FX, "tools", "contract-usage.mjs");
  fs.writeFileSync(p, patchUnusedOk(TOOL_SRC, body), "utf8");
  if (code !== undefined) fs.writeFileSync(path.join(FX, "figma-plugin", "code.js"), code, "utf8");
  else fs.writeFileSync(path.join(FX, "figma-plugin", "code.js"), REAL_CODE, "utf8");
  return p;
}

function run(args = []) {
  const r = spawnSync(process.execPath, [path.join(FX, "tools", "contract-usage.mjs"), ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const json = (r) => {
  try { return JSON.parse(r.out); } catch (_) { return null; }
};

/* ====================================================================
 *  一、判据一致 / 反向对照
 * ==================================================================== */

// 1 用工具自己报出的「零引用 + 弱引用」两份清单去补齐 UNUSED_OK ⇒ 必须通过。
//   ⚠️ 这条同时断言那两份清单是**完备**的：漏掉任一字段，它就会因为「没写理由」而失败。
let autoBody;
let blankBody;
let allFields;
{
  // ⚠️ 空清单传 `""` 而不是 `"{}"`：patchUnusedOk 保留外层花括号，塞 `{}` 会变成
  //    对象字面量里嵌一个块语句 ⇒ **SyntaxError**（第一版就是这么把自己写崩的）。
  install("");
  const r0 = run(["--json"]);
  const rep0 = json(r0);
  check(rep0 && Array.isArray(rep0.unused) && Array.isArray(rep0.weak), "1 首次运行能拿到 unused / weak 清单");
  allFields = [...(rep0?.unused || []), ...(rep0?.weak || [])];
  check(allFields.length > 0, `1 清单非空（实际 ${allFields.length} 个字段）`);
  const entry = (f, reason) => `  ${JSON.stringify(f)}: ${JSON.stringify(reason)},`;
  autoBody = allFields.map((f) => entry(f, "夹具理由：本沙箱里没有判据在读它")).join("\n");
  // 只把**第 2 个**字段的理由写成纯空白，其余正常 —— 这样失败信息能指向具体那一个
  blankBody = allFields.map((f, i) => entry(f, i === 1 ? "   " : "夹具理由")).join("\n");

  install(autoBody); // ⚠️ 别忘了把补丁装上再跑（第一版忘了这行，于是「第二次运行」仍在用空清单）
  const r = run(["--json"]);
  const rep = json(r);
  check(r.status === 0, `1 补齐后退出码 0（实际 ${r.status}）\n${r.out}`);
  check(rep && rep.violations.length === 0, "1 violations 为空");
  check(rep && rep.counts.unused + rep.counts.weak === allFields.length, "1 补齐的条目数与清单长度一致（清单没漏字段）");
}

// 2 **反向对照**：清单空着 ⇒ 必须拦。证明第 1 条的「通过」不是判据空转。
{
  install("");
  const r = run([]);
  check(r.status === 1, `2 清单空时退出码 1（实际 ${r.status}）`);
  check(/fillCount/.test(r.out), "2 信息里点名了某个零引用字段（fillCount）");
  check(/UNUSED_OK/.test(r.out), "2 信息里指向 UNUSED_OK");
}

/* ====================================================================
 *  二、判据①②③
 * ==================================================================== */

// 3 判据①后半：理由为纯空白 ⇒ 拦（空话等于没写）
{
  install(blankBody);
  const r = run([]);
  check(r.status === 1, `3 有字段的理由是空白时退出码 1（实际 ${r.status}）`);
  check(/理由.*空/.test(r.out), "3 信息说明「理由是空的」");
  check(new RegExp(allFields[1]).test(r.out), `3 信息点名是哪个字段（${allFields[1]}）`);
}

// 4 判据②：清单里塞一个契约里不存在的键 ⇒ 拦（防清单腐烂 —— 字段改名/删掉后清单没跟着改）
{
  install(`${autoBody}\n  noSuchFieldInContract: "随便编的",`);
  const r = run([]);
  check(r.status === 1, `4 契约里没有的键 ⇒ 退出码 1（实际 ${r.status}）`);
  check(/noSuchFieldInContract/.test(r.out) && /不在契约里/.test(r.out), "4 信息点名该键并说明「不在契约里」");
}

// 5 判据③（**反向控制**）：清单里放一个**已被消费**的字段 ⇒ 拦。
//   没有这条，一个「把字段全塞进清单」的 UNUSED_OK 也能全绿。
{
  install(`${autoBody}\n  cornerRadius: "它其实已经被 probe.mjs 读过了",`);
  const r = run([]);
  check(r.status === 1, `5 已被消费的字段写进清单 ⇒ 退出码 1（实际 ${r.status}）`);
  check(/cornerRadius/.test(r.out) && /已经有属性访问/.test(r.out), "5 信息点名该字段并说明「已经有属性访问」");
  check(/probe\.mjs/.test(r.out), "5 并把读到它的文件也列出来（人可当场复核）");
}

/* ====================================================================
 *  三、解析守卫（本工具第一版就栽在这里）
 * ==================================================================== */

// 6 字面量字段真的被解析出来 —— **第一版用 `/^\s{2}([\w$]+):/`，真实缩进是 4 空格，
//   于是 id/name/type/width/height/x/y 七个字段被静默漏掉，而报告照样给结论。这条是那个 bug 的回归测试。**
{
  install(autoBody);
  const r = run(["--json"]);
  const rep = json(r);
  const rows = (rep && rep.rows) || [];
  const byField = new Map(rows.map((x) => [x.field, x]));
  for (const f of ["id", "name", "type", "width", "height", "x", "y"]) {
    check(byField.has(f), `6 字面量字段 ${f} 出现在契约里（缩进改动不得再让它消失）`);
  }
  check(byField.get("id")?.where === "nodeInfo(literal)", "6 id 的出处标为 nodeInfo(literal)");
  check(byField.get("layoutSizing")?.where === "styleInfo", "6 layoutSizing 的出处标为 styleInfo");
  check(rows.length >= 25, `6 契约字段数不少于下限（实际 ${rows.length}）`);
}

// 7 解析失败必须**响亮**：`styleInfo` 改名 ⇒ 退出码 2（绝不是 0）
{
  install(autoBody, REAL_CODE.replace("function styleInfo(node) {", "function renamedStyleInfo(node) {"));
  const r = run([]);
  check(r.status === 2, `7 解析不到 styleInfo 时退出码 2（实际 ${r.status}）`);
  check(/契约解析失败/.test(r.out), "7 打印「契约解析失败」而不是给出一份空契约");
}

// 8 契约整体退化（字段数低于下限）⇒ 退出码 2。
//   否则「解析到 2 个字段 ⇒ 无违规 ⇒ 绿」——那种绿是假绿。
{
  const tiny = [
    "function styleInfo(node) { const out = {}; out.aa = 1; return out; }",
    "function nodeInfo(node, opts) { const info = {\n    id: node.id,\n    name: node.name,\n    type: node.type,\n    width: 1,\n    height: 1,\n    x: 1,\n  };\n  return info;\n}",
  ].join("\n");
  install(autoBody, tiny);
  const r = run([]);
  check(r.status === 2, `8 契约退化时退出码 2（实际 ${r.status}）`);
  check(/明显不对|下限/.test(r.out), "8 信息说明字段数低于下限");
}

/* ====================================================================
 *  四、语义：注释与字符串里的字段名不算「消费」
 * ==================================================================== */

// 9 一个只在 JSDoc / 模板串里提到字段名的文件，不得把它算成「有人读」——
//   否则「零引用清单」会漏掉真该收编的字段（本仓库第 5 次踩「代理指标」这个主题）。
{
  install(autoBody);
  fs.writeFileSync(
    path.join(FX, "tools", "commenter.mjs"),
    [
      "/**",
      " * 这段注释里写着 vectorData / vectorPathCount，还有 `fillCount`。",
      " */",
      "export const msg = `回读里可能有 vectorData 字段`;",
      "// vectorData",
      "",
    ].join("\n"),
    "utf8",
  );
  const r = run(["--json"]);
  const rep = json(r);
  const rows = (rep && rep.rows) || [];
  const vd = rows.find((x) => x.field === "vectorData");
  check(vd && vd.verdict === "无", `9 只被注释/字符串提到 ⇒ 仍判「无」（实际 ${vd && vd.verdict}）`);
  check(vd && (vd.usedBy || []).length === 0, "9 且 usedBy 为空（commenter.mjs 不算消费者）");
  fs.rmSync(path.join(FX, "tools", "commenter.mjs"), { force: true });
}

/* ====================================================================
 *  五、`--json` 形状
 * ==================================================================== */

// 10 报告字段齐备（下游要按这些键取数，缺了会静默变 undefined）
{
  install(autoBody);
  const r = run(["--json"]);
  const rep = json(r);
  for (const k of ["counts", "rows", "unused", "weak", "unusedOk", "violations", "caution", "consumerScope"]) {
    check(rep && Object.prototype.hasOwnProperty.call(rep, k), `10 --json 里有 ${k}`);
  }
  check(rep && rep.rows.every((x) => x.field && x.where && x.verdict), "10 每一行都有 field / where / verdict");
  check(rep && rep.counts.contract === rep.rows.length, "10 counts.contract 与 rows 长度一致");
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
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— contract-usage 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— contract-usage 变异测试 ALL GREEN（判据三条 + 两条反向控制 + 解析守卫）`);
