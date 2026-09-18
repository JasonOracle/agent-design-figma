#!/usr/bin/env node
/**
 * off-palette-audit.mjs — 板外色信号审计器（1.4 · A2）
 *
 * 用途：比对画布实际用色 ↔ Spec token 色板，报告「板外色」候选计数。
 * 注意：本工具**不判违规**，只报信号（#72② 纪律）—— 是否豁免由人判定。
 *
 * 数据来源：
 *   1. DS Spec `tokens.color.*.value`（主色板）
 *   2. 4 个 Preset `assets/style-library/*.json`（白名单候选来源）
 *   3. Readback JSON（画布实际用色）
 *
 * 用法：
 *   node tools/off-palette-audit.mjs <readback.json> [spec.json]
 *   node tools/off-palette-audit.mjs .vibe/d2-run-b/readback.json .vibe/d2-run-b/design-system-spec.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESET_DIR = path.join(ROOT, "assets", "style-library");

/* ===================== Helper Functions ===================== */

/** 递归提取所有 #RRGGBB 值 */
function extractHexValues(obj, path = "") {
  const results = [];
  if (typeof obj === "string" && obj.startsWith("#")) {
    results.push(obj.toLowerCase());
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      results.push(...extractHexValues(obj[i], `${path}[${i}]`));
    }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      results.push(...extractHexValues(v, `${path}.${k}`));
    }
  }
  return results;
}

/** 从 Spec 提取所有 color token 值 */
function extractSpecColors(spec) {
  return new Set(extractHexValues(spec.tokens?.color));
}

/** 从 Presets 提取所有颜色（按 preset 分组） */
function extractPresetColors() {
  const presets = {};
  for (const file of fs.readdirSync(PRESET_DIR).filter(f => f.endsWith(".json"))) {
    const name = file.replace(".json", "");
    const content = fs.readFileSync(path.join(PRESET_DIR, file), "utf8");
    const data = JSON.parse(content);
    presets[name] = new Set(extractHexValues(data));
  }
  return presets;
}

/** 从 readback 提取所有节点 fills */
function extractReadbackFills(data) {
  const colors = [];

  function walk(node, path = "") {
    if (!node || typeof node !== "object") return;
    const fills = node.fills;
    if (Array.isArray(fills)) {
      for (const f of fills) {
        if (typeof f === "string" && f.startsWith("#")) {
          colors.push({ color: f.toLowerCase(), node: node.name, path });
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child, `${path}/${child.name || "?"}`);
      }
    }
  }

  // Handle both array and single node data
  const root = Array.isArray(data) ? data[0] : data;
  if (root) walk(root);
  return colors;
}

/* ===================== Main ===================== */

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("用法: node off-palette-audit.mjs <readback.json> [spec.json]");
    process.exit(2);
  }

  const readbackPath = args[0];
  const specPath = args[1] || null;

  // Load readback
  const readbackData = JSON.parse(fs.readFileSync(readbackPath, "utf8"));
  const rawColors = extractReadbackFills(readbackData.data || readbackData);
  const uniqueColors = new Set(rawColors.map(c => c.color));

  // Load spec colors
  let specColors = new Set();
  if (specPath && fs.existsSync(specPath)) {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    specColors = extractSpecColors(spec);
  }

  // Load preset colors
  const presetColors = extractPresetColors();
  const allPresetColors = new Set();
  for (const colors of Object.values(presetColors)) {
    for (const c of colors) allPresetColors.add(c);
  }

  // Categorize
  const inSpec = [];
  const inPreset = [];
  const offPalette = [];

  for (const color of uniqueColors) {
    if (specColors.has(color)) {
      inSpec.push(color);
    } else if (allPresetColors.has(color)) {
      inPreset.push(color);
    } else {
      offPalette.push(color);
    }
  }

  // Find which presets each off-palette color appears in
  const offPaletteWithSources = offPalette.map(color => {
    const sources = [];
    for (const [name, colors] of Object.entries(presetColors)) {
      if (colors.has(color)) sources.push(name);
    }
    return { color, sources };
  });

  // Count occurrences
  const colorCounts = {};
  for (const c of rawColors) {
    colorCounts[c.color] = (colorCounts[c.color] || 0) + 1;
  }

  // Output
  console.log("=== 板外色信号审计 ===\n");
  console.log(`画布唯一色: ${uniqueColors.size} 种`);
  console.log(`Spec token: ${specColors.size} 个`);
  console.log(`Preset 色: ${allPresetColors.size} 个`);
  console.log();

  console.log(`[✅ 在 Spec 内] ${inSpec.length} 个:`);
  for (const c of inSpec.sort()) {
    console.log(`  ${c} (使用 ${colorCounts[c] || 0} 次)`);
  }
  console.log();

  console.log(`[⚠️ 仅在 Preset 中] ${inPreset.length} 个:`);
  for (const c of inPreset.sort()) {
    console.log(`  ${c} (使用 ${colorCounts[c] || 0} 次)`);
  }
  console.log();

  console.log(`[🚨 板外色] ${offPalette.length} 个:`);
  for (const item of offPaletteWithSources) {
    const sources = item.sources.length > 0 ? ` (出现在 Preset: ${item.sources.join(", ")})` : "";
    console.log(`  ${item.color} (使用 ${colorCounts[item.color] || 0} 次)${sources}`);
  }
  console.log();

  console.log("--- 候选白名单建议 ---");
  console.log("以下颜色可作为豁免白名单（出现在至少 1 个 Preset 中）：");
  for (const c of inPreset.sort()) {
    const presetList = [];
    for (const [name, colors] of Object.entries(presetColors)) {
      if (colors.has(c)) presetList.push(name);
    }
    console.log(`  ${c} → Preset: ${presetList.join(", ")}`);
  }

  // Exit 0 (信息性，不阻塞)
  process.exit(0);
}

main();
