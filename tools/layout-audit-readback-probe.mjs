#!/usr/bin/env node
/**
 * layout-audit-readback-probe.mjs — 「回读形状 ↔ layout-audit 输入」的跨模块契约探针（1.3 · A1）
 *
 *   node tools/layout-audit-readback-probe.mjs [--json]
 *   退出码：0 契约成立；1 契约破了；2 用法/环境错误。
 *
 * 为什么需要它（`1.3-candidates.md` 的 A1 与 `lessons.md` #84）：
 * A1 的原描述是「`layout-audit` 要的 readback 形状与 Bridge `depth` 语义不匹配，整条 L4 布局闸门
 * **当场跑不了**」。实测发现**该需求早已被满足**（见下），但这条结论的证据原本只活在本机 `.vibe/`
 * 的一个一次性探针里 —— **不随包发布、下次没人能复核**。而它守的恰恰是一条**跨模块契约**：
 * `figma-plugin/code.js` 的 `nodeInfo()` 产出什么形状 ←→ `layout-audit.mjs` 能吃什么形状。
 * 这两者分属冻结区与非冻结区，**只有集成起来跑才验得到**：`layout-audit-mutation.mjs` 用的是
 * 合成树（手工照着形状捏的），验的是「形状对了工具是否判得对」；本探针用的是**真 `code.js`
 * 走真 `execute("get-node")` 产出的响应**，验的是「真形状是否就是那样」。两者缺一不可。
 *
 * 它同时钉住 `geometryCoverage` 存在的理由（同一棵树的实测，真树共 **5** 个节点）：
 *   `{depth:1}`（默认） → 只有根带几何 ⇒ 覆盖率 **1/2**
 *       ⚠ 注意分母不是 5：depth1 的响应里**孩子连 id/name 都没有**（整棵子树被截掉），
 *         所以工具只能按「收到的 2 个节点」算。真树 5 个节点里有 **4 个**一条检查都没跑到，
 *         而工具只敢说「1 个未参与」—— 这是**下界**，判据 ④ 专门钉这条。
 *   `{depth:2}`         → 根 + 子级带几何 ⇒ **2/5**（这一层能把整棵树**数全**，但 3 个节点不带几何）
 *   `{depth:3, detail:true}` → 全层带几何 ⇒ **5/5**，且能报出落在第 2 层节点上的问题
 * ⇒ **容器数是代理指标，节点数才是规模**；这正是 A1 残余收编的那个字段。
 *   （depth1 与 depth2 的**浅容器数都是 1**，只看容器数这两者无从区分 —— 见下方「观察」。）
 *   （旧文档把 depth1 写成 1/5，那是**没有实测**时照「1 个容器 / 5 个节点」推的 —— 见 lessons #84。）
 *
 * 判据（四条，任一条不成立即契约破了）：
 *   ① 覆盖率随深度**严格递增**（1 < 2 < 5）—— 否则「depth 语义」又退化了；
 *   ② 只有 `{depth:3, detail:true}` 能报出**第 2 层节点**（本用例的 `1:111` `Title`）上的问题 ——
 *      这是「深审可用 / 不可用」的分界，也是原描述「整条闸门跑不了」的真伪判据；
 *   ③ 前两种回读必须**如实报出浅回读**（`shallowWarning` 非空且给出未参与节点数）——
 *      否则就是又一次「没查」冒充「查了没问题」；
 *   ④ `{depth:1}` 的「未参与节点数」必须**小于**真树的未审节点数 ——
 *      即承认浅回读报出的是**下界**：它连「自己漏了多少」都数不全（因为漏掉的子树不在响应里）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPlugin } from "./figma-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIT = path.join(HERE, "layout-audit.mjs");
const JSON_ONLY = process.argv.includes("--json");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "a1-probe-"));

/* ---------------- 造一棵真实几何的树（经真 code.js 的 get-node 回读） ---------------- */

const h = loadPlugin();
const reg = (t, p) => h.register(h.makeNode(t, p));

const root = reg("FRAME", { id: "1:100", name: "L4/AuditRoot", width: 400, height: 300, x: 0, y: 0 });
const card = reg("FRAME", { id: "1:110", name: "Card", width: 200, height: 200, x: 24, y: 24 });
const title = reg("TEXT", { id: "1:111", name: "Title", width: 120, height: 24, x: 32, y: 32, characters: "标题" });
const btn = reg("FRAME", { id: "1:112", name: "Btn/Primary", width: 96, height: 40, x: 32, y: 64, fills: [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3 } }] });
const ghost = reg("FRAME", { id: "1:113", name: "Btn/Ghost", width: 96, height: 40, x: 32, y: 112, fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }] });
h.page.appendChild(root);
root.appendChild(card);
card.appendChild(title);
card.appendChild(btn);
card.appendChild(ghost);

/** 显式档位（不依赖仓库里任何 `.vibe/` 产物，探针自包含）。 */
const AUDIT_ARGS = ["--scale", "2,4,8,16,24", "--font", "14,20,22,26", "--radius", "2,4", "--baseline", "400x300", "--min-touch", "44"];

/**
 * 期望值是**实测钉死的**（不是推的）。改这些数就等于宣布「契约变了」，必须连带改头部文档。
 * 注：`total` 是**响应里**的节点数，不是真树节点数 —— depth1 会把子树整段截掉。
 */
const TRUE_TREE_NODES = 5;
const CASES = [
  { key: "depth1", label: "{depth:1}（默认）", params: { id: "1:100", depth: 1 }, expectAudited: 1, expectTotal: 2, expectShallow: 1 },
  { key: "depth2", label: "{depth:2}", params: { id: "1:100", depth: 2 }, expectAudited: 2, expectTotal: 5, expectShallow: 3 },
  { key: "depth3", label: "{depth:3, detail:true}", params: { id: "1:100", depth: 3, detail: true }, expectAudited: 5, expectTotal: 5, expectShallow: 0 },
];

const rows = [];
for (const c of CASES) {
  const res = await h.execute("get-node", c.params);
  const f = path.join(TMP, `${c.key}.json`);
  fs.writeFileSync(f, JSON.stringify(res, null, 2), "utf8");

  const r = spawnSync(process.execPath, [AUDIT, f, ...AUDIT_ARGS, "--json"], { encoding: "utf8" });
  let rep = null;
  try {
    rep = JSON.parse(r.stdout);
  } catch {
    /* 下面按 rep === null 报错 */
  }
  const g = rep && rep.geometryCoverage;
  rows.push({
    key: c.key,
    label: c.label,
    expectAudited: c.expectAudited,
    expectTotal: c.expectTotal,
    expectShallow: c.expectShallow,
    exit: r.status,
    audited: g ? g.auditedNodes : null,
    total: g ? g.totalNodes : null,
    shallowParents: g ? g.shallowParents : null,
    shallowNodes: g ? g.shallowNodes : null,
    shallowWarning: !!(rep && rep.shallowWarning),
    deepIssue: !!(rep && (rep.issues || []).some((i) => i.nodeId === "1:111")),
    issues: rep ? (rep.issues || []).length : null,
  });
}

/* ---------------- 判据 ---------------- */

const checks = [];
const T = (name, ok, detail) => checks.push({ name, ok, detail });

const got = rows.map((r) => r.audited);
T(
  "① 覆盖率随 depth 严格递增（1 < 2 < 5）",
  rows.every((r) => r.audited === r.expectAudited && r.total === r.expectTotal) && got[0] < got[1] && got[1] < got[2],
  `实测 ${rows.map((r) => `${r.label}→${r.audited}/${r.total}`).join(" · ")}`,
);
T(
  "② 只有 {depth:3, detail:true} 能报出第 2 层节点（1:111 Title）上的问题",
  rows[0].deepIssue === false && rows[1].deepIssue === false && rows[2].deepIssue === true,
  `深审可用性 ${rows.map((r) => `${r.key}=${r.deepIssue}`).join(" / ")}`,
);
T(
  "③ 前两种浅回读必须如实报出（shallowWarning + 未参与节点数）",
  rows[0].shallowWarning &&
    rows[0].shallowNodes === rows[0].expectShallow &&
    rows[1].shallowWarning &&
    rows[1].shallowNodes === rows[1].expectShallow &&
    !rows[2].shallowWarning,
  `未参与检查的节点数 ${rows.map((r) => `${r.key}=${r.shallowNodes}`).join(" / ")}`,
);
const trueUnaudited = TRUE_TREE_NODES - 1;
T(
  "④ {depth:1} 报出的「未参与节点数」是下界（小于真树的未审节点数）",
  rows[0].shallowNodes < trueUnaudited,
  `depth1 报 ${rows[0].shallowNodes} · 真树未审 ${trueUnaudited}（漏掉的子树不在响应里，它数不全）`,
);

/* 非致命观察（不进 PASS/FAIL，只解释 geometryCoverage 为什么非存在不可）：
 * depth1 与 depth2 的**容器数**（shallowParents）都是 1 —— 只看「几个容器浅了」根本分不出差别；
 * 差别全在**节点数**（1 vs 3）。这就是「代理指标 vs 真实规模」的原型，也是 geometryCoverage 的由来。 */
const observations = [
  {
    name: "depth1 与 depth2 的「浅容器数」完全一样，差别只在节点数",
    detail: `shallowParents ${rows.map((r) => `${r.key}=${r.shallowParents}`).join(" / ")} ｜ shallowNodes ${rows.map((r) => `${r.key}=${r.shallowNodes}`).join(" / ")}`,
    same: rows[0].shallowParents === rows[1].shallowParents && rows[0].shallowNodes !== rows[1].shallowNodes,
    why: "容器数是代理指标、节点数才是规模：同报「1 个容器浅了」，而实际分别是 1 个 / 3 个节点一条检查都没跑到",
  },
];

const nFail = checks.filter((c) => !c.ok).length;

/* ---------------- 输出 ---------------- */

if (JSON_ONLY) {
  console.log(
    JSON.stringify(
      {
        tool: "layout-audit-readback-probe",
        contract: "figma-plugin/code.js 的 nodeInfo() 产出形状 ←→ layout-audit.mjs 可吃形状",
        rows,
        checks,
        observations,
        summary: { pass: checks.length - nFail, fail: nFail },
        _meta: {
          why: "跨模块契约：真 code.js 走真 execute(get-node) 的响应，喂给真工具。单元级变异测试用的是合成树，验的是「形状对了判得对不对」；本探针验的是「真形状是否就是那样」",
          freeze: "本探针只读冻结区（figma-plugin/code.js 由 figma-harness 以 vm 加载原文），不修改任何冻结文件",
        },
      },
      null,
      2,
    ),
  );
} else {
  console.log("\nlayout-audit-readback-probe   契约：code.js 的 nodeInfo() ←→ layout-audit 的输入");
  console.log("");
  console.log("  get-node 参数            覆盖率   深审可用   浅容器   未参与检查   问题条数   退出码");
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(22)} ${String(`${r.audited}/${r.total}`).padEnd(8)} ${String(r.deepIssue ? "是" : "否").padEnd(10)} ${String(r.shallowParents).padEnd(8)} ${String(r.shallowNodes).padEnd(12)} ${String(r.issues).padEnd(10)} ${r.exit}`,
    );
  }
  console.log("");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name} —— ${c.detail}`);
  console.log("");
  for (const o of observations) console.log(`  观察  ${o.name}：${o.detail}${o.same ? "（确实一样）" : "（不一致！）"}\n        ↳ ${o.why}`);
  console.log("");
  console.log(nFail ? `结果：${checks.length - nFail} PASS / ${nFail} FAIL —— 契约**破了**` : `结果：${checks.length} PASS / 0 FAIL —— 回读形状与工具输入契约成立`);
}

fs.rmSync(TMP, { recursive: true, force: true });
if (nFail) process.exit(1);
