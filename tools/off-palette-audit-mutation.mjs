#!/usr/bin/env node
/**
 * off-palette-audit 的变异测试 —— 给校验器造错，看它抓不抓得住。
 *
 * 覆盖：
 *   基础  T1 空 readback → 0 色 / 0 板外
 *   解析  T2 readback 含 fills → 正确提取颜色
 *   Spec  T3 无 spec → 仅 Preset 对比 / T4 spec 含 token → inSpec 计数正确
 *   Preset T5 有 Preset 色 → inPreset 非空 / T6 无 Preset 色 → inPreset 为空
 *   板外  T7 画布有 spec 外色 → offPalette 非空 / T8 画布色全在 spec → offPalette 为空
 *   输出  T9 stdout 含关键词（「板外色信号审计」/「唯一色」/「在 Spec 内」）
 *   边界  T10 混合 case：spec + preset + off-palette 三者并存
 *
 * 用法：node tools/off-palette-audit-mutation.mjs  零依赖；exit 0 = 全过。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools", "off-palette-audit.mjs");
const FX = fs.mkdtempSync(path.join(os.tmpdir(), "palette-mut-"));

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const run = (readbackPath, specPath = null) => {
  const args = [readbackPath];
  if (specPath) args.push(specPath);
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};

/* ---------------- 夹具 ---------------- */

/** 造一个 readback JSON（跟 bridge get-node 输出结构对齐） */
const makeReadback = (colors) => ({
  ok: true,
  data: {
    id: "root",
    name: "Root",
    type: "FRAME",
    width: 1920,
    height: 1080,
    x: 0,
    y: 0,
    children: colors.map((c, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      type: "TEXT",
      width: 100,
      height: 20,
      x: 24,
      y: 24 + i * 30,
      fills: [c],
    })),
  },
});

/** 造一个 spec JSON（tokens.color 结构） */
const makeSpec = (colors) => ({
  tokens: {
    color: colors.reduce((acc, c) => {
      acc[c] = { value: c };
      return acc;
    }, {}),
  },
});

const writeFile = (name, content) => {
  const p = path.join(FX, name);
  fs.writeFileSync(p, content);
  return p;
};

/* ---------------- 测试 ---------------- */

// T1 空 readback → 0 色 / 0 板外
{
  const p = writeFile("empty.json", JSON.stringify(makeReadback([])));
  const r = run(p);
  check(r.status === 0, `T1 空 readback 应正常退出（实际 ${r.status}）`);
  check(/画布唯一色: 0 种/.test(r.out), `T1 画布唯一色 0（实际 ${r.out}）`);
  check(/板外色\] 0 个/.test(r.out), `T1 板外色 0（实际 ${r.out}）`);
}

// T2 readback 含 fills → 正确提取颜色
{
  const p = writeFile("filled.json", JSON.stringify(makeReadback(["#ff0000", "#00ff00", "#0000ff"])));
  const r = run(p);
  check(/画布唯一色: 3 种/.test(r.out), `T2 识别 3 个唯一色（实际 ${r.out}）`);
  check(/#0000ff/.test(r.out), `T2 包含 #0000ff`);
  check(/#ff0000/.test(r.out), `T2 包含 #ff0000`);
  check(/#00ff00/.test(r.out), `T2 包含 #00ff00`);
}

// T3 无 spec → 仅 Preset 对比，inSpec 为空
{
  const p = writeFile("no-spec.json", JSON.stringify(makeReadback(["#112233"])));
  const r = run(p);
  check(/✅ 在 Spec 内\] 0 个/.test(r.out), `T3 无 spec 时 inSpec 为 0（实际 ${r.out}）`);
  check(/🚨 板外色\] 1 个/.test(r.out), `T3 无 spec 时 #112233 进入 offPalette（实际 ${r.out}）`);
}

// T4 spec 含 token → inSpec 计数正确
{
  const p = writeFile("with-spec.json", JSON.stringify(makeReadback(["#ff0000", "#aabbcc"])));
  const s = writeFile("spec.json", JSON.stringify(makeSpec(["#ff0000", "#112233"])));
  const r = run(p, s);
  check(/✅ 在 Spec 内\] 1 个/.test(r.out), `T4 只有 #ff0000 在 spec（实际 ${r.out}）`);
  check(/#aabbcc/.test(r.out), `T4 #aabbcc 应出现在输出中`);
}

// T5 有 Preset 色 → inPreset 非空（用已知在 preset 中的颜色）
{
  const p = writeFile("preset-test.json", JSON.stringify(makeReadback(["#00d4ff"])));
  const r = run(p);
  check(/⚠️ 仅在 Preset 中\] 1 个/.test(r.out), `T5 #00d4ff 在 preset 中应进入 inPreset（实际 ${r.out}）`);
}

// T6 无 Preset 色 → inPreset 为空
{
  const p = writeFile("no-preset.json", JSON.stringify(makeReadback(["#deadbe"])));
  const r = run(p);
  check(/⚠️ 仅在 Preset 中\] 0 个/.test(r.out), `T6 无 Preset 色时 inPreset 为 0（实际 ${r.out}）`);
  check(/🚨 板外色\] 1 个/.test(r.out), `T6 #deadbe 应进入 offPalette（实际 ${r.out}）`);
}

// T7 画布有 spec 外色 → offPalette 非空
{
  const p = writeFile("off-spec.json", JSON.stringify(makeReadback(["#ff0000", "#998877"])));
  const s = writeFile("spec-off.json", JSON.stringify(makeSpec(["#ff0000"])));
  const r = run(p, s);
  check(/🚨 板外色\] 1 个/.test(r.out), `T7 #998877 不在 spec，应报板外（实际 ${r.out}）`);
}

// T8 画布色全在 spec → offPalette 为空
{
  const p = writeFile("all-spec.json", JSON.stringify(makeReadback(["#ff0000", "#00ff00"])));
  const s = writeFile("spec-all.json", JSON.stringify(makeSpec(["#ff0000", "#00ff00"])));
  const r = run(p, s);
  check(/🚨 板外色\] 0 个/.test(r.out), `T8 全在 spec 时 offPalette 为 0（实际 ${r.out}）`);
}

// T9 stdout 含关键词
{
  const p = writeFile("keywords.json", JSON.stringify(makeReadback(["#111111"])));
  const r = run(p);
  check(/板外色信号审计/.test(r.out), `T9 标题存在`);
  check(/唯一色/.test(r.out), `T9 「唯一色」关键词存在`);
  check(/在 Spec 内/.test(r.out), `T9 「在 Spec 内」关键词存在`);
}

// T10 混合 case：spec + preset + off-palette 三者并存
{
  const p = writeFile("mixed.json", JSON.stringify(makeReadback([
    "#ff0000", // in spec (via makeSpec)
    "#00d4ff", // in preset
    "#0000ff", // off palette
    "#aabbcc", // off palette
  ])));
  const s = writeFile("spec-mixed.json", JSON.stringify(makeSpec(["#ff0000"])));
  const r = run(p, s);
  check(/✅ 在 Spec 内\] 1 个/.test(r.out), `T10 inSpec = 1`);
  check(/⚠️ 仅在 Preset 中\] 1 个/.test(r.out), `T10 inPreset = 1`);
  check(/🚨 板外色\] 2 个/.test(r.out), `T10 offPalette = 2`);
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
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— off-palette-audit 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— off-palette-audit 变异测试 ALL GREEN`);
