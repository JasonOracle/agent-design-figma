#!/usr/bin/env node
/**
 * read-image-merge.mjs — A3：读图结论自动落结构化字段（1.3 立项书 §2.2 第 3 项）
 *
 * 修的环：F3①③ 把读图升为必选项并给了留痕 Schema（assets/templates/read-image-review.json），
 * 但运行 B 的 L4 报告里 `_evidence.visionObservations` 是**人手把当轮素材结构化**出来的。
 * 本工具把「review 记录 → 报告字段」变成机械动作，并给 qa-critic 提供核对判据（QA9 经 --review 接线）。
 *
 * 两种用法：
 *   node tools/read-image-merge.mjs --report <critic-report.json> --review <read-image-review.json> --check
 *       校验模式：review 记录完备性 + 与报告的证据档位交叉核对。错误 → exit 1（闸门用）。
 *   node tools/read-image-merge.mjs --report <...> --review <...> --out <merged.json>
 *       合并模式：把 review 自动落进 `_evidence.visionObservations` / `unassessed`，写到 --out。
 *       绝不覆盖 --report 本体（--out 与 --report 同路径直接拒绝）。
 *
 * 合并语义（确定性，可重跑）：
 *   - `_evidence.visionObservations`：先剔除既有 `source === "read-image-review"` 的条目再追加 ⇒ 幂等；
 *   - `_evidence.unassessed`：先剔除上一轮自动落的那批（存于 `_evidence.readImageUnassessed`）再追加；
 *   - `_evidence.readImageMerge = { checklist, checklistVersion, sha256, ... }` 留痕来源与内容指纹；
 *   - sha256 = review.items 的规范 JSON 指纹 —— 内容不变则重跑结果逐字节不变（#74：引用计数类
 *     「写记录推高数字」的漂移在此被指纹拦截）。
 *
 * 判据（validateReview，与 Schema 对齐）：
 *   R1  checklist 固定值 / checklistVersion 语义版本 / mode 固定 structured+vision / images 非空
 *   R2  items 必须覆盖清单全部 id（当前 1.0.0 = R1–R11）—— **缺一条 = 没查**，不得静默
 *   R3  verdict ∈ {ok, issue, n-a}；ok/issue 必填 evidence；n-a 必填 note；issue 建议给 dimension（WARN）
 *
 * 零依赖（仅 node 内置）；IS_MAIN 哨兵（lessons.md #88）：被 import 只拿纯函数，直跑才进 CLI。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ---------------- 纯函数（可 import，零副作用） ---------------- */

export const EXPECTED_IDS = Array.from({ length: 11 }, (_, i) => `R${i + 1}`); // 清单 1.0.0 = R1–R11
export const VERDICTS = ["ok", "issue", "n-a"];
export const DIMENSIONS = ["Layout", "Color", "Consistency", "Commercial", "Usability"];

const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";

/** 校验 read-image-review 记录。返回 { errors: string[], warnings: string[] } —— errors 非空即不合格。 */
export function validateReview(review) {
  const errors = [];
  const warnings = [];

  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return { errors: ["review 须为对象"], warnings };
  }

  if (review.checklist !== "read-image-checklist") {
    errors.push(`checklist 须为 "read-image-checklist"（实际 ${JSON.stringify(review.checklist)}）——记录必须声明来自哪份清单`);
  }
  if (!isNonEmptyStr(review.checklistVersion) || !/^\d+\.\d+\.\d+$/.test(review.checklistVersion)) {
    errors.push(`checklistVersion 须为语义版本（实际 ${JSON.stringify(review.checklistVersion)}）`);
  }
  if (review.mode !== "structured+vision") {
    errors.push(`mode 须为 "structured+vision"（实际 ${JSON.stringify(review.mode)}）——structured-only 不得伪造读图记录`);
  }
  if (!Array.isArray(review.images) || review.images.length < 1 || !review.images.every(isNonEmptyStr)) {
    errors.push(`images 须为非空文件名数组（实际 ${JSON.stringify(review.images)}）——读了哪些图必须可回放`);
  }

  if (!Array.isArray(review.items)) {
    errors.push(`items 须为数组（实际 ${typeof review.items}）`);
    return { errors, warnings };
  }

  const seen = new Map();
  for (const [i, it] of review.items.entries()) {
    const id = it && it.id;
    if (!isNonEmptyStr(id) || !/^R\d+$/.test(id)) {
      errors.push(`items[${i}].id 非法：${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) errors.push(`items 重复 id：${id}`);
    seen.set(id, it);

    if (!VERDICTS.includes(it.verdict)) {
      errors.push(`${id}.verdict 非法：${JSON.stringify(it.verdict)}（允许 ${VERDICTS.join(" / ")}）`);
      continue;
    }
    if ((it.verdict === "ok" || it.verdict === "issue") && !isNonEmptyStr(it.evidence)) {
      errors.push(`${id} verdict=${it.verdict} 但 evidence 为空——ok 写「看了哪」/ issue 写「看到了什么」，没写 = 没查`);
    }
    if (it.verdict === "n-a" && !isNonEmptyStr(it.note)) {
      errors.push(`${id} verdict=n-a 但 note 为空——「无对象」必须给出理由，不得静默`);
    }
    if (it.verdict === "issue" && it.dimension != null && !DIMENSIONS.includes(it.dimension)) {
      errors.push(`${id}.dimension 非法：${JSON.stringify(it.dimension)}（允许 ${DIMENSIONS.join(" / ")}）`);
    }
    if (it.verdict === "issue" && it.dimension == null) {
      warnings.push(`${id} verdict=issue 未给 dimension——建议标注影响哪一维，供 critic 吸收时路由`);
    }
  }

  const missing = EXPECTED_IDS.filter((id) => !seen.has(id));
  if (missing.length) {
    errors.push(`items 未覆盖清单全部条目：缺 ${missing.join(", ")} —— 缺一条 = 没查 = 必须记 unassessed，不得静默`);
  }
  const extra = [...seen.keys()].filter((id) => !EXPECTED_IDS.includes(id));
  if (extra.length) {
    errors.push(`items 含清单外的 id：${extra.join(", ")}（清单 ${review.checklistVersion || "?"} = ${EXPECTED_IDS[0]}–${EXPECTED_IDS.at(-1)}）——清单条目可增不可删，版本要对齐`);
  }

  return { errors, warnings };
}

/** review.items 的规范指纹（合并幂等性的依据） */
export function reviewSha(review) {
  return crypto.createHash("sha256").update(JSON.stringify(review.items)).digest("hex").slice(0, 16);
}

/** 从 review 派生要落的字段（不改 report） */
export function deriveFromReview(review) {
  const observations = [];
  const unassessed = [];
  for (const it of review.items) {
    if (it.verdict === "ok" || it.verdict === "issue") {
      observations.push({
        id: it.id,
        verdict: it.verdict,
        ...(it.dimension ? { dimension: it.dimension } : {}),
        evidence: it.evidence,
        source: "read-image-review",
      });
    } else {
      // n-a：进 unassessed（QA7 的 DIM_RE 要求可追溯到维度/章节）
      const dim = DIMENSIONS.includes(it.dimension) ? it.dimension : "§读图清单";
      unassessed.push(`${dim}: ${it.id} n-a —— ${String(it.note).trim()}（read-image-review 自动落）`);
    }
  }
  return { observations, unassessed, sha: reviewSha(review) };
}

/**
 * 合并：返回新 report（不改动入参）。幂等 —— 同一 report × 同一 review 重跑结果一致。
 * 报告档位必须已是 structured+vision（structured-only 下落读图观察 = 伪造证据档位，拒绝）。
 */
export function mergeReport(report, review) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("report 须为对象");
  }
  const ev = report._evidence && typeof report._evidence === "object" ? report._evidence : null;
  if (!ev) throw new Error("report 缺 _evidence —— 档位未声明，拒绝合并（先按 visual-critic.md §1.6 定档）");
  if (ev.mode !== "structured+vision") {
    throw new Error(`report._evidence.mode=${JSON.stringify(ev.mode)} ≠ structured+vision —— structured-only 下不得落读图观察（伪造档位）`);
  }

  const { observations, unassessed, sha } = deriveFromReview(review);

  const prevVis = Array.isArray(ev.visionObservations) ? ev.visionObservations : [];
  const keptVis = prevVis.filter((v) => v && v.source !== "read-image-review");

  const prevAutoUn = Array.isArray(ev.readImageUnassessed) ? ev.readImageUnassessed : [];
  const keptUn = (Array.isArray(ev.unassessed) ? ev.unassessed : []).filter((s) => !prevAutoUn.includes(s));

  const out = {
    ...report,
    _evidence: {
      ...ev,
      visionObservations: [...keptVis, ...observations],
      unassessed: [...keptUn, ...unassessed],
      readImageUnassessed: unassessed,
      readImageMerge: {
        checklist: review.checklist,
        checklistVersion: review.checklistVersion,
        sha256: sha,
        observed: observations.length,
        na: unassessed.length,
        tool: "tools/read-image-merge.mjs",
      },
    },
  };
  return out;
}

/* ---------------- CLI（直跑才执行 —— lessons.md #88） ---------------- */

const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] || "").href;

function fail2(msg) {
  console.error(`用法错误：${msg}`);
  console.error("用法：node tools/read-image-merge.mjs --report <critic-report.json> --review <read-image-review.json> [--check | --out <merged.json>]");
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : null;
  };
  const reportPath = argOf("--report");
  const reviewPath = argOf("--review");
  const outPath = argOf("--out");
  const checkOnly = argv.includes("--check");

  if (!reportPath) fail2("缺 --report");
  if (!reviewPath) fail2("缺 --review");
  if (!checkOnly && !outPath) fail2("合并模式需 --out（或用 --check 只校验）");
  if (outPath && path.resolve(outPath) === path.resolve(reportPath)) {
    fail2("--out 不得与 --report 同路径 —— 本工具不覆盖原始报告");
  }

  let report;
  let review;
  try {
    report = JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8"));
  } catch (e) {
    console.error(`report 读取失败：${e.message}`);
    process.exit(2);
  }
  try {
    review = JSON.parse(fs.readFileSync(path.resolve(reviewPath), "utf8"));
  } catch (e) {
    console.error(`review 读取失败：${e.message}`);
    process.exit(2);
  }

  const { errors, warnings } = validateReview(review);
  for (const w of warnings) console.log(`WARN  ${w}`);

  if (errors.length) {
    for (const e of errors) console.error(`FAIL  ${e}`);
    console.error(`\n结果：${errors.length} FAIL —— read-image-review 记录不合格`);
    process.exit(1);
  }

  if (checkOnly) {
    // 交叉核对：报告档位与记录一致；自动落痕存在时指纹必须对上
    const cross = [];
    const ev = report?._evidence;
    if (ev?.mode && ev.mode !== review.mode) {
      cross.push(`报告 _evidence.mode=${JSON.stringify(ev.mode)} 与 review.mode=${JSON.stringify(review.mode)} 不一致 —— structured-only 下存在读图记录即伪造档位`);
    }
    const merged = ev?.readImageMerge;
    if (merged && merged.sha256 !== reviewSha(review)) {
      cross.push(`报告已落的 readImageMerge.sha256=${merged.sha256} 与当前 review 指纹 ${reviewSha(review)} 不一致 —— 记录在合并后被改过，须重新落`);
    }
    if (cross.length) {
      for (const c of cross) console.error(`FAIL  ${c}`);
      console.error(`\n结果：${cross.length} FAIL —— 记录与报告交叉核对不通过`);
      process.exit(1);
    }
    console.log(`结果：OK —— review 记录合格（${EXPECTED_IDS.length} 条全覆盖），与报告交叉核对通过`);
    return;
  }

  let merged;
  try {
    merged = mergeReport(report, review);
  } catch (e) {
    console.error(`合并失败：${e.message}`);
    process.exit(1);
  }
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(merged, null, 2) + "\n");
  const m = merged._evidence.readImageMerge;
  console.log(`结果：已写出 ${outPath}`);
  console.log(`  visionObservations 落 ${m.observed} 条 / unassessed 落 ${m.na} 条（checklist ${m.checklistVersion}，指纹 ${m.sha256}）`);
  console.log(`  幂等提示：同输入重跑结果一致；原始报告未改动。落痕后请以 qa-critic --review 复核。`);
}

if (IS_MAIN) main();
