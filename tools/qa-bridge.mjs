#!/usr/bin/env node
/**
 * qa-bridge.mjs — Bridge 端到端测试（不需要 Figma）
 *
 * 跑法：node tools/qa-bridge.mjs
 *
 * 做法：真起一个 bridge/server.js 子进程，再用一个 mock 插件客户端走真实的
 * /v1/hello → /v1/poll → /v1/result 长轮询链路。测的是真代码、真 HTTP、真并发，
 * 不是 mock 出来的假桥。
 *
 * 为什么存在：`POST /v1/batch` 的意义就是"别把 296 个 op 打成 296 次往返"，
 * 所以测试直接断言"插件只被调用了几次"——这类指标靠读代码是看不出来的。
 * 零依赖：只用 node 内置模块。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.QA_BRIDGE_PORT || 45690);
const TOKEN = "qa-bridge-token-0123456789";
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT = "qa-mock-plugin";

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

/* ---------------- mock 插件 ---------------- */
const mock = { cmdsReceived: 0, running: true };

function execute(cmd) {
  const { id } = cmd;
  // 单条 op：真插件会在这里执行真实 API，mock 只需如实回执，证明"同步拿到结果"这条链路成立。
  if (cmd.op !== "run") {
    return { id, ok: true, data: { op: cmd.op, echoed: cmd.params || {} } };
  }
  const ops = cmd.params.ops || [];
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op === "boom") {
      return { id, ok: false, error: { message: `Step ${i} ("boom") failed: simulated`, code: "STEP_FAILED", partial: results } };
    }
    results.push({ step: i, op: ops[i].op, ok: true, data: { created: { id: `node_${i}` } } });
  }
  return { id, ok: true, data: { ops: results, count: results.length } };
}

async function mockLoop() {
  await fetch(`${BASE}/v1/hello?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT, label: "qa-mock", info: { page: "QA" } }),
  });
  while (mock.running) {
    let body;
    try {
      body = await (await fetch(`${BASE}/v1/poll?token=${TOKEN}&client=${CLIENT}&wait=800`)).json();
    } catch {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    if (!body || !body.cmd) continue;
    mock.cmdsReceived++;
    await fetch(`${BASE}/v1/result?token=${TOKEN}&client=${CLIENT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(execute(body.cmd)),
    }).catch(() => {});
  }
}

async function post(pathname, payload) {
  const r = await fetch(`${BASE}${pathname}?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const mkSteps = (n, boomAt = []) =>
  Array.from({ length: n }, (_, i) => ({ op: boomAt.includes(i) ? "boom" : "create-rect", params: { name: `s${i}` } }));

/* ---------------- 起服务 ---------------- */
const bridge = spawn(
  process.execPath,
  [path.join(ROOT, "bridge", "server.js"), "--port", String(PORT), "--token", TOKEN, "--no-ipv6"],
  { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] }
);
let bridgeErr = "";
bridge.stderr.on("data", (d) => (bridgeErr += d));

try {
  await new Promise((r) => setTimeout(r, 700));

  console.log("\n/health —— 公开探活");

  await check("无 token 可访问，且上报服务身份与插件状态", async () => {
    const h = await (await fetch(`${BASE}/health`)).json();
    assert.equal(h.service, "agent-design-figma-bridge");
    assert.equal(h.ok, true);
    assert.equal(typeof h.plugin.connected, "boolean");
    assert.ok(h.endpoints && h.endpoints.batch, "health 应自述端点清单，便于发现 /v1/batch");
  });

  await check("无 token 调 /v1/command 返回 401", async () => {
    const r = await fetch(`${BASE}/v1/command`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401);
  });

  mockLoop();
  await new Promise((r) => setTimeout(r, 300));

  console.log("\nPOST /v1/command —— 单条 op");

  await check("单条 op 同步返回真实执行结果", async () => {
    const res = await post("/v1/command", { op: "ping", params: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "ok");
  });

  await check("缺 op 报 400 BAD_BODY", async () => {
    const res = await post("/v1/command", { params: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "BAD_BODY");
  });

  console.log("\nPOST /v1/batch —— 批量通道");

  await check("296 个 op 压到 8 次往返（而不是 296 次）", async () => {
    mock.cmdsReceived = 0;
    const res = await post("/v1/batch", { steps: mkSteps(296) });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.chunks, 8);
    assert.equal(mock.cmdsReceived, 8, `插件应只收到 8 次调用，实收 ${mock.cmdsReceived}`);
    assert.equal(res.body.results.length, 296);
    assert.equal(res.body.remaining, 0);
  });

  await check("results[].step 已重映射为全局序号", async () => {
    const res = await post("/v1/batch", { steps: mkSteps(100), chunkSize: 30 });
    assert.deepEqual(res.body.results.map((r) => r.step), Array.from({ length: 100 }, (_, i) => i));
    assert.equal(res.body.chunks, 4);
  });

  await check("onError=abort：停在断点，failedAt 指向真正失败那一步", async () => {
    mock.cmdsReceived = 0;
    const res = await post("/v1/batch", { steps: mkSteps(296, [100]), onError: "abort" });
    assert.equal(res.body.ok, false);
    assert.equal(res.body.status, "partial");
    assert.equal(res.body.failedAt.step, 100);
    assert.equal(res.body.failedAt.chunk, 2);
    assert.equal(res.body.failedAt.code, "STEP_FAILED");
    assert.equal(res.body.results.length, 100, "失败点之前的成果必须保留，好让调用方续跑");
    assert.equal(mock.cmdsReceived, 3, "abort 后不该再发后续 chunk");
  });

  await check("onError=continue：坏 chunk 之外照跑，报告 chunksRun", async () => {
    mock.cmdsReceived = 0;
    const res = await post("/v1/batch", { steps: mkSteps(296, [100, 250]), onError: "continue" });
    assert.equal(res.body.ok, false);
    assert.equal(mock.cmdsReceived, 8);
    assert.equal(res.body.chunksRun, 6, "8 个 chunk 里坏了 2 个");
    assert.equal(res.body.failedAt.step, 250, "记录最后一个失败点");
    assert.match(res.body.note, /onError=continue/);
  });

  await check("含 @last/$name 引用时不切片，并明确告知原因", async () => {
    mock.cmdsReceived = 0;
    const steps = mkSteps(120);
    steps[60] = { op: "create-rect", params: { parentId: "$card" } };
    const res = await post("/v1/batch", { steps, chunkSize: 10 });
    assert.equal(res.body.chunks, 1, "引用跨 chunk 会断，必须整批跑");
    assert.equal(res.body.referenced, true);
    assert.equal(mock.cmdsReceived, 1);
    assert.match(res.body.note, /single chunk/);
  });

  await check("非引用字段里的 $ 不被误判（如价格文本）", async () => {
    const res = await post("/v1/batch", {
      steps: [
        { op: "create-text", params: { characters: "$9.99" } },
        { op: "create-rect", params: {} },
        { op: "create-rect", params: {} },
      ],
      chunkSize: 1,
    });
    assert.equal(res.body.referenced, false);
    assert.equal(res.body.chunks, 3);
  });

  await check("参数校验：空 steps / op:run / 缺 op 一律 400", async () => {
    assert.equal((await post("/v1/batch", { steps: [] })).status, 400);
    assert.equal((await post("/v1/batch", { steps: [{ op: "run", params: {} }] })).status, 400);
    assert.equal((await post("/v1/batch", { steps: [{ params: {} }] })).status, 400);
    assert.equal((await post("/v1/batch", {})).status, 400);
  });

  await check("单步 batch 与 /v1/command 等价", async () => {
    const res = await post("/v1/batch", { steps: [{ op: "get-page-summary", params: {} }] });
    assert.equal(res.body.ok, true);
    assert.equal(res.body.results.length, 1);
    assert.equal(res.body.results[0].ok, true);
  });

  console.log("\n/v1/history —— 排查用");

  await check("能查到刚跑过的命令", async () => {
    const h = await (await fetch(`${BASE}/v1/history?n=50&token=${TOKEN}`)).json();
    assert.equal(h.ok, true);
    assert.ok(h.history.length > 0);
    assert.ok(h.history.some((x) => x.op === "run"), "批量命令也应进历史");
  });
} finally {
  mock.running = false;
  bridge.kill();
}

console.log("");
if (failures.length) {
  console.log(`${failures.length} 项失败（共 ${pass + failures.length} 项）：`);
  for (const f of failures) console.log(`  - ${f}`);
  if (bridgeErr.trim()) console.log(`\nbridge stderr:\n${bridgeErr.trim()}`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项`);
