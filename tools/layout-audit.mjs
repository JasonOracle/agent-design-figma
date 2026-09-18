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
 * 几何覆盖率（**1.3 · A1**）—— 本工具只遍历**带几何的节点**，而 `get-node` 默认 `depth:1` 时
 * 子级只有 `id/name/type`、`depth:2` 时第二层同样不带几何 ⇒ 那些节点**一条检查都没跑到**。
 * 报告因此带 `geometryCoverage`（`auditedNodes` / `totalNodes` / `unauditedNodes` / `shallowParents` /
 * `shallowNodes` / `auditedDepth` / `inputDepth`），把「没查的规模」摆出来 —— 否则「共 1 条」会被读成
 * 「查全了只有 1 条」。实测（harness 走真实 `code.js`，见 `tools/layout-audit-readback-probe.mjs`）：
 * 同一棵 5 节点树，`{depth:1}` 得覆盖率 **1/2**、`{depth:2}` 得 **2/5**，而**两者的浅容器数都是 1** ——
 * **容器数是代理指标，节点数才是规模**。要拿全几何请用 `get-node {depth:3, detail:true}`。
 * （注意 `{depth:1}` 的分母不是 5 而是 2：漏掉的子树不在响应里，报出的未参与数只是**下界**。）
 *
 * 检查项（全部基于实测坐标，不含主观判断）：
 *   spacing / padding / radius / font-size  —— 档位外数值
 *   alignment  同宽纵向堆叠的兄弟左边缘不齐（auto-layout 容器由 Figma 保证，不检）
 *   overlap    同父级下的**兄弟重叠**（spacing 与 overflow 之间的缝，见下）
 *   duplicate  同父级下 名称+坐标+尺寸 完全重合的重复兄弟（导出图上看不出来）
 *   overflow   子节点越出父节点边界；**若父级 clipsContent=true 则升 high**（静默隐藏，见下）
 *   baseline   顶层页框尺寸与基准不符
 *   touch      可点击元素小于最小触控边长
 *   text-container-fixed  文本容器 textAutoResize=NONE（宽高都固定）⇒ 文本增长只能溢出/被裁
 *   text-justified        文本 textAlign=JUSTIFIED（中英混排下字间距被拉开）
 *   font-family-count     全树字族数 > 上限（默认 3）
 *
 * 新增三项的来历（1.3 · F4 第 3 步）——**它们不是靠读外部文档得来的，是靠「契约里没人用的字段」清单得来的**：
 *   `tools/contract-usage.mjs` 实测回读契约 26 个字段里，只有 6 个有 L4 审计在读；
 *   `textAutoResize` / `textAlign` / `fontName` 都在「零引用」里。拿这份清单回去找外部判据，
 *   命中率远高于逐条读文档（`references/design-criteria-intake.md` §4.6 的结论，本条是它的执行）。
 *   ⚠️ 这几项**只在字段真的出现在输入里时才判**（`inputCoverage` 计数为 0 则进 `unchecked`）——
 *   否则会得到一个「永远报 0 条」的检查，那会被读成「查过没问题」（本节反复踩的那类错）。
 *
 * `textAutoResize` 的四种取值（映射见 `figma-plugin/code.js` 的 `normAutoResize`）：
 *   `NONE` 宽高都固定 ⇒ **风险**（本检查报）｜ `HEIGHT` 宽固定高自适应 ⇒ 正常
 *   `WIDTH_AND_HEIGHT` 都自适应 ⇒ 最宽松｜ `TRUNCATE` 已开省略号 ⇒ **不算违规**，只进 `textTruncated` 清单
 *   ⚠️ 「已开截断」不等于「真被截」—— 那取决于内容长度，静态稿看不到 ⇒ **只能报风险，不能报事实**。
 *
 * `clipsContent` 为什么要给 overflow **分级**（而不是新开一条检查）：
 *   同一个「子级越界」，父级 `clipsContent=false` 时**看得见**（丑，但设计者会发现）；
 *   父级 `clipsContent=true` 时被**静默裁掉**（导出图上什么都没有，人眼永远发现不了）。
 *   两者对一个「视觉验收工具」的意义完全不同，而既有 overflow 检查把它们当同一件事。见 §2.2 #5。
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
 * 选项：--spec <design-system-spec.json>   ← 从 L2 Spec 派生档位（推荐，见下）
 *       --scale 4,8,... --radius 2,4,... --font 11,12,... --baseline 1920x1030
 *       --tolerance 1 --min-touch 44 --font-family-max 3 --no-overlap --no-duplicate --json
 * 退出码：0 无 high；1 有 high或overlap；2 用法/输入错误。零依赖。
 *
 * 参数从哪来（1.3 · A2）：档位（spacing / radius / font / baseline）**优先从 L2 的
 * `design-system-spec.json` 派生**，不再每次手敲 CLI —— 手敲是 lessons #73 的根因：
 * 同一份 readback 换个档位就得出不同的告警数，**数字不可比**。优先级：
 *   `--scale` 等显式 CLI  >  `--spec` 派生  >  内置默认
 * 实际生效的来源逐项写进产物 `paramSource` 段（值 + 来自哪一节），控制台也打印一行。
 * spec 里该字段缺失时**回落到默认并如实标注** `default`，不静默用默认值冒充「来自规格」。
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SCALE = [4, 8, 12, 16, 24, 32, 48, 64, 96, 120, 160];
const DEFAULT_RADIUS = [2, 4, 6, 8, 12, 16, 20, 24];
const DEFAULT_FONT = [11, 12, 13, 14, 16, 18, 20, 24, 26, 28, 32, 36, 40, 48, 56, 64, 72];
const TOUCH_NAME = /(btn|button|tab|toggle|switch|chip|cta|按钮|标签页|开关|入口)/i;
const DEFAULT_FONT_FAMILY_MAX = 3; // better-typography #4(a)：字族 ≤ 3

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

/* ---------------- 从 L2 DS Spec 派生档位（1.3 · A2） ---------------- */

/** token 子组对象 → 数字档位列表。值是数字、或 `"8/16/24"` 这类档位串、或 `{value:…}`。 */
function tokenNumbers(group) {
  const out = [];
  const push = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string") for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  };
  for (const sub of Object.values(group || {})) {
    if (sub && typeof sub === "object") push(sub.value);
    else push(sub);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** typography 的子组对象结构特殊（有 size/lineHeight/weight），**只取 size**，不能通用递归。 */
function typographySizes(group) {
  const out = [];
  for (const sub of Object.values(group || {})) {
    if (sub && typeof sub === "object" && typeof sub.size === "number") out.push(sub.size);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** `responsive.baseline` 是自由文本（如 `"1920x1080 固定分辨率大屏"`），取其中的 `WxH`。 */
function baselineOf(text) {
  if (typeof text !== "string") return null;
  const m = /(\d{2,5})\s*[xX×*]\s*(\d{2,5})/.exec(text);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * 读一份 L2 DS Spec，派生档位。**只读不改**，取不到的项为 null（调用方回落默认并标注）。
 * @returns {{scale:number[]|null, radius:number[]|null, font:number[]|null, baseline:{width:number,height:number}|null, accessibility:{touchTarget:number|null, minFontSize:number|null, focusRing:string|null}}}}
 */
function deriveFromSpec(specPath) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.resolve(specPath), "utf8"));
  } catch (e) {
    console.error(`--spec 读取失败：${specPath} —— ${e.message}`);
    process.exit(2);
  }
  const t = d.tokens || {};
  const scale = tokenNumbers(t.spacing);
  const radius = tokenNumbers(t.radius);
  const font = typographySizes(t.typography);
  const baseline = baselineOf((d.responsive || {}).baseline);

  // 派生 accessibility 三字段（§2.2 第 0 项：参数同源余量）
  const acc = (d.accessibility || {});
  const touchTarget = toPosInt(acc.touchTarget?.value);
  const minFontSize = toPosInt(acc.minFontSize?.value);
  const focusRing = (acc.focusRing?.value === "none" || acc.focusRing?.value == null)
    ? null
    : String(acc.focusRing?.value ?? null);
  const fontFamilyMax = toPosInt(acc.fontFamilyMax?.value);

  return {
    scale: scale.length ? scale : null,
    radius: radius.length ? radius : null,
    font: font.length ? font : null,
    baseline,
    accessibility: { touchTarget, minFontSize, focusRing, fontFamilyMax },
  };
}

/** 把 spec 里 accessibility 字段转成「正整数 / 0 / null」。
 *  0 表示「本产物形态下该检查不适用」（big-screen 无触控 / 无键盘焦点）。
 *  null 表示「spec 未声明或不可解析」，由调用方回落默认并标 paramGaps。
 *  ⚠️ 与「缺字段/空串/全空白」区分：三者都应是 null，不是 0。*/
function toPosInt(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("用法：node tools/layout-audit.mjs <readback.json> [--spec <design-system-spec.json>] [--scale 4,8,12,...] [--baseline 1920x1030] [--no-overlap] [--no-duplicate] [--json]");
  process.exit(2);
}

let SCALE, RADIUS, FONT, TOL, MIN_TOUCH, FONT_FAMILY_MAX, BASELINE = null;
let MIN_TOUCH_UNSET = false;   // true = Spec 声明了 touchTarget=0（不适用）
let FONT_FAMILY_UNSET = false; // true = Spec 声明了 fontFamilyMax=0（不适用）
let CLI_MIN_TOUCH = null, CLI_FONT_FAMILY_MAX = null;
let CLI_SCALE = null, CLI_RADIUS = null, CLI_FONT = null, CLI_BASELINE = null;
try {
  CLI_SCALE = parseNumList("--scale", null);
  CLI_RADIUS = parseNumList("--radius", null);
  CLI_FONT = parseNumList("--font", null);
  TOL = Number(parseFlag("--tolerance", 1));
  // touchTarget / fontFamilyMax 从 CLI 取；Spec 不在 CLI 里
  const rawMinTouch = parseFlag("--min-touch", null);
  if (rawMinTouch === true) {
    MIN_TOUCH = 44;
  } else if (rawMinTouch !== null) {
    MIN_TOUCH = Number(rawMinTouch);
    if (Number.isNaN(MIN_TOUCH)) throw new Error("--min-touch 须为正整数");
  } else {
    MIN_TOUCH = 44; // 默认
  }
  const rawFamMax = parseFlag("--font-family-max", null);
  if (rawFamMax === true) {
    FONT_FAMILY_MAX = DEFAULT_FONT_FAMILY_MAX;
  } else if (rawFamMax !== null) {
    FONT_FAMILY_MAX = Number(rawFamMax);
    if (Number.isNaN(FONT_FAMILY_MAX)) throw new Error("--font-family-max 须为正整数");
  } else {
    FONT_FAMILY_MAX = DEFAULT_FONT_FAMILY_MAX; // 默认
  }
  if (rawMinTouch !== null && Number.isNaN(MIN_TOUCH)) throw new Error("--min-touch 须为正整数");
  if (rawFamMax !== null && Number.isNaN(FONT_FAMILY_MAX)) throw new Error("--font-family-max 须为正整数");
  CLI_MIN_TOUCH = rawMinTouch !== null ? MIN_TOUCH : null;
  CLI_FONT_FAMILY_MAX = rawFamMax !== null ? FONT_FAMILY_MAX : null;
  const b = parseFlag("--baseline", null);
  if (typeof b === "string") {
    const m = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(b.trim());
    if (!m) throw new Error("--baseline 需形如 1920x1030");
    CLI_BASELINE = { width: Number(m[1]), height: Number(m[2]) };
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

// 档位优先级：显式 CLI > `--spec` 派生 > 内置默认；实际来源逐项记入 paramSource（#72②）
const specArg = parseFlag("--spec", null);
const SPEC_PATH = typeof specArg === "string" ? specArg : null;
const derived = SPEC_PATH ? deriveFromSpec(SPEC_PATH) : null;
SCALE = CLI_SCALE ?? derived?.scale ?? DEFAULT_SCALE;
RADIUS = CLI_RADIUS ?? derived?.radius ?? DEFAULT_RADIUS;
FONT = CLI_FONT ?? derived?.font ?? DEFAULT_FONT;
BASELINE = CLI_BASELINE ?? derived?.baseline ?? null;

const MIN_FONT_SIZE = derived?.accessibility?.minFontSize ?? null;

// accessibility 三字段：CLI > Spec > 默认；Spec=0 表示「本产物不适用」而非「阈值为 0」
// ⚠️ 这是 #12 判据 ② 的应用：null/缺字段 ≠ 0 ≠ 空串；0 是「不适用」信号，必须区分
if (derived?.accessibility) {
  if (CLI_MIN_TOUCH != null) {
    MIN_TOUCH = CLI_MIN_TOUCH;
  } else if (derived.accessibility.touchTarget != null) {
    // spec 给了具体值（含 0）
    MIN_TOUCH = derived.accessibility.touchTarget;
    if (MIN_TOUCH === 0) MIN_TOUCH_UNSET = true;
  }
  // else: 回落 44（default），paramSource 将记 "default"
  if (CLI_FONT_FAMILY_MAX != null) {
    FONT_FAMILY_MAX = CLI_FONT_FAMILY_MAX;
  } else if (derived.accessibility.fontFamilyMax != null) {
    FONT_FAMILY_MAX = derived.accessibility.fontFamilyMax;
    if (FONT_FAMILY_MAX === 0) FONT_FAMILY_UNSET = true;
  }
}
// fallback（Spec 未给，且 CLI 也未给）：保持解析段的默认值
MIN_TOUCH = MIN_TOUCH ?? 44;
FONT_FAMILY_MAX = FONT_FAMILY_MAX ?? DEFAULT_FONT_FAMILY_MAX;

const paramSource = {
  spec: SPEC_PATH,
  scale: CLI_SCALE ? "cli:--scale" : derived?.scale ? "spec:tokens.spacing" : "default",
  radius: CLI_RADIUS ? "cli:--radius" : derived?.radius ? "spec:tokens.radius" : "default",
  font: CLI_FONT ? "cli:--font" : derived?.font ? "spec:tokens.typography[].size" : "default",
  baseline: CLI_BASELINE ? "cli:--baseline" : derived?.baseline ? "spec:responsive.baseline" : "none",
  minTouch: CLI_MIN_TOUCH != null ? "cli:--min-touch" : derived?.accessibility?.touchTarget != null ? "spec:accessibility.touchTarget" : "default",
  fontFamilyMax: CLI_FONT_FAMILY_MAX != null ? "cli:--font-family-max" : derived?.accessibility?.fontFamilyMax != null ? "spec:accessibility.fontFamilyMax" : "default",
  minWidthSize: derived?.accessibility?.minFontSize != null ? "spec:accessibility.minFontSize" : null,
};
// spec 给了、但该字段取不到值 ⇒ 这是「没查到」，必须说出来（不许静默用默认值冒充来自规格）
const specGaps = [];
if (SPEC_PATH) {
  if (!derived.scale) specGaps.push("tokens.spacing");
  if (!derived.radius) specGaps.push("tokens.radius");
  if (!derived.font) specGaps.push("tokens.typography[].size");
  if (!derived.baseline) specGaps.push("responsive.baseline");
  if (!derived.accessibility?.minFontSize) specGaps.push("accessibility.minFontSize");
  if (derived.accessibility?.touchTarget == null && CLI_MIN_TOUCH == null) specGaps.push("accessibility.touchTarget");
  if (derived.accessibility?.fontFamilyMax == null && CLI_FONT_FAMILY_MAX == null) specGaps.push("accessibility.fontFamilyMax");
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
/**
 * 几何覆盖率（1.3 · A1）。为什么「容器数」不够、必须再数节点：
 * `shallowParents` 是个**代理指标** —— 同一棵树、不同回读深度，它都能报「1 个容器」。
 * 实测（`.vibe/a1-probe-*.json`，用 harness 加载真实 `code.js` 走 `get-node`）：
 *   `{depth:1}`              → 2 个节点里只有 1 个带几何，报 1 个容器
 *   `{depth:2}`              → 5 个节点里只有 2 个带几何，**还是报 1 个容器**
 *   `{depth:3, detail:true}` → 5 个节点全带几何，L4 五类检查跑出 5 条
 * 而在前两种输入下报告都写「共 1 条」—— 与 `alignmentCoverage` 同一纪律：
 * **没查的规模必须可读**，否则「共 1 条」会被读成「查全了只有 1 条」。
 */
let shallowNodes = 0;        // 因不带几何而**一条检查都没跑到**的节点数（含其子树）
let auditedNodes = 0;        // 真正带几何、参与检查的节点数
let maxAuditedDepth = 0;     // 审到的最深层（根 = 0 层）
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
 * 「已开截断」的文本清单（1.3 · F4 第 3 步）。
 *
 * 为什么不进 `issues`：`textAutoResize=TRUNCATE` 是**设计意图**，不是违规 —— 单行标签开省略号
 * 完全正当。但它又**值得留痕**：截断一旦生效，节点上就不再有任何「完整文案」的痕迹，
 * 静态稿上看不出「这里其实少了几个字」。故按 `skipped` / `dataDrivenSpacing` 的同一纪律
 * **只留痕、不判违规**。要判「真被截」得比对内容长度，而静态稿看不到预期长度（§2.3 #12）。
 */
const truncatedText = [];
/** 假完美数字节点清单（1.4 · A4）：**只留痕、不判违规** —— 见下方逻辑 */
const fakePerfectText = [];
/** 中文占位符人名/单位名称（1.5 · A1，taste-skill #11）：**只留痕、不判违规** */
const placeholderNames = [];
/** 顺序词 tell（1.5 · A2，taste-skill #32）：**只留痕、不判违规** */
const orderWords = [];
/** 品牌名占位 tell（1.5 · A3，taste-skill #14）：**只留痕、不判违规** */
const brandPlaceholders = [];
/** 全树字族计数（font-family-count 用；`fontName` 也是零引用字段） */
const fontFamilies = new Map();

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

/** 整棵子树（含不带几何的层）的节点数 —— 「有多少个节点没跑到」的分母。 */
function countSubtree(n) {
  let c = 1;
  for (const k of Array.isArray(n.children) ? n.children : []) c += countSubtree(k);
  return c;
}

/** 输入里能看到的树深（根 = 0 层）。回读被截断时，这个数就是截断的位置。 */
function treeDepth(n) {
  const ks = Array.isArray(n.children) ? n.children : [];
  return ks.length ? 1 + Math.max(...ks.map(treeDepth)) : 0;
}

function walk(node, trail, sameSpace = true, depth = 0) {
  const pathStr = trail.join(" / ");
  const kids = Array.isArray(node.children) ? node.children : [];
  const geoKids = kids.filter((c) => has(c.width) && has(c.height));
  auditedNodes++;
  if (depth > maxAuditedDepth) maxAuditedDepth = depth;
  // 原判据是 `kids.length && !geoKids.length`（只认「这一层全裸」）。放宽成「有几个裸的」，
  // 是为了不依赖「同层几何必然同有同无」这条**当前实现**的巧合 —— 一旦回读改成按需展开，
  // 同层混合就会出现，而那正是这次治的病（静默漏算）。
  const bareKids = kids.filter((c) => !(has(c.width) && has(c.height)));
  if (bareKids.length) {
    shallowParents++;
    for (const c of bareKids) shallowNodes += countSubtree(c);
  }

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

  // ---- 字号下限（1.4 · 第 1 项，判据来自 intake §2.3 #16）----
  // ⚠️ 只有 minFontSize 来自 spec 且节点有 fontSize 时才判；Spec 未声明（MIN_FONT_SIZE==null）不进报告（不是"通过"，是"没查"）。
  // 反向对照：fontSize >= MIN_FONT_SIZE 不报。
  if (MIN_FONT_SIZE != null && has(node.fontSize) && node.fontSize < MIN_FONT_SIZE) {
    add("font-size-floor", "high", node,
      `fontSize=${node.fontSize}px < 规格下限 ${MIN_FONT_SIZE}px（spec:accessibility.minFontSize）—— 远距可读性红线`,
      { path: pathStr, measured: node.fontSize, allowed: MIN_FONT_SIZE });
  }

  // ---- 假完美数字留痕（1.4 · A4，taste-skill #13，语言无关子集）----
  // ⚠️ **只留痕、不判违规**（#72② 纪律）。原因：
  //   ① 静态稿上看不出「是否真的用了假数字」—— 设计稿里的数字可能是占位，也可能被后续替换
  //   ② 要确认是否为「假完美」需要理解文案语义（语言相关）
  //   ③ 本检查是**语言无关形态检测**：只看数字字符串的"形态特征"（全9/全0/连续整数/纯幂次等）
  //   因此归入文案 tell 语言无关子集，但仍只留痕。
  // 反向对照：characters 字段不存在时，fieldCoverage.charactersNodes=0 → checksEnabled 为 false → 进 unchecked。
  // ⚠️ 不能用 `has()` 判字符 — has 只认数字（typeof === "number"），characters 是字符串，必须显式 typeof 检查。
  if (typeof node.characters === "string" && node.characters) {
    const match = node.characters.match(/(\d+\.?\d*)/g);
    if (match) {
      for (const num of match) {
        // 假完美数字模式：全相同数字 / 纯 0.x99 / 纯连续整数 / 纯幂次
        const isFakePerfect =
          /^\d+$/.test(num) && num.length >= 3 && new Set(num.split('')).size === 1 || // 111, 999
          /^9+\.\d+$/.test(num) || // 99.99%, 9.99
          /^\d{1,2}\.0+$/.test(num) && parseFloat(num) >= 10 || // 50.0, 100.0
          /^\d+$/.test(num) && num.split('').every((d, i, arr) => i === 0 || d === String(parseInt(arr[0]) + i)).join('') === 'true'; // 连续整数
        if (isFakePerfect) {
          fakePerfectText.push({
            id: node.id,
            name: node.name,
            path: pathStr,
            characters: node.characters,
            match: num,
          });
          break; // 每个节点只记一条
        }
      }
    }
  }

  // ---- 文本容器形态 / 文本对齐 / 字族（1.3 · F4 第 3 步，解锁自「零引用字段」清单）-----
  // 三条都**只在字段存在时判**：字段不存在 ⇒ inputCoverage 计数为 0 ⇒ 进 unchecked（"没查"，不是"干净"）。
  if (node.textAutoResize === "NONE") {
    add("text-container-fixed", "medium", node,
      `文本容器 textAutoResize=NONE（宽高都固定）—— 文本一长就溢出或被静默裁掉；` +
      `要随内容自适应请用 HEIGHT（固定宽、随内容折行）或 WIDTH_AND_HEIGHT`,
      { path: pathStr, measured: "NONE", allowed: "HEIGHT / WIDTH_AND_HEIGHT" });
  }
  // TRUNCATE **不报违规**，只登记（见 `truncatedText` 的声明处）。这里刻意不 `add`。
  if (node.textAutoResize === "TRUNCATE") {
    truncatedText.push({
      id: node.id,
      name: node.name,
      path: pathStr,
      width: has(node.width) ? round(node.width) : null,
      characters: typeof node.characters === "string" ? node.characters.length : null,
    });
  }
  if (node.textAlign && node.textAlign.horizontal === "JUSTIFIED") {
    add("text-justified", "medium", node,
      `textAlign.horizontal=JUSTIFIED（两端对齐）—— 中英混排下字间距会被强行拉开、出现"河流"；` +
      `外部判据给的 Fix 是改回 start/left（判据出处：intake §2.3 #20）`,
      { path: pathStr, measured: "JUSTIFIED", allowed: "LEFT / CENTER / RIGHT" });
  }
  if (node.fontName && typeof node.fontName.family === "string") {
    fontFamilies.set(node.fontName.family, (fontFamilies.get(node.fontName.family) || 0) + 1);
  }
  if (has(node.width) && has(node.height) && TOUCH_NAME.test(node.name || "")) {
    // ⚠️ §2.2 第 0 项：MIN_TOUCH_UNSET=true 表示「本产物形态无触控要求」
    //   （big-screen 值守/遥控场景）；不进报告（不是通过，是 unchecked）。
    //   MIN_TOUCH_UNSET=false 且 MIN_TOUCH > 0 时按阈值判。
    //   MIN_TOUCH_UNSET=false 且 MIN_TOUCH === 0（理论情形）—— 按阈值 0 判，任何尺寸均违规。
    if (!MIN_TOUCH_UNSET) {
      const side = Math.min(node.width, node.height);
      if (side < MIN_TOUCH) {
        add("touch", "high", node, `可点击元素 ${round(node.width)}x${round(node.height)} 最小边 ${side} < ${MIN_TOUCH}（触控红线）`, { path: pathStr, measured: side, allowed: MIN_TOUCH });
      }
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
      // 几个像素的溢出多是坐标轴标签这类装饰性外挂，按 medium 报；真正撑破结构的才升 high。
      // ⚠️ 再加一档（1.3 · F4 第 3 步）：父级 `clipsContent=true` 时越界**被静默裁掉** ——
      //    导出图上什么都没有、人眼永远发现不了，与「看得见的溢出」不是一个量级 ⇒ 升 high。
      //    这让 overflow 这条既有检查开始消费 `clipsContent`（此前它是零引用字段）。
      const hidden = node.clipsContent === true;
      add("overflow", worst > 16 || hidden ? "high" : "medium", c,
        `"${c.name}" 越出父级 "${node.name}"（${round(node.width)}x${round(node.height)}）：${out.join("、")}` +
        (hidden ? `；且父级 clipsContent=true ⇒ 越界部分被**静默裁掉**（导出图上看不见，不是"不严重"，是"查不出来"）` : ""),
        { path: pathStr, measured: out.join("、"), allowed: "完全在父级本地盒子内" });
    }
  }

  // auto-layout 容器的间距与对齐由 Figma 保证，不再做几何推断
  // （但 duplicate 仍要查：auto-layout 下重复创建同样会留下重合节点）
  if (node.layoutMode && node.layoutMode !== "NONE") {
    if (CHECK_DUPLICATE && localSameSpace) auditDuplicates(geoKids, pathStr);
    for (const c of geoKids) walk(c, trail.concat(c.name), true, depth + 1);
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
  for (const c of geoKids) walk(c, trail.concat(c.name), true, depth + 1);
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

const totalNodes = countSubtree(root);
const inputDepth = treeDepth(root);
walk(root, [root.name], true, 0);

// ---- 独立文本遍历：检测中文文案 tell（1.5 · A1-A3）----
// 这个遍历独立于 walk，确保即使文本节点没有几何属性也能被检测到
const walkForText = (node, trail) => {
  const pathStr = trail.join(" / ");
  // 检测当前节点的 characters 字段
  if (typeof node.characters === "string" && node.characters) {
    const text = node.characters;
    // A1: 中文占位符人名/单位名称
    const placeholderNamePatterns = [
      /张三|李四|王五|小明|小红|某人|某某人/i,
      /某某公司|示例公司|某科技公司|某某科技|示例科技/i,
      /甲公司|乙公司|丙公司|丁公司/i,
    ];
    for (const pat of placeholderNamePatterns) {
      if (pat.test(text)) {
        placeholderNames.push({ id: node.id, name: node.name, path: pathStr, characters: text, match: pat.source });
        break;
      }
    }
    // A2: 顺序词 tell
    const orderWordPatterns = [/第一步|步骤[一二三四五六七八九十0-9]+|首先|其次|最后|阶段一|Phase\s*0?\d+/i];
    for (const pat of orderWordPatterns) {
      if (pat.test(text)) {
        orderWords.push({ id: node.id, name: node.name, path: pathStr, characters: text, match: pat.source });
        break;
      }
    }
    // A3: 品牌名占位
    const brandPattern = /某某科技|XX公司|示例品牌|品牌名|Acme|Nexus|SmartFlow/i;
    if (brandPattern.test(text)) {
      brandPlaceholders.push({ id: node.id, name: node.name, path: pathStr, characters: text, match: brandPattern.source });
    }
  }
  // 递归遍历所有子节点
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const c of kids) walkForText(c, trail.concat(c.name));
};
walkForText(root, [root.name]);

// 字族数是**全树**性质，不是单节点性质 ⇒ 只能在走完整棵树之后判（与 baseline 同类，故 node 传 root）。
// 为什么值得一条：字族数直接决定渲染成本与视觉一致性，且 `fontName` 此前是**零引用字段**。
// 上限默认 3（better-typography #4(a)：字族 ≤ 3）；`--font-family-max` 可调，0 = 关闭。
if (FONT_FAMILY_MAX > 0 && fontFamilies.size > FONT_FAMILY_MAX) {
  const ranked = [...fontFamilies.entries()].sort((a, b) => b[1] - a[1]);
  add("font-family-count", "medium", root,
    `全树用到 ${fontFamilies.size} 个字族（上限 ${FONT_FAMILY_MAX}）：` +
    ranked.map(([f, n]) => `${f}×${n}`).join(" / "),
    { path: root.name, measured: fontFamilies.size, allowed: FONT_FAMILY_MAX });
}

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
  // 1.3 · F4 第 3 步新增的三项：各自依赖一个此前无人读的字段，同样要探「字段在不在输入里」。
  let textAutoResizeNodes = 0;
  let textAlignNodes = 0;
  let fontNameNodes = 0;
  let clipsContentNodes = 0;
  let charactersNodes = 0;
  let total = 0;
  const walk = (n) => {
    total++;
    if (n.layoutMode && n.layoutMode !== "NONE") layoutNodes++;
    if (has(n.itemSpacing)) itemSpacingNodes++;
    if (n.padding && typeof n.padding === "object" && Object.values(n.padding).some(has)) paddingNodes++;
    if (typeof n.textAutoResize === "string") textAutoResizeNodes++;
    if (n.textAlign && typeof n.textAlign === "object") textAlignNodes++;
    if (n.fontName && typeof n.fontName.family === "string") fontNameNodes++;
    if (typeof n.clipsContent === "boolean") clipsContentNodes++;
    if (typeof n.characters === "string" && n.characters) charactersNodes++;
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return { total, paddingNodes, layoutNodes, itemSpacingNodes, textAutoResizeNodes, textAlignNodes, fontNameNodes, clipsContentNodes, charactersNodes };
})();

const high = grouped.filter((i) => i.severity === "high").length;
const byCheck = grouped.reduce((a, i) => { a[i.check] = (a[i.check] || 0) + i.occurrences; return a; }, {});
const report = {
  tool: "layout-audit",
  auditedRoot: { id: root.id, name: root.name, width: root.width, height: root.height },
  scales: { spacing: SCALE, radius: RADIUS, font: FONT, tolerance: TOL, minTouch: MIN_TOUCH, fontFamilyMax: FONT_FAMILY_MAX, baseline: BASELINE, minFontSize: MIN_FONT_SIZE },
  // 每个档位的**实际来源**（cli:… / spec:<节> / default）—— 参数不同源则数字不可比（#72② / #73）
  paramSource,
  // `--spec` 给了、但某节取不到值 ⇒ 该档位回落为内置默认。**单列一段**：
  // 它不改「检查跑没跑」，改的是「判据的尺子」。混进 unchecked 会让人误以为某项检查没执行。
  paramGaps: specGaps.length
    ? {
        spec: SPEC_PATH,
        missing: specGaps,
        note: "这几节在 spec 里取不到值，对应档位已回落为内置默认 —— 数字与他轮不可比，须先补 spec",
      }
    : null,
  checksEnabled: {
    spacing: true, padding: fieldCoverage.paddingNodes > 0, radius: true, "font-size": true,
    alignment: true, touch: true, overflow: true, baseline: Boolean(BASELINE),
    overlap: CHECK_OVERLAP, duplicate: CHECK_DUPLICATE,
    // 三项新检查同样是「字段在输入里才有效」—— 否则会是个永远报 0 条的检查（S1.5 的病）
    "text-container-fixed": fieldCoverage.textAutoResizeNodes > 0,
    "text-justified": fieldCoverage.textAlignNodes > 0,
    "font-family-count": FONT_FAMILY_MAX > 0 && fieldCoverage.fontNameNodes > 0,
    // 文案 tell 语言无关子集（1.4 · A4）
    "fake-perfect-numbers": fieldCoverage.charactersNodes > 0,
  },
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
    // 三项新检查的「字段缺了 ⇒ 没查」留痕（1.3 · F4 第 3 步）
    ...(fieldCoverage.textAutoResizeNodes > 0 ? [] : [`text-container-fixed / textTruncated (输入无 textAutoResize 字段)`]),
    ...(fieldCoverage.textAlignNodes > 0 ? [] : [`text-justified (输入无 textAlign 字段)`]),
    ...(FONT_FAMILY_MAX > 0 && fieldCoverage.fontNameNodes === 0 ? [`font-family-count (输入无 fontName.family 字段)`] : []),
    ...(MIN_TOUCH_UNSET ? [`touch (本产物形态无触控要求：spec.accessibility.touchTarget=0)`] : []),
    ...(MIN_FONT_SIZE == null ? [`font-size-floor (spec 未声明 accessibility.minFontSize)`] : []),
    ...(fieldCoverage.clipsContentNodes > 0 ? [] : [`overflow 的"静默隐藏"分级 (输入无 clipsContent 字段 ⇒ 越界一律按"看得见的溢出"判，看不见的那种分不出来)`]),
    // 1.4 · A4：文案 tell 语言无关子集（characters 字段不存在时 = 没查，必须如实声明）
    ...(fieldCoverage.charactersNodes > 0 ? [] : [`fake-perfect-numbers (输入无 characters 字段；bridge get-node 是否回读字符内容待确认)`]),
  ],
  /**
   * 「已开截断」的文本清单（1.3 · F4 第 3 步）。**只留痕、不判违规** ——
   * `TRUNCATE` 是设计意图；但截断生效后节点上不再留「完整文案」的痕迹，
   * 静态稿上看不出「这里少了字」。故列出来给人看，不进 `issues`、不改退出码。
   */
  textTruncated: truncatedText.length
    ? {
        reason: "textAutoResize=TRUNCATE ⇒ 已开省略号。**这不等于真被截** —— 是否真截取决于内容长度，静态稿看不到（§2.3 #12），故只报风险、不报事实。",
        nodes: truncatedText.slice(0, 20),
        count: truncatedText.length,
      }
    : null,
  // 假完美数字留痕（1.4 · A4）：**只留痕、不判违规**。
  // 这些数字形态上"太完美"，但无法从静态稿确认是否为真实数据还是占位符。
  fakePerfect: fakePerfectText.length
    ? {
        reason: "检测到形如全相同数字（111、999）或 99.99% 式的「假完美数字」—— 可能为占位符而非真实数据（taste-skill #13），静态稿无法确认语义，故只留痕。",
        nodes: fakePerfectText.slice(0, 20),
        count: fakePerfectText.length,
      }
    : null,
  // 1.5 · A1：中文占位符人名/单位（taste-skill #11）—— 只留痕、不判违规
  placeholderNames: placeholderNames.length
    ? {
        reason: "检测到中文占位符人名或单位名称（如张三/李四/某某公司），可能为占位而非真实用户数据（taste-skill #11），静态稿无法确认语义，故只留痕。",
        nodes: placeholderNames.slice(0, 20),
        count: placeholderNames.length,
      }
    : null,
  // 1.5 · A2：顺序词 tell（taste-skill #32）—— 只留痕、不判违规
  orderWords: orderWords.length
    ? {
        reason: "检测到顺序词 tell（如第一步/步骤X/首先/其次/最后），可能为结构化模板而非真实内容（taste-skill #32），静态稿无法确认语义，故只留痕。",
        nodes: orderWords.slice(0, 20),
        count: orderWords.length,
      }
    : null,
  // 1.5 · A3：品牌名占位（taste-skill #14）—— 只留痕、不判违规
  brandPlaceholders: brandPlaceholders.length
    ? {
        reason: "检测到品牌名占位 tell（如某某科技/XX公司/Acme/Nexus），可能为占位符而非真实品牌（taste-skill #14），静态稿无法确认语义，故只留痕。",
        nodes: brandPlaceholders.slice(0, 20),
        count: brandPlaceholders.length,
      }
    : null,
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
    ? `${shallowParents} 个容器的子级不带几何 —— 那部分共 ${shallowNodes} 个节点**一条检查都没跑到**；` +
      `用 get-node {depth:2~3, detail:true} 取全子树重跑`
    : null,
  // 几何覆盖率（1.3 · A1）。与 `shallowParents` 的差别是它给出**规模**：
  // 那条只说「1 个容器」，读不出「是 1 片孤叶没查，还是 3 个节点整棵没查」。
  // 详见变量声明处的实测三例（depth:1 → 1/2；depth:2 → 2/5，**两者都报 1 个容器**）。
  geometryCoverage: {
    auditedNodes,
    totalNodes,
    unauditedNodes: totalNodes - auditedNodes,
    shallowParents,
    shallowNodes,
    auditedDepth: maxAuditedDepth,
    inputDepth,
    note:
      "`auditedNodes` 是**带几何、真跑过检查**的节点数；`totalNodes` 是输入里能看到的全部节点。" +
      "两者不等时，差值那部分节点**一条检查都没跑到** —— 它们不是「查了没问题」，是「没查」。" +
      "`inputDepth` 是输入 JSON 能看到的树深，`auditedDepth` 是能审到的深度；" +
      "两者相差越多，说明回读被截断得越厉害（`get-node` 默认 `depth:1` 时子级只有 id/name/type）。",
  },
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
  console.log(`档位  spacing [${SCALE.join(",")}]  radius [${RADIUS.join(",")}]  容差 ${TOL}px  字族上限 ${FONT_FAMILY_MAX || "关"}${BASELINE ? `  基准 ${BASELINE.width}x${BASELINE.height}` : "  未给 --baseline（跳过 baseline 检查）"}`);
  // 参数从哪来必须可见 —— 同一份 readback 换个档位就换个结论，来源不明则数字无法横向比（#73）
  console.log(
    `参数来源  ${Object.entries(paramSource)
      .filter(([k]) => k !== "spec")
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}${SPEC_PATH ? `   ← --spec ${SPEC_PATH}` : "   ← 未给 --spec（档位用内置默认）"}`,
  );
  if (report.paramGaps) {
    console.log(`⚠  --spec 取不到：${report.paramGaps.missing.join(" / ")} —— 这几节回落到内置默认，数字与他轮不可比`);
  }
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
  // 「已开截断」单列一行：它不是违规（不进 issues），但**必须可见** ——
  // 截断生效后节点上不再留完整文案的痕迹，不列出来就没人知道「这里少了字」。
  if (report.textTruncated) {
    const t = report.textTruncated;
    const show = t.nodes.slice(0, 4).map((n) => `"${n.name}"`).join("、");
    console.log(
      `已截断文本  ${t.count} 个节点开了 TRUNCATE（省略号）—— ${show}${t.count > 4 ? ` …另 ${t.count - 4} 个（--json 看全）` : ""}` +
        `   ← 这是**风险清单不是违规**：真被截与否取决于内容长度，静态稿看不出来`,
    );
  }
  if (report.fakePerfect) {
    const f = report.fakePerfect;
    const show = f.nodes.slice(0, 4).map((n) => `"${n.name}"(${n.match})`).join("、");
    console.log(
      `假完美数字  ${f.count} 个节点含可疑数字（如 111、99.99%）—— ${show}${f.count > 4 ? ` …另 ${f.count - 4} 个（--json 看全）` : ""}` +
        `   ← 这是**风险清单不是违规**：无法从静态稿确认是否为占位符`,
    );
  }
  if (report.placeholderNames) {
    const p = report.placeholderNames;
    const show = p.nodes.slice(0, 4).map((n) => `"${n.name}"(${n.match})`).join("、");
    console.log(
      `占位符人名  ${p.count} 个节点含中文占位符（如张三/李四/某某公司）—— ${show}${p.count > 4 ? ` …另 ${p.count - 4} 个（--json 看全）` : ""}` +
        `   ← 这是**风险清单不是违规**：静态稿无法确认是否为真实数据`,
    );
  }
  if (report.orderWords) {
    const o = report.orderWords;
    const show = o.nodes.slice(0, 4).map((n) => `"${n.name}"(${n.match})`).join("、");
    console.log(
      `顺序词 tell ${o.count} 个节点含顺序词（如第一步/步骤X/首先）—— ${show}${o.count > 4 ? ` …另 ${o.count - 4} 个（--json 看全）` : ""}` +
        `   ← 这是**风险清单不是违规**：静态稿无法确认是否为真实内容`,
    );
  }
  if (report.brandPlaceholders) {
    const b = report.brandPlaceholders;
    const show = b.nodes.slice(0, 4).map((n) => `"${n.name}"(${n.match})`).join("、");
    console.log(
      `占位品牌名  ${b.count} 个节点含品牌占位（如某某科技/XX公司/Acme）—— ${show}${b.count > 4 ? ` …另 ${b.count - 4} 个（--json 看全）` : ""}` +
        `   ← 这是**风险清单不是违规**：静态稿无法确认是否为真实品牌`,
    );
  }
  if (report.shallowWarning) {
    const g = report.geometryCoverage;
    console.log(`\n⚠  ${report.shallowWarning}`);
    console.log(
      `   几何覆盖  ${g.auditedNodes}/${g.totalNodes} 个节点带几何（审到第 ${g.auditedDepth} 层 / 输入深 ${g.inputDepth} 层）` +
        ` ｜ ${g.shallowNodes} 个节点未参与检查   ← 这些不是「查了没问题」，是「没查」`,
    );
  }
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
