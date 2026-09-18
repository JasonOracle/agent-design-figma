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
 * 覆盖 48 类：
 *   应抓错 14：spacing 越档 · padding 越档 · radius 越档 · font-size 越档 · 轻微错位 ·
 *              触摸区不足 · 子级越出父级 · 页框不符基准（含 1px 边界）· 兄弟文字重叠 · 重复兄弟 ·
 *              **文本容器 textAutoResize=NONE · 两端对齐 JUSTIFIED · 字族数超上限 ·
 *              overflow 被 clipsContent 静默裁切时升 high**（末四项见「第四半」）
 *   应放过 11：文字压自己底板 · 仪表盘同心圆叠画 · 折线压网格线 · 等距刻度（数据驱动）·
 *             等距网格线（数据驱动）· 二维网格对角"伪相邻" · 合成页根（子节点同原点，跳过）·
 *             **textAutoResize=HEIGHT/WIDTH_AND_HEIGHT · textAlign=LEFT/CENTER/RIGHT ·
 *             字族数恰好等于上限（闭区间边界）· 无 clipsContent 时同样的 6px 溢出仍是 medium**
 *   留痕 14：关检查项时进 unchecked · 未给 --baseline 时进 unchecked ·
 *          数据驱动免检进 dataDrivenSpacing（非静默）· 输入无字段时如实声明「没查」·
 *          反向对照：字段存在时不得虚报为「没查」·
 *          **B1 · alignment 覆盖范围进 alignmentCoverage（compared / skippedCrossSizeDiff / samples）**·
 *          **B1 反向对照：放宽判据会得到 100% 假阳性 —— 居中对齐的不同高元素不得报 alignment**·
 *          **TRUNCATE 进 textTruncated 清单（是风险清单不是违规，不进 summary）**·
 *          **文本模式也打印「已截断文本」那行**· **字族上限设 0 时关检查且 checksEnabled 为 false**·
 *          **无 textAutoResize 字段 ⇒ unchecked 声明没查**· **无 clipsContent ⇒ 声明分级缺失**·
 *          **反向对照（测测试本身）：`--json` 输出喂 `reports()` 必须抛**
 *   参数同源 5（**1.3 · A2**）：从 L2 Spec 派生四项档位 · **反向对照（不给 `--spec` 时 22 确实会报，
 *          证明前一条的「不报」来自 spec 而非规则空转）** · CLI 覆盖 spec 且**逐项独立** ·
 *          spec 缺节时回落默认并如实写进 `paramGaps`（文本模式也打）· `--spec` 文件不存在判退出码 2
 *   几何覆盖率 4（**1.3 · A1**）：全层带几何时**不报**（反向对照，防「无条件报一条」）·
 *          部分几何时同一份报告既给「1 个容器」也给**「3 个节点未参与检查」**（容器数是代理指标，
 *          节点数才是规模；实测 depth:1 与 depth:2 都会报「1 个容器」而漏掉的分别是 1 与 3 个节点）·
 *          只根带几何时覆盖率 1/5 且可审深度 0 层 / 输入深 2 层（差值即截断位置）·
 *          文本模式同样打印这两行（不留 `--json` 独占 —— 人读的那份才是被归档的那份）
 *
 * ⚠️ 写这个文件时踩的三个坑（留在这里当告示，因为它们会让测试「永远 FAIL 且看不出原因」）：
 *   ① 退出码只由 **high** 决定（`process.exit(high > 0 ? 1 : 0)`）。
 *      spacing / padding / radius / font-size / alignment / 小幅 overflow 都是 medium，
 *      **报出但不改退出码**。对它们断言 `status === 1` 是错的，要断言**输出文字**。
 *   ② 不能拿 `!/spacing/` 当断言 —— 控制台永远会打印「已启用 … spacing …」，
 *      任何对元信息行的否定匹配都恒为 false。必须裁掉元信息行再看问题正文（见 issuesBlock）。
 *   ③ **`--json` 的输出不能喂给 `reports()` / `silent()`** —— JSON 里没有「问题正文」那种行，
 *      于是 `reports` 恒 false、`silent` 恒 true，**配着 `--json` 写的断言全部空转、恒 PASS**。
 *      这是最阴的一类错：它长得像绿。故 `issuesBlock()` 见到 JSON 直接抛（配第 48 例守）。
 *      用 `--json` 时改用 `parse(r).summary.byCheck` / `unchecked` 断言（见 `notInSummary`）。
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
  // ③（1.3 · F4 第 3 步补记的第三个坑）**`--json` 的输出喂不得这个函数**。
  //    JSON 是缩进过的（`      "check": "overflow",`），既不含 `[medium] overflow ` 这种问题正文行，
  //    也没有「已启用…」这些元信息行 —— 于是 `reports()` 恒 false、`silent()` 恒 true，
  //    **配着 `--json` 写的断言全都是空转的**（一组永远 PASS 的用例）。
  //    这类错比断言写错更危险：它长得像绿。故这里**直接抛**，把静默空转变成响亮失败。
  if (out.trim().startsWith("{")) {
    throw new Error(
      "issuesBlock/reports/silent 只能用于**文本模式**输出；`--json` 的结果请用 JSON.parse 断言 " +
        "（否则断言恒真/恒假，是空转的用例）",
    );
  }
  return out
    .split("\n")
    .filter(
      (l) => !/^(已启用|已免检|已跳过|已检查|已截断文本|未检查|对齐覆盖|几何覆盖|档位|参数来源|layout-audit|⚠)\s/.test(l.trim()),
    )
    .join("\n");
}

/** 断「有问题」：出现在问题正文里 */
const reports = (r, check) => new RegExp(`\\[\\w+\\] ${check} `).test(issuesBlock(r.out));
/** 断「没问题」：问题正文里找不到该 check */
const silent = (r, check) => !new RegExp(`\\[\\w+\\] ${check} `).test(issuesBlock(r.out));
/** 断「没问题」但输入是 `--json` 时用这个：从 summary.byCheck 里看（缺键 == 0 条） */
const notInSummary = (rep, check) => !rep || !rep.summary.byCheck[check];

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

// 23 B1 · `alignment` 的覆盖范围必须留痕（lessons #67c）
//    旧版有一句 `if (|prev[cross]-cur[cross]| > TOL) continue` —— 跨轴尺寸不同就跳过，
//    **既不上报也不计数**。于是一份只比了 3 对、和一份比了 900 对的报告，在产物里长得一样：
//    都写 `alignment: 0`。「没查」与「查了没问题」又一次不可分辨（#72 的同一类错）。
//    实测规模（运行 B readback）：真正比过 3 对，因跨轴尺寸不同**没比**的有 121 对。
{
  // 三个 24 高的块（跨轴尺寸相等）+ 一个 10 高的块（跨轴尺寸不同但视觉相邻）
  const tree = box([
    T({ name: "A", width: 100, height: 24, x: 24, y: 24 }),
    T({ name: "B", width: 100, height: 24, x: 24, y: 80 }),
    T({ name: "C", width: 100, height: 24, x: 24, y: 136 }),
    T({ name: "Dot", width: 10, height: 10, x: 24, y: 190 }), // 与 C 跨轴尺寸不同、但纵向相邻
  ]);
  const r = run(tree, [...ALL, "--json"]);
  let rep = null;
  try { rep = JSON.parse(r.out); } catch { /* 下面断言会报 */ }
  check(!!rep, "23 --json 可解析");
  if (rep) {
    check(!!rep.alignmentCoverage, "23 报告含 alignmentCoverage 段（覆盖范围非静默）");
    const ac = rep.alignmentCoverage;
    check(ac && ac.compared > 0, `23 compared 记录真正比过的对数（实际 ${ac && ac.compared}）`);
    check(
      ac && ac.skippedCrossSizeDiff >= 1,
      `23 跨轴尺寸不同而**没比**的对被计数（实际 ${ac && ac.skippedCrossSizeDiff}）`,
    );
    check(
      Array.isArray(ac && ac.samples) && ac.samples.some((s) => s.a === "C" && s.b === "Dot"),
      "23 没比的对子抽样存档，可被人复核（C vs Dot 应在列）",
    );
  }
  const r2 = run(tree);
  check(/对齐覆盖/.test(r2.out), `23 文本模式单列「对齐覆盖」行\n${r2.out}`);
  check(/没?比|未比/.test(r2.out), "23 该行同时说明「没比」的对数（不只讲比过多少）");
}

// 24 B1 反向对照：**放宽判据是错的** —— 这条断言是"防止未来把它'修'回去"的闸门。
//    跨轴尺寸不同的两个元素，视觉惯例是**居中**对齐。拿边缘去比是拿错了尺子：
//    运行 B 实测放宽后在 121 对里新增 5 条报告，**5 条全是假阳性**
//    （时间戳 27 高 vs 在线圆点 10 高 —— 圆点居中对齐文字，上边缘当然差 8px）。
//    故这里造一个**居中对齐**的合法布局：文字 20 高、圆点 8 高，圆点在文字垂直中线上。
//    正确行为：不得报 alignment。若将来有人把判据放宽成"跨轴有交集即比边缘"，本用例立刻 FAIL。
{
  const tree = box([
    // 文字 y=[24,44]（中心 34）；圆点 8 高，居中 ⇒ y=[30,38]（中心 34）
    leaf("文字", 24, 24, 200, 20, { fontSize: 14 }),
    T({ name: "Dot", type: "ELLIPSE", width: 8, height: 8, x: 240, y: 30 }),
  ]);
  const r = run(tree);
  check(
    silent(r, "alignment"),
    `24 居中对齐的不同高元素**不得**报 alignment（放宽判据的代价是 100% 假阳性）\n${issuesBlock(r.out)}`,
  );
  // 而且要能看出来"它没被边缘比对"这件事 —— 否则这条"不报"无法与人区分
  check(/因跨轴尺寸不同未比 [1-9]/.test(r.out), "24 该对子计入「未比」而不是被静默吞掉");
}

// 25-29 A2：闸门参数从 L2 Spec 派生。同一份 readback 换个档位就换个结论，
//        所以「参数从哪来」必须**可溯源**（#72② / #73）——手敲档位是那条教训的根因。
{
  const specPath = path.join(FX, "spec.json");
  const writeSpec = (o) => fs.writeFileSync(specPath, JSON.stringify(o, null, 2), "utf8");
  const tree = box([leaf("字", 24, 24, 200, 20, { fontSize: 22 })]);
  const treePath = path.join(FX, `spec-tree-${n++}.json`);
  fs.writeFileSync(treePath, JSON.stringify(tree, null, 2), "utf8");
  const runSpec = (extra) => {
    const r = spawnSync(process.execPath, [TOOL, treePath, ...extra], { encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, rep: r.stdout.trim().startsWith("{") ? JSON.parse(r.stdout) : null };
  };

  const FULL_SPEC = {
    tokens: {
      spacing: { base: { value: 8 }, scale: { value: "8/16/24" }, cardPadding: { value: 16 } },
      radius: { sm: { value: 2 }, md: { value: 4 } },
      typography: {
        display: { size: 26, lineHeight: 34 },
        heading: { size: 20, lineHeight: 28 },
        body: { size: 14, lineHeight: 20 },
        number: { size: 22, lineHeight: 29 },
      },
    },
    responsive: { baseline: "400x300 固定分辨率（合成样本）" },
    accessibility: {
      minFontSize: { value: 14 },
      touchTarget: { value: 0 },
      fontFamilyMax: { value: 5 },
    },
  };

  // 25 全字段：四项都从 spec 派生，手敲参数一个都不给
  writeSpec(FULL_SPEC);
  const a = runSpec(["--spec", specPath, "--json"]);
  check(
    JSON.stringify(a.rep.scales.spacing) === JSON.stringify([8, 16, 24]),
    `25 spacing 从 tokens.spacing 派生（实际 ${JSON.stringify(a.rep.scales.spacing)}）`,
  );
  check(
    JSON.stringify(a.rep.scales.radius) === JSON.stringify([2, 4]),
    `25 radius 从 tokens.radius 派生（实际 ${JSON.stringify(a.rep.scales.radius)}）`,
  );
  check(
    JSON.stringify(a.rep.scales.font) === JSON.stringify([14, 20, 22, 26]),
    `25 font 取 typography[].size 且**不含 lineHeight**（实际 ${JSON.stringify(a.rep.scales.font)}）`,
  );
  check(
    a.rep.scales.baseline && a.rep.scales.baseline.width === 400 && a.rep.scales.baseline.height === 300,
    `25 baseline 从 responsive.baseline 的自由文本里解出 WxH（实际 ${JSON.stringify(a.rep.scales.baseline)}）`,
  );
  check(
    a.rep.paramSource.scale === "spec:tokens.spacing" &&
      a.rep.paramSource.radius === "spec:tokens.radius" &&
      a.rep.paramSource.font === "spec:tokens.typography[].size" &&
      a.rep.paramSource.baseline === "spec:responsive.baseline",
    `25 paramSource 逐项标注来源（实际 ${JSON.stringify(a.rep.paramSource)}）`,
  );
  check(a.rep.paramGaps === null, "25 四项都派生到 ⇒ paramGaps 为 null（无缺口就不许编缺口）");
  check(
    !(a.rep.issues || []).some((i) => i.check === "font-size"),
    "25 fontSize=22 在 spec 字阶内 ⇒ 不报",
  );

  // 26 反向对照：同一棵树不给 --spec ⇒ 回落默认档位，22 越档会被报出来。
  //    没有这条，「25 不报」既可能是"用了 spec"，也可能是"规则空转"，两者无法区分。
  const b = runSpec(["--json"]);
  check(
    (b.rep.issues || []).some((i) => i.check === "font-size"),
    "26 反向对照：不给 --spec 时 22 越默认字阶、**确实被报** ⇒ 证明 25 的「不报」来自 spec",
  );
  check(
    b.rep.paramSource.scale === "default" && b.rep.paramSource.baseline === "none",
    `26 反向对照：paramSource 如实标 default / none（实际 ${JSON.stringify(b.rep.paramSource)}）`,
  );

  // 27 优先级：显式 CLI 覆盖 spec，且**逐项独立**（不一体降级）
  const c = runSpec(["--spec", specPath, "--radius", "6,8", "--json"]);
  check(
    JSON.stringify(c.rep.scales.radius) === JSON.stringify([6, 8]) && c.rep.paramSource.radius === "cli:--radius",
    `27 显式 --radius 优先于 spec 派生（实际 ${JSON.stringify(c.rep.scales.radius)} / ${c.rep.paramSource.radius}）`,
  );
  check(
    c.rep.paramSource.scale === "spec:tokens.spacing",
    "27 只覆盖 radius，其余仍来自 spec（逐项独立）",
  );

  // 28 spec 缺节：回落默认 + **如实标注缺口**，不许静默用默认值冒充「来自规格」
  writeSpec({ tokens: { radius: { sm: { value: 2 } } }, responsive: {} });
  const d = runSpec(["--spec", specPath, "--json"]);
  check(
    d.rep.paramSource.scale === "default" && d.rep.paramSource.font === "default",
    "28 spec 缺 tokens.spacing / typography ⇒ 这两项标 default",
  );
  check(
    !!d.rep.paramGaps &&
      d.rep.paramGaps.missing.includes("tokens.spacing") &&
      d.rep.paramGaps.missing.includes("tokens.typography[].size"),
    `28 缺口逐条写进 paramGaps（实际 ${JSON.stringify(d.rep.paramGaps && d.rep.paramGaps.missing)}）`,
  );
  const d2 = runSpec(["--spec", specPath]);
  check(/⚠.*--spec 取不到/.test(d2.out), "28 文本模式同样打印缺口警告（不只在 --json 里）");

  // 29 --spec 指向不存在的文件 ⇒ 用法错误退出码 2，**不得静默回落默认**
  const e = runSpec(["--spec", path.join(FX, "nope.json"), "--json"]);
  check(e.status === 2, `29 --spec 文件不存在时退出码 2（实际 ${e.status}）—— 不许静默回落默认`);
  check(/--spec 读取失败/.test(e.out), "29 并打印失败原因");

  // 30 font-size-floor 抓错：fontSize < spec.accessibility.minFontSize
  //    （恢复 FULL_SPEC 因为 test 28 已覆盖 spec）
  writeSpec(FULL_SPEC);
  const tree30 = box([leaf("字", 12, 24, 200, 20, { fontSize: 12 })]);
  const tree30Path = path.join(FX, `spec-tree-30.json`);
  fs.writeFileSync(tree30Path, JSON.stringify(tree30, null, 2), "utf8");
  const r30 = spawnSync(process.execPath, [TOOL, tree30Path, "--spec", specPath, "--json"], { encoding: "utf8" });
  const rep30 = r30.stdout.trim().startsWith("{") ? JSON.parse(r30.stdout) : null;
  check(
    (rep30.issues || []).some((i) => i.check === "font-size-floor" && i.severity === "high"),
    `30 fontSize=12 < minFontSize=14 ⇒ 报 font-size-floor high（实际 ${JSON.stringify((rep30.issues || []).filter(i => i.check === "font-size-floor"))}）`,
  );
  check(
    rep30.paramSource.minWidthSize === "spec:accessibility.minFontSize",
    `30 paramSource.minWidthSize 标注来源（实际 ${JSON.stringify(rep30.paramSource.minWidthSize)}）`,
  );

  // 31 **反向对照**：fontSize >= minFontSize ⇒ 不报 font-size-floor
  const tree31 = box([leaf("字", 22, 24, 200, 20, { fontSize: 14 })]);
  const tree31Path = path.join(FX, `spec-tree-31.json`);
  fs.writeFileSync(tree31Path, JSON.stringify(tree31, null, 2), "utf8");
  const r31 = spawnSync(process.execPath, [TOOL, tree31Path, "--spec", specPath, "--json"], { encoding: "utf8" });
  const rep31 = r31.stdout.trim().startsWith("{") ? JSON.parse(r31.stdout) : null;
  check(
    !(rep31.issues || []).some((i) => i.check === "font-size-floor"),
    "31 fontSize=14 >= minFontSize=14 ⇒ 不报 font-size-floor",
  );
  check(
    rep31.unchecked && rep31.unchecked.includes("font-size-floor (spec 未声明 accessibility.minFontSize)") === false,
    "31 spec 已声明 minFontSize ⇒ font-size-floor 不在 unchecked",
  );
}

/* ====================================================================
 *  几何覆盖率（**1.3 · A1**）—— 「没查」的规模必须可读
 * ====================================================================
 * 背景（用 harness 加载真实 `code.js` 走 `get-node` 实测得到，见 `.vibe/a1-probe-*.json`）：
 * `get-node` 默认 `depth:1` 时**子级只有 id/name/type**（无几何），而本工具只遍历带几何的
 * 节点 ⇒ 那些节点「一条检查都没跑到」。这与 #72 是同一个病（「没查」与「查了没问题」不可分辨），
 * 只是发生在**输入侧**而不是判据侧。
 *
 * 为什么必须给规模而不是只给容器数：实测同一棵树、只换回读深度 ——
 *   `{depth:1}` → 2 个节点里 1 个带几何，报「1 个容器」
 *   `{depth:2}` → 5 个节点里 2 个带几何，**还是报「1 个容器」**
 * 而两种情况在报告里都写「共 1 条」。容器数是**代理指标**：读不出漏掉的是 1 片孤叶还是 3 个节点。
 */
{
  // 一棵三层树：根 → Card → 3 个叶。`bare()` 抹掉几何，模拟浅回读。
  const full = T({
    name: "Root", width: 400, height: 300,
    children: [T({ name: "Card", width: 200, height: 200, x: 24, y: 24, children: [
      leaf("A", 32, 32, 100, 24), leaf("B", 32, 64, 100, 24), leaf("C", 32, 96, 100, 24),
    ] })],
  });
  const bare = (tree, depth) => {
    if (depth === 0) { for (const c of tree.children || []) { delete c.x; delete c.y; delete c.width; delete c.height; } }
    else for (const c of tree.children || []) bare(c, depth - 1);
    return tree;
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const parse = (r) => (r.out.trim().startsWith("{") ? JSON.parse(r.out) : null);

  // 30 **反向对照**：几何给足时**不得**报浅回读 —— 防「无条件报一条」
  {
    const r = run(full, [...ALL, "--json"]);
    const rep = parse(r);
    check(rep && rep.shallowWarning === null, "30 全层带几何时 shallowWarning 为 null（反向对照：不许无条件报）");
    check(rep && rep.geometryCoverage.auditedNodes === rep.geometryCoverage.totalNodes, "30 auditedNodes === totalNodes（全覆盖）");
    check(rep && rep.geometryCoverage.unauditedNodes === 0, "30 unauditedNodes 为 0");
  }

  // 31 部分几何（= depth:2 的形状）：容器数 1，但**没跑到的节点是 3**
  {
    const half = bare(clone(full), 1);
    const r = run(half, [...ALL, "--json"]);
    const rep = parse(r);
    const g = rep && rep.geometryCoverage;
    check(g && g.shallowParents === 1, `31 报 1 个浅容器（实际 ${g && g.shallowParents}）`);
    check(g && g.shallowNodes === 3, `31 **同一份报告里给出真实规模：3 个节点未参与检查**（实际 ${g && g.shallowNodes}）—— 这正是新字段相对容器数的价值`);
    check(g && g.unauditedNodes === 3 && g.totalNodes === 5, `31 覆盖率 2/5（实际 ${g && g.auditedNodes}/${g && g.totalNodes}）`);
    check(g && g.auditedDepth === 1 && g.inputDepth === 2, `31 审到第 1 层 / 输入深 2 层（实际 ${g && g.auditedDepth} / ${g && g.inputDepth}）`);
    check(rep && (g.shallowNodes > 0) === (rep.shallowWarning !== null), "31 警告与计数不漂移（有未参与节点 ⟺ 有警告）");
  }

  // 32 只根带几何（= depth:1 的形状）：覆盖率 1/5，可审深度 0 层
  {
    const shallow1 = bare(clone(full), 0);
    const r = run(shallow1, [...ALL, "--json"]);
    const g = parse(r) && parse(r).geometryCoverage;
    check(g && g.auditedNodes === 1 && g.totalNodes === 5, `32 只根带几何时覆盖率 1/5（实际 ${g && g.auditedNodes}/${g && g.totalNodes}）`);
    check(g && g.auditedDepth === 0 && g.inputDepth === 2, "32 可审深度 0 层而输入深 2 层 —— 差值说明回读被截断");
  }

  // 33 文本模式也打这两行（不留 `--json` 独占，否则人读的那份仍然只写「共 1 条」）
  {
    const r = run(bare(clone(full), 1));
    check(/几何覆盖\s+2\/5 个节点带几何/.test(r.out), "33 文本模式打印「几何覆盖 2/5 个节点带几何」");
    check(/3 个节点未参与检查/.test(r.out), "33 文本模式打印未参与检查的节点数");
    check(/3 个节点\*\*一条检查都没跑到\*\*/.test(r.out), "33 警告行给出「多少个节点一条检查都没跑到」");
  }
}

/* ====================================================================
 *  第四半：F4 第 3 步的三项新检查 + overflow 的 clipsContent 分级（14 例）
 *
 *  这半的来源与前三半不同：它们**不是**从外部文档逐条抄来的，而是
 *  `tools/contract-usage.mjs` 报出「回读契约 26 个字段里只有 6 个有 L4 审计在读」之后，
 *  拿那份**零引用字段清单**回去找判据得来的（intake §4.6 / §七）。
 *
 *  仍守两半纪律：【能抓错】注入缺陷必须报；【不误报】合法形态必须静默。
 *  另外这批检查都多一个前提：**字段得在输入里**。故每个都配一条「字段缺了怎么说」的用例 ——
 *  因为「永远报 0 条」与「查过没问题」在报告里长得一模一样（本节反复踩的那类错）。
 * ==================================================================== */
{
  const parse = (r) => (r.out.trim().startsWith("{") ? JSON.parse(r.out) : null);
  const FAMS = [
    { family: "Inter", style: "Regular" },
    { family: "Microsoft YaHei", style: "Regular" },
    { family: "Roboto Mono", style: "Regular" },
    { family: "Source Han Sans", style: "Regular" },
  ];
  /** 竖排一列字号 14、间隔 8 的文本（其余检查全静默，保证用例只测一件事） */
  const textColumn = (fams, extra = {}) =>
    box(fams.map((f, i) => leaf(`T${i}`, 24, 24 + i * 32, 100, 24, { fontSize: 14, fontName: f, ...extra })));

  // 34 text-container-fixed 抓错：textAutoResize=NONE（宽高都固定）
  {
    const r = run(textColumn([FAMS[0]], { textAutoResize: "NONE" }));
    check(reports(r, "text-container-fixed"), `34 报出 text-container-fixed\n${r.out}`);
    check(/textAutoResize=NONE/.test(r.out), "34 证据里点名是 NONE");
    check(r.status === 0, `34 它是 medium，不改退出码（实际 ${r.status}）`);
  }

  // 35 **反向对照**：HEIGHT / WIDTH_AND_HEIGHT 都是自适应，不得报（防「见到文本就报一条」）
  {
    const ok1 = run(textColumn([FAMS[0]], { textAutoResize: "HEIGHT" }));
    const ok2 = run(textColumn([FAMS[0]], { textAutoResize: "WIDTH_AND_HEIGHT" }));
    check(silent(ok1, "text-container-fixed"), `35 HEIGHT（固定宽、随内容折行）不报\n${ok1.out}`);
    check(silent(ok2, "text-container-fixed"), `35 WIDTH_AND_HEIGHT（都自适应）不报\n${ok2.out}`);
  }

  // 36 text-justified 抓错：两端对齐（中英混排下字间距被拉开）
  {
    const r = run(textColumn([FAMS[0]], { textAutoResize: "HEIGHT", textAlign: { horizontal: "JUSTIFIED", vertical: "TOP" } }));
    check(reports(r, "text-justified"), `36 报出 text-justified\n${r.out}`);
    check(r.status === 0, `36 它是 medium，不改退出码（实际 ${r.status}）`);
  }

  // 37 **反向对照**：LEFT / CENTER / RIGHT 是正常取值，不得报
  {
    const quiet = ["LEFT", "CENTER", "RIGHT"].map((h) =>
      silent(run(textColumn([FAMS[0]], { textAutoResize: "HEIGHT", textAlign: { horizontal: h, vertical: "TOP" } })), "text-justified"),
    );
    check(quiet.every(Boolean), "37 LEFT / CENTER / RIGHT 三种取值都不报（只 JUSTIFIED 才报）");
  }

  // 38 font-family-count 抓错：全树 4 个字族 > 上限 3（`fontName` 此前是零引用字段）
  {
    const r = run(textColumn(FAMS));
    check(reports(r, "font-family-count"), `38 报出 font-family-count\n${r.out}`);
    check(/用到 4 个字族/.test(r.out), "38 报出的是 4 个字族");
    check(/Inter×1/.test(r.out), "38 证据里给出每个字族的出现次数（人可复核是哪几个）");
  }

  // 39 **边界**：恰好 3 个 == 上限 ⇒ 不报（上限是闭区间，差一个才是违规）
  {
    const r = run(textColumn(FAMS.slice(0, 3)));
    check(silent(r, "font-family-count"), `39 恰好 3 个字族（= 上限）不报\n${r.out}`);
  }

  // 40 关掉开关：`--font-family-max 0` ⇒ 不报，且 checksEnabled 里为 false（反向控制：证明 39 的「不报」来自判据而非检查空转）
  {
    const r = run(textColumn(FAMS), [...ALL, "--font-family-max", "0", "--json"]);
    const rep = parse(r);
    check(notInSummary(rep, "font-family-count"), "40 上限设 0 时 4 个字族也不报");
    check(rep && rep.checksEnabled["font-family-count"] === false, "40 checksEnabled 里 font-family-count 为 false（不是「查过没问题」）");
    check(rep && rep.scales.fontFamilyMax === 0, "40 报告里如实记下上限为 0");
  }

  // 41 overflow 分级 · 抓错：父级 clipsContent=true + 小幅溢出 ⇒ 由 medium 升 **high**（静默裁掉，导出图上查不出来）
  {
    const tree = box([T({ name: "Wide", width: 382, height: 40, x: 24, y: 24 })], { clipsContent: true });
    const r = run(tree);
    check(r.status === 1, `41 父级会裁切时越界退出 1（实际 ${r.status}）`);
    check(reports(r, "overflow"), "41 报出 overflow");
    check(/clipsContent=true/.test(r.out), "41 证据里点名「被静默裁掉」这个升级理由");
  }

  // 42 **反向对照**：同一棵树、只去掉 clipsContent ⇒ 仍是 medium、退出码 0（证明升级来自字段而不是溢出本身）
  {
    const tree = box([T({ name: "Wide", width: 382, height: 40, x: 24, y: 24 })]);
    const r = run(tree);
    check(r.status === 0, `42 无 clipsContent 时同样的 6px 溢出仍是 medium、退出码 0（实际 ${r.status}）`);
    check(reports(r, "overflow"), "42 仍然报出 overflow（只是不升级）");
    check(!/clipsContent=true/.test(r.out), "42 证据里不得出现升级理由");
  }

  // 43 TRUNCATE **不算违规**：issues 里没有它，但要进 textTruncated 清单（留痕 ≠ 判违规）
  {
    const r = run(textColumn([FAMS[0]], { textAutoResize: "TRUNCATE", characters: "很长的标题文案" }), [...ALL, "--json"]);
    const rep = parse(r);
    check(notInSummary(rep, "text-container-fixed"), "43 TRUNCATE 不得被判成 text-container-fixed（也不得出现在 byCheck 里）");
    check(rep && rep.textTruncated && rep.textTruncated.count === 1, `43 报告里有 textTruncated 清单、计数 1（实际 ${rep && JSON.stringify(rep.textTruncated && rep.textTruncated.count)}）`);
    check(rep && rep.textTruncated.nodes[0].characters === 7, "43 清单里带上字符数（供人判断这个宽度够不够）");
    check(rep && rep.summary.total === 0, "43 它不进 summary（不算违规，不改退出码）");
  }

  // 44 TRUNCATE 在**文本模式**下也要打印（不留 `--json` 独占 —— 人读的那份才是被归档的那份）
  {
    const r = run(textColumn([FAMS[0]], { textAutoResize: "TRUNCATE" }));
    check(/已截断文本\s+1 个节点/.test(r.out), `44 文本模式打印「已截断文本 1 个节点」\n${r.out}`);
    check(/风险清单不是违规/.test(r.out), "44 并写明它是风险清单、不是违规");
  }

  // 45 字段缺了必须说「没查」：文本节点没有 textAutoResize ⇒ 进 unchecked，且**既不报违规也不当干净**
  {
    const noField = textColumn([FAMS[0]]); // leaf() 默认不带 textAutoResize
    const r = run(noField, [...ALL, "--json"]);
    const rep = parse(r);
    check(notInSummary(rep, "text-container-fixed"), "45 无字段时不得报 text-container-fixed（不许把「没字段」当违规）");
    check(
      rep && rep.unchecked.some((s) => /输入无 textAutoResize 字段/.test(s)),
      `45 unchecked 里如实声明没查（实际 ${rep && JSON.stringify(rep.unchecked)}）`,
    );
    check(rep && rep.checksEnabled["text-container-fixed"] === false, "45 checksEnabled 里为 false —— 「没查」与「查了没问题」必须分得开");
  }

  // 46 **反向对照**：字段存在时不得再报「没查」（防无条件留痕）
  {
    const r = run(textColumn([FAMS[0]], { textAutoResize: "HEIGHT" }), [...ALL, "--json"]);
    const rep = parse(r);
    check(
      rep && !rep.unchecked.some((s) => /输入无 textAutoResize 字段/.test(s)),
      "46 字段存在时不得出现该 unchecked 项",
    );
    check(rep && rep.checksEnabled["text-container-fixed"] === true, "46 checksEnabled 为 true");
  }

  // 47 输入无 clipsContent ⇒ overflow 仍在跑，但「静默隐藏」那一档要如实声明分不出来
  {
    const r = run(box([T({ name: "Wide", width: 382, height: 40, x: 24, y: 24 })]), [...ALL, "--json"]);
    const rep = parse(r);
    check(rep && rep.summary.byCheck.overflow >= 1, "47 无 clipsContent 时 overflow 照常报（证明留痕不等于把检查关掉）");
    check(
      rep && rep.unchecked.some((s) => /静默隐藏.*输入无 clipsContent/.test(s)),
      `47 unchecked 里声明分不出「看得见/看不见」（实际 ${rep && JSON.stringify(rep.unchecked)}）`,
    );
  }

  // 48 **反向对照（测测试本身）**：把 `--json` 的输出喂给 `reports()` 必须**抛**。
  //    不抛的话，任何「配着 --json 写的 reports/silent 断言」都会静默空转、恒 PASS ——
  //    那是一种长得像绿的假绿，比断言写错更难发现（本批用例第一版就踩了这个，才补的守卫）。
  {
    const r = run(textColumn([FAMS[0]], { textAutoResize: "NONE" }), [...ALL, "--json"]);
    let threw = false;
    try { reports(r, "text-container-fixed"); } catch (_) { threw = true; }
    check(threw, "48 --json 输出喂 reports() 必须抛（否则断言空转、恒 PASS）");
    const rep = parse(r);
    check(
      rep && rep.summary.byCheck["text-container-fixed"] === 1,
      "48 同时证明该检查在 --json 里确实报了 1 条（抛不是因为「没报」，是真的用错了读法）",
    );
  }

  // 49 fake-perfect-numbers 抓错：characters 含全相同数字（111）应进入 fakePerfect 留痕清单
  {
    const r = run(
      textColumn([FAMS[0]], { characters: "进度 111%" }),
      [...ALL, "--json"],
    );
    const rep = parse(r);
    check(rep && rep.fakePerfect && rep.fakePerfect.count >= 1, `49 含「111」时应进入 fakePerfect 清单（实际 ${rep && JSON.stringify(rep.fakePerfect)}）`);
    check(rep && rep.fakePerfect && rep.fakePerfect.nodes[0].match === "111", "49 匹配到的是 111");
    check(rep && rep.summary.total === 0, "49 fakePerfect 不进 summary（只留痕，不改退出码）");
  }

  // 50 **反向对照**：有机数字（如 47.2%）不得触发 fake-perfect
  {
    const r = run(
      textColumn([FAMS[0]], { characters: "转化率 47.2%" }),
      [...ALL, "--json"],
    );
    const rep = parse(r);
    check(!rep || !rep.fakePerfect || rep.fakePerfect.count === 0, "50 有机数字 47.2% 不得触发 fake-perfect");
  }

  // 51 输入无 characters 字段 ⇒ checksEnabled 为 false，unchecked 如实声明
  {
    const r = run(textColumn([FAMS[0]]), [...ALL, "--json"]);
    const rep = parse(r);
    check(rep && rep.checksEnabled["fake-perfect-numbers"] === false, "51 无 characters 时 checksEnabled 为 false");
    check(
      rep && rep.unchecked.some((s) => /fake-perfect/.test(s)),
      `51 unchecked 里如实声明没查（实际 ${rep && JSON.stringify(rep.unchecked)}）`,
    );
  }

  // 52 **反向对照**：characters 字段存在但无假完美数字 ⇒ checksEnabled=true，fakePerfect 为 null
  {
    const r = run(
      textColumn([FAMS[0]], { characters: "用户留存率 73.8%" }),
      [...ALL, "--json"],
    );
    const rep = parse(r);
    check(rep && rep.checksEnabled["fake-perfect-numbers"] === true, "52 有 characters 时 checksEnabled 为 true");
    check(!rep || !rep.fakePerfect || rep.fakePerfect.count === 0, "52 有机数字不得进入 fakePerfect 清单");
  }

  // 53 A1: 中文占位符人名应被检测
  {
    const r = run(textColumn([FAMS[0]], { characters: "用户张三的余额" }), [...ALL, "--json"]);
    const rep = parse(r);
    check(rep && rep.placeholderNames && rep.placeholderNames.count >= 1, `53 中文占位符应被检测（实际 ${JSON.stringify(rep?.placeholderNames)}）`);
    check(rep.summary.total === 0, "53 placeholderNames 不进 summary");
  }

  // 54 A2: 顺序词 tell 应被检测
  {
    const r = run(textColumn([FAMS[0]], { characters: "第一步注册账号" }), [...ALL, "--json"]);
    const rep = parse(r);
    check(rep && rep.orderWords && rep.orderWords.count >= 1, `54 顺序词应被检测（实际 ${JSON.stringify(rep?.orderWords)}）`);
    check(rep.summary.total === 0, "54 orderWords 不进 summary");
  }

  // 55 A3: 品牌名占位应被检测
  {
    const r = run(textColumn([FAMS[0]], { characters: "版权所有某某科技有限公司" }), [...ALL, "--json"]);
    const rep = parse(r);
    check(rep && rep.brandPlaceholders && rep.brandPlaceholders.count >= 1, `55 品牌占位应被检测（实际 ${JSON.stringify(rep?.brandPlaceholders)}）`);
    check(rep.summary.total === 0, "55 brandPlaceholders 不进 summary");
  }

  // 56 反向对照：真实数据不应误报
  {
    const r = run(textColumn([FAMS[0]], { characters: "真实用户名：李明" }), [...ALL, "--json"]);
    const rep = parse(r);
    check(!rep || !rep.placeholderNames || rep.placeholderNames.count === 0, "56 真实用户名不应触发占位符检测");
    check(!rep || !rep.orderWords || rep.orderWords.count === 0, "56 真实内容不应触发顺序词检测");
    check(!rep || !rep.brandPlaceholders || rep.brandPlaceholders.count === 0, "56 真实内容不应触发品牌占位检测");
  }
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
