#!/usr/bin/env node
/**
 * layout-audit.mjs — L4 Layout 维的结构化审计工具
 *
 *   node tools/layout-audit.mjs <readback.json> [选项]
 *
 * 为什么存在：visual-critic.md 要求 Layout 维"禁止目测、必须 get-node 实测"，但仓库里
 * 没有配套工具——上一轮真实运行是靠 Agent 现写临时代码算 gap 与对齐的。临时代码不可复现、
 * 不能回归，所以这一步现在有了随仓库发布的实现。
 *
 * 输入（自动识别）：get-node 的返回体本身，或含它的响应包裹 {ok,data} / {data} / {result}。
 *
 * 检查项（全部基于实测坐标，不含主观判断）：
 *   spacing / padding / radius / font-size  —— 档位外数值
 *   alignment  同宽纵向堆叠的兄弟左边缘不齐（auto-layout 容器由 Figma 保证，不检）
 *   overlap    同父级下的**兄弟重叠**（spacing 与 overflow 之间的缝，见下）
 *   duplicate  同父级下 名称+坐标+尺寸 完全重合的重复兄弟（导出图上看不出来）
 *   overflow   子节点越出父节点边界
 *   baseline   顶层页框尺寸与基准不符
 *   touch      可点击元素小于最小触控边长
 *
 * 为什么单独立 overlap 与 duplicate（D2 运行 B 实测教训）：
 *   `spacing` 对 `gap < -TOL` 是**直接 continue 跳过**的（原注释写「另由 overflow 反映」），
 *   而 `overflow` 只在子级越出**父级**时才报 —— 于是**同一父级下两个兄弟互相重叠，
 *   两条检查都不覆盖**。运行 B 的 TitleBar 右侧时间戳与在线状态簇重叠 71px 就是这么漏掉的，
 *   导出图上一片糊，21 条审计告警里一条都没提到它。
 *   `duplicate` 同理：TrendChart 有 9 个轴标签被建了两遍、像素级完全重合，
 *   删掉后**导出 PNG 的 md5 一字未变** —— 这类缺陷**读图通道完全不敏感**，
 *   必须有独立的结构化检查（同父级下 name+type+坐标+尺寸 四元组查重）。
 *
 * 选项：--scale 4,8,... --radius 2,4,... --font 11,12,... --baseline 1920x1030
 *       --tolerance 1 --min-touch 44 --no-overlap --no-duplicate --json
 * 退出码：0 无 high；1 有 high或overlap；2 用法/输入错误。零依赖。
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SCALE = [4, 8, 12, 16, 24, 32, 48, 64, 96, 120, 160];
const DEFAULT_RADIUS = [2, 4, 6, 8, 12, 16, 20, 24];
const DEFAULT_FONT = [11, 12, 13, 14, 16, 18, 20, 24, 26, 28, 32, 36, 40, 48, 56, 64, 72];
const TOUCH_NAME = /(btn|button|tab|toggle|switch|chip|cta|按钮|标签页|开关|入口)/i;

const args = process.argv.slice(2);
function parseFlag(flag, fallback) {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const raw = args[i + 1];
  return raw === undefined || raw.startsWith("--") ? true : raw;
}
function parseNumList(flag, fallback) {
  const raw = parseFlag(flag, null);
  if (raw === null) return fallback;
  if (raw === true) throw new Error(`${flag} 需要一个逗号分隔的数字列表`);
  const list = String(raw).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (!list.length) throw new Error(`${flag} 解析不到有效数字`);
  return list;
}

const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("用法：node tools/layout-audit.mjs <readback.json> [--scale 4,8,12,...] [--baseline 1920x1030] [--no-overlap] [--no-duplicate] [--json]");
  process.exit(2);
}

let SCALE, RADIUS, FONT, TOL, MIN_TOUCH, BASELINE = null;
try {
  SCALE = parseNumList("--scale", DEFAULT_SCALE);
  RADIUS = parseNumList("--radius", DEFAULT_RADIUS);
  FONT = parseNumList("--font", DEFAULT_FONT);
  TOL = Number(parseFlag("--tolerance", 1));
  MIN_TOUCH = Number(parseFlag("--min-touch", 44));
  const b = parseFlag("--baseline", null);
  if (typeof b === "string") {
    const m = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(b.trim());
    if (!m) throw new Error("--baseline 需形如 1920x1030");
    BASELINE = { width: Number(m[1]), height: Number(m[2]) };
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const JSON_ONLY = args.includes("--json");
// 两个新检查默认开启；开关是给「只想看档位类问题」的场景留的，也方便变异测试单独关掉。
const CHECK_OVERLAP = !args.includes("--no-overlap");
const CHECK_DUPLICATE = !args.includes("--no-duplicate");

let raw;
try {
  raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
} catch (e) {
  console.error(`读不到输入：${e.message}`);
  process.exit(2);
}

/** 响应包裹 -> 节点树 */
function unwrap(o) {
  let cur = o;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    if (Array.isArray(cur.children) || typeof cur.type === "string") return cur;
    if (cur.data || cur.result) { cur = cur.data || cur.result; continue; }
    break;
  }
  return cur;
}
const root = unwrap(raw);
if (!root || !root.type) {
  console.error("输入里找不到节点树（需要 get-node 的返回体，或含它的响应包裹）");
  process.exit(2);
}

const has = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v) => Math.round(v * 100) / 100;
const inScale = (v, scale) => scale.some((s) => Math.abs(v - s) <= TOL + 1e-9);
// 作者显式写下的值与"算出来的间隙"要区别对待：间隙受浮点与舍入影响需要容差，
// 而 cornerRadius=9 / fontSize=15 这类是**精确契约**——差 1px 就是档位外的错值，
// 用容差去比对会把 9≈8、15≈14 这种真缺陷放过。
const inScaleExact = (v, scale) => scale.some((s) => Math.abs(v - s) <= 1e-9);

const issues = [];
function add(check, severity, node, evidence, extra = {}) {
  issues.push({
    check, severity,
    nodeId: node && node.id,
    nodeName: node && node.name,
    path: extra.path,
    measured: extra.measured,
    allowed: extra.allowed,
    evidence,
  });
}
let shallowParents = 0;
let multiOriginParentsFound = 0;
const skippedSameSpace = [];   // 因「子节点不共享坐标系」而跳过 overlap/duplicate 的父级
const dataDrivenRows = [];     // 被判为「等距数据标注」而免检 spacing 的整摞元素

/**
 * `alignment` 的实际覆盖范围（B1 · lessons #67c）。
 *
 * 问题：`alignment` 有一句 `if (|prev[cross] - cur[cross]| > TOL) continue` —— 跨轴尺寸不同就跳过。
 * 它**既不上报也不计数**，于是在报告里，「比过 9 对」与「比过 900 对」长得一模一样，
 * 「alignment: 0」会被读成「对齐都查过了」。这是 #72 的同一类错（「没查」与「查了没问题」不可分辨）。
 *
 * 为什么正确修法是**留痕**而不是**放宽判据**（这里是本条的要点，别把它"修"回去）：
 *   跨轴尺寸不同的两个元素，视觉惯例是**居中对齐**，不是**边缘对齐**。拿边缘去比是拿错了尺子。
 *   运行 B 实测（121 对这样的相邻对）：把判据放宽成「跨轴有投影交集即比边缘」，
 *   新增 5 条报告，**5 条全是假阳性** —— 时间戳 27 高 vs 在线圆点 10 高（圆点居中对齐文字，
 *   上边缘当然差 8px）。故**不报**，但必须**计数并写出理由**，让人知道这块没被边缘判据覆盖。
 *
 * 另一个已排除的方向：给这类对子另加一条「居中偏差」检查。那不是机械修，是新判据设计
 *   （居中同样有"刻意不居中"的合法情形），须单独立项，见 `1.3-candidates.md` B1 注。
 */
let alignCompared = 0;              // 真正做了边缘比对的相邻对
let alignSkippedCrossSizeDiff = 0;  // 因跨轴尺寸不同而未做边缘比对、**但确实视觉相邻**的对
const alignSkippedSamples = [];     // 抽样（供人复核"这些到底是什么"）

/**
 * 把一摞兄弟沿**交叉轴**切成若干「带」（band）：同一带内的元素在交叉轴上彼此有真实投影交集。
 *
 * 为什么免检判定必须先分带再聚类 —— 这是运行 B 残留 3 条假阳性的根因：
 *   TrendChart 底下同时住着**两排文字**：
 *     横轴时间刻度 `00:00 06:00 12:00 18:00 24:00`（y=268，间隔 175/175/177/177）
 *     纵轴数值刻度 `1200 900 600 300`（x=862 起一列，沿 x 轴它们并不等距）
 *   两者的名字形态**都是空串**（都是纯数字/时间），按形态全局聚簇会把 9 个混成一组，
 *   组内间隔 `175,175,177,167,-33,-27,-27,-17` 中位数 167 —— 等距性被跨带的那几项毁掉，
 *   于是**真正等距的那一排也被连坐**，免检不触发。
 *   而 h 轴真实的相邻对只发生在同一排内部（`00:00→06:00` …），它们本来该被免检。
 *
 * 结论：**等距是「一条带内」的性质，不是「整个兄弟集合」的性质**。
 *   先按交叉轴分带（几何事实：同一排/同一列），再在带内按名字形态聚类，最后判等距。
 */
const bandByCross = (stack, ax) => {
  const sorted = stack.slice().sort((a, b) => a[ax.edge] - b[ax.edge]);
  const bands = [];
  let cur = [];
  for (const c of sorted) {
    if (cur.length === 0) { cur.push(c); continue; }
    // 与「当前带」整体的交叉轴区间比：有交集就并进来，否则另起一带
    const s0 = Math.min(...cur.map((x) => x[ax.edge]));
    const e0 = Math.max(...cur.map((x) => x[ax.edge] + x[ax.cross]));
    const s1 = c[ax.edge];
    const e1 = c[ax.edge] + c[ax.cross];
    if (Math.min(e0, e1) - Math.max(s0, s1) > TOL) cur.push(c);
    else { bands.push(cur); cur = [c]; }
  }
  if (cur.length) bands.push(cur);
  return bands;
};

/**
 * 等距数据标注：把一摞按轴排序的兄弟切成「带 → 同形态段」，段内若**等距**
 * （相邻间隔的中位数与每个间隔偏差 ≤10%），则该段是**数据驱动的刻度/网格线**——
 * 它们的间隔由「绘图区尺寸 ÷ 刻度数」算出来，不是从 spacing 档位里挑的。报「不在档位」是拿错了尺子。
 *
 * 运行 B 的残留全属此类：TrendChart 的 `00:00/06:00/…/24:00`（间隔 175/175/177）、
 * MapPanel 的 `Grid/V5..V11`（间隔 75）、以及 AlertTicker 的「正文 ↔ 共 3 条 ›」（两端对齐）。
 *
 * 为什么不能拿「整摞」直接判：一摞兄弟里常混着标题、网格线、横轴刻度、纵轴刻度、折线等**多种形态**，
 * 拿整摞去算中位数必然失败（运行 B 的 TrendChart 一摞 16 个、名字形态全不同）。
 * 于是要两级切分：**先按交叉轴分带（区分「哪一排」），再按名字形态聚类（区分「哪一种」）**，
 * 最后才在段内判等距 —— 先聚类再判定，而不是排序后硬比。
 *
 * ⚠️ **本函数返回空集是常态，不代表什么都没查**：单行文本条的兄弟几乎都是「1~2 个」，
 * 达不到 n≥3 的聚类门槛，函数自然返回空。这不是漏检，因为下面的 spacing 检查**不依赖本函数**
 * —— 免检只是**从报出项里剔除能证明是「数据驱动」的**，剔除不掉的照报。
 * 反过来说：**单轴相邻 ≠ 视觉相邻**。运行 B 的 AlertTicker 里「正文」在 x=[132,547]、
 * 「共 3 条 ›」在 x=[1770,1824]，中间 1223px 全是空气 —— 单轴排序让它俩成了"相邻一对"，
 * 于是报出「间距 1223px 不在档位」。这属于「用错了尺子」的第三类：
 * **不能因为两个元素在某一轴上排序相邻，就认为它们之间存在设计间距**。
 * 目前用 `crossOverlap > TOL`（跨轴投影必须真有交集）挡住了大部分这类伪相邻，
 * 但同带内的极端留白仍会漏过来 —— 这种情况**报出来不是错，是提示 review 者「这里到底是
 * 两端对齐还是漏了东西」**，故本函数不做处理，保留上报。
 *
 * 返回「应免检的节点 id 集合」；同时把判定记进 dataDrivenRows（报告里如实列出，
 * 因为这是**跳过**、不是**通过**）。
 */
const isDataDrivenSpacing = (stack, ax) => {
  // 名字形态：抹掉结尾的数字/时间（`Grid/V5`→`Grid/V`、`06:00`→``、`300`→``）
  // 抹完为空说明整名就是「纯数值/时间」（刻度特有形态），给个可读占位符而不是空串
  const shape = (n) => String(n).replace(/[\d:.]+\s*$/g, "").trim() || "(纯数值/时间)";

  const exempt = new Set();
  for (const band of bandByCross(stack, ax)) {
    // 形态**带内**聚簇：不能按「排序后相邻」切连续段 —— MapPanel 的 `Grid/V1..V11`
    // 在 h 轴排序时会被夹在中间的其他元素（`Legend`、`Link/A-B`…）切碎，它们排序后并不相邻，
    // 但「同形态等距」与是否相邻无关。
    const groups = new Map();
    for (const c of band) {
      const k = shape(c.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const [k, group] of groups) {
      if (group.length < 3) continue;                 // 两点之间谈不上「分布规律」
      const run = group.slice().sort((a, b) => a[ax.pos] - b[ax.pos]);
      const gaps = [];
      for (let i = 1; i < run.length; i++) gaps.push(run[i][ax.pos] - (run[i - 1][ax.pos] + run[i - 1][ax.size]));
      const sorted = gaps.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median <= 0) continue;
      if (!gaps.every((g) => Math.abs(g - median) / median <= 0.1)) continue;
      for (const c of run) exempt.add(c.id);
      dataDrivenRows.push({ axis: ax === AXES.v ? "v" : "h", count: run.length, median: round(median), shape: k });
    }
  }
  return exempt;
};

// 沿轴向堆叠时的三个关键维度：pos=沿轴位置，size=沿轴长度，cross=跨轴长度（同列/同行应一致），edge=跨轴边缘（应齐）
const AXES = {
  v: { pos: "y", size: "height", cross: "width", edge: "x", edgeLabel: "左" },
  h: { pos: "x", size: "width", cross: "height", edge: "y", edgeLabel: "上" },
};

/**
 * 兄弟重叠：同一父级下两个**文字**节点的面积交集。
 *
 * 为什么只查「文字 × 文字」—— 这条范围是踩过坑之后收窄的：
 *   第一版对**所有**兄弟两两比交集，在运行 B 上得到 256 条，几乎全是假阳性：
 *     · 文字压在它自己的底板 RECTANGLE 上（`Tab/实时` + `实时`）—— 这是**正常图层结构**；
 *     · 仪表盘的 `Gauge/Track` / `Arc` / `Hole` 三层同心圆 —— 这是**刻意的叠画**；
 *     · 图表折线与网格线铺满整个绘图区 —— 这是**图表本来的画法**。
 *   这些「重叠」不但合法，而且是绝大多数设计的基础手法。**把结构当缺陷报，
 *   等于用一个必然报错的判据淹没真信号**（正是 layout-audit spacing 那条的老病）。
 *   真正会造成视觉伤害的只有一类：**两段文字互相压字**（运行 B 的 TitleBar
 *   时间戳压住「系统在线」71px，导出图上糊成一团）。故只报这一类。
 *
 * 前提：兄弟**真的共享同一个坐标系**（`localSameSpace`）—— 合成页根把 N 个独立
 *   组件帧拢在一起时各自 x=0,y=0，对它们比交集必出 213 条噪音，故那一层跳过。
 */
const OVERLAP_MIN_AREA = 4;      // 交集面积下限（px²），滤掉浮点级接触
const auditOverlaps = (kids, pathStr) => {
  const texts = kids.filter((c) => c.type === "TEXT");
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      // 名称相同 ⇒ 是 duplicate 该管的重合副本，不在这里重复报（两类缺陷分开归因）
      if (a.name === b.name) continue;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox <= TOL || oy <= TOL) continue;
      const area = round(ox * oy);
      if (area < OVERLAP_MIN_AREA) continue;
      // 报在「后出现」的那个身上，两个名字都写进证据 —— 只说一个名字会让人找不到另一半
      const pct = round((area / Math.min(a.width * a.height, b.width * b.height)) * 100);
      add("overlap", "high", b, `文字 "${a.name}" 与 "${b.name}" 重叠 ${round(ox)}x${round(oy)}px（${area}px²，占较小者 ${pct}%）—— 会互相压字、糊成一团`, {
        path: pathStr,
        measured: `${round(ox)}x${round(oy)}px`,
        allowed: "两段文字的面积交集应为空",
      });
    }
  }
};

/**
 * 重复兄弟：同父级下 **名称 + 类型 + 坐标 + 尺寸** 四元组完全相同的节点。
 * 为什么必须有这条：这类缺陷在导出图上**完全隐形**（重合 ⇒ 像素一模一样）。
 * 运行 B 实测：TrendChart 的 9 个重复轴标签删掉后，**导出 PNG 的 md5 一字未变**
 * （`eb35355a…` / 32539 bytes）—— 「导出图看着对」对这类缺陷是**原理性盲区**。
 * 成因通常是重跑了一批不带 `cleanPrevious` 的计划（`run` 不幂等）。
 * severity high：它会污染所有按子节点数量做的校验（如「16 个子节点」实为 25）。
 */
const auditDuplicates = (kids, pathStr) => {
  const seen = new Map();
  for (const c of kids) {
    const key = [c.name, c.type, round(c.x), round(c.y), round(c.width), round(c.height)].join("|");
    const hit = seen.get(key);
    if (hit) { hit.extra.push(c); continue; }
    seen.set(key, { first: c, extra: [] });
  }
  for (const { first, extra } of seen.values()) {
    if (!extra.length) continue;
    add("duplicate", "high", first, `同父级下有 ${extra.length + 1} 个完全重合的 "${first.name}"（${first.type} @ ${round(first.x)},${round(first.y)} ${round(first.width)}x${round(first.height)}）—— 导出图上看不出来，但会污染子节点计数`, {
      path: pathStr,
      measured: `${extra.length + 1} 个重合`,
      allowed: "1",
      duplicateIds: extra.map((e) => e.id),
    });
  }
};

function walk(node, trail, sameSpace = true) {
  const pathStr = trail.join(" / ");
  const kids = Array.isArray(node.children) ? node.children : [];
  const geoKids = kids.filter((c) => has(c.width) && has(c.height));
  if (kids.length && !geoKids.length) shallowParents++;

  // 「这些子节点是否共享同一坐标系」—— 重叠/重复两条检查的前提。
  // 判据：一组本该被排布出来的兄弟，不可能**全部**起算于同一个远点。
  // 运行 B 的合成页根正是这样：14 个彼此独立的组件帧各自 x=0,y=0，
  // 于是两两比交集得到 213 条纯噪音。真正被排布过的兄弟至多有一个在原点。
  //
  // ⚠️ 这个判定**只对当前这一层生效，不向下继承**（`localSameSpace`）。
  // 一度写成继承，结果合成页根把 `sameSpace=false` 一路传给了全部子树 ——
  // TrendChart 里 45 个重合的轴标签（9 名 × 5 份，正是 duplicate 该抓的形态）
  // 就这么被判成「不在同一坐标系」而静默跳过。**上游的异常不该让下游失明。**
  let localSameSpace = sameSpace;
  if (geoKids.length > 2) {
    const atOrigin = geoKids.filter((c) => Math.abs(c.x) <= TOL && Math.abs(c.y) <= TOL).length;
    if (atOrigin === geoKids.length) {
      localSameSpace = false;
      multiOriginParentsFound++;
      skippedSameSpace.push(pathStr);
    }
  }

  // itemSpacing=0 是"不设自动间距"的合法取值，不是档位违规。
  // ⚠️ 但它有**双重前提**，任一不成立就整条不触发（见文件头 `padding`/`itemSpacing` 的说明）：
  //    ① 输入里得有 `itemSpacing` 字段；② 节点得是 auto-layout。
  if (has(node.itemSpacing) && node.itemSpacing !== 0 && node.layoutMode && node.layoutMode !== "NONE" && !inScaleExact(node.itemSpacing, SCALE)) {
    add("spacing", "medium", node, `itemSpacing=${node.itemSpacing} 不在档位 [${SCALE.join(",")}]`, { path: pathStr, measured: node.itemSpacing, allowed: SCALE });
  }
  // ⚠️ **padding 检查的真实覆盖范围**（运行 B 结案时实测出来的，必须写明）：
  //    本检查读的是 Figma 自己在 auto-layout 容器上声明的 `padding.{side}` 字段，
  //    **不是**从子级坐标反推出来的「视觉内边距」。
  //    实测（Run B 的 377 个节点、bridge `get-node` 各参数组合）：
  //      `padding` / `paddingTop` 等字段 **从未出现在回读里**，`layoutMode` 恒为 "NONE"。
  //      ⇒ 在本管线里这条检查**一次都不会触发**，它报 0 不代表「内边距都对」，
  //        而是代表「这个字段没被回读出来」。
  //    为什么不改成从坐标反推：反推需要区分「有意留白」与「排版凑巧」，
  //      二维网格里尤其不可靠（见 auditOverlaps / bandByCross 同样的前提问题）。
  //      宁可如实声明「没查」，也不给一个会误报的近似。
  //    留痕在报告的 `unchecked` 里（`padding (输入无该字段)`），不在这里静默。
  if (node.padding && typeof node.padding === "object") {
    for (const [side, v] of Object.entries(node.padding)) {
      if (has(v) && v !== 0 && !inScaleExact(v, SCALE)) {
        add("padding", "medium", node, `padding.${side}=${v} 不在档位 [${SCALE.join(",")}]`, { path: pathStr, measured: v, allowed: SCALE });
      }
    }
  }
  if (has(node.cornerRadius) && node.cornerRadius !== 0 && !inScaleExact(node.cornerRadius, RADIUS)) {
    add("radius", "medium", node, `cornerRadius=${node.cornerRadius} 不在档位 [${RADIUS.join(",")}]`, { path: pathStr, measured: node.cornerRadius, allowed: RADIUS });
  }
  if (has(node.fontSize) && !inScaleExact(node.fontSize, FONT)) {
    add("font-size", "medium", node, `fontSize=${node.fontSize} 不在字阶 [${FONT.join(",")}]`, { path: pathStr, measured: node.fontSize, allowed: FONT });
  }
  if (has(node.width) && has(node.height) && TOUCH_NAME.test(node.name || "")) {
    const side = Math.min(node.width, node.height);
    if (side < MIN_TOUCH) {
      add("touch", "high", node, `可点击元素 ${round(node.width)}x${round(node.height)} 最小边 ${side} < ${MIN_TOUCH}（触控红线）`, { path: pathStr, measured: side, allowed: MIN_TOUCH });
    }
  }

  if (!geoKids.length) return;

  // Figma 的 x/y 是**相对于父级**的（只有顶层节点因为父级是页面才等于画布绝对坐标），
  // 所以子级要跟父级的"本地盒子" [0,0,width,height] 比，而不是跟父级的 x/y 比——
  // 拿父级绝对坐标来比会得出"子级左溢 12500px"这种荒谬结论。
  for (const c of geoKids) {
    const out = [];
    let worst = 0;
    const mark = (label, amount) => {
      if (amount > TOL) { out.push(`${label} ${round(amount)}px`); worst = Math.max(worst, amount); }
    };
    mark("左溢", -c.x);
    mark("上溢", -c.y);
    mark("右溢", c.x + c.width - node.width);
    mark("下溢", c.y + c.height - node.height);
    if (out.length) {
      // 几个像素的溢出多是坐标轴标签这类装饰性外挂，按 medium 报；真正撑破结构的才升 high
      add("overflow", worst > 16 ? "high" : "medium", c, `"${c.name}" 越出父级 "${node.name}"（${round(node.width)}x${round(node.height)}）：${out.join("、")}`, { path: pathStr, measured: out.join("、"), allowed: "完全在父级本地盒子内" });
    }
  }

  // auto-layout 容器的间距与对齐由 Figma 保证，不再做几何推断
  // （但 duplicate 仍要查：auto-layout 下重复创建同样会留下重合节点）
  if (node.layoutMode && node.layoutMode !== "NONE") {
    if (CHECK_DUPLICATE && localSameSpace) auditDuplicates(geoKids, pathStr);
    for (const c of geoKids) walk(c, trail.concat(c.name));
    return;
  }

  // ---- 新增①：兄弟重叠 ------------------------------------------------------
  // 为什么不能塞进下面的 spacing 循环：那个循环是**按单轴排序后看相邻一对**，
  //   (a) 它只比「相邻」，重叠的一对若中间夹着别的元素就会被跳过；
  //   (b) 二维网格里「排序相邻」不等于「几何相邻」（运行 B 的假阳性全出在这）。
  // 所以重叠必须**成对全比**（O(n²)，只在同父级内，实际规模无压力），与档位无关、恒报。
  // 但它有前提：这些兄弟**真的共享坐标系**（`sameSpace`），否则必出大量假阳性。
  if (CHECK_OVERLAP && localSameSpace) auditOverlaps(geoKids, pathStr);

  // ---- 新增②：重复兄弟 ------------------------------------------------------
  if (CHECK_DUPLICATE && localSameSpace) auditDuplicates(geoKids, pathStr);

  for (const ax of Object.values(AXES)) {
    const stack = geoKids.slice().sort((a, b) => a[ax.pos] - b[ax.pos]);
    // 先算出「这一轴上有哪些元素属于等距数据标注」——它们是刻度/网格线，间隔由数据决定
    const exempt = isDataDrivenSpacing(stack, ax);
    for (let i = 1; i < stack.length; i++) {
      const prev = stack[i - 1];
      const cur = stack[i];
      // 跨轴尺寸不同 ⇒ 两者本就不构成一列/一行，边缘对齐不是正确判据（见文件头 alignmentCoverage）。
      // ⚠️ 但**不许静默**：若两者在跨轴上真有投影交集（视觉上确实挨着），计数留痕、抽样存证。
      if (Math.abs(prev[ax.cross] - cur[ax.cross]) > TOL) {
        const overlapIfAny =
          Math.min(prev[ax.edge] + prev[ax.cross], cur[ax.edge] + cur[ax.cross]) -
          Math.max(prev[ax.edge], cur[ax.edge]);
        if (overlapIfAny > TOL) {
          alignSkippedCrossSizeDiff++;
          if (alignSkippedSamples.length < 12) {
            alignSkippedSamples.push({
              axis: ax === AXES.v ? "v" : "h",
              parent: pathStr,
              a: prev.name,
              b: cur.name,
              crossA: round(prev[ax.cross]),
              crossB: round(cur[ax.cross]),
              edgeDelta: round(Math.abs(cur[ax.edge] - prev[ax.edge])),
            });
          }
        }
        continue;  // 跨轴长度不同，不构成一列/一行
      }
      // 单轴排序会把「不同行也不同列」的元素排成邻居（网格伪相邻），故要求**跨轴也真的重叠**：
      // 只有两个元素在跨轴上存在真实投影交集，它们才谈得上「同一行/同一列里挨着」，
      // 这时算出来的间隙才有设计含义。否则算出来的是行距/列距，报出去就是假阳性。
      const crossOverlap = Math.min(prev[ax.edge] + prev[ax.cross], cur[ax.edge] + cur[ax.cross]) - Math.max(prev[ax.edge], cur[ax.edge]);
      if (crossOverlap <= TOL) continue;
      const gap = round(cur[ax.pos] - (prev[ax.pos] + prev[ax.size]));
      // 重叠交给上面的 auditOverlaps 专门报，这里不再静默吞掉（旧版正是 continue 掉导致漏报）
      if (gap < -TOL) continue;
      // 等距数据标注免检（刻度/网格线：间隔由「绘图区 ÷ 刻度数」决定，不是设计档位）
      if (exempt.has(prev.id) && exempt.has(cur.id)) continue;
      if (!inScale(gap, SCALE)) {
        add("spacing", "medium", cur, `"${prev.name}" 与 "${cur.name}" 的间距 ${gap}px 不在档位 [${SCALE.join(",")}]`, { path: pathStr, measured: gap, allowed: SCALE });
      }
      // 走到这里才是一次**真的**边缘比对（前面任一 continue 都意味着没比）
      alignCompared++;
      const drift = round(Math.abs(cur[ax.edge] - prev[ax.edge]));
      // 只报"差一点点"的：真正大幅错位是刻意的布局，不该当对齐缺陷
      if (drift > TOL && drift <= 8) {
        add("alignment", "medium", cur, `与同列 "${prev.name}" 的${ax.edgeLabel}边缘差 ${drift}px（超容差 ${TOL}px 但属轻微错位，看着该齐却没齐）`, { path: pathStr, measured: drift, allowed: `<= ${TOL}` });
      }
    }
  }
  for (const c of geoKids) walk(c, trail.concat(c.name));
}

if (BASELINE && has(root.width) && has(root.height)) {
  const dw = round(Math.abs(root.width - BASELINE.width));
  const dh = round(Math.abs(root.height - BASELINE.height));
  if (dw > TOL || dh > TOL) {
    add("baseline", "high", root, `页框 ${round(root.width)}x${round(root.height)} 与基准 ${BASELINE.width}x${BASELINE.height} 不符（宽差 ${dw} / 高差 ${dh}）——页框被 HUG 收缩或被内容撑开了`, {
      path: root.name, measured: `${round(root.width)}x${round(root.height)}`, allowed: `${BASELINE.width}x${BASELINE.height}`,
    });
  }
}

walk(root, [root.name]);

// 同因重复条目归并：一个图表里 13 个 X 轴标签各自越界，报 1 条带 occurrences 才有可读性
const grouped = [];
const seen = new Map();
for (const i of issues) {
  const key = `${i.check}|${i.severity}|${i.path}|${i.evidence}`;
  const hit = seen.get(key);
  if (hit) { hit.occurrences++; hit.nodeIds.push(i.nodeId); continue; }
  const rec = Object.assign({}, i, { occurrences: 1, nodeIds: [i.nodeId] });
  seen.set(key, rec);
  grouped.push(rec);
}

/**
 * 静态能力探测：这几项检查**能不能触发**，取决于输入里有没有它们依赖的字段。
 *
 * 为什么必须探：运行 B 结案时发现 `padding` 检查在 377 个节点上一次都没触发 ——
 * 因为 bridge 的 `get-node`（任何参数组合）都不返回 `padding*` 字段，`layoutMode` 恒为 NONE。
 * 于是控制台打出「已启用 … padding」时，读的人会以为内边距被查过 ——
 * 而**实际是「这个字段根本没被回读出来」**。这正是本项目反复踩的那类错：
 * 把「工具没看」读成「东西是对的」。
 *
 * 探测方式：整棵树里有没有任何一个节点带该字段。有 → 检查有效；无 → 进 unchecked。
 * 注意这与 `--no-*` 开关是两回事：开关是「人主动关」，这里是「输入不具备」。
 */
const fieldCoverage = (() => {
  let paddingNodes = 0;
  let layoutNodes = 0;
  let itemSpacingNodes = 0;
  let total = 0;
  const walk = (n) => {
    total++;
    if (n.layoutMode && n.layoutMode !== "NONE") layoutNodes++;
    if (has(n.itemSpacing)) itemSpacingNodes++;
    if (n.padding && typeof n.padding === "object" && Object.values(n.padding).some(has)) paddingNodes++;
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return { total, paddingNodes, layoutNodes, itemSpacingNodes };
})();

const high = grouped.filter((i) => i.severity === "high").length;
const byCheck = grouped.reduce((a, i) => { a[i.check] = (a[i.check] || 0) + i.occurrences; return a; }, {});
const report = {
  tool: "layout-audit",
  auditedRoot: { id: root.id, name: root.name, width: root.width, height: root.height },
  scales: { spacing: SCALE, radius: RADIUS, font: FONT, tolerance: TOL, minTouch: MIN_TOUCH, baseline: BASELINE },
  checksEnabled: { spacing: true, padding: fieldCoverage.paddingNodes > 0, radius: true, "font-size": true, alignment: true, touch: true, overflow: true, baseline: Boolean(BASELINE), overlap: CHECK_OVERLAP, duplicate: CHECK_DUPLICATE },
  // 输入能力探测的原始计数 —— 让「为什么某项是 false」可复核，而不是只给个结论
  inputCoverage: fieldCoverage,
  summary: {
    total: grouped.length,
    rawTotal: issues.length,
    bySeverity: { high, medium: grouped.length - high },
    byCheck,
  },
  // 「这次根本没查」与「查了没问题」必须能分辨 —— 后者才是绿。
  // 关掉某项检查时，这里会如实列出，避免把「我没看」读成「它是干净的」。
  unchecked: [
    ...(CHECK_OVERLAP ? [] : ["overlap"]),
    ...(CHECK_DUPLICATE ? [] : ["duplicate"]),
    ...(BASELINE ? [] : ["baseline (未给 --baseline)"]),
    // 输入里没有该字段 ⇒ 检查结构性地不可能触发。这是「没查」，不是「干净」。
    ...(fieldCoverage.paddingNodes > 0 ? [] : [`padding (输入无 padding* 字段；实测 bridge get-node 不返回，见文件头)`]),
    ...(fieldCoverage.layoutNodes > 0 ? [] : [`itemSpacing (输入无 auto-layout 容器；${fieldCoverage.total} 个节点 layoutMode 全为 NONE)`]),
  ],
  // 因坐标系前提不成立而**跳过** overlap/duplicate 的父级。同样是「没查」，必须留痕：
  // 运行 B 的合成页根（14 个独立组件帧各自 x=0,y=0）就会命中这里 —— 不写明的话，
  // 读到「overlap 0 条」的人会以为组件之间真的没重叠。
  skipped: multiOriginParentsFound
    ? {
        reason: "子节点全部起算于同一原点 —— 它们不是被排布出来的兄弟（典型：把 N 个独立组件帧拢在一起的合成页根），对其做重叠/重复判定必然全是假阳性",
        parents: skippedSameSpace.slice(0, 8),
        count: multiOriginParentsFound,
        affectedChecks: ["overlap", "duplicate"],
      }
    : null,
  // 被判定为「等距数据标注」而**免检** spacing 的整摞元素。同样是「没查」，必须留痕：
  // 刻度/网格线的间隔由「绘图区尺寸 ÷ 刻度数」算出来，用 spacing 档位去要求它是拿错了尺子；
  // 但「我认定它是数据驱动」这件事本身是个判断，写进报告才能被人复核。
  // 一条 21 条假阳性 → 1 条的收窄，如果报告里只写「1 条」，谁知道另外 20 条是被谁吃掉的？
  dataDrivenSpacing: dataDrivenRows.length
    ? {
        reason: "同带内同形态且相邻间隔等距（偏差 ≤10%）——判定为刻度/网格线，间隔由数据驱动而非设计档位，故免检 spacing",
        rows: dataDrivenRows,
        affectedChecks: ["spacing"],
      }
    : null,
  shallowParents,
  shallowWarning: shallowParents
    ? `${shallowParents} 个容器只有不带几何的子级（典型 depth:1 轻量回读）—— Layout 深审不可用，请用 get-node {depth:2~3, detail:true} 重取`
    : null,
  // `alignment` 的实际覆盖范围。为什么必须写进报告：不写的话「alignment: 0」会被读成
  // 「对齐都查过了」，而实际可能只比了 9 对、另有 121 对视觉相邻的对子根本没比。
  // 详见 walk 循环上方的 `alignmentCoverage` 注释与文件头 B1 段。
  alignmentCoverage: {
    compared: alignCompared,
    skippedCrossSizeDiff: alignSkippedCrossSizeDiff,
    samples: alignSkippedSamples,
    note:
      "`alignment` 只在**跨轴尺寸相等**的相邻对之间比边缘。跨轴尺寸不同的对子（下表 samples）" +
      "按视觉惯例是**居中**对齐，用边缘去比是拿错了尺子——实测放宽判据会得到 100% 假阳性" +
      "（运行 B：121 对里放宽后新增 5 条，5 条全假）。故不报，但计入本字段：" +
      "`compared` 才是本轮真正比对过的对数，`skippedCrossSizeDiff` 是**没比**的对数。",
  },
  issues: grouped,
  generatedAt: new Date().toISOString(),
};

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nlayout-audit   ${root.name}   ${round(root.width)}x${round(root.height)}`);
  console.log(`档位  spacing [${SCALE.join(",")}]  radius [${RADIUS.join(",")}]  容差 ${TOL}px${BASELINE ? `  基准 ${BASELINE.width}x${BASELINE.height}` : "  未给 --baseline（跳过 baseline 检查）"}`);
  console.log(`已启用  ${Object.entries(report.checksEnabled).filter(([, v]) => v).map(([k]) => k).join(" / ")}`);
  // 措辞刻意分开：「未检查」= 人主动关掉/没给参数；「输入不具备」= 字段压根没回读出来。
  // 两者都是「没看」，但**成因不同、修法不同**（前者改命令行，后者改回读深度或接受无法查）。
  // 合成一行会让人以为都是自己忘了传参数，从而漏掉「这个管线根本取不到该字段」这件事。
  const offByFlag = report.unchecked.filter((s) => !/输入无/.test(s));
  const offByInput = report.unchecked.filter((s) => /输入无/.test(s));
  if (offByFlag.length) console.log(`未检查  ${offByFlag.join(" / ")}   ← 这几项是「没看」，不是「干净」`);
  if (offByInput.length) {
    console.log(`输入不具备  ${offByInput.length} 项（不是"干净"，是"取不到该字段"）：`);
    for (const s of offByInput) console.log(`            ${s}`);
  }
  if (report.skipped) console.log(`已跳过  ${report.skipped.affectedChecks.join(" / ")}：${report.skipped.count} 个父级（子节点不共享坐标系）`);
  if (report.dataDrivenSpacing) {
    // 组数多时别把 21 组全糊在一行 —— 人眼读不完，反而看不出重点。
    // 前 6 组给出「形态×个数(间隔)」便于核对，其余折叠成计数；完整明细在 --json 里。
    const rows = report.dataDrivenSpacing.rows;
    const show = rows.slice(0, 6).map((r) => `${r.shape}×${r.count}(间隔${r.median})`).join("、");
    const more = rows.length > 6 ? ` …另 ${rows.length - 6} 组（--json 看全）` : "";
    console.log(`已免检  spacing：${rows.length} 组等距数据标注 —— ${show}${more}`);
  }
  if (report.shallowWarning) console.log(`\n⚠  ${report.shallowWarning}`);
  // `alignment` 的覆盖范围单列一行。它不进 `unchecked`：这项检查**开着**，只是判据自带边界。
  // 但边界必须可见 —— 否则「alignment: 0」会被读成「对齐都查过」，而实际本轮只比了 9 对。
  {
    const ac = report.alignmentCoverage;
    console.log(
      `对齐覆盖  edge 比对 ${ac.compared} 对 ｜ 因跨轴尺寸不同未比 ${ac.skippedCrossSizeDiff} 对` +
        `   ← 后者按视觉惯例是**居中**对齐，用边缘比是拿错尺子（放宽判据实测 100% 假阳性）`,
    );
  }
  if (!grouped.length) {
    console.log("\n无违规。\n");
  } else {
    const order = { high: 0, medium: 1 };
    grouped.sort((a, b) => order[a.severity] - order[b.severity]);
    console.log("");
    for (const i of grouped) {
      const times = i.occurrences > 1 ? `  ×${i.occurrences}` : "";
      console.log(`  [${i.severity}] ${i.check}${times}  ${i.path}`);
      console.log(`        ${i.evidence}`);
      const ids = i.nodeIds.slice(0, 4).join(", ");
      console.log(`        节点 ${ids}${i.nodeIds.length > 4 ? ` …共 ${i.nodeIds.length} 个` : ""}`);
    }
    console.log(`\n共 ${grouped.length} 条（去重前 ${issues.length} 条）：high ${high} / medium ${grouped.length - high}`);
    console.log(`分类（按出现次数）：${Object.entries(byCheck).map(([k, v]) => `${k} ${v}`).join(" / ")}\n`);
  }
}

process.exit(high > 0 ? 1 : 0);
