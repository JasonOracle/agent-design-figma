#!/usr/bin/env node
/**
 * qa-l2-mutation.mjs — 对 qa-l2.mjs 的变异测试（验证「校验脚本本身有效」）
 *
 * 为什么需要它：只跑一次 47/0 全绿**不能证明校验有效**——一个永远返回 PASS 的脚本
 * 也能全绿。上游 `stage10-4-qa.py` 就存在这样一处逻辑漏洞（派生色值只要恰好落在
 * preset 色板内就会被跳过校验），长期没人发现，因为没人验证过校验脚本本身。
 *
 * 做法：以一份合法产物为基准，逐项注入**已知错误**，断言 qa-l2 报警且给出对应关键词。
 *
 * 用法：node tools/qa-l2-mutation.mjs
 * 零依赖；在临时目录造变异副本，不改动仓库内任何示例文件。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-l2-mut-"));

const BRIEF = path.join(ROOT, "assets", "examples", "example-health.json");
const BASE_SPEC = path.join(ROOT, "assets", "examples", "example-health.dsspec.json");
const SPEC = path.join(TMP, "mutant.json");

const base = JSON.parse(fs.readFileSync(BASE_SPEC, "utf8"));
const clone = () => JSON.parse(JSON.stringify(base));
const write = (s) => fs.writeFileSync(SPEC, JSON.stringify(s, null, 2));
const run = () => {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools", "qa-l2.mjs"), "--spec", SPEC, "--brief", BRIEF, "--quiet"],
    { encoding: "utf8" }
  );
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

let pass = 0;
let fail = 0;

const expectFail = (label, mutate, keyword) => {
  const s = clone();
  mutate(s);
  write(s);
  const { code, out } = run();
  if (code === 1 && out.includes(keyword)) {
    console.log(`  ok   ${label}`);
    pass++;
  } else {
    console.log(`  MISS ${label} → exit=${code}，期望 FAIL 含「${keyword}」`);
    const lines = out.split("\n").filter((l) => l.includes("FAIL"));
    if (lines.length) console.log("       " + lines.join("\n       "));
    fail++;
  }
};

const expectPass = (label) => {
  write(clone());
  const { code, out } = run();
  if (code === 0) {
    console.log(`  ok   ${label}`);
    pass++;
  } else {
    console.log(`  MISS ${label} → exit=${code}（基准产物应通过）`);
    console.log("       " + out.split("\n").filter((l) => l.includes("FAIL")).join("\n       "));
    fail++;
  }
};

console.log("=== qa-l2 变异测试（逐项注入已知错误，确认校验会报警）===\n");

expectPass("基准产物（未变异）零误报");

// QA2 — 颜色
expectFail("非派生色值不在 preset 色板内", (s) => { s.tokens.color.background.page.value = "#123456"; }, "非派生色");
expectFail("派生值不符 RD 公式", (s) => { s.tokens.color.brand.hover.value = "#000000"; }, "派生色");
expectFail("派生值被填成另一个色板色（#FFFFFF 也不许蒙混）", (s) => { s.tokens.color.brand.hover.value = "#FFFFFF"; }, "派生色");
expectFail("derived 前缀但格式不合法", (s) => { s.tokens.color.brand.hover.source = "derived:whatever"; }, "格式不符");
expectFail("派生 token 的父路径不存在", (s) => { s.tokens.color.border.divider.source = "derived:RD-3@tokens.color.border.nope"; }, "父 token");
expectFail("使用了未知派生规则", (s) => { s.tokens.color.brand.hover.source = "derived:RD-9@tokens.color.brand.primary"; }, "未知派生规则");
expectFail("引用了不存在的 preset", (s) => { s.brand.stylePresetId = "nope-preset"; }, "不存在的 preset");

// QA3 — 覆盖与数量
expectFail("briefRefs 少覆盖一个组件（并集不等）", (s) => {
  s.components.find((x) => x.decision === "create-local").briefRefs = [];
}, "并集");
expectFail("P0 组件被 reject", (s) => {
  s.components.find((x) => x.priority === "P0" && x.decision === "generate-core").decision = "reject";
}, "reject 仅限");
expectFail("存量项目却出现 generate-core", (s) => {
  s.sourceMapping.existingDsRefs = ["existing-ds:DS/Form/Button"];
}, "存量项目");

// QA4 — DS 单源
expectFail("create-local 误用 DS/ 前缀", (s) => {
  s.components.find((x) => x.decision === "create-local").figmaNaming = "DS/Local/Wrong";
}, "DS/ 前缀");
expectFail("四件套状态矩阵缺项（Button 缺 loading）", (s) => {
  s.components.find((x) => x.name === "Button").states = ["primary", "secondary", "disabled"];
}, "状态矩阵");
expectFail("buildPlan.estOps 超过 30", (s) => { s.buildPlan.batches[0].estOps = 40; }, "estOps");
expectFail("chart 色板与 preset 不一致", (s) => { s.tokens.color.chart.series3.value = "#123456"; }, "chart 色板");

// QA1 — Schema
expectFail("顶层必填字段缺失（accessibility）", (s) => { delete s.accessibility; }, "必填字段");

console.log(`\n结果：${pass} ok / ${fail} MISS${fail ? " —— 校验存在漏洞" : " —— 校验有效"}`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
