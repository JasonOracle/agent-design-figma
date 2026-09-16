#!/usr/bin/env node
/**
 * precheck-mutation.mjs — precheck.mjs 的配套变异测试（1.2 · B1）
 *
 * 依 `references/lessons.md` #33 的通则：**校验器没有配套变异测试，它的"全绿"就没有意义**
 * ——一个永远返回 OK 的脚本也能全绿。
 *
 * 做法：在临时目录里造计划文件，逐项注入已知错误，断言 precheck 的**退出码与输出**都符合预期。
 *
 * 覆盖五组共 63 条断言：
 *  A 应报错（exit 1）：未知 op · 嵌套 run · 未声明 $name · 首步 @last · 引用给错字段 ·
 *     params 非对象 · as 非字符串 · 步骤非对象 ·
 *     缺必填（set-name 无 name）· 数值非数 · 颜色格式错 · **效果多写 key（1.1 的 P0 现场）** ·
 *     FILL 缺自动布局父级
 *  B 应拒收（exit 2）：形状认不出 · DS Spec 误当计划
 *  C 应通过（exit 0）：合法基准 · 裸数组形状 · {ops:…} 形状 · 含字面 id（只算「待核对」，不是错）
 *  D 结构性断言：
 *     · 一次报全部 —— 验证非 fail-fast（`run` 一次只报第一个，本工具必须全报）
 *     · 36 op 全通跑 —— 锁住离线装置对全部 op 都不缺件（0 错误 0 装置缺口）
 *     · 核实「静默丢弃」前提 —— 直接问真源码：模糊类多写的 color 与不写**逐字一致**
 *       （证明它是被丢弃而不是报错，这才使 precheck 的静态拦成为必要且唯一可行的手段）
 *  E B2 在线核对（真 Bridge + mock 插件，端到端）：
 *     · id 存在 → 通过 · id 缺失 → 报出「哪一步的哪个 id」
 *     · 插件在册但不应答（超时）→ 报「意外响应」并失败
 *     · 插件从未连接（/health 直接说未连接）→ 当场判失败，不发命令
 *     两种离线都**不得**把没查说成「全部存在于画布」
 *
 * 用法：node tools/precheck-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。B2 段会临时占用端口 45691 与 45692（可用 QA_PRECHECK_PORT 覆盖）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRECHECK = path.join(HERE, "precheck.mjs");
const GOOD = path.join(HERE, "..", "assets", "examples", "example-health.ops.json");

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const FX = fs.mkdtempSync(path.join(os.tmpdir(), "precheck-mut-"));
const PLAN = path.join(FX, "plan.json");

/** 用给定内容跑一次 precheck，返回 {status, out} */
function run(content, args = []) {
  fs.writeFileSync(PLAN, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  const r = spawnSync(process.execPath, [PRECHECK, PLAN, "--quiet", ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/**
 * 异步版：`spawnSync` 会**阻塞 Node 事件循环**，而 B2 的 mock 插件是靠同一进程里的
 * 异步轮询循环应答的——用同步版跑，mock 永远没机会执行，会被 bridge 判成
 * 「插件未领取命令（NOT_PICKED_UP）」。测真链路就必须让出事件循环。
 */
function runAsync(content, args = []) {
  fs.writeFileSync(PLAN, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [PRECHECK, PLAN, "--quiet", ...args]);
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ status: code, out }));
  });
}

/** 断言：退出码 + 输出里有这些关键词 */
function expect(label, content, status, keywords = []) {
  const r = run(content);
  check(r.status === status, `${label} 退出码应为 ${status}（实际 ${r.status}）`);
  for (const k of keywords) {
    const ok = k instanceof RegExp ? k.test(r.out) : r.out.includes(k);
    check(ok, `${label} 输出应含 ${k}`);
  }
  return r;
}

/* ---------------- 基准 ---------------- */
const goodPlan = JSON.parse(fs.readFileSync(GOOD, "utf8"));

/* 1. 合法基准：零误报 */
{
  const r = run(goodPlan);
  check(r.status === 0, `合法基准退出码应为 0（实际 ${r.status}）`);
  check(/PRECHECK OK/.test(r.out), "合法基准应输出 PRECHECK OK");
  check(!/FAIL/.test(r.out), "合法基准不该有任何 FAIL");
  check(/待核对的外部引用 1 个/.test(r.out), "合法基准的字面 id 应被归入「待核对」而非错误");
}

const S = (op, params, as) => {
  const s = { op, params: params || {} };
  if (as !== undefined) s.as = as;
  return s;
};
/** 一个最小可用的两步行；作为注入错误的底座 */
const base = [S("create-frame", { name: "根", width: 320, height: 640 }, "root"), S("set-name", { id: "$root", name: "根" })];

/* ---------------- 结构错误 ---------------- */
expect("未知 op 名", { steps: [S("create-framee", {})] }, 1, [/未知 op/, /相近/]);
expect("嵌套 run", { steps: [S("run", { ops: [] })] }, 1, [/不要嵌套/]);
expect("$name 未声明", { steps: [...base, S("set-name", { id: "$nope", name: "x" })] }, 1, [/\$nope/, /没有更早的步骤/]);
expect("@last 出现在首步", { steps: [S("set-name", { id: "@last", name: "x" })] }, 1, [/@last/, /前面没有任何步骤创建过节点/]);
expect("引用写进非引用字段", { steps: [S("create-rect", { fill: "$root" })] }, 1, [/只能出现在节点引用字段/]);
expect("params 不是对象", { steps: [S("create-frame", {}), { op: "set-name", params: "oops" }] }, 1, [/`params` 必须是对象/]);
expect("as 不是字符串", { steps: [{ op: "create-frame", params: {}, as: 123 }] }, 1, [/`as` 必须是字符串/]);
expect("步骤不是对象", { steps: ["hello"] }, 1, [/步骤不是对象/]);

/* ---------------- 契约错误（靠真源码判定） ---------------- */
expect("缺必填参数（set-name 无 name）", { steps: [...base, S("set-name", { id: "$root" })] }, 1, [/BAD_PARAM/]);
expect("数值参数非数（create-rect width:\"abc\"）", { steps: [S("create-rect", { width: "abc" })] }, 1, [/Invalid number for "width"/]);
expect("颜色格式错（set-fill color:\"nope\"）", { steps: [...base, S("set-fill", { id: "$root", color: "nope" })] }, 1, [/Invalid hex colour/]);
expect(
  "效果多写 key（BACKGROUND_BLUR 带 color）—— 1.1 的 P0 现场",
  { steps: [...base, S("set-effects", { id: "$root", effects: [{ type: "BACKGROUND_BLUR", radius: 20, color: "#000000" }] })] },
  1,
  [/静默丢弃/, /"color"/],
);
expect(
  "FILL 遇上非自动布局父级",
  { steps: [S("create-frame", { name: "外", width: 320, height: 640 }, "outer"), S("create-rect", { name: "内", parentId: "$outer", width: 10, height: 10 }, "inner"), S("set-layout-sizing", { id: "$inner", horizontal: "FILL" })] },
  1,
  [/NO_AUTO_LAYOUT_PARENT/],
);

/* ---------------- 核实「静默丢弃」这个前提本身 ---------------- */
/* precheck 之所以要**静态**拦效果字段，前提是「多了的 key 跑起来既不报错也不生效」。
   这条前提必须被证明，否则那个静态检查就是凭印象写的。这里直接问真源码要答案。 */
{
  const { loadPlugin } = await import("./figma-harness.mjs");
  const hh = loadPlugin();
  const mk = () => hh.register(hh.makeNode("FRAME", { id: `probe:${Math.random()}` }));

  const norm = async (eff) => {
    const n = mk();
    await hh.handlers["set-effects"]({ id: n.id, effects: [eff] });
    return JSON.stringify(n.effects);
  };

  const plain = await norm({ type: "BACKGROUND_BLUR", radius: 8 });
  const withColor = await norm({ type: "BACKGROUND_BLUR", radius: 8, color: "#FF0000" });
  check(
    plain === withColor,
    "核实前提：BACKGROUND_BLUR 多写 color —— 归一化结果与不写**逐字一致**（证明是被静默丢弃，不是报错）",
  );
  check(!/"color"/.test(withColor), "核实前提：模糊类归一化结果里根本没有 color 字段");

  // 反向用例：影子类**确实**读 color。防"静态检查把合法字段也误拦"
  const shadow = await norm({ type: "DROP_SHADOW", color: "#FF0000", blur: 4 });
  check(/"color"/.test(shadow) && /"r":1/.test(shadow), `反向：DROP_SHADOW 的 color 确实被读取并转换（#FF0000 → r=1）\n        ${shadow}`);
}

/* ---------------- 一次报全部（非 fail-fast） ---------------- */
{
  const r = run({
    steps: [
      S("create-framee", {}),                       // 未知 op
      S("create-frame", { name: "根", width: 320, height: 640 }, "root"),
      S("set-name", { id: "$root" }),               // 缺必填
      S("set-name", { id: "$ghost", name: "x" }),   // 未声明引用
    ],
  });
  check(r.status === 1, `一次报全部：退出码应为 1（实际 ${r.status}）`);
  check(/未知 op/.test(r.out), "一次报全部：应报出未知 op");
  check(/BAD_PARAM/.test(r.out), "一次报全部：应报出缺必填参数");
  check(/\$ghost/.test(r.out), "一次报全部：应报出未声明引用");
  const n = (r.out.match(/FAIL {2}/g) || []).length;
  check(n >= 3, `一次报全部：应至少报出 3 条 FAIL（实际 ${n}）—— run 是 fail-fast 的，本工具必须全报`);
}

/* ---------------- 形状 / 用法 ---------------- */
expect("形状认不出", { foo: 1, bar: 2 }, 2, [/认不出计划的形状/]);
expect("DS Spec 误当计划", { brand: {}, buildPlan: { strategy: "s", batches: [] } }, 2, [/这不是 op 序列/, /qa-l2/]);
{
  const r = run(base); // 裸数组
  check(r.status === 0 && /PRECHECK OK/.test(r.out), "裸数组形状应通过");
}
{
  const r = run({ ops: base }); // 插件 run 载荷
  check(r.status === 0 && /PRECHECK OK/.test(r.out), "{ops:…} 形状应通过");
}
{
  const r = run({ steps: [...base, S("get-node", { id: "1:2", depth: 1 })] });
  check(r.status === 0, `字面 id 不应算错误（实际 ${r.status}）`);
  check(/待核对/.test(r.out) && /1:2/.test(r.out), "字面 id 应进「待核对」并列出具体 id");
}

/* ---------------- 36 个 op 全通跑：锁住装置完整度 ---------------- */
{
  const cover = [
    S("ping", {}),
    S("create-frame", { name: "f", width: 320, height: 640, fill: "#FFFFFF" }, "f"),
    S("create-rect", { name: "r", parentId: "$f", width: 40, height: 40, fill: "#EEEEEE", cornerRadius: 8 }, "r"),
    S("create-text", { characters: "文本", parentId: "$f", fontSize: 14, fill: "#101828" }, "t"),
    S("create-ellipse", { name: "e", parentId: "$f", width: 24, height: 24, fill: "#DDDDDD" }, "e"),
    S("create-line", { name: "l", parentId: "$f", length: 40, stroke: "#CCCCCC" }, "l"),
    S("create-vector", { name: "v", parentId: "$f", points: [[0, 0], [10, 10]], stroke: "#999999" }, "v"),
    S("set-name", { id: "$f", name: "根" }),
    S("set-fill", { id: "$r", color: "#123456" }),
    S("set-stroke", { id: "$r", color: "#000000", strokeWeight: 1 }),
    S("set-opacity", { id: "$r", opacity: 0.5 }),
    S("set-corner-radius", { id: "$r", radius: 6 }),
    S("set-font", { id: "$t", family: "Inter", style: "Regular" }),
    S("set-font-size", { id: "$t", size: 14 }),
    S("set-font-weight", { id: "$t", weight: 600 }),
    S("set-text-color", { id: "$t", color: "#101828" }),
    S("set-text-content", { id: "$t", characters: "改过" }),
    S("set-auto-layout", { id: "$f", mode: "VERTICAL" }),
    S("set-padding", { id: "$f", all: 16 }),
    S("set-item-spacing", { id: "$f", spacing: 8 }),
    S("set-primary-axis-align", { id: "$f", align: "MIN" }),
    S("set-counter-axis-align", { id: "$f", align: "MIN" }),
    S("append-child", { parentId: "$f", childId: "$r" }),
    S("create-component", { from: "$l", name: "DS/Line" }, "c"),
    S("create-instance", { componentId: "$c", parentId: "$f" }, "i"),
    S("set-effects", { id: "$f", effects: [{ type: "BACKGROUND_BLUR", radius: 12 }, { type: "DROP_SHADOW", color: "#000000", opacity: 0.06, y: 2, blur: 8 }] }),
    S("set-text-align", { id: "$t", horizontal: "CENTER" }),
    S("set-text-autoresize", { id: "$t", mode: "WIDTH_AND_HEIGHT" }),
    S("set-layout-sizing", { id: "$f", horizontal: "HUG" }),
    S("move-node", { id: "$r", dx: 1 }),
    S("resize-node", { id: "$r", width: 44, height: 44 }),
    S("duplicate-node", { id: "$r", name: "r copy" }, "d"),
    S("delete-node", { id: "$d" }),
    S("export-node", { id: "$f", format: "PNG", scale: 1 }),
    S("get-node", { id: "$f", depth: 2, detail: true }),
    S("get-page-summary", {}),
  ];
  const r = run({ steps: cover });
  check(r.status === 0, `36 op 全通跑应通过（实际 ${r.status}）\n${r.out}`);
  check(/错误 0 ｜ 装置缺口 0/.test(r.out), `36 op 全通跑应 0 错误 0 装置缺口（输出：${(r.out.match(/\d+ 步：通过.*/) || ["?"])[0]}）`);
  check(/通过 36/.test(r.out), "36 op 全通跑应 36 步全通过");
}

/* ---------------- B2 在线核对（真 Bridge + mock 插件，端到端） ---------------- */
/* `--live` 只在连上真 Bridge 时才有意义，离线测不出来。这里起一个真的 bridge/server.js
   子进程 + mock 插件走完整长轮询，把两个方向都钉住：id 存在 → 通过；id 缺失 → 报出
   「哪一步的哪个 id」。 */
{
  const PORT = Number(process.env.QA_PRECHECK_PORT || 45691);
  const TOKEN = "precheck-live-token-0123456789";
  const BASE = `http://127.0.0.1:${PORT}`;
  const CLIENT = "precheck-mock-plugin";
  const KNOWN = new Set(["1:2"]); // 假装画布上"已存在"的节点
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bridge = spawn(
    process.execPath,
    [path.join(HERE, "..", "bridge", "server.js"), "--port", String(PORT), "--token", TOKEN, "--no-ipv6"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let bridgeErr = "";
  bridge.stderr.on("data", (d) => (bridgeErr += d));

  let running = true;
  const mockLoop = async () => {
    await fetch(`${BASE}/v1/hello?token=${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT, label: "precheck-mock" }),
    }).catch(() => {});
    while (running) {
      let body;
      try {
        body = await (await fetch(`${BASE}/v1/poll?token=${TOKEN}&client=${CLIENT}&wait=500`)).json();
      } catch {
        await sleep(50);
        continue;
      }
      if (!body || !body.cmd) continue;
      // 已"掉线"就**连在途命令也不回**：否则这条长轮询会把停摆前的最后一条命令答掉，
      // 「插件不应答」就退化成赌时序（Bridge 判定插件在线的窗口是 45s，短 sleep 追不上）。
      if (!running) break;
      const cmd = body.cmd;
      const id = cmd.params && cmd.params.id;
      const reply =
        cmd.op === "get-node" && !KNOWN.has(id)
          ? { id: cmd.id, ok: false, error: { message: `Node not found: ${id}`, code: "NODE_NOT_FOUND" } }
          : { id: cmd.id, ok: true, data: { id, name: "已知节点", type: cmd.op === "get-node" ? "FRAME" : undefined } };
      await fetch(`${BASE}/v1/result?token=${TOKEN}&client=${CLIENT}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reply),
      }).catch(() => {});
    }
  };

  try {
    await sleep(700);
    mockLoop();
    await sleep(300);
    const liveArgs = ["--live", "--port", String(PORT), "--token", TOKEN];
    const withId = (id) => ({ steps: [...base, S("get-node", { id, depth: 1 })] });

    // 方向一：id 存在 → 通过
    {
      const r = await runAsync(withId("1:2"), liveArgs);
      check(r.status === 0, `B2：id 存在时应通过（实际 ${r.status}）\n${r.out}${bridgeErr}`);
      check(/外部引用全部存在于画布/.test(r.out), "B2：id 存在时报告「全部存在于画布」");
    }
    // 方向二：id 缺失 → 报出「哪一步的哪个 id」
    {
      const r = await runAsync(withId("9:9"), liveArgs);
      check(r.status === 1, `B2：id 缺失时应失败（实际 ${r.status}）\n${r.out}`);
      check(/step 2 \(get-node\) 的 id = 9:9/.test(r.out), `B2：应报出具体是哪一步的哪个 id 缺失\n${r.out}`);
      check(/画布上不存在这个节点/.test(r.out), "B2：应说明该节点在画布上不存在");
      check(!/全部存在于画布/.test(r.out), "B2：核出缺失时**不得**同时说「全部存在于画布」");
    }
    // 边界一：插件在册但不应答（挂死 / 已关但还没过 Bridge 的 45s stale 窗口）→ 必须超时报「意外响应」。
    // 这里**不能**靠"停掉轮询再睡 300ms"假装掉线：Bridge 判定插件在线的窗口是 45s（`PLUGIN_STALE_MS`），
    // 而 mock 的在途长轮询最长 500ms，短睡只会让 mock 把最后一条命令答掉——那这条用例就在赌时序，
    // 实测会偶发假绿。确定性来自 mock 侧「停摆后连在途命令也不回」，不是来自等更久。
    {
      running = false;
      await sleep(300);
      const r = await runAsync(withId("1:2"), liveArgs);
      check(r.status === 1, `B2：插件在册但不应答时应失败而不是静默通过（实际 ${r.status}）\n${r.out}`);
      check(/意外响应/.test(r.out), "B2：插件不应答时应报「意外响应」，不得当作通过");
      check(!/全部存在于画布/.test(r.out), "B2：没核成时**不得**说「全部存在于画布」（不许把没查说成查过了）");
    }

    // 边界二：插件从未连接（/health 直接说未连接）→ 当场判失败，不发命令。
    // 用一台**全新**的 Bridge：否则要等满 45s 才等到 stale。
    {
      const PORT2 = PORT + 1;
      const bridge2 = spawn(
        process.execPath,
        [path.join(HERE, "..", "bridge", "server.js"), "--port", String(PORT2), "--token", TOKEN, "--no-ipv6"],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let err2 = "";
      bridge2.stderr.on("data", (d) => (err2 += d));
      try {
        await sleep(700);
        const r = await runAsync(withId("1:2"), ["--live", "--port", String(PORT2), "--token", TOKEN]);
        check(r.status === 1, `B2：无插件连接时应失败（实际 ${r.status}）\n${r.out}${err2}`);
        check(/未连接|核对不了/.test(r.out), "B2：无插件连接时应明确报出「核对不了」");
        check(!/全部存在于画布/.test(r.out), "B2：无插件连接时不得说「全部存在于画布」");
      } finally {
        bridge2.kill();
      }
    }
  } finally {
    running = false;
    bridge.kill();
  }
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
  console.log(`\n结果：${pass.length} PASS / ${fail.length} FAIL —— precheck 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL —— precheck 变异测试 ALL GREEN（能抓错、不误报）`);
