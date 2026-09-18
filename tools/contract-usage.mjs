#!/usr/bin/env node
/**
 * contract-usage.mjs — 回读契约的**使用矩阵**（1.3 · F4 第 3 步）
 *
 *   node tools/contract-usage.mjs [--json]
 *
 * 为什么存在（`references/design-criteria-intake.md` §4.6）：
 *   筛外部设计判据时最贵的发现不是某条规则，而是一个**已经回读、却没有任何检查在读**的字段
 *   （`textAutoResize`）——它一条字段解锁三条规则。于是动作顺序应当**反过来**：
 *   **先列出「契约里没人用的字段」，再拿这份清单去找规则**，命中率远高于逐条读外部文档。
 *   本工具就是那份清单的可复现实现。不落成工具，下一轮又要靠人手 grep（lessons #81）。
 *
 * 口径（**单一事实源**）：契约字段从 `figma-plugin/code.js` 现场解析
 *   —— `styleInfo()` 的 `out.X =` 与 `nodeInfo()` 的 `info.X =` / 字面量键。
 *   **不写死清单**：契约改了（比如 D 组需求单落地后补了 `lineHeight`），本工具自动跟着变。
 *
 * ⚠️ 本工具是**代理指标**（本项目第 5 次踩这个主题，见 intake §4.7），必须知道它错在哪一边：
 *   - 判「**用**」的依据是「源码里有该字段的属性访问」。**源码里出现 ≠ 语义上真在用**
 *     （可能是转型、可能是透传）。⇒ 「用」这一档**必须人复核**，不得当结论。
 *   - 反方向才是它值钱的地方：**「零属性访问」⇒ 该字段结构性地不可能有任何判据**。
 *     这是**可判定的**（不依赖语义），也是我们真正要的那一半。
 *   ⇒ 所以本工具**只在「无」这一档下结论**，其余两档一律标为「待复核」。
 *
 * 判据（`UNUSED_OK` 允许清单，**双向**，这是它作为「裁判」而不是「报告」的地方）：
 *   ① 每个契约字段，要么有属性访问，要么在 `UNUSED_OK` 里**写明理由**（理由不得为空/纯空白）；
 *   ② `UNUSED_OK` 里的键**必须真的存在于契约**（键写错/契约已删 ⇒ FAIL，防清单腐烂）；
 *   ③ `UNUSED_OK` 里的字段**不得已经有属性访问**（已经用上了就该从清单里删 ⇒ FAIL）。
 *   ②③ 是**反向控制**：只验①的话，一个「所有字段都塞进允许清单」的清单也能全绿。
 *
 * 退出码：0 = 双向一致；1 = 判据不过；2 = 用法/解析错误。零依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PLUGIN = path.join(REPO, "figma-plugin", "code.js");
const CONSUMER_DIR = HERE; // 只扫 tools/：问题问的是「有没有**检查**在读」

const JSON_ONLY = process.argv.slice(2).includes("--json");

/**
 * 显式声明「这个字段暂时没有判据」，并**写明理由**。
 * 理由必须是**为什么现在不收编**，不是「以后再说」——空话会让这张清单失去意义。
 * 契约里出现新字段（或某字段被用上）而这里没跟着改 ⇒ 判据①②③会当场 FAIL。
 */
const UNUSED_OK = {
  /* ---- 一档：可回读、有信息量，但**判据还没立**（收编要等对应的检查类） ---- */
  // ⚠️ `fills` / `strokes` 已于 2026-09-18（F3②）由 anchor-compare.mjs 收编（画布实际用色的解析
  //    通道，描边色与填充色同权计入），按判据①从本表删除 —— 「已收编」的条目不得留在这里，
  //    否则清单与源码就说了两套话。仍待立的判据：画布色 ↔ Spec token 的一致性比对
  //    （contrast-audit 只读 Spec，不读画布）；better-ui #3（阴影 vs 边框）等 effects 一并立。
  imageFills:
    "F2（2026-09-18 用户批准解冻）新增：图片填充的回读凭证（image:<hash>:<scaleMode>），" +
    "由 set-image-fill 的更新回包与 get-node 携带。**判据还没立**：图片填充与 Spec 图片位的一致性比对" +
    "（「Spec 说这里该有图」⇒ 画布真的是图）尚不存在，且 L4 视觉 critic 对图片的判定目前走像素通道" +
    "（pixel-proof），两者互证的交叉判据也未立 —— 先登记，等图片类检查收编时一起。",
  // ⚠️ `lineHeight` / `letterSpacing`（FR-3/FR-4，2026-09-18）**不在**此表：qa-plugin 已在读
  //    （形状断言），判据③不许留。但注意「用」只到 L1 —— better-typography 的行高/字距
  //    **业务判据**仍未立（行高要与 fontSize 交叉、字距要先过语言分档，见各自 FR 的理由）。
  // ⚠️ `fillCount` / `fillOpacities`（FR-5，2026-09-18）**不在**此表：qa-plugin 已在读（判据③）。
  //    「非纯色填充线索」（fillCount 与 fills.length 的差）与「半透明稀释对比度」的
  //    **业务判据**依旧没立 —— fillOpacities 的落点是与 contrast-audit 交叉（见 opacity 行），
  //    目前「用」只到 L1 形状断言。
  strokeWeight:
    "外部判据里唯一用到它的是 better-ui #14（stroke 宽度匹配字重）尾部，而那条的主体在" +
    "「一个界面只用一套图标库」——画布没有「库」这个概念 ⇒ 过筛判为**无对象**，只留下一个没有对象的半句。",

  opacity:
    "**注意：intake §1.5 曾把 opacity 整条写成「结构性地不可回读」——那是错的**（一个符号装了两个意思，" +
    "lessons #83 同族）：节点级 opacity **一直在回读里**（运行 B 376/376）；**填充级** paint.opacity " +
    "也已于 FR-5（2026-09-18，用户批准解冻）经 fillOpacities 平行数组可回读。之所以仍不收编节点级 opacity：" +
    "opacity < 1 在文本上是**合法设计手法**（占位符 / 次要文字），单独报就是假阳性机器 ⇒ 要与 " +
    "contrast-audit 的对比度声称**交叉**才有意义（说明「声称的 4.8:1 被 opacity 稀释」），而交叉判据还没立" +
    "—— fillOpacities 与它共用同一个落点，收编时一起。",
  // ⚠️ `characters` **不在**此表里 —— 它已被 layout-audit 的 textTruncated 清单消费（取长度）。
  //    若把它留在这里，判据③会当场 FAIL（「已收编就该从清单里删掉」）—— 这正是那条反向控制的意义。
  //    ⚠️ 但**长度以外**的用法（标点 / 混排）还没做：标点类规则（better-typography #13）是
  //    **拉丁排版惯例**，照搬到中文产物会系统性假阳性（intake §1.6 第三问），必须先按语言分档 ⇒
  //    不是「以后再说」，是「要先造一个语言闸门」。见 intake §七。
  parentId:
    "本管线的树是**嵌套**的（children 已给出结构），parentId 是冗余信息。它只被 qa-bridge / qa-plugin 当作" +
    "**op 参数**写过，没有判据在读。若哪天回读改成一维节点表（按 parentId 重建树），它才会变成必需。",
  vectorPathCount:
    "**判据缺位**：本管线没有「图表必须是真几何、不是截图」的检查。pixel-proof 读的是**导出的 PNG**，" +
    "矢量信息到那一步已经没了（intake §1.5 把它的读者写成 pixel-proof，同样是印象）。" +
    "留作该检查立起来时的数据源。",
  vectorData:
    "同上（vectorPathCount 的首段路径数据）。它存在的意义是「能证明是真的路径而不是一段 Base64 图片」，" +
    "而那条检查还没有。",

  /* ---- 二档：**对象不存在**（不是漏收编）—— 与「同心圆角」同族，见 intake §三.1 ---- */
  primaryAxisAlignItems:
    "**本管线里永远没有对象**：这四个字段只在 layoutMode !== NONE 时才序列化，" +
    "而实测运行 B 的 377 个节点 layoutMode **全为 NONE**（管线用绝对坐标排布，不用 auto-layout）⇒ " +
    "结构性地 0 个对象。若哪天管线改用 auto-layout，它会与 layoutMode / itemSpacing / padding 一起活过来。",
  counterAxisAlignItems: "同上（两轴对齐的另一轴，同一前提）。",
  primaryAxisSizingMode: "同上（两轴 sizing mode 之一，同一前提）。",
  counterAxisSizingMode: "同上。",

  /* ---- 三档：**可回读但恒为常量 ⇒ 没有信息量，不得做判据** ---- */
  layoutSizing:
    "**最值得记的一条**：实测运行 B 里 376/376 都是 {horizontal:FIXED, vertical:FIXED} —— 而同一批 92 个文本" +
    "节点报的是 textAutoResize: WIDTH_AND_HEIGHT（「宽高都自适应」）⇒ **两个字段互相矛盾**。" +
    "根因：layoutSizing* 只在**有 auto-layout 父级**时才有意义，无 auto-layout 的树上读到的只是未触碰的默认值。" +
    "⇒ 在无 auto-layout 的产物里它是**常量**、没有信息量。**故不得拿它做判据** —— 会得到" +
    "「所有节点都有宽度上限」这种恒真的假绿。intake §2.3 #9 原本打算用它判「宽度上限存在性」，本条就是那条落点被撤掉的原因。",
};

/* ------------------------------------------------------------------ *
 *  一、从 code.js 解析契约字段（单一事实源）
 * ------------------------------------------------------------------ */

/** 取一个 `function name(...) {` 的函数体（按大括号配对，够用且不引依赖）。 */
function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`code.js 里找不到 function ${name}`);
  let i = src.indexOf("{", start);
  if (i === -1) throw new Error(`function ${name} 没有函数体`);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(i + 1, j);
    }
  }
  throw new Error(`function ${name} 的大括号不配对`);
}

/**
 * 取出 `const info = { … }` 这个字面量的**键名**。
 *
 * ⚠️ 为什么不能图省事用 `/^\s{2}([\w$]+):/gm`：真实 `code.js` 里字面量的键缩进是 **4 个空格**
 * （`const info = {` 在 2 空格、键在 4 空格），那个正则**一个都匹配不到**，
 * 于是 `id` / `name` / `type` / `width` / `height` / `x` / `y` 七个字段**被静默漏掉** ——
 * 而工具照样打印「契约 26 个字段」并给出结论。**这正是本仓库反复在抓的那类错**：
 * 工具漏了东西，报告上看不出来。改为按大括号配对精确取出字面量，再在字面量内部扫键。
 */
function infoLiteralKeys(body) {
  const at = body.indexOf("const info");
  if (at === -1) throw new Error("nodeInfo 里找不到 `const info = {`");
  const open = body.indexOf("{", at);
  if (open === -1) throw new Error("`const info` 后面没有对象字面量");
  let depth = 0;
  let end = -1;
  for (let j = open; j < body.length; j++) {
    if (body[j] === "{") depth++;
    else if (body[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) throw new Error("`const info` 的对象字面量大括号不配对");
  const lit = body.slice(open + 1, end);
  const keys = [];
  for (const m of lit.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g)) keys.push(m[1]);
  return keys;
}

/** 解析契约。返回 [{field, where, line}]，按字段名去重（保留首次出现的出处）。 */
function parseContract() {
  const src = fs.readFileSync(PLUGIN, "utf8");
  const found = new Map();
  const note = (field, where, offset) => {
    if (!field || found.has(field)) return;
    found.set(field, { field, where, line: src.slice(0, offset).split("\n").length });
  };

  const style = functionBody(src, "styleInfo");
  const styleAt = src.indexOf("function styleInfo(");
  for (const m of style.matchAll(/out\.([A-Za-z_$][\w$]*)\s*=/g)) note(m[1], "styleInfo", styleAt + m.index);

  const info = functionBody(src, "nodeInfo");
  const infoAt = src.indexOf("function nodeInfo(");
  const literalKeys = infoLiteralKeys(info);
  for (const k of literalKeys) note(k, "nodeInfo(literal)", infoAt);
  for (const m of info.matchAll(/info\.([A-Za-z_$][\w$]*)\s*=/g)) note(m[1], "nodeInfo", infoAt + m.index);

  return { fields: [...found.values()], literalKeys };
}

/* ------------------------------------------------------------------ *
 *  二、在消费方源码里找「有没有属性访问」
 * ------------------------------------------------------------------ */

/**
 * 去掉注释与字符串字面量再匹配。
 * 为什么必须去：文件头与 `unchecked` 的**模板串**里大量出现字段名（`padding` / `clipsContent`），
 * 不去掉的话「只是被文档提到」会被读成「有检查在读」—— 正好是我们最想避免的那种假绿。
 * 注释按行判断（`trim` 后以 `//` `*` `/*` 开头），不碰行内的 `//`（`http://` 之类）。
 */
function stripCommentsAndStrings(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l))
    .join("\n");
  return s.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/**
 * 消费方白名单是**排除式**的，三处排除各有理由（都写成常量，避免下次有人"顺手"加回来）：
 *   · 本工具自己 —— 自引用会把「零引用」全变成「用」。
 *   · `*-mutation.mjs` —— 变异测试是**造**数据（往夹具里塞 `clipsContent: true`），
 *     不是在读契约。算进来会让每个字段都"有人读"。
 *   · `figma-harness.mjs` —— 它是 mock 的**提供方**：为了跑真实 `code.js`，
 *     它给假节点造出 `clipsContent: false` / `textAutoResize: "NONE"` 这些默认值。
 *     「提供字段」与「消费字段」是两件事，混淆会让「零引用」全部消失。
 * 其余校验工具（`qa-plugin` 等）**保留**：它们确实在读序列化结果（虽则读的是插件自测目的）。
 */
const EXCLUDE = new Set(["contract-usage.mjs", "figma-harness.mjs"]);
const consumers = () =>
  fs
    .readdirSync(CONSUMER_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => !EXCLUDE.has(f))
    .filter((f) => !f.endsWith("-mutation.mjs"))
    .map((f) => ({ file: f, code: stripCommentsAndStrings(fs.readFileSync(path.join(CONSUMER_DIR, f), "utf8")) }));

/**
 * 三种读法分开计：
 *   access  —— `.field`：确定是属性访问
 *   index   —— `["field"]` / `['field']`：确定是下标访问
 *   bare    —— 裸词：**弱证据**（可能是局部变量、可能是对象键、可能是拼错的别的字段）
 * 判据只用 access + index；bare 只为「有」这一档提供线索（不进结论）。
 */
function usageOf(field, list) {
  const esc = field.replace(/[$]/g, "\\$");
  const reAccess = new RegExp(`\\.${esc}\\b(?![\\w$])`, "g");
  const reIndex = new RegExp(`\\[\\s*["'\`]${esc}["'\`]\\s*\\]`, "g");
  const reBare = new RegExp(`\\b${esc}\\b`, "g");
  const at = { access: [], index: [], bare: [] };
  for (const { file, code } of list) {
    if (reAccess.test(code)) at.access.push(file);
    reAccess.lastIndex = 0;
    if (reIndex.test(code)) at.index.push(file);
    reIndex.lastIndex = 0;
    if (reBare.test(code)) at.bare.push(file);
    reBare.lastIndex = 0;
  }
  return at;
}

/* ------------------------------------------------------------------ *
 *  三、判定
 * ------------------------------------------------------------------ */

let contract;
let literalKeys;
try {
  const parsed = parseContract();
  contract = parsed.fields;
  literalKeys = parsed.literalKeys;
} catch (e) {
  console.error(`契约解析失败：${e.message}`);
  process.exit(2);
}
/**
 * 解析守卫 —— **本地就有一条血泪**：本工具第一版用 `/^\s{2}([\w$]+):/` 扫字面量键，
 * 因为真实缩进是 4 空格，**7 个字段被静默漏掉**，而报告照样打印「契约 26 个字段」并给出结论。
 * 所以解析结果必须过两道**下限**（只是下限：契约只会变长，真要变小就显式改这里）：
 *   ① 字面量键数 —— 直接盯住上面那个 bug（`nodeInfo` 的 `const info = {` 至少有 7 个键）
 *   ② 契约总字段数 —— 挡住「正则整段失配」这类整体性退化
 * 宁可响亮失败，也不要「解析到很少的字段 ⇒ 无违规 ⇒ 绿」（那种绿是假绿）。
 */
if (literalKeys.length < 5) {
  console.error(
    `契约解析异常：nodeInfo 的字面量只解析到 ${literalKeys.length} 个键（${literalKeys.join(",") || "空"}）—— ` +
      `检查 code.js 的 \`const info = {\` 是否改了形状`,
  );
  process.exit(2);
}
if (contract.length < 25) {
  console.error(`契约解析结果只有 ${contract.length} 个字段，明显不对（下限 25）—— 检查 code.js 结构是否变了`);
  process.exit(2);
}

const list = consumers();
const rows = contract.map((c) => {
  const u = usageOf(c.field, list);
  const strong = [...new Set([...u.access, ...u.index])];
  let verdict;
  if (strong.length) verdict = "用";
  else if (u.bare.length) verdict = "待复核";
  else verdict = "无";
  return { ...c, verdict, access: u.access, index: u.index, bare: u.bare, used: strong };
});

const violations = [];
for (const r of rows) {
  // ① 无属性访问的字段必须在允许清单里，且理由非空
  if (r.verdict === "无" || r.verdict === "待复核") {
    const reason = UNUSED_OK[r.field];
    if (reason === undefined) {
      violations.push(`${r.field}：契约里有、源码里没有属性访问，但不在 UNUSED_OK 里 —— 要么去用它，要么写明为什么先不用`);
    } else if (!String(reason).trim()) {
      violations.push(`${r.field}：UNUSED_OK 的理由是空的（空话等于没写）`);
    }
  }
}
// ② 允许清单里不得有契约里不存在的键（防清单腐烂）
const byField = new Map(rows.map((r) => [r.field, r]));
for (const f of Object.keys(UNUSED_OK)) {
  if (!byField.has(f)) violations.push(`UNUSED_OK 里的 "${f}" 不在契约里 —— 字段已改名/已删，清单要跟着改`);
}
// ③ 允许清单里不得有「其实已经在用」的字段（反向控制：这条防「全塞进清单」的假绿）
for (const [f, reason] of Object.entries(UNUSED_OK)) {
  const r = byField.get(f);
  if (r && r.used.length) {
    violations.push(`UNUSED_OK 里的 "${f}" 已经有属性访问（${r.used.join(", ")}）—— 已收编就该从清单里删掉（理由原文："${String(reason).slice(0, 40)}"）`);
  }
}

const unused = rows.filter((r) => r.verdict === "无");
const weak = rows.filter((r) => r.verdict === "待复核");
const report = {
  tool: "contract-usage",
  contractSource: "figma-plugin/code.js",
  consumerScope: "tools/*.mjs（不含变异测试；变异测试是造数据不是在读契约）",
  counts: { contract: rows.length, used: rows.filter((r) => r.verdict === "用").length, weak: weak.length, unused: unused.length },
  // 「用」只做到 L1（源码里有属性访问）。L2（那个访问是在读**回读产物**，还是在读**计划 / spec**）
  // 本工具**故意不做**：`precheck.mjs` 的 `step.params.effects` 是属性访问，但读的是计划不是回读；
  // 机械手段分不出来，硬分就会给出错误结论。故把读者名单原样交给下面这行 note。
  caution:
    "「用」的依据只是**源码里有该字段的属性访问**（L1），**不证明语义上真在用**，也不区分「读回读产物」" +
    "与「读计划/spec」（L2，须人看读者名单）。本工具只在「无」这一档下结论：" +
    "零属性访问 ⇒ 该字段结构性地不可能有任何判据。",
  rows: rows.map((r) => ({ field: r.field, where: r.where, line: r.line, verdict: r.verdict, usedBy: r.used, bareOnly: r.bare })),
  unused: unused.map((r) => r.field),
  weak: weak.map((r) => r.field),
  unusedOk: UNUSED_OK,
  violations,
};

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\ncontract-usage   契约源 figma-plugin/code.js   消费方 tools/*.mjs`);
  console.log(`契约字段 ${rows.length} 个：在用 ${report.counts.used} ｜ 弱引用待复核 ${weak.length} ｜ 零引用 ${unused.length}\n`);
  const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).replace(/[\u4e00-\u9fa5]/g, "xx").length));
  console.log(`  ${pad("字段", 26)}${pad("出处", 12)}${pad("判定", 8)}谁在读`);
  for (const r of rows) {
    const who = r.verdict === "用" ? r.used.join(", ") : r.bare.length ? `（仅提及：${r.bare.join(", ")}）` : "——";
    console.log(`  ${pad(r.field, 26)}${pad(r.where, 12)}${pad(r.verdict, 8)}${who}`);
  }
  if (report.unused.length) {
    console.log(`\n⭐ 零引用（结构性地不可能有判据 —— 这就是「未使用字段清单」）：`);
    for (const f of report.unused) console.log(`   ${f}${UNUSED_OK[f] ? "" : "   ⚠ 不在 UNUSED_OK 里"}`);
  }
  if (report.weak.length) console.log(`\n弱引用（只有裸词、无属性访问 —— 多半只是被提到，需人看一眼）：${report.weak.join(" / ")}`);
  console.log(`\n⚠  「用」只到 L1（源码里有属性访问），**不证明是在读回读产物**（precheck 读的是计划）；「零引用」才是可判定的结论。`);
  if (violations.length) {
    console.log(`\n判据不过（${violations.length} 条）：`);
    for (const v of violations) console.log(`  ✗ ${v}`);
  } else {
    console.log(`\n判据通过：${rows.length} 个契约字段要么有消费者、要么在 UNUSED_OK 里写明了理由（双向一致）。\n`);
  }
}

process.exit(violations.length ? 1 : 0);
