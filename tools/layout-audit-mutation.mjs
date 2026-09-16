#!/usr/bin/env node
/**
 * layout-audit-mutation.mjs — layout-audit.mjs 的配套变异测试（1.2 · D2 运行 B 收编）
 *
 * 为什么要有这个文件：`qa-l2` 的教训（references/lessons.md #33）——**校验器没有配套变异测试，
 * 它的「全绿」就没有意义**。本工具是 1.2 五个校验器里**最后一个补上变异测试的**，
 * 而它恰恰是最需要的一个：D2 运行 B 里它先后**假阳性 293 条 → 213 → 256 → 21 → 5 → 1**，
 * 每一次都是「判定所依赖的**前提**不成立」，而不是「阈值写错了」。
 * 一个只会数数的审计器，报出的 0 与「没在跑」无法区分；而一个前提错误的审计器，
 * 报出的 256 条会**淹没**那 2 条真的。
 *
 * 所以本文件有两个方向，缺一不可：
 *   【能抓错】注入真实缺陷，断言报出且退出码非 0 —— 防「规则空转」；
 *   【不误报】注入**合法的**布局模式（叠画/底板/数据驱动刻度/网格相邻/合成页根），
 *             断言**不报** —— 这是本文件比其它 mutation 更重的一半。
 *
 * 覆盖 22 类：
 *   应抓错 10：spacing 越档 · padding 越档 · radius 越档 · font-size 越档 · 轻微错位 ·
 *              触摸区不足 · 子级越出父级 · 页框不符基准（含 1px 边界）· 兄弟文字重叠 · 重复兄弟
 *   应放过 7：文字压自己底板 · 仪表盘同心圆叠画 · 折线压网格线 · 等距刻度（数据驱动）·
 *             等距网格线（数据驱动）· 二维网格对角"伪相邻" · 合成页根（子节点同原点，跳过）
 *   留痕 5：关检查项时进 unchecked · 未给 --baseline 时进 unchecked ·
 *          数据驱动免检进 dataDrivenSpacing（非静默）· 输入无字段时如实声明「没查」·
 *          反向对照：字段存在时不得虚报为「没查」
 *
 * ⚠️ 写这个文件时踩的两个坑（留在这里当告示，因为它们会让测试「永远 FAIL 且看不出原因」）：
 *   ① 退出码只由 **high** 决定（`process.exit(high > 0 ? 1 : 0)`）。
 *      spacing / padding / radius / font-size / alignment / 小幅 overflow 都是 medium，
 *      **报出但不改退出码**。对它们断言 `status === 1` 是错的，要断言**输出文字**。
 *   ② 不能拿 `!/spacing/` 当断言 —— 控制台永远会打印「已启用 … spacing …」，
 *      任何对元信息行的否定匹配都恒为 false。必须裁掉元信息行再看问题正文（见 issuesBlock）。
 *
 * 用法：node tools/layout-audit-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "layout-audit.mjs");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "layout-mut-"));
let n = 0;

/**
 * 造一棵树。约定：node 用 `{name,type,x,y,width,height,children}`，
 * 缺省 type=FRAME、children=[]。父级若不写坐标，子级坐标就是相对父级的（本工具正是这样测的）。
 */
const T = (o) => ({ type: "FRAME", ...o, children: o.children || [] });

/** 常用：一个 400x300 的容器，内边距 24，用于 padding/font 类用例 */
const box = (kids, extra = {}) => T({ name: "Root", width: 400, height: 300, ...extra, children: kids });
const leaf = (name, x, y, w, h, extra = {}) => ({ name, type: "TEXT", x, y, width: w, height: h, ...extra });

const BASE = ["--baseline", "400x300"];
const SCALE = ["--scale", "2,4,8,16,24"];
const FONT = ["--font", "14,20,22,26"];
const RAD = ["--radius", "2,4"];
const TOUCH = ["--min-touch", "44"];
const ALL = [...BASE, ...SCALE, ...FONT, ...RAD, ...TOUCH];

function run(tree, args = ALL) {
  const p = path.join(FX, `t${n++}.json`);
  fs.writeFileSync(p, JSON.stringify(tree, null, 2), "utf8");
  const r = spawnSync(process.execPath, [TOOL, p, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/**
 * ⚠️ 断言的两个陷阱（第一版全踩了，记下来免得下次再踩）：
 *
 * ① **退出码只由 high 决定**（`process.exit(high > 0 ? 1 : 0)`）。
 *    spacing / padding / radius / font-size / alignment / overflow(小幅) 都是 medium，
 *    它们**报出但不改退出码** —— 这是刻意的（这些是"值得看一眼"，不是"结构崩了"）。
 *    所以对 medium 类缺陷断言 `status === 1` 是错的，必须断言**输出文字里有没有它**。
 *
 * ② **不能拿 `!/spacing/` 当断言**。控制台永远会打印
 *    `已启用  spacing / padding / … / overlap / duplicate`，
 *    于是任何 `!out.includes("overlap")` 都恒为 false —— 测试永远 FAIL，还看不出为什么。
 *    必须断言**问题清单**里没有它。下面的 `issuesBlock()` 就是干这个的：
 *    它裁掉「已启用 / 已免检 / 已跳过 / 未检查」这几行元信息，只留下问题正文。
 */
function issuesBlock(out) {
  return out
    .split("\n")
    .filter((l) => !/^(已启用|已免检|已跳过|未检查|档位|layout-audit)\s/.test(l.trim()))
    .join("\n");
}

/** 断「有问题」：出现在问题正文里 */
const reports = (r, check) => new RegExp(`\\[\\w+\\] ${check} `).test(issuesBlock(r.out));
/** 断「没问题」：问题正文里找不到该 check */
const silent = (r, check) => !new RegExp(`\\[\\w+\\] ${check} `).test(issuesBlock(r.out));

/* ====================================================================
 *  第一半：能抓错（10 类）—— 注入真实缺陷，必须报出
 * ==================================================================== */

// 1 spacing 越档：两个 24 高的块水平相隔 12（不在 [2,4,8,16,24]）
{
  const tree = box([
    T({ name: "A", width: 100, height: 24, x: 24, y: 24 }),
    T({ name: "B", width: 100, height: 24, x: 136, y: 24 }),
  ]);
  const r = run(tree);
  check(reports(r, "spacing"), `1 报出 spacing 违档\n${r.out}`);
  check(/12px 不在档位/.test(r.out), "1 间距数值正确（12）");
  check(r.status === 0, `1 spacing 是 medium，不改退出码（实际 ${r.status}）`);
}

// 2 padding 越档：显式声明 `padding.left=12`（不在档位）
//    ⚠️ 本检查读的是 Figma 在 auto-layout 上声明的字段，**不从子级坐标反推**。
//    实测 bridge 的 `get-node` 不返回 padding*，故真实管线里它不会触发；
//    这条用例只钉「字段存在时判得对」，另有一条（第 21 例）钉「字段不存在时要如实留痕」。
{
  const tree = box([], { padding: { top: 24, right: 24, bottom: 24, left: 12 } });
  const r = run(tree);
  check(reports(r, "padding"), `2 报出 padding 违档\n${r.out}`);
  check(/padding\.left=12/.test(r.out), "2 指出是 left 且值为 12");
}

// 3 radius 越档：圆角 6（不在 [2,4]）
{
  const tree = box([T({ name: "Card", width: 100, height: 100, x: 24, y: 24, cornerRadius: 6 })]);
  const r = run(tree);
  check(reports(r, "radius"), `3 报出 radius 违档\n${r.out}`);
}

// 4 font-size 越档：字号 16（不在 [14,20,22,26]）
{
  const tree = box([leaf("T", 24, 24, 200, 26, { fontSize: 16 })]);
  const r = run(tree);
  check(reports(r, "font-size"), `4 报出 font-size 违档\n${r.out}`);
  check(/\b16\b/.test(issuesBlock(r.out)), "4 报出的字号正是 16");
}

// 5 轻微错位：同列两块左边缘差 3px（超容差 1、且在 <=8 的"差一点点"区间）
{
  const tree = box([
    T({ name: "U", width: 100, height: 40, x: 24, y: 24 }),
    T({ name: "L", width: 100, height: 40, x: 27, y: 72 }),
  ]);
  const r = run(tree);
  check(reports(r, "alignment"), `5 报出 alignment 轻微错位\n${r.out}`);
  check(/差 3px/.test(r.out), "5 报出的偏差正是 3px");
}

// 6 触摸区不足：可点元素 36x36 < 44（high，改退出码）
{
  const tree = box([T({ name: "Btn", width: 36, height: 36, x: 24, y: 24, itemType: "INTERACTIVE" })]);
  const r = run(tree);
  check(r.status === 1, `6 触摸区不足退出 1（实际 ${r.status}）`);
  check(reports(r, "touch"), "6 报出 touch 类问题");
}

// 7 子级越出父级（溢出 100px，high）
{
  const tree = box([T({ name: "Wide", width: 500, height: 40, x: 24, y: 24 })]);
  const r = run(tree);
  check(r.status === 1, `7 子级越出父级退出 1（实际 ${r.status}）`);
  check(reports(r, "overflow"), "7 报出 overflow 类问题");
}

// 8 页框不符基准（超出容差才报）
//    ⚠️ 陷阱：容差默认 1px，判定是 `dw > TOL`，所以**差 1px 是允许的**（1 > 1 为假）。
//    第一版拿 401 vs 400 测，正好踩在边界上判成"工具坏了"。
//    要测这类阈值，样本必须**离边界足够远**（这里用 30px），否则测的是舍入不是逻辑。
{
  const tree = T({ name: "Root", width: 430, height: 300, children: [] });
  const r = run(tree);
  check(r.status === 1, `8 页框不符基准退出 1（实际 ${r.status}）`);
  check(reports(r, "baseline"), "8 报出 baseline 类问题");
  // 边界行为本身也钉一下，免得以后有人把 > 改成 >= 而无人察觉
  const b = run(T({ name: "Root", width: 401, height: 300, children: [] }));
  check(silent(b, "baseline"), "8 边界：差 1px 在容差内，不报（`dw > TOL` 而非 `>=`）");
}

// 9 兄弟文字重叠（TEXT×TEXT，重叠 20x10，high）
{
  const tree = box([
    leaf("一个较长的标题", 24, 24, 120, 20),
    leaf("另一个压上来的标题", 134, 30, 120, 20),
  ]);
  const r = run(tree);
  check(r.status === 1, `9 兄弟文字重叠退出 1（实际 ${r.status}）`);
  check(reports(r, "overlap"), "9 报出 overlap 类问题");
  check(/一个较长的标题/.test(r.out) && /另一个压上来的标题/.test(r.out), "9 两个文件名都出现在报出里");
}

// 10 重复兄弟：像素级重合（同 name+type+x+y+w+h，high）
{
  const dup = { name: "Dup", type: "RECTANGLE", width: 50, height: 50, x: 24, y: 24 };
  const tree = box([{ ...dup }, { ...dup }]);
  const r = run(tree);
  check(r.status === 1, `10 重复兄弟退出 1（实际 ${r.status}）`);
  check(reports(r, "duplicate"), "10 报出 duplicate 类问题");
}

/* ====================================================================
 *  第二半：不误报（7 类）—— 注入**合法的**布局模式，必须悄无声息
 *  这一半是整个文件的重点：D2 运行 B 的 293 条假阳性全出在这里。
 * ==================================================================== */

// 11 文字压在自己底板上（正常图层结构）—— 不得报 overlap
{
  const tree = box([
    T({ name: "Tab/实时", type: "RECTANGLE", width: 96, height: 44, x: 24, y: 24, cornerRadius: 4 }),
    leaf("实时", 44, 34, 56, 24, { fontSize: 14 }),
  ]);
  const r = run(tree);
  check(r.status === 0, `11 文字压底板放行退出 0（实际 ${r.status}）\n${r.out}`);
  check(silent(r, "overlap"), "11 未误报 overlap（文字×底板是图层结构）");
}

// 12 仪表盘同心圆叠画（Track/Arc/Hole 三层同心）—— 不得报 overlap
{
  const tree = box([
    T({ name: "Gauge/Track", type: "ELLIPSE", width: 176, height: 176, x: 24, y: 24 }),
    T({ name: "Gauge/Arc", type: "ELLIPSE", width: 176, height: 176, x: 24, y: 24 }),
    T({ name: "Gauge/Hole", type: "ELLIPSE", width: 130, height: 130, x: 47, y: 47 }),
  ]);
  const r = run(tree);
  check(silent(r, "overlap"), `12 未误报 overlap（同心圆是刻意的叠画）\n${r.out}`);
}

// 13 折线压网格线（VECTOR 压 RECTANGLE）—— 不得报 overlap
{
  const tree = box([
    T({ name: "Grid/1", type: "RECTANGLE", width: 352, height: 1, x: 24, y: 80 }),
    T({ name: "Trend/Line", type: "VECTOR", width: 352, height: 160, x: 24, y: 60 }),
  ]);
  const r = run(tree);
  check(silent(r, "overlap"), `13 未误报 overlap（折线压网格线是正常的）\n${r.out}`);
}

// 14 等距刻度（数据驱动）：5 个时间刻度，间隔 175/175/177/177 —— 不得报 spacing
//    这正是运行 B 残留假阳性的场景：同带内纯数值名字，间隔由「绘图区 ÷ 刻度数」决定。
//    注意刻度宽度故意不做成完全相等（39/39/37/37/39），模拟真实文本计量 —— 靠的是**间隙**等距。
{
  const kids = ["00:00", "06:00", "12:00", "18:00", "24:00"].map((t, i) =>
    leaf(t, 24 + i * 214, 260, i === 2 || i === 3 ? 37 : 39, 17, { fontSize: 14 }),
  );
  const tree = box(kids);
  const r = run(tree);
  check(silent(r, "spacing"), `14 未误报 spacing（等距时间刻度）\n${r.out}`);
  check(/已免检/.test(r.out), "14 免检动作被留痕（不是静默吞掉）");
}

// 15 等距网格线（数据驱动）：11 条竖网格线，间隔 40 —— 不得报 spacing
//    注意父级宽度要容得下（不能顺带触发 overflow，那会干扰本用例的语义）
{
  const kids = Array.from({ length: 11 }, (_, i) =>
    T({ name: `Grid/V${i + 1}`, type: "RECTANGLE", width: 1, height: 200, x: 24 + i * 41, y: 40 }),
  );
  const tree = T({ name: "Root", width: 460, height: 300, children: kids });
  const r = run(tree, [...BASE, ...SCALE, ...FONT, ...RAD, ...TOUCH].map((a, i, arr) => (a === "400x300" ? "460x300" : a)));
  check(silent(r, "spacing"), `15 未误报 spacing（等距竖网格线）\n${r.out}`);
  check(silent(r, "overflow"), "15 网格线全在父级内，未误报 overflow");
}

// 16 二维网格里的"伪相邻"：两行两列，单轴排序会把对角排成邻居，
//    但它们跨轴并不重叠 —— 算出来的"间距"是行距/列距，不是设计间距。不得报 spacing。
{
  const kids = [];
  for (let r0 = 0; r0 < 2; r0++)
    for (let c0 = 0; c0 < 2; c0++)
      kids.push(T({ name: `Cell/${r0}-${c0}`, width: 60, height: 60, x: 24 + c0 * 160, y: 24 + r0 * 160 }));
  const tree = T({ name: "Root", width: 400, height: 400, children: kids });
  const r = run(tree, [...SCALE, ...FONT, ...RAD, ...TOUCH, "--baseline", "400x400"]);
  check(silent(r, "spacing"), `16 未误报 spacing（网格对角非真相邻）\n${r.out}`);
  check(silent(r, "overlap"), "16 网格元素不重叠，未误报 overlap");
}

// 17 合成页根（5 个独立组件帧各自 x=0,y=0）—— overlap/duplicate 必须**跳过**且留痕，
//    而不是报出「它们全都重叠」。
{
  const kids = Array.from({ length: 5 }, (_, i) =>
    T({ name: `DS/Comp/${i}`, width: 200, height: 100, x: 0, y: 0, children: [T({ name: `Inner${i}`, width: 50, height: 50, x: 0, y: 0 })] }),
  );
  const tree = T({ name: "SyntheticRoot", width: 400, height: 300, children: kids });
  const r = run(tree);
  check(r.status === 0, `17 合成页根退出 0（实际 ${r.status}）\n${r.out}`);
  check(silent(r, "overlap"), "17 未误报 overlap（同原点兄弟不构成排布）");
  check(/已跳过/.test(r.out) && /overlap \/ duplicate/.test(r.out), "17 跳过动作被留痕（不是静默全绿）");
}

/* ====================================================================
 *  第三半：留痕（3 类）—— 「我没查」与「查了没问题」必须可分辨
 * ==================================================================== */

// 18 关掉检查项 -> 必须出现在 unchecked 里，且确实不再报
{
  const tree = box([
    leaf("一个较长的标题", 24, 24, 120, 20),
    leaf("另一个压上来的标题", 134, 30, 120, 20),
  ]);
  const r = run(tree, [...ALL, "--no-overlap", "--no-duplicate"]);
  check(/未检查/.test(r.out) && /overlap/.test(r.out) && /duplicate/.test(r.out), `18 关掉的检查项进「未检查」清单\n${r.out}`);
  check(silent(r, "overlap"), "18 关掉后确实不再报 overlap 问题（对照片：同一份数据不关时就报）");
  // 同一份数据、不关检查 —— 必须报，否则上一条「关掉后不报」说明不了任何事
  const r2 = run(tree, ALL);
  check(reports(r2, "overlap"), "18 对照：同一份数据不关检查时确实报 overlap（证明断言有效）");
}

// 19 不给 --baseline -> baseline 进 unchecked（不是静默通过）
{
  const tree = T({ name: "Root", width: 400, height: 300, children: [] });
  const r = run(tree, [...SCALE, ...FONT, ...RAD, ...TOUCH]);
  check(/未检查/.test(r.out) && /baseline/.test(r.out), `19 未给 --baseline 时进「未检查」\n${r.out}`);
}

// 20 数据驱动免检必须写进报告（--json），且列出组数 —— 21 条假阳性被吃掉这件事要可复核
{
  const kids = ["00:00", "06:00", "12:00", "18:00", "24:00"].map((t, i) =>
    leaf(t, 24 + i * 214, 260, 39, 17, { fontSize: 14 }),
  );
  const tree = box(kids);
  const r = run(tree, [...ALL, "--json"]);
  let rep = null;
  try { rep = JSON.parse(r.out); } catch { /* 下面断言会报 */ }
  check(!!rep, "20 --json 输出可解析");
  if (rep) {
    check(!!rep.dataDrivenSpacing, "20 报告含 dataDrivenSpacing 段（免检非静默）");
    check(
      rep.dataDrivenSpacing && rep.dataDrivenSpacing.rows.some((x) => /纯数值|时间/.test(x.shape) && x.count === 5),
      "20 免检明细里列出了「纯数值/时间 ×5」这一组",
    );
    check(Array.isArray(rep.unchecked) && typeof rep.checksEnabled === "object", "20 报告含 unchecked / checksEnabled");
  }
}

// 21 输入不具备该字段时，必须**如实声明没查**，而不是打出「已启用 padding」让人误以为查过了。
//    这是运行 B 结案时实测出来的真缺口：377 个节点、bridge get-node 任何参数组合都不返回 padding*，
//    layoutMode 全为 NONE —— 于是 padding / itemSpacing 两条检查**结构性地一次都不会触发**，
//    但旧版头部照样打印「已启用 … padding」，把「没看」卖成了「干净」。
{
  const tree = box([T({ name: "Child", width: 100, height: 100, x: 24, y: 24 })]); // 无 padding 字段、无 auto-layout
  const r = run(tree, [...ALL, "--json"]);
  let rep = null;
  try { rep = JSON.parse(r.out); } catch { /* 落空则下面断言会报 */ }
  check(!!rep, "21 --json 可解析");
  if (rep) {
    check(rep.checksEnabled.padding === false, "21 无 padding 字段时 checksEnabled.padding 为 false（不再虚报已启用）");
    check(
      rep.unchecked.some((s) => /^padding/.test(s) && /输入无/.test(s)),
      "21 padding 进 unchecked 且注明「输入无该字段」",
    );
    check(rep.inputCoverage && rep.inputCoverage.paddingNodes === 0, "21 报告含 inputCoverage 原始计数（结论可复核）");
  }
  // 文本模式同样要说清楚，且与「命令行关掉」区分开
  const r2 = run(tree);
  check(/输入不具备/.test(r2.out), `21 文本模式打印「输入不具备」段\n${r2.out}`);
  check(!/已启用.*padding/.test(r2.out), "21 文本模式的「已启用」里不再含 padding");
}

// 22 反向对照：字段**存在**时不得进 unchecked（否则「输入不具备」就成了永久噪音，没人会再看它）
{
  const tree = box([], { padding: { top: 24, right: 24, bottom: 24, left: 24 } });
  const r = run(tree, [...ALL, "--json"]);
  let rep = null;
  try { rep = JSON.parse(r.out); } catch { /* 落空则下面断言会报 */ }
  check(!!rep && rep.checksEnabled.padding === true, "22 有 padding 字段时 checksEnabled.padding 为 true");
  check(!!rep && !rep.unchecked.some((s) => /^padding/.test(s)), "22 有字段时 padding 不进 unchecked");
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
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— layout-audit 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— layout-audit 变异测试 ALL GREEN（能抓错、不误报、跳过留痕）`);
