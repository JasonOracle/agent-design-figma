#!/usr/bin/env node
/**
 * qa-plugin.mjs — 插件端回归测试（离线，不需要 Figma）
 *
 * 跑法：node tools/qa-plugin.mjs
 *
 * 为什么存在：`set-effects` 曾经对模糊类效果无条件写入 `color` 字段。Figma 对效果对象
 * 严格校验，多一个未知 key 就整条赋值抛错，于是 BACKGROUND_BLUR（毛玻璃的唯一实现路径）
 * 在任何新版 Figma 上都从未真正可用过——而当时的 QA 完全没覆盖 effect，所以一直没暴露。
 * 这个脚本用"像 Figma 一样严格"的校验桩把这类问题挡在提交之前。
 *
 * 做法：用 vm 加载真实的 figma-plugin/code.js（源码一字不改），只注入一个受控的
 * `figma` 桩，然后直接调用它内部的 handlers。装置见 `tools/figma-harness.mjs`
 * （与 `tools/precheck.mjs` 共用同一份桩与效果字段白名单——那份白名单是安全关键
 * 常量，粘贴第二份将来必然腐坏成两份不一致）。
 * 零依赖：只用 node 内置模块。
 */
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadPlugin } from "./figma-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- 装置：真源码 + 严格桩（effect 的 key 白名单就住在装置里）---- */
const harness = loadPlugin();
const handlers = harness.handlers;
const nodeInfo = harness.nodeInfo;
const execute = harness.execute;
const opNames = harness.opNames;
const nodes = harness.nodes;
const makeNode = (type, props) => harness.makeNode(type, props);

let pass = 0;
const failures = [];
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok    ${label}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${label}\n        ${e.message}`);
    failures.push(label);
  }
}

console.log("\nset-effects —— 效果对象字段形状");
console.log("  （背景模糊是毛玻璃的唯一实现路径，多写一个 key 就会全灭）");

await check("校验桩本身能抓出旧 bug 的写法（BACKGROUND_BLUR 带 color 必抛）", () => {
  const n = makeNode("FRAME");
  assert.throws(
    () => { n.effects = [{ type: "BACKGROUND_BLUR", radius: 20, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }]; },
    /Unrecognized key\(s\) in object: 'color'/
  );
});

await check("BACKGROUND_BLUR 只写 type/radius/visible", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({ id: n.id, effects: [{ type: "BACKGROUND_BLUR", radius: 20 }] });
  assert.deepEqual(Object.keys(n.effects[0]).sort(), ["radius", "type", "visible"]);
  assert.equal(n.effects[0].radius, 20);
});

await check("LAYER_BLUR 不带 color，且接受 blur/radius 两种写法", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({ id: n.id, effects: [{ type: "LAYER_BLUR", blur: 8 }] });
  assert.deepEqual(Object.keys(n.effects[0]).sort(), ["radius", "type", "visible"]);
  assert.equal(n.effects[0].radius, 8);
});

await check("DROP_SHADOW 仍带 color/offset/spread/blendMode", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({ id: n.id, effects: [{ type: "DROP_SHADOW", color: "#000000", opacity: 0.08, x: 0, y: 1, blur: 2 }] });
  const e = n.effects[0];
  assert.deepEqual(Object.keys(e).sort(), ["blendMode", "color", "offset", "radius", "spread", "type", "visible"]);
  assert.equal(e.radius, 2);
  assert.equal(e.offset.y, 1);
});

await check("INNER_SHADOW 与 DROP_SHADOW 同形状", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({ id: n.id, effects: [{ type: "INNER_SHADOW", color: "#FFFFFF", opacity: 0.3, y: 1, blur: 2 }] });
  assert.ok("color" in n.effects[0]);
  assert.equal(n.effects[0].type, "INNER_SHADOW");
});

await check("毛玻璃叠投影混排一次通过（旗舰场景）", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({
    id: n.id,
    effects: [
      { type: "BACKGROUND_BLUR", radius: 24 },
      { type: "DROP_SHADOW", color: "#000000", opacity: 0.06, y: 4, blur: 12 },
    ],
  });
  assert.equal(n.effects.length, 2);
  assert.equal("color" in n.effects[0], false);
  assert.equal("color" in n.effects[1], true);
});

await check("blur 简写 = 单个 LAYER_BLUR，无 color", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({ id: n.id, blur: 6 });
  assert.equal(n.effects.length, 1);
  assert.deepEqual(Object.keys(n.effects[0]).sort(), ["radius", "type", "visible"]);
});

await check("shadow 简写 = 单个 DROP_SHADOW，完整字段", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await handlers["set-effects"]({ id: n.id, shadow: { color: "#111111", y: 2, blur: 8 } });
  assert.equal(n.effects[0].type, "DROP_SHADOW");
  assert.equal(n.effects[0].radius, 8);
});

await check("clear:true 清空效果", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  n.effects = [{ type: "LAYER_BLUR", radius: 4, visible: true }];
  await handlers["set-effects"]({ id: n.id, clear: true });
  assert.equal(n.effects.length, 0);
});

await check("无参数的 set-effects 报 BAD_PARAM（不是静默成功）", async () => {
  const n = makeNode("FRAME");
  nodes.set(n.id, n);
  await assert.rejects(() => handlers["set-effects"]({ id: n.id }), (e) => e.code === "BAD_PARAM");
});

console.log("\nnodeInfo —— depth 与 detail 语义");

const grandchild = makeNode("TEXT", { id: "gc1", name: "标题" });
const child = makeNode("FRAME", { id: "c1", name: "卡片", children: [grandchild] });
const root = makeNode("FRAME", { id: "r1", name: "页面", children: [child] });
nodes.set("r1", root);

await check("depth:2 真的返回孙级节点", () => {
  const info = nodeInfo(root, { depth: 2 });
  assert.equal(info.children[0].id, "c1");
  assert.ok(Array.isArray(info.children[0].children), "depth:2 必须带孙级数组");
  assert.equal(info.children[0].children[0].id, "gc1");
});

await check("depth:1 保持原有轻量形状（不胀包）", () => {
  const info = nodeInfo(root, { depth: 1 });
  assert.deepEqual(Object.keys(info.children[0]).sort(), ["id", "name", "type"]);
  assert.equal("children" in info.children[0], false);
});

await check("detail:true 递归携带样式态", () => {
  const info = nodeInfo(root, { depth: 2, detail: true });
  assert.equal(info.children[0].children[0].id, "gc1");
  assert.ok("width" in info.children[0].children[0]);
});

await check("depth:0 不带 children，但保留 childCount", () => {
  const info = nodeInfo(root, { depth: 0 });
  assert.equal("children" in info, false);
  assert.equal(info.childCount, 1);
});

console.log("\nget-node —— 参数校验");

await check("缺 id 报 BAD_PARAM", async () => {
  await assert.rejects(() => handlers["get-node"]({}), (e) => e.code === "BAD_PARAM");
});

await check("不存在的 id 报 NODE_NOT_FOUND", async () => {
  await assert.rejects(() => handlers["get-node"]({ id: "404:404" }), (e) => e.code === "NODE_NOT_FOUND");
});

console.log("\nrun —— 批量引用语法");

await check("直接调未知 op 报 UNSUPPORTED_OP 并回显全部合法 op 清单", async () => {
  await assert.rejects(
    () => execute("definitely-not-an-op", {}),
    (e) => e.code === "UNSUPPORTED_OP" && /Supported: .*create-frame/.test(e.message)
  );
});

await check("op 清单覆盖到 36 个（不含 run 批量壳）", () => {
  assert.equal(opNames.length, 36, `实际 ${opNames.length}: ${opNames.join(",")}`);
  assert.ok(!opNames.includes("run"), "run 是批量壳，不计入可单独调用的 op");
  assert.ok(opNames.includes("set-effects") && opNames.includes("export-node"));
});

await check("run 内未知 op 报 UNSUPPORTED_OP 并指出是第几步", async () => {
  await assert.rejects(
    () => handlers.run({ ops: [{ op: "definitely-not-an-op", params: {} }] }),
    (e) => e.code === "UNSUPPORTED_OP" && /Step 0/.test(e.message)
  );
});

await check("$name 引用未声明时报 BAD_PARAM", async () => {
  await assert.rejects(
    () => handlers.run({ ops: [{ op: "create-rect", params: { parentId: "$nope", width: 1, height: 1 } }] }),
    (e) => e.code === "BAD_PARAM"
  );
});

await check("空 ops 数组报 BAD_PARAM", async () => {
  await assert.rejects(() => handlers.run({ ops: [] }), (e) => e.code === "BAD_PARAM");
});

console.log("");
if (failures.length) {
  console.log(`${failures.length} 项失败（共 ${pass + failures.length} 项）：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项`);
