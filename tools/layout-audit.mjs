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
 *   overflow   子节点越出父节点边界
 *   baseline   顶层页框尺寸与基准不符
 *   touch      可点击元素小于最小触控边长
 *
 * 选项：--scale 4,8,... --radius 2,4,... --font 11,12,... --baseline 1920x1030
 *       --tolerance 1 --min-touch 44 --json
 * 退出码：0 无 high；1 有 high；2 用法/输入错误。零依赖。
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
  console.error("用法：node tools/layout-audit.mjs <readback.json> [--scale 4,8,12,...] [--baseline 1920x1030] [--json]");
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

// 沿轴向堆叠时的三个关键维度：pos=沿轴位置，size=沿轴长度，cross=跨轴长度（同列/同行应一致），edge=跨轴边缘（应齐）
const AXES = {
  v: { pos: "y", size: "height", cross: "width", edge: "x", edgeLabel: "左" },
  h: { pos: "x", size: "width", cross: "height", edge: "y", edgeLabel: "上" },
};

function walk(node, trail) {
  const pathStr = trail.join(" / ");
  const kids = Array.isArray(node.children) ? node.children : [];
  const geoKids = kids.filter((c) => has(c.width) && has(c.height));
  if (kids.length && !geoKids.length) shallowParents++;

  // itemSpacing=0 是"不设自动间距"的合法取值，不是档位违规
  if (has(node.itemSpacing) && node.itemSpacing !== 0 && node.layoutMode && node.layoutMode !== "NONE" && !inScaleExact(node.itemSpacing, SCALE)) {
    add("spacing", "medium", node, `itemSpacing=${node.itemSpacing} 不在档位 [${SCALE.join(",")}]`, { path: pathStr, measured: node.itemSpacing, allowed: SCALE });
  }
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
  if (node.layoutMode && node.layoutMode !== "NONE") {
    for (const c of geoKids) walk(c, trail.concat(c.name));
    return;
  }

  for (const ax of Object.values(AXES)) {
    const stack = geoKids.slice().sort((a, b) => a[ax.pos] - b[ax.pos]);
    for (let i = 1; i < stack.length; i++) {
      const prev = stack[i - 1];
      const cur = stack[i];
      if (Math.abs(prev[ax.cross] - cur[ax.cross]) > TOL) continue;  // 跨轴长度不同，不构成一列/一行
      const gap = round(cur[ax.pos] - (prev[ax.pos] + prev[ax.size]));
      if (gap < -TOL) continue;                                     // 互相重叠，另由 overflow 反映
      if (!inScale(gap, SCALE)) {
        add("spacing", "medium", cur, `"${prev.name}" 与 "${cur.name}" 的间距 ${gap}px 不在档位 [${SCALE.join(",")}]`, { path: pathStr, measured: gap, allowed: SCALE });
      }
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

const high = grouped.filter((i) => i.severity === "high").length;
const report = {
  tool: "layout-audit",
  auditedRoot: { id: root.id, name: root.name, width: root.width, height: root.height },
  scales: { spacing: SCALE, radius: RADIUS, font: FONT, tolerance: TOL, minTouch: MIN_TOUCH, baseline: BASELINE },
  summary: {
    total: grouped.length,
    rawTotal: issues.length,
    bySeverity: { high, medium: grouped.length - high },
    byCheck: grouped.reduce((a, i) => { a[i.check] = (a[i.check] || 0) + i.occurrences; return a; }, {}),
  },
  shallowParents,
  shallowWarning: shallowParents
    ? `${shallowParents} 个容器只有不带几何的子级（典型 depth:1 轻量回读）—— Layout 深审不可用，请用 get-node {depth:2~3, detail:true} 重取`
    : null,
  issues: grouped,
  generatedAt: new Date().toISOString(),
};

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nlayout-audit   ${root.name}   ${round(root.width)}x${round(root.height)}`);
  console.log(`档位  spacing [${SCALE.join(",")}]  radius [${RADIUS.join(",")}]  容差 ${TOL}px${BASELINE ? `  基准 ${BASELINE.width}x${BASELINE.height}` : "  未给 --baseline（跳过 baseline 检查）"}`);
  if (report.shallowWarning) console.log(`\n⚠  ${report.shallowWarning}`);
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
    console.log(`分类（按出现次数）：${Object.entries(report.summary.byCheck).map(([k, v]) => `${k} ${v}`).join(" / ")}\n`);
  }
}

process.exit(high > 0 ? 1 : 0);
