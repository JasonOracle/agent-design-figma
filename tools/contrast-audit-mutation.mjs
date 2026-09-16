#!/usr/bin/env node
/**
 * contrast-audit-mutation.mjs — contrast-audit.mjs 的配套变异测试（1.2 · C1）
 *
 * 为什么要有这个文件：`qa-l2` 的教训（references/lessons.md #33）——**校验器没有配套变异测试，
 * 它的「全绿」就没有意义**。一个永远报 0 的对比度检查器，与一个永远报 0 的摆设无法区分。
 * 尤其本工具的第一版就把「已声明的制约」误判成违规、还把未声明的组合当硬性要求——所以必须有
 * 反向用例钉死「不误报」。
 *
 * 做法：在临时目录里造若干 DS Spec 样本，逐项注入已知缺陷，断言 contrast-audit.mjs 的
 * **输出文字与退出码**都符合预期；并断言计数非零（防规则空转）。
 *
 * 覆盖 15 类：
 *   应通过 5：干净样本 · 同一 token 双背景分别判定 · 辅助文本偏低（信息项） · FAIL 标签只告警 ·
 *             非配对散文条目
 *   应拦截 9：声称数字不符 · 声称 hex 与 token 不符 · 正文不达标 · 边界值（舍入会跨阈值） ·
 *             取值非 hex（算不出） · 标 PASS 但 <4.5 · 标 PASS-LARGE 但 <3 · 多份聚合取最坏 ·
 *             正文 token 在两个背景上结果不同（不得只查白底）
 *   另有 1 类：无 accessibility 字段时不崩
 *
 * 用法：node tools/contrast-audit-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "contrast-audit.mjs");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-mut-"));

/* 本地实现一份对比度，仅用于**挑选样本 hex**（断言针对工具输出文字，不依赖这份实现） */
const px = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
const lum = (h) => {
  const [r, g, b] = px(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** 找一个灰度值，使它与 #FFFFFF 的比值落在 (lo, hi) 区间 */
function greyIn(lo, hi) {
  for (let i = 0; i <= 255; i++) {
    const hex = `#${i.toString(16).padStart(2, "0").repeat(3)}`;
    const r = ratio(hex, "#FFFFFF");
    if (r > lo && r < hi) return { hex, r };
  }
  return null;
}

const BOUNDARY = greyIn(4.45, 4.4999); // 舍入到 1 位小数会变成 4.5 的灰
const PLAIN_LOW = greyIn(4.2, 4.35); // 明显低于 4.5 但不跨舍入边界的灰

const WHITE = "#FFFFFF";
const PAGE = "#F2F3F5"; // 非白页底：用于钉死「只查白底」的漏判
const PASS_BOTH = "#606266"; // 白底 6.11 / 灰底 5.50 都达标
const HIGH = "#6B7280"; // 白底 4.83 达标、灰底 ~4.35 不达标 —— 双背景差异用例
const LOW = "#9CA3AF"; // 白底 2.54，辅助文本偏低
const NEAR_LARGE = "#909399"; // 白底 3.08，仅够大字号

check(!!BOUNDARY && !!PLAIN_LOW, `样本挑选成功：边界灰 ${BOUNDARY && BOUNDARY.hex}(${BOUNDARY && BOUNDARY.r.toFixed(3)}) / 低灰 ${PLAIN_LOW && PLAIN_LOW.hex}(${PLAIN_LOW && PLAIN_LOW.r.toFixed(3)})`);
check(ratio(HIGH, WHITE) >= 4.5 && ratio(HIGH, PAGE) < 4.5, `双背景样本 #6B7280 白底达标(${ratio(HIGH, WHITE).toFixed(2)})、灰底不达标(${ratio(HIGH, PAGE).toFixed(2)})`);
check(ratio(BOUNDARY.hex, WHITE) < 4.5 && Math.round(ratio(BOUNDARY.hex, WHITE) * 10) / 10 === 4.5, `边界灰舍入成 4.5 但实际 ${ratio(BOUNDARY.hex, WHITE).toFixed(3)} < 4.5`);

/** 造一份最小 DS Spec */
function mkSpec({ primary = "#111827", regular = PASS_BOTH, secondary = LOW, contrast, omitA11y = false } = {}) {
  const spec = {
    brand: { name: "mut-sample" },
    tokens: {
      color: {
        text: {
          primary: { value: primary, source: "test" },
          regular: { value: regular, source: "test" },
          secondary: { value: secondary, source: "test" },
        },
        surface: { card: { value: WHITE, source: "test" } },
        background: { page: { value: PAGE, source: "test" } },
      },
    },
  };
  if (!omitA11y) spec.accessibility = { contrast: contrast || [] };
  return spec;
}

let n = 0;
function run(specOrSpecs) {
  const files = (Array.isArray(specOrSpecs) ? specOrSpecs : [specOrSpecs]).map((s) => {
    const p = path.join(FX, `s${n++}.json`);
    fs.writeFileSync(p, JSON.stringify(s, null, 2), "utf8");
    return p;
  });
  const r = spawnSync(process.execPath, [TOOL, ...files], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ---------------- 应通过（5 类） ---------------- */

// A 干净样本：正文双 token × 双背景全达标（其中一个背景非白）+ 1 条声称正确
{
  const r = run(
    mkSpec({
      contrast: [`text.primary #111827 on surface.card ${WHITE} = ${ratio("#111827", WHITE).toFixed(1)}:1 PASS（正文）`],
    }),
  );
  check(r.status === 0, `A 干净样本退出 0（实际 ${r.status}）`);
  check(/CONTRAST AUDIT OK/.test(r.out), "A 输出 OK");
  check(/正文矩阵 4 对：通过 4 ｜ 违规 0/.test(r.out), "A 正文 4 对全通过（计数非零，防空转）");
  check(/声称值 1 条：不符 0/.test(r.out), "A 声称 1 条且无不符（计数非零）");
}

// B 同一 token 在两个背景上结果不同 -> 必须分别判定（白底过、灰底不过）
{
  const r = run(mkSpec({ regular: HIGH }));
  check(r.status === 1, `B 灰底不达标退出 1（实际 ${r.status}）`);
  check(/正文矩阵 4 对：通过 3 ｜ 违规 1/.test(r.out), "B 白底 3 对通过、灰底 1 对违规（未只查白底）");
}

// C 辅助文本偏低 -> 信息项，不进退出码
{
  const r = run(mkSpec({ secondary: LOW }));
  check(r.status === 0, `C 辅助偏低仍退出 0（信息项，实际 ${r.status}）`);
  check(new RegExp(`${LOW}.*< 3`).test(r.out), "C 辅助偏低出现在「低于参考值」清单里");
}

// D FAIL 标签与比值不符 -> 只告警
{
  const r = run(mkSpec({ secondary: HIGH, contrast: [`text.secondary ${HIGH} on surface.card ${WHITE} = ${ratio(HIGH, WHITE).toFixed(1)}:1 FAIL-TEXT（测试）`] }));
  check(r.status === 0, `D FAIL 标签低报只告警、退出 0（实际 ${r.status}）`);
  check(/仅告警/.test(r.out), "D 输出含「仅告警」");
}

// E 非配对散文条目 -> 容忍
{
  const r = run(mkSpec({ contrast: ["远距可读红线：3m 视距下正文字号 ≥14px", `text.primary #111827 on surface.card ${WHITE} = ${ratio("#111827", WHITE).toFixed(1)}:1 PASS`] }));
  check(r.status === 0, `E 散文条目被容忍、退出 0（实际 ${r.status}）`);
  check(/非配对条目/.test(r.out), "E 输出标注了非配对条目");
}

/* ---------------- 应拦截（9 类） ---------------- */

// F 声称数字不符
{
  const r = run(mkSpec({ contrast: [`text.primary #111827 on surface.card ${WHITE} = 15.0:1 PASS（正文）`] }));
  check(r.status === 1, `F 声称数字不符退出 1（实际 ${r.status}）`);
  check(/声称 15:1 ≠ 复算/.test(r.out), "F 报出「声称 15 ≠ 复算」");
}

// G 声称 hex 与 token 不符
{
  const r = run(mkSpec({ contrast: [`text.primary #000000 on surface.card ${WHITE} = 21.0:1 PASS（正文）`] }));
  check(r.status === 1, `G 声称 hex 与 token 不符退出 1（实际 ${r.status}）`);
  check(/token 实际是 #111827/.test(r.out), "G 报出 token 实际值");
}

// H 正文不达标
{
  const r = run(mkSpec({ primary: PLAIN_LOW.hex }));
  check(r.status === 1, `H 正文不达标退出 1（实际 ${r.status}）`);
  check(/低于正文 4.5:1 的硬性要求/.test(r.out), "H 报出正文阈值违规");
}

// I 边界值：舍入到 1 位小数会变成 4.5，但未舍入值 < 4.5 -> 必须判违规
{
  const r = run(mkSpec({ primary: BOUNDARY.hex }));
  check(r.status === 1, `I 边界值退出 1（实际 ${r.status}）`);
  check(/正文矩阵 4 对：通过 2 ｜ 违规 2/.test(r.out), "I 边界值被判违规（未舍入判定，未被 toFixed 蒙混）");
  check(/4\.4[5-9]:1/.test(r.out), "I 显示的是未舍入真实值（4.4x）而非舍入后的 4.5");
  check(/⚠边界/.test(r.out), "I 标出了 ⚠边界");
}

// J 正文取值非 hex -> 算不出，不能当通过
{
  const r = run(mkSpec({ regular: "rgba(0,0,0,0.5)" }));
  check(r.status === 1, `J 取值非 hex 退出 1（实际 ${r.status}）`);
  check(/无法计算/.test(r.out), "J 报出「无法计算」而非静默通过");
}

// K 标 PASS 但比值 < 4.5
{
  const r = run(mkSpec({ contrast: [`text.secondary ${NEAR_LARGE} on surface.card ${WHITE} = ${ratio(NEAR_LARGE, WHITE).toFixed(1)}:1 PASS（测试）`] }));
  check(r.status === 1, `K 标 PASS 但 <4.5 退出 1（实际 ${r.status}）`);
  check(/标 PASS 但复算/.test(r.out), "K 报出「标 PASS 但复算不足」");
}

// L 标 PASS-LARGE 但比值 < 3
{
  const r = run(mkSpec({ contrast: [`text.secondary ${LOW} on surface.card ${WHITE} = ${ratio(LOW, WHITE).toFixed(1)}:1 PASS-LARGE（测试）`] }));
  check(r.status === 1, `L 标 PASS-LARGE 但 <3 退出 1（实际 ${r.status}）`);
  check(/连大字号也不达标/.test(r.out), "L 报出「连大字号也不达标」");
}

// M 多份聚合取最坏
{
  const clean = mkSpec({ contrast: [`text.primary #111827 on surface.card ${WHITE} = ${ratio("#111827", WHITE).toFixed(1)}:1 PASS`] });
  const bad = mkSpec({ primary: PLAIN_LOW.hex });
  const r = run([clean, bad]);
  check(r.status === 1, `M 一净一错聚合后退出 1（实际 ${r.status}）`);
  check(/s\d+\.json[\s\S]*s\d+\.json/.test(r.out), "M 两份样本都被列出");
}

/* ---------------- 健壮性（1 类） ---------------- */

// N 无 accessibility 字段不崩
{
  const r = run(mkSpec({ omitA11y: true }));
  check(r.status === 0, `N 无 accessibility 字段不崩且退出 0（实际 ${r.status}）`);
  check(/声称值 0 条/.test(r.out), "N 声称数为 0");
  check(/覆盖缺口/.test(r.out), "N 报出正文 token 未声明的覆盖缺口");
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
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— contrast-audit 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— contrast-audit 变异测试 ALL GREEN（能抓错、不误报）`);
