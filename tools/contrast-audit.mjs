#!/usr/bin/env node
/**
 * contrast-audit.mjs — Color 维对比度审计 + `accessibility.contrast` 声称值复算（1.2 / C1）
 *
 *   node tools/contrast-audit.mjs                       # 审计仓库自带 assets/examples/*.dsspec.json
 *   node tools/contrast-audit.mjs <spec.json>           # 审计单份 DS Spec
 *   node tools/contrast-audit.mjs <spec.json> --json
 *
 * 为什么存在：visual-critic.md 把「对比度」列为 Color 维 20% 权重的硬指标，L2 契约也要求
 * DS Spec 的 `accessibility.contrast` 逐条给出「前景/背景 对比值与结论」——但仓库里没有配套
 * 工具，那些数字是**人手写上去的，从没有人复算过**。首次运行本工具即发现：随包 3 份样例的
 * 13 条声称值里有 9 条与 WCAG 公式算出的结果不符（偏差 0.17~1.64，方向还不一致），说明它们
 * 是被「编」出来而非算出来的。这正是 1.2「立证据」要还的债：把断言变成可复算的证据。
 *
 * 工具做三件事：
 *   ① 正文矩阵（硬判据）—— `text.primary` / `text.regular` × 各 surface/background，
 *      阈值 4.5:1（WCAG AA 正文）。这条是 visual-critic.md 与 critic-mapping.md 的明文规则
 *      （深色底 < 4.5:1 必须路由 L2 改 token），所以只有它进退出码。
 *   ② 全量矩阵（信息项）—— 辅助/占位文本、品牌色、状态色、边框色的所有组合，给出精确比值与
 *      WCAG 档位。**刻意不进退出码**：DS Spec 并不声明「某 token 用在哪个背景上」，把这些组合
 *      一律当硬性要求，等于工具自己发明用法、凭空造出违规（如 example-highway 的 #00D4FF 是
 *      高亮色而非按钮填充，要求白字达标就是假的）。
 *   ③ 声称值核对 —— 解析 `accessibility.contrast` 每条声称值，逐条与复算比对，并交叉验证
 *      「声称里写的 hex」与「token 实际值」是否一致（抓「token 改了、声称没跟着改」）。
 *
 * 判据分档（避免工具自己发明要求）：
 *   硬（影响退出码）
 *     · ② 中任何「声称值与复算不符」「声称 hex 与 token 不符」
 *     · 声称标签 `PASS` 要求比值 ≥ 4.5；`PASS-LARGE` 要求 ≥ 3.0（这两条是无歧义的自我断言：
 *       既然声称可用，就得真达标）。`FAIL*` 与比值不符（如 3.3 却标 FAIL-TEXT）只**告警**——
 *       现有样例的 FAIL 用法本身就不一致（highway 在 3.3 标 FAIL-TEXT、saas 在 4.2 标
 *       PASS-LARGE），标签词表并无文档定义，工具不该替它立法。
 *     · 正文矩阵里任一对不达标，或取值无法计算（「算不出」不能当「通过」）。
 *   软（不影响退出码）
 *     · 全量矩阵的各项比值；正文 token 未出现在声称条目里的覆盖缺口（仅告警）。
 *
 * 取值与边界（都是踩过的坑）：
 *   · 判定用**未舍入**的比值（WCAG 明确「不得先舍入再判定」）；2 位小数只用于显示。
 *     若某值舍入后会跨过阈值，行尾标 `⚠边界`——防 4.499 显示成 4.50 被当通过。
 *   · 非 `#RRGGBB` 的取值（rgba() / 具名色 / 缺 value）记为 SKIP 并计数，**不算通过**。
 *   · 声称里的路径写 `text.primary` 或 `color.text.primary` 都能解析（两种写法各留后路）。
 *
 * 退出码：0 硬判据全过；1 有硬判据违规或声称值不符；2 用法/输入错误。零依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = path.join(ROOT, "assets", "examples");
const JSON_ONLY = process.argv.includes("--json");

/* ---------------- WCAG 2.x 对比度核心（精确实现，勿改） ---------------- */

/** `#RGB` / `#RRGGBB` -> [r,g,b]；非法返回 null（不要静默当黑色） */
function parseHex(v) {
  if (typeof v !== "string") return null;
  let h = v.trim().replace(/^#/, "");
  if (/^[0-9A-Fa-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** 相对亮度（WCAG 2.x 定义），非法输入返回 null */
function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 对比度比值（1~21），非法输入返回 null */
function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------- 角色分类（依据 §13 / visual-critic.md，不靠猜） ---------------- */

const IS_BG = /^color\.(surface|background)\./;
const IS_BODY = /^color\.text\.(primary|regular)$/;
const IS_AUX = /^color\.text\.(secondary|caption)$/;
const IS_TEXT = /^color\.text\./;
const IS_BRAND = /^color\.brand\./;
const IS_STATUS = /^color\.status\./;
const IS_BORDER = /^color\.border\./;

const AA_NORMAL = 4.5; // WCAG AA 正文
const AA_LARGE = 3.0; // WCAG AA 大字号 / 非文字边界
const AAA_NORMAL = 7.0;

/** 比值 -> WCAG 档位文字（用未舍入原值判定） */
function tierOf(ratio) {
  if (ratio === null) return "非法值";
  const aa = ratio >= AA_NORMAL ? "AA✓" : ratio >= AA_LARGE ? "AA✗(仅大字)" : "AA✗";
  return `${aa} ${ratio >= AAA_NORMAL ? "AAA✓" : "AAA✗"}`;
}

/* ---------------- 载入待审计的 DS Spec ---------------- */

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let targets;
if (positional.length) {
  targets = positional.map((f) => path.resolve(f));
} else {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`找不到样例目录 ${EXAMPLES_DIR}，请显式给出 DS Spec 路径`);
    process.exit(2);
  }
  targets = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((n) => n.endsWith(".dsspec.json"))
    .sort()
    .map((n) => path.join(EXAMPLES_DIR, n));
}
if (!targets.length) {
  console.error(`用法：node tools/contrast-audit.mjs [<spec.json> ...] [--json]`);
  process.exit(2);
}

/** 遍历 tokens.color，返回 [{path,value}]；path 以 `color.` 开头 */
function collectColors(spec) {
  const out = [];
  const walk = (o, p) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === "object" && typeof v.value === "string") out.push({ path: `${p}.${k}`, value: v.value });
      else if (v && typeof v === "object") walk(v, `${p}.${k}`);
    }
  };
  if (spec && spec.tokens && spec.tokens.color) walk(spec.tokens.color, "color");
  return out;
}

/** 解析声称里的 token 路径：`text.primary` / `color.text.primary` / `tokens.color.*` 皆可 */
function resolvePath(tokens, p) {
  for (const c of [p, `color.${p}`, `tokens.${p}`, `tokens.color.${p}`]) {
    const hit = tokens.find((t) => t.path === c);
    if (hit) return hit;
  }
  return null;
}

/** 归一化路径用于配对索引：`color.text.primary` / `tokens.color.x` / `text.primary` -> `text.primary` */
const normPath = (p) => String(p).replace(/^tokens\./, "").replace(/^color\./, "");

/* ---------------- 解析 accessibility.contrast 声称值 ---------------- */
// 形如：text.primary #111827 on surface.card #FFFFFF = 16.1:1 PASS（正文）
const CLAIM_RE =
  /^\s*([\w.\-]+)\s+(#[0-9A-Fa-f]{3,6})\s+on\s+([\w.\-]+)\s+(#[0-9A-Fa-f]{3,6})\s*=\s*([\d.]+)\s*:\s*1\s+([A-Z][A-Z\-]*)/;

const TOL_CLAIM = 0.05; // 声称值保留 1 位小数，允许半个最低位的差
const NEAR = 0.05; // 与阈值距离小于此值 -> 标 ⚠边界

/* ---------------- 主流程 ---------------- */

const reports = [];
let worstExit = 0;

for (const file of targets) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    reports.push({ file, error: `解析失败：${e.message}` });
    worstExit = Math.max(worstExit, 2);
    continue;
  }

  const tokens = collectColors(spec);
  const bgs = tokens.filter((t) => IS_BG.test(t.path));
  const bodyToks = tokens.filter((t) => IS_BODY.test(t.path));
  const auxToks = tokens.filter((t) => IS_AUX.test(t.path));
  const decoToks = tokens.filter((t) => IS_TEXT.test(t.path) && !IS_BODY.test(t.path) && !IS_AUX.test(t.path));
  const brandToks = tokens.filter((t) => IS_BRAND.test(t.path));
  const statusToks = tokens.filter((t) => IS_STATUS.test(t.path));
  const borderToks = tokens.filter((t) => IS_BORDER.test(t.path));

  /* --- ③ 先解析声称值（① 的覆盖核对要用到它） --- */
  const rawClaims = Array.isArray(spec.accessibility?.contrast) ? spec.accessibility.contrast : [];
  const claims = [];
  const nonPairLines = [];
  const claimIndex = new Map(); // `fgNorm|bgNorm` -> claim
  const softClaimIssues = [];

  for (const line of rawClaims) {
    const m = CLAIM_RE.exec(String(line));
    if (!m) {
      nonPairLines.push(String(line));
      continue;
    }
    const [, fgPath, fgHexRaw, bgPath, bgHexRaw, claimedStr, label] = m;
    const claimed = Number(claimedStr);
    const fgHex = fgHexRaw.toUpperCase();
    const bgHex = bgHexRaw.toUpperCase();
    const actual = contrast(fgHex, bgHex);
    const rec = { raw: String(line), fgPath, fgHex, bgPath, bgHex, claimed, actual, label, ok: true, problems: [], warnings: [] };

    if (actual === null) {
      rec.ok = false;
      rec.problems.push("声称里的 hex 无法解析");
    } else if (Math.abs(claimed - actual) > TOL_CLAIM) {
      rec.ok = false;
      rec.problems.push(`声称 ${claimed}:1 ≠ 复算 ${actual.toFixed(2)}:1（差 ${Math.abs(claimed - actual).toFixed(2)}）`);
    }
    // 声称 hex 与 token 实际值是否一致
    for (const [role, pth, hx] of [
      ["前景", fgPath, fgHex],
      ["背景", bgPath, bgHex],
    ]) {
      const tok = resolvePath(tokens, pth);
      if (!tok) {
        rec.warnings.push(`${role}路径 ${pth} 在 tokens 里找不到，无法交叉验证 hex`);
        continue;
      }
      if (String(tok.value).toUpperCase() !== hx) {
        rec.ok = false;
        rec.problems.push(`${role} ${pth} 声称 ${hx}，token 实际是 ${tok.value}`);
      }
    }
    // 自我断言的一致性（无歧义的那部分才进退出码）
    if (actual !== null) {
      if (label === "PASS" && actual < AA_NORMAL) {
        rec.ok = false;
        rec.problems.push(`标 PASS 但复算 ${actual.toFixed(2)} < ${AA_NORMAL}（正文阈值）`);
      }
      if (label === "PASS-LARGE" && actual < AA_LARGE) {
        rec.ok = false;
        rec.problems.push(`标 PASS-LARGE 但复算 ${actual.toFixed(2)} < ${AA_LARGE}（连大字号也不达标）`);
      }
      if (/^FAIL/.test(label) && actual >= AA_NORMAL) {
        rec.warnings.push(`标 ${label} 但复算 ${actual.toFixed(2)} ≥ ${AA_NORMAL}——实为可通过正文，标签词表无文档定义，仅告警`);
      }
      if (label === "FAIL-TEXT" && actual >= AA_LARGE) {
        rec.warnings.push(`标 FAIL-TEXT 但复算 ${actual.toFixed(2)} ≥ ${AA_LARGE}——按「大字号可用」读法应为 PASS-LARGE`);
      }
    }

    for (const w of rec.warnings) softClaimIssues.push({ ...rec, warning: w });

    claims.push(rec);
    claimIndex.set(`${normPath(fgPath)}|${normPath(bgPath)}`, rec);
  }
  const badClaims = claims.filter((c) => !c.ok);

  /* --- ① 正文矩阵（硬判据） --- */
  const bodyPairs = [];
  for (const fg of bodyToks) {
    for (const bg of bgs) {
      const ratio = contrast(fg.value, bg.value);
      const declared = claimIndex.has(`${normPath(fg.path)}|${normPath(bg.path)}`);
      const row = {
        fg: fg.path, fgValue: fg.value, bg: bg.path, bgValue: bg.value,
        min: AA_NORMAL, ratio, tier: tierOf(ratio), declared,
        near: ratio !== null && Math.abs(ratio - AA_NORMAL) < NEAR,
        verdict: ratio === null ? "skip" : ratio < AA_NORMAL ? "violation" : "pass",
      };
      if (row.verdict === "skip") row.note = `取值非 #RRGGBB（${fg.value} / ${bg.value}）——无法计算，不计通过`;
      else if (row.verdict === "violation") row.note = `低于正文 ${AA_NORMAL}:1 的硬性要求（critic-mapping.md：深色底 <4.5:1 必须路由 L2 调 text token）`;
      bodyPairs.push(row);
    }
  }
  const bodyViol = bodyPairs.filter((r) => r.verdict === "violation");
  const bodySkip = bodyPairs.filter((r) => r.verdict === "skip");
  // 覆盖缺口：正文 token 一次都没被声明（只告警，不判违规）
  const bodyUndeclared = bodyToks.filter(
    (t) => !bgs.some((bg) => claimIndex.has(`${normPath(t.path)}|${normPath(bg.path)}`)),
  );

  /* --- ② 全量矩阵（信息项） --- */
  const matrix = [];
  const pushRow = (fgPath, fgValue, bgPath, bgValue, kind, refMin) => {
    const ratio = contrast(fgValue, bgValue);
    matrix.push({
      kind, fg: fgPath, fgValue, bg: bgPath, bgValue, refMin, ratio, tier: tierOf(ratio),
      meetsRef: refMin === null || ratio === null ? null : ratio >= refMin,
      declared: claimIndex.has(`${normPath(fgPath)}|${normPath(bgPath)}`),
    });
  };
  for (const t of auxToks) for (const bg of bgs) pushRow(t.path, t.value, bg.path, bg.value, "辅助/占位（≥3 仅大字）", AA_LARGE);
  for (const t of decoToks) for (const bg of bgs) pushRow(t.path, t.value, bg.path, bg.value, "装饰性文本", null);
  for (const t of statusToks) for (const bg of bgs) pushRow(t.path, t.value, bg.path, bg.value, "语义色作文字（需 4.5）", AA_NORMAL);
  for (const t of brandToks) for (const bg of bgs) pushRow(t.path, t.value, bg.path, bg.value, "品牌色作文字（需 4.5）", AA_NORMAL);
  for (const t of brandToks) pushRow("#FFFFFF（白字）", "#FFFFFF", t.path, t.value, "品牌色作填充时的反色文字（需 4.5）", AA_NORMAL);
  for (const t of borderToks) for (const bg of bgs) pushRow(t.path, t.value, bg.path, bg.value, "非文字边界（WCAG 1.4.11 需 3）", AA_LARGE);

  let exit = 0;
  if (bodyViol.length || bodySkip.length || badClaims.length) exit = 1;
  worstExit = Math.max(worstExit, exit);

  reports.push({
    file: path.relative(ROOT, file).replace(/\\/g, "/"),
    name: (spec.brand && spec.brand.name) || "(未命名)",
    counts: {
      body: bodyPairs.length,
      bodyPassed: bodyPairs.filter((r) => r.verdict === "pass").length,
      bodyViolations: bodyViol.length,
      bodySkipped: bodySkip.length,
      matrix: matrix.length,
      matrixBelowRef: matrix.filter((r) => r.meetsRef === false).length,
      matrixDeclared: matrix.filter((r) => r.declared).length,
      claims: claims.length,
      badClaims: badClaims.length,
      claimWarnings: softClaimIssues.length,
      nonPairLines: nonPairLines.length,
    },
    bodyViolations: bodyViol,
    bodySkipped: bodySkip,
    bodyPairs,
    bodyUndeclared: bodyUndeclared.map((t) => t.path),
    matrix,
    claims,
    badClaims,
    claimWarnings: softClaimIssues,
    nonPairLines,
    exit,
  });
}

/* ---------------- 输出 ---------------- */

const bar = "=".repeat(62);
const f2 = (v) => (v === null ? " n/a" : v.toFixed(2));

if (JSON_ONLY) {
  console.log(
    JSON.stringify(
      {
        tool: "contrast-audit",
        wcag: { aaNormal: AA_NORMAL, aaLarge: AA_LARGE, aaaNormal: AAA_NORMAL },
        reports: reports.map(({ bodyPairs, matrix, claims, ...rest }) => rest),
        exit: worstExit,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} else {
  console.log(bar);
  console.log(`contrast-audit —— Color 维对比度审计 + 声称值复算（1.2 C1）`);
  console.log(`WCAG 阈值：正文 AA ${AA_NORMAL}:1 / AAA ${AAA_NORMAL}:1 ｜ 大字号与边界 AA ${AA_LARGE}:1`);
  console.log(bar);
  for (const r of reports) {
    if (r.error) {
      console.log(`\n✗ ${r.file}\n    ${r.error}`);
      continue;
    }
    console.log(`\n■ ${r.file}   ${r.name}`);
    console.log(`  ① 正文矩阵 ${r.counts.body} 对：通过 ${r.counts.bodyPassed} ｜ 违规 ${r.counts.bodyViolations} ｜ 无法计算 ${r.counts.bodySkipped}`);
    console.log(`  ② 全量矩阵 ${r.counts.matrix} 对（信息项，仅列低于参考值者）｜ ③ 声称值 ${r.counts.claims} 条：不符 ${r.counts.badClaims} ｜ 告警 ${r.counts.claimWarnings}`);

    console.log(`\n  ── ① 正文矩阵（硬判据，text.primary/regular ≥ ${AA_NORMAL}:1）──`);
    for (const v of r.bodyPairs) {
      const mark = v.verdict === "pass" ? "ok  " : v.verdict === "violation" ? "FAIL" : "?   ";
      console.log(`    ${mark} ${v.fg} ${v.fgValue} on ${v.bg} ${v.bgValue} = ${f2(v.ratio)}:1  ${v.tier}${v.near ? "  ⚠边界" : ""}${v.declared ? "  [已声明]" : ""}`);
      if (v.verdict !== "pass") console.log(`         → ${v.note}`);
    }
    if (r.bodyUndeclared.length) {
      console.log(`    ⚠ 未在 accessibility.contrast 里声明的正文 token：${r.bodyUndeclared.join("、")}（覆盖缺口，仅告警）`);
    }

    if (r.bodySkipped.length) {
      console.log(`\n  ── 无法计算（= 未验证，不能当通过）──`);
      for (const v of r.bodySkipped) console.log(`    ? ${v.fg} ${v.fgValue} on ${v.bg} ${v.bgValue}  ${v.note}`);
    }

    console.log(`\n  ── ② 全量矩阵：低于参考值者（信息项，不影响退出码）──`);
    const below = r.matrix.filter((m) => m.meetsRef === false);
    if (!below.length) console.log(`    （无）`);
    for (const m of below) {
      console.log(`    · ${m.fg} ${m.fgValue} on ${m.bg} ${m.bgValue} = ${f2(m.ratio)}:1 < ${m.refMin}  ${m.kind}${m.declared ? "  [已声明]" : ""}`);
    }

    console.log(`\n  ── ③ 声称值核对（accessibility.contrast）──`);
    if (!r.claims.length) console.log(`    （没有可解析的声称条目）`);
    for (const c of r.claims) {
      console.log(`    ${c.ok ? "✓" : "✗"} ${c.fgPath} ${c.fgHex} on ${c.bgPath} ${c.bgHex}：声称 ${c.claimed} ｜ 复算 ${f2(c.actual)} ｜ ${c.label}`);
      for (const p of c.problems) console.log(`        → ${p}`);
      for (const w of c.warnings) console.log(`        ~ ${w}`);
    }
    if (r.nonPairLines.length) {
      console.log(`    （${r.nonPairLines.length} 条非配对条目，未参与比对：${r.nonPairLines.map((s) => `「${s.slice(0, 22)}${s.length > 22 ? "…" : ""}」`).join("、")}）`);
    }
  }
  console.log(`\n${bar}`);
  const totalViol = reports.reduce((a, r) => a + ((r.bodyViolations && r.bodyViolations.length) || 0), 0);
  const totalSkip = reports.reduce((a, r) => a + ((r.bodySkipped && r.bodySkipped.length) || 0), 0);
  const totalBad = reports.reduce((a, r) => a + ((r.badClaims && r.badClaims.length) || 0), 0);
  const totalWarn = reports.reduce((a, r) => a + ((r.claimWarnings && r.claimWarnings.length) || 0), 0);
  if (worstExit === 2) console.log(`结果：输入错误`);
  else if (worstExit === 0) console.log(`结果：通过 —— 正文对比度全达标，声称值与复算一致（CONTRAST AUDIT OK）`);
  else console.log(`结果：未通过 —— 正文违规 ${totalViol} 项 ｜ 无法计算 ${totalSkip} 项 ｜ 声称值不符 ${totalBad} 条（另有 ${totalWarn} 条标签告警）`);
  console.log(bar);
}

process.exit(worstExit);
